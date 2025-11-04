import type {
  DataSourceManager,
  FeatureLayerDataSource,
  FeatureDataRecord,
  QueryOptions,
} from "jimu-core";
import { loadArcGISJSAPIModules } from "jimu-arcgis";
import type {
  AttributeMap,
  ErrorState,
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
  QueryResult,
  ValidationResult,
} from "../config/types";
import { isValidationFailure } from "../config/types";
import { OWNER_QUERY_CONCURRENCY } from "../config/constants";
import {
  buildFnrWhereClause,
  parseArcGISError,
  isAbortError,
  normalizeFnrKey,
  ownerIdentity,
  abortHelpers,
  calculatePropertyUpdates,
  processPropertyQueryResults,
  logger,
  createRowId,
  formatPropertyWithShare,
  formatOwnerInfo,
  extractFnr,
} from "./utils";

type FeatureLayerConstructor = new (
  properties?: __esri.FeatureLayerProperties
) => __esri.FeatureLayer;

type QueryConstructor = new (
  properties?: __esri.QueryProperties
) => __esri.Query;

interface RelationshipQueryLike {
  objectIds: number[];
  relationshipId: number;
  outFields: string[];
}

interface QueryTaskLike {
  executeRelationshipQuery: (
    query: RelationshipQueryLike,
    options?: SignalOptions
  ) => Promise<{
    [objectId: number]: { features?: __esri.Graphic[] } | undefined;
  }>;
}

type QueryTaskConstructor = new (...args: unknown[]) => QueryTaskLike;
type RelationshipQueryConstructor = new (
  ...args: unknown[]
) => RelationshipQueryLike;

const ARC_GIS_LAYER_PATTERN = /\/(mapserver|featureserver)\/\d+(?:\/query)?$/i;
const PRIVATE_IPV4_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/u,
  /^192\.168\.\d{1,3}\.\d{1,3}$/u,
];
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_IPV6 = "::1";

let cachedFeatureLayerCtor: FeatureLayerConstructor | null = null;
let cachedQueryCtor: QueryConstructor | null = null;
let cachedQueryTaskCtor: QueryTaskConstructor | null = null;
let cachedRelationshipQueryCtor: RelationshipQueryConstructor | null = null;
const featureLayerCache = new Map<string, __esri.FeatureLayer>();

const stripIpv6Brackets = (hostname: string): string => {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
};

const isIpv4Address = (value: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/u.test(value);

const isPrivateHost = (hostname: string): boolean => {
  const normalized = stripIpv6Brackets(hostname.toLowerCase());
  if (LOCAL_HOSTNAMES.has(normalized)) {
    return true;
  }
  if (normalized === LOOPBACK_IPV6) {
    return true;
  }
  if (isIpv4Address(normalized)) {
    return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(normalized));
  }
  return false;
};

const normalizeHostname = (hostname: string): string =>
  hostname.trim().toLowerCase();

const isAllowedHost = (
  hostname: string,
  allowedHosts?: readonly string[]
): boolean => {
  if (!allowedHosts || allowedHosts.length === 0) {
    return true;
  }

  const normalizedHostname = normalizeHostname(hostname);

  return allowedHosts.some((allowedHost) => {
    const normalizedAllowed = normalizeHostname(allowedHost);
    return (
      normalizedHostname === normalizedAllowed ||
      normalizedHostname.endsWith(`.${normalizedAllowed}`)
    );
  });
};

const isStandardPort = (port: string): boolean => port === "" || port === "443";

interface SignalOptions {
  signal: AbortSignal;
}

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
};

const createValidationError = (
  type: ErrorState["type"],
  message: string,
  failureReason: string
): ValidationResult<never> => ({
  valid: false,
  error: { type, message },
  failureReason,
});

const extractDataSourceUrl = (
  dataSource: FeatureLayerDataSource | null
): string | null => {
  if (!dataSource) {
    return null;
  }

  if (typeof dataSource.url === "string" && dataSource.url) {
    return dataSource.url;
  }

  const layerDefinition = dataSource.getLayerDefinition?.();
  if (layerDefinition && typeof layerDefinition === "object") {
    const candidate = (layerDefinition as { url?: string | null }).url;
    if (candidate) {
      return candidate;
    }
  }

  const dsJson = dataSource.getDataSourceJson?.();
  if (dsJson && typeof dsJson === "object") {
    const candidate = (dsJson as { url?: string | null }).url;
    if (candidate) {
      return candidate;
    }
  }

  return null;
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
  const url = extractDataSourceUrl(dataSource);
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

interface ValidateDataSourcesParams {
  propertyDsId?: string | null;
  ownerDsId?: string | null;
  dsManager: DataSourceManager | null;
  allowedHosts?: readonly string[];
  translate: (key: string) => string;
}

interface ValidatedProperty {
  fnr: FnrValue;
  attrs: PropertyAttributes;
  graphic: __esri.Graphic;
}

interface OwnerFetchSuccess {
  validated: ValidatedProperty;
  owners: OwnerAttributes[];
  queryFailed: boolean;
}

interface OwnerQueryResolution {
  value?: OwnerFetchSuccess;
  error?: unknown;
}

interface ProcessingAccumulator {
  rows: GridRowData[];
  graphics: Array<{ graphic: __esri.Graphic; fnr: FnrValue }>;
}

const toOwnerAttributes = (
  graphic: __esri.Graphic | null | undefined
): OwnerAttributes | null => {
  if (!graphic?.attributes) {
    return null;
  }
  return graphic.attributes as OwnerAttributes;
};

const deduplicateOwnerEntries = (
  owners: OwnerAttributes[],
  context: { fnr: FnrValue; propertyId?: string }
): OwnerAttributes[] => {
  const seenKeys = new Set<string>();
  const unique: OwnerAttributes[] = [];

  owners.forEach((owner, index) => {
    if (!owner || typeof owner !== "object") {
      return;
    }

    try {
      const key = ownerIdentity.buildKey(owner, context, index);
      if (seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      unique.push(owner);
    } catch (_error) {
      unique.push(owner);
    }
  });

  return unique;
};

interface CreateGridRowParams {
  fnr: FnrValue;
  objectId: number;
  uuidFastighet: string;
  fastighet: string;
  bostadr: string;
  geometryType: string | null;
  createRowId: (fnr: FnrValue, objectId: number) => string;
  rawOwner?: OwnerAttributes;
}

const createGridRow = (params: CreateGridRowParams): GridRowData => ({
  id: params.createRowId(params.fnr, params.objectId),
  FNR: params.fnr,
  UUID_FASTIGHET: params.uuidFastighet,
  FASTIGHET: params.fastighet,
  BOSTADR: params.bostadr,
  geometryType: params.geometryType,
  rawOwner: params.rawOwner,
});

const accumulatePropertyRows = (
  rows: GridRowData[],
  accumulator: ProcessingAccumulator,
  graphic: __esri.Graphic,
  fnr: FnrValue,
  currentTotal: number,
  maxResults: number
): boolean => {
  if (rows.length === 0) {
    return currentTotal >= maxResults;
  }

  const remaining = Math.max(maxResults - currentTotal, 0);
  const rowsToAdd = remaining > 0 ? rows.slice(0, remaining) : [];

  accumulator.rows.push(...rowsToAdd);

  if (rowsToAdd.length > 0) {
    accumulator.graphics.push({ graphic, fnr });
  }

  return currentTotal + rowsToAdd.length >= maxResults;
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

const buildPropertyRows = (
  validated: ValidatedProperty,
  owners: OwnerAttributes[],
  queryFailed: boolean,
  maskPII: boolean,
  context: PropertyProcessingContext
): GridRowData[] => {
  const geometryType = validated.graphic.geometry?.type ?? null;

  if (owners.length > 0) {
    const uniqueOwners = deduplicateOwnerEntries(owners, {
      fnr: validated.fnr,
      propertyId: validated.attrs.UUID_FASTIGHET,
    });

    return uniqueOwners.map((owner) =>
      createGridRow({
        fnr: validated.fnr,
        objectId: owner.OBJECTID ?? validated.attrs.OBJECTID,
        uuidFastighet: owner.UUID_FASTIGHET ?? validated.attrs.UUID_FASTIGHET,
        fastighet: context.helpers.formatPropertyWithShare(
          owner.FASTIGHET ?? validated.attrs.FASTIGHET,
          owner.ANDEL
        ),
        bostadr: context.helpers.formatOwnerInfo(
          owner,
          maskPII,
          context.messages.unknownOwner
        ),
        geometryType,
        createRowId: context.helpers.createRowId,
        rawOwner: owner,
      })
    );
  }

  const fallbackMessage = queryFailed
    ? context.messages.errorOwnerQueryFailed
    : context.messages.unknownOwner;

  const fallbackOwner: OwnerAttributes = {
    OBJECTID: validated.attrs.OBJECTID,
    FNR: validated.fnr,
    UUID_FASTIGHET: validated.attrs.UUID_FASTIGHET,
    FASTIGHET: validated.attrs.FASTIGHET,
    NAMN: fallbackMessage,
    BOSTADR: "",
    POSTNR: "",
    POSTADR: "",
    ORGNR: "",
  };

  return [
    createGridRow({
      fnr: validated.fnr,
      objectId: validated.attrs.OBJECTID,
      uuidFastighet: validated.attrs.UUID_FASTIGHET,
      fastighet: validated.attrs.FASTIGHET,
      bostadr: fallbackMessage,
      geometryType,
      createRowId: context.helpers.createRowId,
      rawOwner: fallbackOwner,
    }),
  ];
};

const processOwnerQueryError = (
  validated: ValidatedProperty,
  context: PropertyProcessingContext,
  maskPII: boolean,
  accumulator: ProcessingAccumulator,
  currentRowCount: number,
  maxResults: number
): boolean => {
  const totalBefore = currentRowCount + accumulator.rows.length;
  if (totalBefore >= maxResults) {
    return true;
  }

  const rows = buildPropertyRows(validated, [], true, maskPII, context);
  return accumulatePropertyRows(
    rows,
    accumulator,
    validated.graphic,
    validated.fnr,
    totalBefore,
    maxResults
  );
};

const processOwnerQuerySuccess = (
  result: OwnerFetchSuccess,
  context: PropertyProcessingContext,
  maskPII: boolean,
  accumulator: ProcessingAccumulator,
  currentRowCount: number,
  maxResults: number
): boolean => {
  const totalBefore = currentRowCount + accumulator.rows.length;
  if (totalBefore >= maxResults) {
    return true;
  }

  const rows = buildPropertyRows(
    result.validated,
    result.owners,
    result.queryFailed,
    maskPII,
    context
  );

  return accumulatePropertyRows(
    rows,
    accumulator,
    result.validated.graphic,
    result.validated.fnr,
    totalBefore,
    maxResults
  );
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

  const modules = await loadArcGISJSAPIModules(["esri/core/promiseUtils"]);
  abortHelpers.throwIfAborted(context.signal);

  const promiseUtils = modules[0] as {
    eachAlways: <T>(
      promises: Array<Promise<T>>
    ) => Promise<Array<{ value?: T; error?: unknown }>>;
  };

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
    const skip = shouldSkipOwnerResult(resolution, helpers);

    if (skip.skip) {
      if (skip.reason === "aborted" || skip.reason === "invalid_value") {
        continue;
      }
    }

    if (resolution.error) {
      const shouldStop = processOwnerQueryError(
        validated,
        context,
        config.enablePIIMasking,
        accumulator,
        currentRowCount,
        maxResults
      );
      if (shouldStop) {
        break;
      }
      continue;
    }

    const ownerResult = resolution.value;
    if (!ownerResult) {
      continue;
    }

    const shouldStop = processOwnerQuerySuccess(
      ownerResult,
      context,
      config.enablePIIMasking,
      accumulator,
      currentRowCount,
      maxResults
    );
    if (shouldStop) {
      break;
    }
  }

  return accumulator;
};

export const isValidArcGISUrl = (
  url: string,
  allowedHosts?: readonly string[]
): boolean => {
  if (!url || typeof url !== "string") {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  if (!isStandardPort(parsed.port)) {
    return false;
  }

  const hostname = parsed.hostname;
  if (isPrivateHost(hostname)) {
    return false;
  }

  if (!isAllowedHost(hostname, allowedHosts)) {
    return false;
  }

  const normalizedPath = parsed.pathname.replace(/\/+/g, "/").toLowerCase();
  if (!ARC_GIS_LAYER_PATTERN.test(normalizedPath)) {
    return false;
  }

  return true;
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
  const ownerDs = dsManager.getDataSource(
    ownerDsId
  ) as FeatureLayerDataSource | null;

  const propertyValidation = validateSingleDataSource(
    propertyDs,
    "property",
    translate
  );
  if (isValidationFailure(propertyValidation)) {
    return {
      valid: false,
      error: propertyValidation.error,
      failureReason: propertyValidation.failureReason,
    };
  }

  const ownerValidation = validateSingleDataSource(ownerDs, "owner", translate);
  if (isValidationFailure(ownerValidation)) {
    return {
      valid: false,
      error: ownerValidation.error,
      failureReason: ownerValidation.failureReason,
    };
  }

  const propertyUrlValidation = validateDataSourceUrl(
    propertyValidation.data.dataSource,
    "property",
    allowedHosts,
    translate
  );
  if (isValidationFailure(propertyUrlValidation)) {
    return {
      valid: false,
      error: propertyUrlValidation.error,
      failureReason: propertyUrlValidation.failureReason,
    };
  }

  const ownerUrlValidation = validateDataSourceUrl(
    ownerValidation.data.dataSource,
    "owner",
    allowedHosts,
    translate
  );
  if (isValidationFailure(ownerUrlValidation)) {
    return {
      valid: false,
      error: ownerUrlValidation.error,
      failureReason: ownerUrlValidation.failureReason,
    };
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

    const queryTask = new QueryTaskCtor({ url: layerUrl });
    const relationshipQuery = new RelationshipQueryCtor();

    const objectIds: number[] = [];
    const fnrToObjectIdMap = new Map<number, string>();

    const signalOptions = createSignalOptions(options?.signal);

    const propertyResult = await propertyDs.query(
      {
        where: propertyFnrs.map((fnr) => buildFnrWhereClause(fnr)).join(" OR "),
        outFields: ["FNR", "OBJECTID"],
        returnGeometry: false,
      },
      toDataSourceQueryOptions(signalOptions)
    );

    abortHelpers.throwIfAborted(options?.signal);

    if (!propertyResult?.records || propertyResult.records.length === 0) {
      return new Map();
    }

    propertyResult.records.forEach((record: FeatureDataRecord) => {
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

      if (owners.length > 0) {
        const uniqueOwners = deduplicateOwnerEntries(owners, {
          fnr: validated.fnr,
          propertyId: validated.attrs.UUID_FASTIGHET,
        });

        uniqueOwners.forEach((owner) => {
          const formattedOwner = context.helpers.formatOwnerInfo(
            owner,
            config.enablePIIMasking,
            context.messages.unknownOwner
          );
          const propertyWithShare = context.helpers.formatPropertyWithShare(
            validated.attrs.FASTIGHET,
            owner.ANDEL
          );

          rowsToProcess.push(
            createGridRow({
              fnr: validated.fnr,
              objectId: owner.OBJECTID ?? validated.attrs.OBJECTID,
              uuidFastighet:
                owner.UUID_FASTIGHET ?? validated.attrs.UUID_FASTIGHET,
              fastighet: propertyWithShare,
              bostadr: formattedOwner,
              geometryType: validated.graphic.geometry?.type ?? null,
              createRowId: context.helpers.createRowId,
              rawOwner: owner,
            })
          );
        });
      } else {
        const fallbackMessage = failedFnrs.has(String(validated.fnr))
          ? context.messages.errorOwnerQueryFailed
          : context.messages.unknownOwner;

        const fallbackOwner: OwnerAttributes = {
          OBJECTID: validated.attrs.OBJECTID,
          FNR: validated.fnr,
          UUID_FASTIGHET: validated.attrs.UUID_FASTIGHET,
          FASTIGHET: validated.attrs.FASTIGHET,
          NAMN: fallbackMessage,
          BOSTADR: "",
          POSTNR: "",
          POSTADR: "",
          ORGNR: "",
        };

        rowsToProcess.push(
          createGridRow({
            fnr: validated.fnr,
            objectId: validated.attrs.OBJECTID,
            uuidFastighet: validated.attrs.UUID_FASTIGHET,
            fastighet: validated.attrs.FASTIGHET,
            bostadr: fallbackMessage,
            geometryType: validated.graphic.geometry?.type ?? null,
            createRowId: context.helpers.createRowId,
            rawOwner: fallbackOwner,
          })
        );
      }

      graphicsToAdd.push({
        graphic: validated.graphic,
        fnr: validated.fnr,
      });
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
