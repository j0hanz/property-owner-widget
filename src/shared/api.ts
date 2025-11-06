import type {
  DataSourceManager,
  FeatureDataRecord,
  FeatureLayerDataSource,
  QueryOptions,
} from "jimu-core";
import { loadArcGISJSAPIModules } from "jimu-arcgis";
import { OWNER_QUERY_CONCURRENCY } from "../config/constants";
import type {
  AttributeMap,
  FeatureLayerConstructor,
  FnrValue,
  GridRowData,
  OwnerAttributes,
  OwnerFetchSuccess,
  OwnerQueryResolution,
  ProcessingAccumulator,
  ProcessPropertyResult,
  PromiseUtilsLike,
  PropertyAttributes,
  PropertyBatchQueryParams,
  PropertyIndividualQueryParams,
  PropertyProcessingContext,
  PropertySelectionPipelineParams,
  PropertySelectionPipelineResult,
  QueryConstructor,
  QueryResult,
  QueryTaskConstructor,
  QueryTaskLike,
  RelationshipQueryConstructor,
  SignalOptions,
  ValidateDataSourcesParams,
  ValidatedProperty,
  ValidationResult,
} from "../config/types";
import {
  abortHelpers,
  buildFnrWhereClause,
  buildPropertyRows,
  calculatePropertyUpdates,
  createRowId,
  createValidationError,
  deriveToggleState,
  extractFnr,
  formatOwnerInfo,
  formatPropertyWithShare,
  getDataSourceUrl,
  isAbortError,
  isValidArcGISUrl,
  normalizeFnrKey,
  parseArcGISError,
  processOwnerResult,
  processPropertyQueryResults,
} from "./utils/index";

// Global module cache - loaded once per session
let cachedFeatureLayerCtor: FeatureLayerConstructor | null = null;
let cachedQueryCtor: QueryConstructor | null = null;
let cachedQueryTaskCtor: QueryTaskConstructor | null = null;
let cachedRelationshipQueryCtor: RelationshipQueryConstructor | null = null;
let cachedPromiseUtils: PromiseUtilsLike | null = null;

// Instance caches - cleared on widget unmount
const featureLayerCache = new Map<string, __esri.FeatureLayer>();
const relationshipQueryTaskCache = new Map<string, QueryTaskLike>();

const getPromiseUtils = async (): Promise<PromiseUtilsLike> => {
  if (cachedPromiseUtils) {
    return cachedPromiseUtils;
  }

  const [promiseUtils] = (await loadArcGISJSAPIModules([
    "esri/core/promiseUtils",
  ])) as [PromiseUtilsLike];

  cachedPromiseUtils = promiseUtils;
  return promiseUtils;
};

const createSignalOptions = (
  signal?: AbortSignal
): SignalOptions | undefined => (signal ? { signal } : undefined);

const toDataSourceQueryOptions = (
  signalOptions: SignalOptions | undefined
): QueryOptions | undefined =>
  signalOptions ? (signalOptions as unknown as QueryOptions) : undefined;

const clearFeatureLayerCache = (): void => {
  featureLayerCache.forEach((layer) => {
    if (typeof layer.destroy === "function") {
      layer.destroy();
    }
  });
  featureLayerCache.clear();
  relationshipQueryTaskCache.forEach((task) => {
    const destroy = (task as { destroy?: () => void }).destroy;
    if (typeof destroy === "function") {
      destroy.call(task);
    }
  });
  relationshipQueryTaskCache.clear();
  cachedPromiseUtils = null;
};

const appendRowsForValidatedProperty = (
  accumulator: {
    rows: GridRowData[];
    graphics: Array<{ graphic: __esri.Graphic; fnr: FnrValue }>;
  },
  params: {
    validated: ValidatedProperty;
    owners: OwnerAttributes[];
    ownerQueryFailed: boolean;
    maskPII: boolean;
    context: PropertyProcessingContext;
  }
) => {
  const { rows, graphics } = accumulator;
  const { validated, owners, ownerQueryFailed, maskPII, context } = params;

  const builtRows = buildPropertyRows(
    validated,
    owners,
    ownerQueryFailed,
    maskPII,
    context
  );

  if (builtRows.length > 0) {
    rows.push(...builtRows);
  }

  graphics.push({
    graphic: validated.graphic,
    fnr: validated.fnr,
  });
};

const toOwnerAttributes = (
  graphic: __esri.Graphic | null | undefined
): OwnerAttributes | null => {
  if (!graphic?.attributes) {
    return null;
  }
  return graphic.attributes as OwnerAttributes;
};

const shouldSkipOwnerResult = (
  result: OwnerQueryResolution,
  helpers: PropertyProcessingContext["helpers"]
): { skip: boolean; reason?: "aborted" | "invalid_value" } => {
  if (result.error) {
    if (helpers.isAbortError(result.error)) {
      return { skip: true, reason: "aborted" };
    }
    return { skip: false };
  }

  if (!result.value) {
    return { skip: true, reason: "invalid_value" };
  }

  return { skip: false };
};

const validateAndDeduplicateProperties = (
  propertyResults: QueryResult[],
  extractFnrFn: (attrs: AttributeMap | null | undefined) => FnrValue | null,
  maxResults?: number
): ValidatedProperty[] => {
  const limit =
    typeof maxResults === "number" ? maxResults : propertyResults.length;
  const seenFnrs = new Map<string, ValidatedProperty>();
  const len = propertyResults.length;

  // Performance: Direct indexed loop faster than for-of for large arrays
  for (let i = 0; i < len && seenFnrs.size < limit; i++) {
    const result = propertyResults[i];
    const features = result?.features;
    if (!features || features.length === 0) {
      continue;
    }

    const feature = features[0];
    if (!feature?.attributes || !feature.geometry) {
      continue;
    }

    const fnr = extractFnrFn(
      feature.attributes as AttributeMap | null | undefined
    );
    if (fnr == null) {
      continue;
    }

    const normalized = normalizeFnrKey(fnr);
    if (seenFnrs.has(normalized)) {
      continue;
    }

    seenFnrs.set(normalized, {
      fnr,
      attrs: feature.attributes as PropertyAttributes,
      graphic: feature,
    });
  }

  return Array.from(seenFnrs.values());
};

const fetchOwnerDataForProperty = async (
  validated: ValidatedProperty,
  context: PropertyProcessingContext,
  config: { ownerDataSourceId: string }
): Promise<OwnerFetchSuccess> => {
  const { dsManager, signal, helpers } = context;
  try {
    abortHelpers.throwIfAborted(signal);

    const graphics = await helpers.queryOwnerByFnr(
      validated.fnr,
      config.ownerDataSourceId,
      dsManager,
      { signal }
    );

    const owners = graphics
      .map((graphic) => toOwnerAttributes(graphic))
      .filter((attrs): attrs is OwnerAttributes => Boolean(attrs));

    return { validated, owners, queryFailed: false };
  } catch (error) {
    if (helpers.isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    return { validated, owners: [], queryFailed: true };
  }
};

const processBatchOfProperties = async (params: {
  batch: ValidatedProperty[];
  currentRowCount: number;
  context: PropertyProcessingContext;
  config: { ownerDataSourceId: string; enablePIIMasking: boolean };
}): Promise<ProcessingAccumulator> => {
  const { batch, context, config, currentRowCount } = params;
  const { helpers, maxResults } = context;

  const promiseUtils = await getPromiseUtils();
  abortHelpers.throwIfAborted(context.signal);

  const ownerData = await promiseUtils.eachAlways(
    batch.map((validated) =>
      fetchOwnerDataForProperty(validated, context, {
        ownerDataSourceId: config.ownerDataSourceId,
      })
    )
  );

  const accumulator: ProcessingAccumulator = {
    rows: [],
    graphics: [],
  };

  const remainingCapacity = maxResults - currentRowCount;
  if (remainingCapacity <= 0) {
    return accumulator;
  }

  for (let index = 0; index < ownerData.length; index += 1) {
    if (accumulator.rows.length >= remainingCapacity) {
      break;
    }

    const resolution = ownerData[index];
    const validated = batch[index];
    const skip = shouldSkipOwnerResult(resolution, helpers);

    if (
      skip.skip &&
      (skip.reason === "aborted" || skip.reason === "invalid_value")
    ) {
      continue;
    }

    const shouldStop = processOwnerResult({
      resolution,
      validated,
      context,
      maskPII: config.enablePIIMasking,
      accumulator,
      currentRowCount,
      maxResults,
    });

    if (shouldStop) {
      break;
    }
  }

  return accumulator;
};

export const clearQueryCache = (): void => {
  clearFeatureLayerCache();
};

export const validateDataSources = (
  params: ValidateDataSourcesParams
): ValidationResult<{ manager: DataSourceManager }> => {
  const { propertyDsId, ownerDsId, dsManager, allowedHosts, translate } =
    params;

  if (!propertyDsId || !ownerDsId) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "missing_data_sources"
    );
  }

  if (!dsManager) {
    return createValidationError(
      "QUERY_ERROR",
      translate("errorQueryFailed"),
      "no_data_source_manager"
    );
  }

  const propertyDs = dsManager.getDataSource(
    propertyDsId
  ) as FeatureLayerDataSource | null;
  if (!propertyDs) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "property_data_source_missing"
    );
  }

  const ownerDs = dsManager.getDataSource(
    ownerDsId
  ) as FeatureLayerDataSource | null;
  if (!ownerDs) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "owner_data_source_missing"
    );
  }

  const propertyUrl = getDataSourceUrl(propertyDs);
  if (!propertyUrl) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "property_missing_url"
    );
  }

  if (!isValidArcGISUrl(propertyUrl, allowedHosts)) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorHostNotAllowed"),
      "property_disallowed_host"
    );
  }

  const ownerUrl = getDataSourceUrl(ownerDs);
  if (!ownerUrl) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "owner_missing_url"
    );
  }

  if (!isValidArcGISUrl(ownerUrl, allowedHosts)) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorHostNotAllowed"),
      "owner_disallowed_host"
    );
  }

  return { valid: true, data: { manager: dsManager } };
};

export const queryPropertyByPoint = async (
  point: __esri.Point,
  dataSourceId: string,
  dsManager: DataSourceManager,
  options?: { signal?: AbortSignal }
): Promise<QueryResult[]> => {
  try {
    abortHelpers.throwIfAborted(options?.signal);

    const ds = dsManager.getDataSource(
      dataSourceId
    ) as FeatureLayerDataSource | null;
    if (!ds) {
      throw new Error("Property data source not found");
    }

    const layerUrl = ds.url;
    if (!layerUrl) {
      throw new Error("Data source URL not available");
    }

    if (!cachedFeatureLayerCtor || !cachedQueryCtor) {
      const [FeatureLayer, Query] = (await loadArcGISJSAPIModules([
        "esri/layers/FeatureLayer",
        "esri/rest/support/Query",
      ])) as [FeatureLayerConstructor, QueryConstructor];
      cachedFeatureLayerCtor = FeatureLayer;
      cachedQueryCtor = Query;
    }

    if (!cachedFeatureLayerCtor || !cachedQueryCtor) {
      throw new Error("Failed to load ArcGIS query modules");
    }

    const FeatureLayer = cachedFeatureLayerCtor;
    const Query = cachedQueryCtor;

    let layer = featureLayerCache.get(layerUrl);
    if (!layer) {
      layer = new FeatureLayer({
        url: layerUrl,
        outFields: ["*"],
      });
      featureLayerCache.set(layerUrl, layer);

      // Ensure layer is loaded before querying
      try {
        await layer.load(createSignalOptions(options?.signal));
        abortHelpers.throwIfAborted(options?.signal);
      } catch (loadError) {
        featureLayerCache.delete(layerUrl);
        throw loadError instanceof Error
          ? loadError
          : new Error(String(loadError));
      }
    }

    const query = new Query({
      geometry: point,
      returnGeometry: true,
      outFields: ["*"],
      spatialRelationship: "intersects",
      returnZ: false,
      returnM: false,
    });

    const result = await layer.queryFeatures(
      query,
      createSignalOptions(options?.signal)
    );

    abortHelpers.throwIfAborted(options?.signal);

    if (!result?.features || result.features.length === 0) {
      return [];
    }

    return result.features.map((feature: __esri.Graphic) => {
      const attrs = feature.attributes as PropertyAttributes;
      return {
        features: [feature],
        propertyId: attrs.FNR,
      };
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    throw new Error(parseArcGISError(error, "Property query failed"));
  }
};

export const queryOwnerByFnr = async (
  fnr: FnrValue,
  dataSourceId: string,
  dsManager: DataSourceManager,
  options?: { signal?: AbortSignal }
): Promise<__esri.Graphic[]> => {
  try {
    abortHelpers.throwIfAborted(options?.signal);

    const ds = dsManager.getDataSource(
      dataSourceId
    ) as FeatureLayerDataSource | null;
    if (!ds) {
      throw new Error("Owner data source not found");
    }

    const signalOptions = createSignalOptions(options?.signal);

    const result = await ds.query(
      {
        where: buildFnrWhereClause(fnr),
        returnGeometry: false,
        outFields: ["*"],
      },
      toDataSourceQueryOptions(signalOptions)
    );

    abortHelpers.throwIfAborted(options?.signal);

    const records = result?.records ?? [];
    if (records.length === 0) {
      return [];
    }

    return records.map((record: FeatureDataRecord) => {
      const attributes = record.getData() as OwnerAttributes;
      return { attributes } as __esri.Graphic;
    });
  } catch (error) {
    abortHelpers.handleOrThrow(error);
    throw new Error(parseArcGISError(error, "Owner query failed"));
  }
};

export const queryOwnersByRelationship = async (
  propertyFnrs: FnrValue[],
  propertyDataSourceId: string,
  _ownerDataSourceId: string,
  dsManager: DataSourceManager,
  relationshipId: number,
  options?: { signal?: AbortSignal }
): Promise<Map<string, OwnerAttributes[]>> => {
  try {
    abortHelpers.throwIfAborted(options?.signal);

    if (!propertyFnrs || propertyFnrs.length === 0) {
      return new Map();
    }

    const propertyDs = dsManager.getDataSource(
      propertyDataSourceId
    ) as FeatureLayerDataSource | null;
    if (!propertyDs) {
      throw new Error("Property data source not found");
    }

    const layerDefinition = propertyDs.getLayerDefinition?.();
    const layerUrl =
      layerDefinition && typeof layerDefinition === "object"
        ? ((layerDefinition as { url?: string | null }).url ?? null)
        : null;

    if (!layerUrl) {
      throw new Error("Property layer URL not available");
    }

    if (!cachedQueryTaskCtor || !cachedRelationshipQueryCtor) {
      const [QueryTask, RelationshipQuery] = (await loadArcGISJSAPIModules([
        "esri/tasks/QueryTask",
        "esri/rest/support/RelationshipQuery",
      ])) as [QueryTaskConstructor, RelationshipQueryConstructor];
      cachedQueryTaskCtor = QueryTask;
      cachedRelationshipQueryCtor = RelationshipQuery;
    }

    if (!cachedQueryTaskCtor || !cachedRelationshipQueryCtor) {
      throw new Error("Failed to load relationship query modules");
    }

    const QueryTask = cachedQueryTaskCtor;
    const RelationshipQuery = cachedRelationshipQueryCtor;

    let queryTask = relationshipQueryTaskCache.get(layerUrl);
    if (!queryTask) {
      queryTask = new QueryTask({ url: layerUrl });
      relationshipQueryTaskCache.set(layerUrl, queryTask);
    }
    const relationshipQuery = new RelationshipQuery();

    const signalOptions = createSignalOptions(options?.signal);

    const BATCH_SIZE = 100;
    const fnrBatches: FnrValue[][] = [];
    for (let index = 0; index < propertyFnrs.length; index += BATCH_SIZE) {
      fnrBatches.push(propertyFnrs.slice(index, index + BATCH_SIZE));
    }

    const batchRequests = fnrBatches.map(
      (batch) => () =>
        propertyDs.query(
          {
            where: batch.map((fnr) => buildFnrWhereClause(fnr)).join(" OR "),
            outFields: ["FNR", "OBJECTID"],
            returnGeometry: false,
          },
          toDataSourceQueryOptions(signalOptions)
        )
    );

    const propertyRecords: FeatureDataRecord[] = [];
    const objectIds: number[] = [];
    const fnrToObjectIdMap = new Map<number, string>();

    // Performance: Process batches with concurrency limit
    for (
      let index = 0;
      index < batchRequests.length;
      index += OWNER_QUERY_CONCURRENCY
    ) {
      const slice = batchRequests.slice(index, index + OWNER_QUERY_CONCURRENCY);
      const settled = await Promise.all(
        slice.map((createRequest) => createRequest())
      );

      // Performance: Flatten results and build maps in single pass
      for (let j = 0; j < settled.length; j++) {
        const result = settled[j];
        const records = ((result?.records ?? []) as FeatureDataRecord[]) || [];
        const recordsLen = records.length;

        for (let k = 0; k < recordsLen; k++) {
          const record = records[k];
          propertyRecords.push(record);

          const data = record.getData() as PropertyAttributes;
          const objectId = data.OBJECTID;
          const fnr = String(data.FNR);

          if (objectId != null && fnr) {
            objectIds.push(objectId);
            fnrToObjectIdMap.set(objectId, fnr);
          }
        }
      }

      abortHelpers.throwIfAborted(options?.signal);
    }

    if (objectIds.length === 0) {
      return new Map();
    }

    relationshipQuery.objectIds = objectIds;
    relationshipQuery.relationshipId = relationshipId;
    relationshipQuery.outFields = ["*"];

    abortHelpers.throwIfAborted(options?.signal);

    const result = await queryTask.executeRelationshipQuery(
      relationshipQuery,
      createSignalOptions(options?.signal)
    );

    abortHelpers.throwIfAborted(options?.signal);

    const ownersByFnr = new Map<string, OwnerAttributes[]>();

    objectIds.forEach((objectId) => {
      const relatedRecords = result[objectId];
      const fnr = fnrToObjectIdMap.get(objectId);

      if (fnr && relatedRecords?.features) {
        const owners = relatedRecords.features
          .map(
            (feature: __esri.Graphic) => feature.attributes as OwnerAttributes
          )
          .filter(Boolean);
        ownersByFnr.set(fnr, owners);
      }
    });

    return ownersByFnr;
  } catch (error) {
    abortHelpers.handleOrThrow(error);
    throw new Error(parseArcGISError(error, "Relationship query failed"));
  }
};

const processBatchQuery = async (
  params: PropertyBatchQueryParams
): Promise<ProcessPropertyResult> => {
  const { propertyResults, config, context } = params;
  const { helpers, maxResults } = context;

  const graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: FnrValue }> = [];
  const rowsToProcess: GridRowData[] = [];

  const validatedProperties = validateAndDeduplicateProperties(
    propertyResults,
    helpers.extractFnr,
    maxResults
  );

  if (validatedProperties.length === 0) {
    return { rowsToProcess, graphicsToAdd };
  }

  const fnrsToQuery = validatedProperties.map((item) => item.fnr);
  const failedFnrs = new Set<string>();
  let ownersByFnr: Map<string, OwnerAttributes[]>;

  try {
    ownersByFnr = await helpers.queryOwnersByRelationship(
      fnrsToQuery,
      config.propertyDataSourceId,
      config.ownerDataSourceId,
      context.dsManager,
      config.relationshipId,
      { signal: context.signal }
    );
  } catch (error) {
    if (helpers.isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    console.log("Batch owner query failed", { error });
    ownersByFnr = new Map();
    fnrsToQuery.forEach((fnr) => failedFnrs.add(String(fnr)));
  }

  abortHelpers.throwIfAborted(context.signal);

  const CHUNK_SIZE = 100;
  for (let index = 0; index < validatedProperties.length; index += CHUNK_SIZE) {
    const chunk = validatedProperties.slice(index, index + CHUNK_SIZE);

    for (const validated of chunk) {
      const owners = ownersByFnr.get(String(validated.fnr)) ?? [];
      const ownerQueryFailed = failedFnrs.has(String(validated.fnr));

      appendRowsForValidatedProperty(
        { rows: rowsToProcess, graphics: graphicsToAdd },
        {
          validated,
          owners,
          ownerQueryFailed,
          maskPII: config.enablePIIMasking,
          context,
        }
      );
    }

    if (index + CHUNK_SIZE < validatedProperties.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      abortHelpers.throwIfAborted(context.signal);
    }
  }

  return { rowsToProcess, graphicsToAdd };
};

const processIndividualQuery = async (
  params: PropertyIndividualQueryParams
): Promise<ProcessPropertyResult> => {
  const { propertyResults, config, context } = params;
  const { helpers, maxResults } = context;

  const graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: FnrValue }> = [];
  const rowsToProcess: GridRowData[] = [];

  const validatedProperties = validateAndDeduplicateProperties(
    propertyResults,
    helpers.extractFnr
  );

  for (let index = 0; index < validatedProperties.length; ) {
    const remainingSlots = maxResults - rowsToProcess.length;
    if (remainingSlots <= 0) {
      break;
    }

    const batchSize = Math.min(
      remainingSlots,
      OWNER_QUERY_CONCURRENCY,
      validatedProperties.length - index
    );

    const batch = validatedProperties.slice(index, index + batchSize);

    const accumulator = await processBatchOfProperties({
      batch,
      currentRowCount: rowsToProcess.length,
      context,
      config: {
        ownerDataSourceId: config.ownerDataSourceId,
        enablePIIMasking: config.enablePIIMasking,
      },
    });

    rowsToProcess.push(...accumulator.rows);
    graphicsToAdd.push(...accumulator.graphics);

    index += batchSize;
  }

  return { rowsToProcess, graphicsToAdd };
};

export const propertyQueryService = {
  processBatch: processBatchQuery,
  processIndividual: processIndividualQuery,
};

export const runPropertySelectionPipeline = async (
  params: PropertySelectionPipelineParams
): Promise<PropertySelectionPipelineResult> => {
  const {
    mapPoint,
    propertyDataSourceId,
    ownerDataSourceId,
    dsManager,
    maxResults,
    toggleEnabled,
    enableBatchOwnerQuery,
    relationshipId,
    enablePIIMasking,
    signal,
    selectedProperties,
    translate,
  } = params;

  const propertyResults = await queryPropertyByPoint(
    mapPoint,
    propertyDataSourceId,
    dsManager,
    { signal }
  );

  if (propertyResults.length === 0) {
    return { status: "empty" };
  }

  const toggleRemovalState = deriveToggleState({
    propertyResults,
    selectedProperties,
    toggleEnabled,
    normalizeFnrKey,
    extractFnr,
  });

  if (toggleRemovalState) {
    const { updatedRows, keysToRemove } = toggleRemovalState;

    return {
      status: "success",
      rowsToProcess: [],
      graphicsToAdd: [],
      updatedRows,
      toRemove: keysToRemove,
      propertyResults,
    };
  }

  const processingResult = await processPropertyQueryResults({
    propertyResults,
    config: {
      propertyDataSourceId,
      ownerDataSourceId,
      enablePIIMasking,
      relationshipId,
      enableBatchOwnerQuery,
    },
    processingContext: {
      dsManager,
      maxResults,
      signal,
      helpers: {
        extractFnr,
        queryOwnerByFnr,
        queryOwnersByRelationship,
        createRowId,
        formatPropertyWithShare,
        formatOwnerInfo,
        isAbortError,
      },
      messages: {
        unknownOwner: translate("unknownOwner"),
        errorOwnerQueryFailed: translate("errorOwnerQueryFailed"),
        errorNoDataAvailable: translate("errorNoDataAvailable"),
      },
    },
    services: {
      processBatch: propertyQueryService.processBatch,
      processIndividual: propertyQueryService.processIndividual,
    },
  });

  abortHelpers.throwIfAborted(signal);

  const { toRemove, updatedRows } = calculatePropertyUpdates(
    processingResult.rowsToProcess,
    selectedProperties,
    toggleEnabled,
    maxResults
  );

  return {
    status: "success",
    rowsToProcess: processingResult.rowsToProcess,
    graphicsToAdd: processingResult.graphicsToAdd,
    updatedRows,
    toRemove,
    propertyResults,
  };
};

export const queryPropertiesInBuffer = async (
  point: __esri.Point,
  bufferDistance: number,
  bufferUnit: "meters" | "kilometers" | "feet" | "miles",
  dataSourceId: string,
  dsManager: DataSourceManager,
  options?: { signal?: AbortSignal }
): Promise<PropertyAttributes[]> => {
  try {
    abortHelpers.throwIfAborted(options?.signal);

    const modules = (await loadArcGISJSAPIModules([
      "esri/geometry/geometryEngine",
    ])) as [__esri.geometryEngine];
    const [geometryEngine] = modules;

    const bufferGeometry = geometryEngine.buffer(
      point,
      bufferDistance,
      bufferUnit
    ) as __esri.Polygon;

    if (!bufferGeometry) {
      throw new Error("Failed to create buffer geometry");
    }

    if (!bufferGeometry.extent || bufferGeometry.extent.width === 0) {
      throw new Error("Invalid buffer geometry: empty extent");
    }

    abortHelpers.throwIfAborted(options?.signal);

    const ds = dsManager.getDataSource(
      dataSourceId
    ) as FeatureLayerDataSource | null;
    if (!ds) {
      throw new Error("Property data source not found");
    }

    const signalOptions = createSignalOptions(options?.signal);

    const result = await ds.query(
      {
        geometry: bufferGeometry,
        spatialRel: "esriSpatialRelIntersects",
        returnGeometry: true,
        outFields: ["*"],
      },
      toDataSourceQueryOptions(signalOptions)
    );

    abortHelpers.throwIfAborted(options?.signal);

    if (!result?.records || result.records.length === 0) {
      return [];
    }

    return result.records.map(
      (record: FeatureDataRecord) => record.getData() as PropertyAttributes
    );
  } catch (error) {
    abortHelpers.handleOrThrow(error);
    throw new Error(parseArcGISError(error, "Buffer query failed"));
  }
};

export { isValidArcGISUrl };
