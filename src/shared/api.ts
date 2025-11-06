import type {
  DataSourceManager,
  FeatureLayerDataSource,
  FeatureDataRecord,
  QueryOptions,
} from "jimu-core";
import { loadArcGISJSAPIModules } from "jimu-arcgis";
import type {
  AttributeMap,
  FnrValue,
  GridRowData,
  OwnerAttributes,
  ProcessPropertyResult,
  PropertyAttributes,
  PropertyBatchQueryParams,
  PropertyIndividualQueryParams,
  PropertyProcessingContext,
  PropertySelectionPipelineParams,
  PropertySelectionPipelineResult,
  PromiseUtilsLike,
  QueryResult,
  ValidationResult,
  FeatureLayerConstructor,
  QueryConstructor,
  QueryTaskLike,
  QueryTaskConstructor,
  RelationshipQueryConstructor,
  SignalOptions,
  ValidateDataSourcesParams,
  ValidatedProperty,
  OwnerFetchSuccess,
  OwnerQueryResolution,
  ProcessingAccumulator,
} from "../config/types";
import { isValidationFailure } from "../config/types";
import { OWNER_QUERY_CONCURRENCY } from "../config/constants";
import {
  buildFnrWhereClause,
  parseArcGISError,
  isAbortError,
  normalizeFnrKey,
  abortHelpers,
  calculatePropertyUpdates,
  processPropertyQueryResults,
  logger,
  createRowId,
  formatPropertyWithShare,
  formatOwnerInfo,
  extractFnr,
  shouldStopAccumulation,
  processOwnerResult,
  createValidationPipeline,
  isValidArcGISUrl,
  getDataSourceUrl,
  createValidationError,
  deriveToggleState,
  buildPropertyRows,
} from "./utils";

let cachedFeatureLayerCtor: FeatureLayerConstructor | null = null;
let cachedQueryCtor: QueryConstructor | null = null;
let cachedQueryTaskCtor: QueryTaskConstructor | null = null;
let cachedRelationshipQueryCtor: RelationshipQueryConstructor | null = null;
let cachedPromiseUtils: PromiseUtilsLike | null = null;
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
const validateSingleDataSource = (
  dataSource: FeatureLayerDataSource | null,
  role: "property" | "owner",
  translate: (key: string) => string
): ValidationResult<{ dataSource: FeatureLayerDataSource }> => {
  if (!dataSource) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      `${role}_data_source_missing`
    );
  }

  return { valid: true, data: { dataSource } };
};

const validateDataSourceUrl = (
  dataSource: FeatureLayerDataSource,
  role: "property" | "owner",
  allowedHosts: readonly string[] | undefined,
  translate: (key: string) => string
): ValidationResult<{ url: string }> => {
  const url = getDataSourceUrl(dataSource);
  if (!url) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      `${role}_missing_url`
    );
  }

  if (!isValidArcGISUrl(url, allowedHosts)) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorHostNotAllowed"),
      `${role}_disallowed_host`
    );
  }

  return { valid: true, data: { url } };
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
  const seenFnrs = new Set<string>();
  const validated: ValidatedProperty[] = [];

  for (const propertyResult of propertyResults) {
    const feature = propertyResult.features?.[0];
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

    seenFnrs.add(normalized);
    validated.push({
      fnr,
      attrs: feature.attributes as PropertyAttributes,
      graphic: feature,
    });

    if (typeof maxResults === "number" && validated.length >= maxResults) {
      break;
    }
  }

  return validated;
};

const fetchOwnerDataForProperty = async (
  validated: ValidatedProperty,
  context: PropertyProcessingContext,
  config: { ownerDataSourceId: string }
): Promise<OwnerFetchSuccess> => {
  const { dsManager, signal, helpers } = context;
  try {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

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

  for (let index = 0; index < ownerData.length; index += 1) {
    const resolution = ownerData[index];
    const validated = batch[index];
    if (
      shouldStopAccumulation(
        currentRowCount,
        accumulator.rows.length,
        maxResults
      )
    ) {
      break;
    }
    const skip = shouldSkipOwnerResult(resolution, helpers);

    if (skip.skip) {
      if (skip.reason === "aborted" || skip.reason === "invalid_value") {
        continue;
      }
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
  interface ValidationState {
    propertyDsId?: string | null;
    ownerDsId?: string | null;
    dsManager: DataSourceManager | null;
    manager?: DataSourceManager;
    allowedHosts?: readonly string[];
    translate: (key: string) => string;
    propertyDs?: FeatureLayerDataSource;
    ownerDs?: FeatureLayerDataSource;
  }

  const initialState: ValidationState = {
    propertyDsId: params.propertyDsId,
    ownerDsId: params.ownerDsId,
    dsManager: params.dsManager,
    allowedHosts: params.allowedHosts,
    translate: params.translate,
  };

  const validateDataSourceIds = (
    state: ValidationState
  ): ValidationResult<ValidationState> => {
    if (!state.propertyDsId || !state.ownerDsId) {
      return createValidationError(
        "VALIDATION_ERROR",
        state.translate("errorNoDataAvailable"),
        "missing_data_sources"
      ) as ValidationResult<ValidationState>;
    }
    return { valid: true, data: state };
  };

  const validateManager = (
    state: ValidationState
  ): ValidationResult<ValidationState> => {
    if (!state.dsManager) {
      return createValidationError(
        "QUERY_ERROR",
        state.translate("errorQueryFailed"),
        "no_data_source_manager"
      ) as ValidationResult<ValidationState>;
    }
    return {
      valid: true,
      data: { ...state, manager: state.dsManager },
    };
  };

  const validatePropertyDataSource = (
    state: ValidationState
  ): ValidationResult<ValidationState> => {
    const manager = state.manager ?? state.dsManager;
    if (!manager) {
      return createValidationError(
        "QUERY_ERROR",
        state.translate("errorQueryFailed"),
        "no_data_source_manager"
      ) as ValidationResult<ValidationState>;
    }
    const propertyDs = manager.getDataSource(
      state.propertyDsId
    ) as FeatureLayerDataSource | null;
    const validation = validateSingleDataSource(
      propertyDs,
      "property",
      state.translate
    );
    if (isValidationFailure(validation)) {
      return {
        valid: false,
        error: validation.error,
        failureReason: validation.failureReason,
      };
    }
    return {
      valid: true,
      data: {
        ...state,
        manager,
        propertyDs: validation.data.dataSource,
      },
    };
  };

  const validateOwnerDataSource = (
    state: ValidationState
  ): ValidationResult<ValidationState> => {
    const manager = state.manager ?? state.dsManager;
    if (!manager) {
      return createValidationError(
        "QUERY_ERROR",
        state.translate("errorQueryFailed"),
        "no_data_source_manager"
      ) as ValidationResult<ValidationState>;
    }
    const ownerDs = manager.getDataSource(
      state.ownerDsId
    ) as FeatureLayerDataSource | null;
    const validation = validateSingleDataSource(
      ownerDs,
      "owner",
      state.translate
    );
    if (isValidationFailure(validation)) {
      return {
        valid: false,
        error: validation.error,
        failureReason: validation.failureReason,
      };
    }
    return {
      valid: true,
      data: {
        ...state,
        manager,
        ownerDs: validation.data.dataSource,
      },
    };
  };

  const validatePropertyUrl = (
    state: ValidationState
  ): ValidationResult<ValidationState> => {
    if (!state.propertyDs) {
      return createValidationError(
        "VALIDATION_ERROR",
        state.translate("errorNoDataAvailable"),
        "property_data_source_missing"
      ) as ValidationResult<ValidationState>;
    }
    const validation = validateDataSourceUrl(
      state.propertyDs,
      "property",
      state.allowedHosts,
      state.translate
    );
    if (isValidationFailure(validation)) {
      return {
        valid: false,
        error: validation.error,
        failureReason: validation.failureReason,
      };
    }
    return { valid: true, data: state };
  };

  const validateOwnerUrl = (
    state: ValidationState
  ): ValidationResult<ValidationState> => {
    if (!state.ownerDs) {
      return createValidationError(
        "VALIDATION_ERROR",
        state.translate("errorNoDataAvailable"),
        "owner_data_source_missing"
      ) as ValidationResult<ValidationState>;
    }
    const validation = validateDataSourceUrl(
      state.ownerDs,
      "owner",
      state.allowedHosts,
      state.translate
    );
    if (isValidationFailure(validation)) {
      return {
        valid: false,
        error: validation.error,
        failureReason: validation.failureReason,
      };
    }
    return { valid: true, data: state };
  };

  const pipeline = createValidationPipeline<ValidationState>([
    validateDataSourceIds,
    validateManager,
    validatePropertyDataSource,
    validateOwnerDataSource,
    validatePropertyUrl,
    validateOwnerUrl,
  ]);

  const pipelineResult = pipeline(initialState);
  if (isValidationFailure(pipelineResult)) {
    return pipelineResult;
  }

  const resolvedManager = pipelineResult.data.manager;
  if (!resolvedManager) {
    return createValidationError(
      "QUERY_ERROR",
      params.translate("errorQueryFailed"),
      "no_data_source_manager"
    );
  }

  return { valid: true, data: { manager: resolvedManager } };
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
      const modules = await loadArcGISJSAPIModules([
        "esri/layers/FeatureLayer",
        "esri/rest/support/Query",
      ]);
      const [FeatureLayer, Query] = modules;
      cachedFeatureLayerCtor = FeatureLayer as FeatureLayerConstructor;
      cachedQueryCtor = Query as QueryConstructor;
    }

    const FeatureLayerCtor = cachedFeatureLayerCtor;
    const QueryCtor = cachedQueryCtor;
    if (!FeatureLayerCtor || !QueryCtor) {
      throw new Error("Property query modules failed to load");
    }

    let layer = featureLayerCache.get(layerUrl);
    if (!layer) {
      layer = new FeatureLayerCtor({
        url: layerUrl,
      });
      featureLayerCache.set(layerUrl, layer);
    }

    const query = new QueryCtor({
      geometry: point,
      returnGeometry: true,
      outFields: ["*"],
      spatialRelationship: "intersects",
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
      const modules = await loadArcGISJSAPIModules([
        "esri/tasks/QueryTask",
        "esri/rest/support/RelationshipQuery",
      ]);
      const [QueryTask, RelationshipQuery] = modules;
      cachedQueryTaskCtor = QueryTask as QueryTaskConstructor;
      cachedRelationshipQueryCtor =
        RelationshipQuery as RelationshipQueryConstructor;
    }

    const QueryTaskCtor = cachedQueryTaskCtor;
    const RelationshipQueryCtor = cachedRelationshipQueryCtor;
    if (!QueryTaskCtor || !RelationshipQueryCtor) {
      throw new Error("Relationship query modules failed to load");
    }

    let queryTask = relationshipQueryTaskCache.get(layerUrl) ?? null;
    if (!queryTask) {
      queryTask = new QueryTaskCtor({ url: layerUrl });
      relationshipQueryTaskCache.set(layerUrl, queryTask);
    }
    const relationshipQuery = new RelationshipQueryCtor();

    const objectIds: number[] = [];
    const fnrToObjectIdMap = new Map<number, string>();

    const signalOptions = createSignalOptions(options?.signal);

    const BATCH_SIZE = 50;
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
    for (
      let index = 0;
      index < batchRequests.length;
      index += OWNER_QUERY_CONCURRENCY
    ) {
      const slice = batchRequests.slice(index, index + OWNER_QUERY_CONCURRENCY);
      const settled = await Promise.all(
        slice.map((createRequest) => createRequest())
      );
      settled.forEach((result) => {
        const records = ((result?.records ?? []) as FeatureDataRecord[]) || [];
        if (records.length > 0) {
          propertyRecords.push(...records);
        }
      });
      abortHelpers.throwIfAborted(options?.signal);
    }

    if (propertyRecords.length === 0) {
      return new Map();
    }

    propertyRecords.forEach((record: FeatureDataRecord) => {
      const data = record.getData() as PropertyAttributes;
      const objectId = data.OBJECTID;
      const fnr = String(data.FNR);
      if (objectId != null && fnr) {
        objectIds.push(objectId);
        fnrToObjectIdMap.set(objectId, fnr);
      }
    });

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
    logger.error("Batch owner query failed", { error });
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

  const propQueryStart = performance.now();
  console.log("[PERF-API] Property query started");
  const propertyResults = await queryPropertyByPoint(
    mapPoint,
    propertyDataSourceId,
    dsManager,
    { signal }
  );
  const propQueryEnd = performance.now();
  console.log(
    "[PERF-API] Property query completed in",
    propQueryEnd - propQueryStart,
    "ms",
    "(returned",
    propertyResults.length,
    "results)"
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

  const processStart = performance.now();
  console.log("[PERF-API] Processing property results started");
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
  const processEnd = performance.now();
  console.log(
    "[PERF-API] Processing completed in",
    processEnd - processStart,
    "ms",
    "(produced",
    processingResult.rowsToProcess.length,
    "rows)"
  );

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
