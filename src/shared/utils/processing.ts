import type { DataSourceManager } from "jimu-core";
import type {
  CreateGridRowParams,
  FnrValue,
  GridRowData,
  IMConfig,
  OwnerAttributes,
  OwnerQueryResolution,
  ProcessingAccumulator,
  ProcessPropertyQueryParams,
  ProcessPropertyResult,
  PropertyPipelineSuccess,
  PropertyProcessingContext,
  PropertySelectionPipelineParams,
  PropertySelectionPipelineResult,
  QueryResult,
  SelectionGraphicsHelpers,
  SelectionGraphicsParams,
  SerializedQueryResult,
  SerializedQueryResultMap,
  SerializedRecord,
  ValidatedProperty,
} from "../../config/types";
import { propertyActions } from "../../extensions/store";
import { getValidatedOutlineWidth } from "./formatting";
import { buildHighlightColor } from "./graphics";
import {
  cleanupRemovedGraphics,
  createRowId,
  extractFnr,
  normalizeFnrKey,
} from "./helpers";
import { deduplicateOwnerEntries } from "./privacy";
import { serializeGeometry, serializePropertyResult } from "./serialization";

export { createRowId, extractFnr, normalizeFnrKey };

export const createGridRow = (params: CreateGridRowParams): GridRowData => ({
  id: params.createRowId(params.fnr, params.objectId),
  FNR: params.fnr,
  UUID_FASTIGHET: params.uuidFastighet,
  FASTIGHET: params.fastighet,
  BOSTADR: params.bostadr,
  ADDRESS: params.address,
  geometryType: params.geometryType,
  geometry: params.geometry ?? null,
  rawOwner: params.rawOwner,
});

export const accumulatePropertyRows = (
  rows: GridRowData[],
  accumulator: ProcessingAccumulator,
  graphic: __esri.Graphic,
  fnr: FnrValue,
  currentTotal: number,
  maxResults: number
): boolean => {
  if (!rows || rows.length === 0) {
    return currentTotal >= maxResults;
  }

  const remaining = maxResults - currentTotal;
  if (remaining <= 0) {
    return true;
  }

  const shouldTruncate = remaining < rows.length;
  const rowsToAdd = shouldTruncate ? rows.slice(0, remaining) : rows;

  accumulator.rows.push(...rowsToAdd);
  accumulator.graphics.push({ graphic, fnr });

  return shouldTruncate;
};

const mapOwnerToGridRow = (
  owner: OwnerAttributes,
  validated: ValidatedProperty,
  maskPII: boolean,
  context: PropertyProcessingContext,
  geometryType: string | null,
  serializedGeometry: SerializedRecord | null
): GridRowData => {
  const { fnr, attrs } = validated;
  const { createRowId, formatOwnerInfo, formatPropertyWithShare } =
    context.helpers;
  const { unknownOwner } = context.messages;

  const formattedOwner = formatOwnerInfo(owner, maskPII, unknownOwner);

  return createGridRow({
    fnr,
    objectId: owner.OBJECTID ?? attrs.OBJECTID,
    uuidFastighet: owner.UUID_FASTIGHET ?? attrs.UUID_FASTIGHET,
    fastighet: formatPropertyWithShare(
      owner.FASTIGHET ?? attrs.FASTIGHET,
      owner.ANDEL
    ),
    bostadr: formattedOwner,
    address: formattedOwner,
    geometryType,
    geometry: serializedGeometry,
    createRowId,
    rawOwner: owner,
  });
};

const createOwnerRows = (
  validated: ValidatedProperty,
  owners: OwnerAttributes[],
  maskPII: boolean,
  context: PropertyProcessingContext,
  geometryType: string | null,
  serializedGeometry: SerializedRecord | null
): GridRowData[] => {
  const uniqueOwners = deduplicateOwnerEntries(owners, {
    fnr: validated.fnr,
    propertyId: validated.attrs.UUID_FASTIGHET,
  });

  return uniqueOwners.map((owner) =>
    mapOwnerToGridRow(
      owner,
      validated,
      maskPII,
      context,
      geometryType,
      serializedGeometry
    )
  );
};

const createFallbackRow = (
  validated: ValidatedProperty,
  queryFailed: boolean,
  context: PropertyProcessingContext,
  geometryType: string | null,
  serializedGeometry: SerializedRecord | null
): GridRowData[] => {
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
      address: "",
      geometryType,
      geometry: serializedGeometry,
      createRowId: context.helpers.createRowId,
      rawOwner: fallbackOwner,
    }),
  ];
};

export const buildPropertyRows = (
  validated: ValidatedProperty,
  owners: OwnerAttributes[],
  queryFailed: boolean,
  maskPII: boolean,
  context: PropertyProcessingContext
): GridRowData[] => {
  const geometry = validated.graphic.geometry;
  const geometryType = geometry?.type ?? null;
  const serializedGeometry = serializeGeometry(geometry);

  if (owners.length > 0) {
    return createOwnerRows(
      validated,
      owners,
      maskPII,
      context,
      geometryType,
      serializedGeometry
    );
  }

  return createFallbackRow(
    validated,
    queryFailed,
    context,
    geometryType,
    serializedGeometry
  );
};

export const shouldStopAccumulation = (
  currentRowCount: number,
  accumulatedRows: number,
  maxResults: number
): boolean => {
  if (maxResults <= 0) {
    return true;
  }
  return currentRowCount + accumulatedRows >= maxResults;
};

const extractFeatureFnr = (
  result: QueryResult,
  extract: (
    attrs: { [key: string]: unknown } | null | undefined
  ) => FnrValue | null,
  normalize: (fnr: FnrValue | null | undefined) => string
): string | null => {
  const feature = result?.features?.[0];
  if (!feature?.attributes) {
    return null;
  }

  const attributes = feature.attributes as {
    [key: string]: unknown;
  };
  const fnr = extract(attributes);

  return fnr != null ? normalize(fnr) : null;
};

const buildSelectedFnrSet = (
  selectedProperties: GridRowData[],
  normalize: (fnr: FnrValue | null | undefined) => string
): Set<string> => {
  return new Set(selectedProperties.map((row) => normalize(row.FNR)));
};

const collectKeysToRemove = (
  propertyResults: QueryResult[],
  selectedFnrKeys: Set<string>,
  extract: (
    attrs: { [key: string]: unknown } | null | undefined
  ) => FnrValue | null,
  normalize: (fnr: FnrValue | null | undefined) => string
): Set<string> | null => {
  const keysToRemove = new Set<string>();

  for (const result of propertyResults) {
    const key = extractFeatureFnr(result, extract, normalize);
    if (key == null || !selectedFnrKeys.has(key)) {
      return null;
    }
    keysToRemove.add(key);
  }

  return keysToRemove.size > 0 ? keysToRemove : null;
};

export const deriveToggleState = (params: {
  propertyResults: QueryResult[];
  selectedProperties: GridRowData[];
  toggleEnabled: boolean;
  normalizeFnrKey: (fnr: FnrValue | null | undefined) => string;
  extractFnr: (
    attributes: { [key: string]: unknown } | null | undefined
  ) => FnrValue | null;
}): {
  status: "remove_only";
  keysToRemove: Set<string>;
  updatedRows: GridRowData[];
} | null => {
  const {
    propertyResults,
    selectedProperties,
    toggleEnabled,
    normalizeFnrKey: normalize,
    extractFnr: extract,
  } = params;

  if (!toggleEnabled || selectedProperties.length === 0) {
    return null;
  }

  const selectedFnrKeys = buildSelectedFnrSet(selectedProperties, normalize);
  if (selectedFnrKeys.size === 0) {
    return null;
  }

  const keysToRemove = collectKeysToRemove(
    propertyResults,
    selectedFnrKeys,
    extract,
    normalize
  );
  if (!keysToRemove) {
    return null;
  }

  const updatedRows = selectedProperties.filter(
    (row) => !keysToRemove.has(normalize(row.FNR))
  );

  return {
    status: "remove_only",
    keysToRemove,
    updatedRows,
  };
};

export const processOwnerResult = (params: {
  resolution: OwnerQueryResolution;
  validated: ValidatedProperty;
  context: PropertyProcessingContext;
  maskPII: boolean;
  accumulator: ProcessingAccumulator;
  currentRowCount: number;
  maxResults: number;
}): boolean => {
  const {
    resolution,
    validated,
    context,
    maskPII,
    accumulator,
    currentRowCount,
    maxResults,
  } = params;

  if (
    shouldStopAccumulation(currentRowCount, accumulator.rows.length, maxResults)
  ) {
    return true;
  }

  const totalBefore = currentRowCount + accumulator.rows.length;

  if (resolution.error || !resolution.value) {
    const rows = buildPropertyRows(validated, [], true, maskPII, context);
    return accumulatePropertyRows(
      rows,
      accumulator,
      validated.graphic,
      validated.fnr,
      totalBefore,
      maxResults
    );
  }

  const ownerResult = resolution.value;
  const rows = buildPropertyRows(
    ownerResult.validated,
    ownerResult.owners,
    ownerResult.queryFailed,
    maskPII,
    context
  );

  return accumulatePropertyRows(
    rows,
    accumulator,
    ownerResult.validated.graphic,
    ownerResult.validated.fnr,
    totalBefore,
    maxResults
  );
};

export const isDuplicateProperty = (
  fnr: string | number,
  existingProperties: Array<{ FNR: string | number }>
): boolean => {
  const fnrKey = normalizeFnrKey(fnr);
  return existingProperties.some((row) => normalizeFnrKey(row.FNR) === fnrKey);
};

export const shouldToggleRemove = (
  fnr: string | number,
  existingProperties: Array<{ FNR: string | number }>,
  toggleEnabled: boolean
): boolean => {
  if (!toggleEnabled) return false;
  return isDuplicateProperty(fnr, existingProperties);
};

const buildFnrGroupMap = <T extends { FNR: string | number; id: string }>(
  properties: T[]
): { byFnr: Map<string, T[]>; seenIds: Set<string> } => {
  const byFnr = new Map<string, T[]>();
  const seenIds = new Set<string>();
  const propertiesLen = properties.length;

  for (let i = 0; i < propertiesLen; i++) {
    const row = properties[i];
    const fnrKey = normalizeFnrKey(row.FNR);
    const existingGroup = byFnr.get(fnrKey);
    if (existingGroup) {
      existingGroup.push(row);
    } else {
      byFnr.set(fnrKey, [row]);
    }
    seenIds.add(row.id);
  }

  return { byFnr, seenIds };
};

const shouldRemoveForToggle = <T extends { FNR: string | number }>(
  row: T,
  existingByFnr: Map<string, T[]>,
  toggleEnabled: boolean
): boolean => {
  if (!toggleEnabled) return false;
  const fnrKey = normalizeFnrKey(row.FNR);
  const existingGroup = existingByFnr.get(fnrKey);
  return existingGroup != null && existingGroup.length > 0;
};

const processRowsForToggleAndDedup = <
  T extends { FNR: string | number; id: string },
>(
  rowsToProcess: T[],
  existingByFnr: Map<string, T[]>,
  seenIds: Set<string>,
  toggleEnabled: boolean
): { toRemove: Set<string>; toAdd: T[] } => {
  const toRemove = new Set<string>();
  const toAdd: T[] = [];

  for (const row of rowsToProcess) {
    if (shouldRemoveForToggle(row, existingByFnr, toggleEnabled)) {
      const fnrKey = normalizeFnrKey(row.FNR);
      const existingGroup = existingByFnr.get(fnrKey);
      if (existingGroup) {
        for (const existingRow of existingGroup) {
          toRemove.add(existingRow.id);
        }
      }
      continue;
    }

    if (seenIds.has(row.id)) {
      continue;
    }

    toAdd.push(row);
    seenIds.add(row.id);
  }

  return { toRemove, toAdd };
};

const applyRemovalsAndAdditions = <
  T extends { FNR: string | number; id: string },
>(
  existingProperties: T[],
  toRemove: Set<string>,
  toAdd: T[],
  maxResults: number
): T[] => {
  let updatedRows: T[];
  const existingLen = existingProperties.length;

  if (toRemove.size > 0) {
    updatedRows = [];
    for (let i = 0; i < existingLen; i++) {
      const row = existingProperties[i];
      if (!toRemove.has(normalizeFnrKey(row.FNR))) {
        updatedRows.push(row);
      }
    }
  } else {
    updatedRows = existingProperties.slice();
  }

  updatedRows.push(...toAdd);

  if (updatedRows.length > maxResults) {
    updatedRows.length = maxResults;
  }

  return updatedRows;
};

export const calculatePropertyUpdates = <
  T extends { FNR: string | number; id: string },
>(
  rowsToProcess: T[],
  existingProperties: T[],
  toggleEnabled: boolean,
  maxResults: number
): { toRemove: Set<string>; toAdd: T[]; updatedRows: T[] } => {
  const { byFnr: existingByFnr, seenIds } =
    buildFnrGroupMap(existingProperties);
  const { toRemove, toAdd } = processRowsForToggleAndDedup(
    rowsToProcess,
    existingByFnr,
    seenIds,
    toggleEnabled
  );
  const updatedRows = applyRemovalsAndAdditions(
    existingProperties,
    toRemove,
    toAdd,
    maxResults
  );

  return { toRemove, toAdd, updatedRows };
};

export const processPropertyQueryResults = async (
  params: ProcessPropertyQueryParams
): Promise<ProcessPropertyResult> => {
  const { propertyResults, config, processingContext, services } = params;

  const useBatchQuery =
    config.enableBatchOwnerQuery &&
    config.relationshipId !== undefined &&
    config.propertyDataSourceId;

  if (useBatchQuery && config.relationshipId !== undefined) {
    return await services.processBatch({
      propertyResults,
      config: {
        propertyDataSourceId: config.propertyDataSourceId,
        ownerDataSourceId: config.ownerDataSourceId,
        enablePIIMasking: config.enablePIIMasking,
        relationshipId: config.relationshipId,
      },
      context: processingContext,
    });
  }

  return await services.processIndividual({
    propertyResults,
    config: {
      ownerDataSourceId: config.ownerDataSourceId,
      enablePIIMasking: config.enablePIIMasking,
    },
    context: processingContext,
  });
};

const extractFnrFromFeature = (
  feature: __esri.Graphic | undefined
): string | number | null => {
  const attributes = feature?.attributes as
    | { FNR?: unknown; fnr?: unknown }
    | undefined;

  const fnrValue = attributes?.FNR ?? attributes?.fnr;

  if (typeof fnrValue === "string" || typeof fnrValue === "number") {
    return fnrValue;
  }

  return null;
};

const buildPropertyResultsLookup = (
  propertyResults: QueryResult[],
  normalize: (fnr: FnrValue | null | undefined) => string
): Map<string, SerializedQueryResult> => {
  const lookup = new Map<string, SerializedQueryResult>();
  const resultsLen = propertyResults.length;

  for (let i = 0; i < resultsLen; i++) {
    const result = propertyResults[i];
    const fnrValue = extractFnrFromFeature(result?.features?.[0]);

    if (fnrValue != null) {
      lookup.set(normalize(fnrValue), serializePropertyResult(result));
    }
  }

  return lookup;
};

const buildSelectedPropertiesLookup = (
  selectedProperties: Array<{ FNR: string | number; id: string }>,
  normalize: (fnr: FnrValue | null | undefined) => string
): Map<string, string> => {
  const lookup = new Map<string, string>();
  const selectedLen = selectedProperties.length;

  for (let i = 0; i < selectedLen; i++) {
    const row = selectedProperties[i];
    lookup.set(normalize(row.FNR), row.id);
  }

  return lookup;
};

const addProcessedRows = (
  updated: Map<string, SerializedQueryResult>,
  rowsToProcess: Array<{ FNR: string | number; id: string }>,
  propertyResultsByFnr: Map<string, SerializedQueryResult>,
  propertyResults: QueryResult[],
  normalize: (fnr: FnrValue | null | undefined) => string
): void => {
  let fallbackIndex = 0;
  const resultsLen = propertyResults.length;
  const rowsLen = rowsToProcess.length;

  for (let i = 0; i < rowsLen; i++) {
    const row = rowsToProcess[i];
    const fnrKey = normalize(row.FNR);
    let propertyResult = propertyResultsByFnr.get(fnrKey);

    if (!propertyResult && resultsLen > 0) {
      const fallback = serializePropertyResult(
        propertyResults[Math.min(fallbackIndex, resultsLen - 1)]
      );
      fallbackIndex += 1;
      propertyResult = fallback;
    }

    if (propertyResult) {
      updated.set(row.id, propertyResult);
    }
  }
};

const removeDeletedProperties = (
  updated: Map<string, SerializedQueryResult>,
  toRemove: Set<string>,
  selectedByFnr: Map<string, string>
): void => {
  toRemove.forEach((removedKey) => {
    const removedId = selectedByFnr.get(removedKey);
    if (removedId) {
      updated.delete(removedId);
    }
  });
};

export const updateRawPropertyResults = (
  prev:
    | Map<string, SerializedQueryResult>
    | { [key: string]: SerializedQueryResult },
  rowsToProcess: Array<{ FNR: string | number; id: string }>,
  propertyResults: QueryResult[],
  toRemove: Set<string>,
  selectedProperties: Array<{ FNR: string | number; id: string }>,
  normalize: (fnr: FnrValue | null | undefined) => string
): Map<string, SerializedQueryResult> => {
  const prevMap = prev instanceof Map ? prev : new Map();

  const updated = new Map(prevMap);
  const propertyResultsByFnr = buildPropertyResultsLookup(
    propertyResults,
    normalize
  );
  const selectedByFnr = buildSelectedPropertiesLookup(
    selectedProperties,
    normalize
  );

  addProcessedRows(
    updated,
    rowsToProcess,
    propertyResultsByFnr,
    propertyResults,
    normalize
  );
  removeDeletedProperties(updated, toRemove, selectedByFnr);

  return updated;
};

export const executePropertyQueryPipeline = async (params: {
  mapPoint: __esri.Point;
  config: IMConfig;
  dsManager: DataSourceManager;
  maxResults: number;
  toggleEnabled: boolean;
  enablePIIMasking: boolean;
  selectedProperties: GridRowData[];
  signal: AbortSignal;
  translate: (key: string) => string;
  runPipeline: (
    input: PropertySelectionPipelineParams
  ) => Promise<PropertySelectionPipelineResult>;
}): Promise<PropertySelectionPipelineResult> => {
  return params.runPipeline({
    mapPoint: params.mapPoint,
    propertyDataSourceId: params.config.propertyDataSourceId,
    ownerDataSourceId: params.config.ownerDataSourceId,
    dsManager: params.dsManager,
    maxResults: params.maxResults,
    toggleEnabled: params.toggleEnabled,
    enableBatchOwnerQuery: params.config.enableBatchOwnerQuery,
    relationshipId: params.config.relationshipId,
    enablePIIMasking: params.enablePIIMasking,
    signal: params.signal,
    selectedProperties: params.selectedProperties,
    translate: params.translate,
  });
};

export const computePropertySelectionUpdate = (params: {
  pipelineResult: PropertyPipelineSuccess;
  previousRawResults:
    | SerializedQueryResultMap
    | Map<string, SerializedQueryResult>
    | null;
  selectedProperties: GridRowData[];
  normalizeFnrKey: (fnr: FnrValue | null | undefined) => string;
  highlightColorConfig: string;
  highlightOpacityConfig: number;
  outlineWidthConfig: number;
}): {
  rowsToStore: GridRowData[];
  resultsToStore: SerializedQueryResultMap;
  highlightColor: [number, number, number, number];
  outlineWidth: number;
  fnrKeysToRemove: Set<string>;
} => {
  const {
    pipelineResult,
    previousRawResults,
    selectedProperties,
    normalizeFnrKey: normalize,
    highlightColorConfig,
    highlightOpacityConfig,
    outlineWidthConfig,
  } = params;

  const prevPlain = previousRawResults ?? {};
  const updatedRawResults = updateRawPropertyResults(
    prevPlain,
    pipelineResult.rowsToProcess,
    pipelineResult.propertyResults,
    pipelineResult.toRemove,
    selectedProperties,
    normalize
  );

  const resultsToStore =
    updatedRawResults instanceof Map
      ? (Object.fromEntries(updatedRawResults) as SerializedQueryResultMap)
      : updatedRawResults;

  const highlightColor = buildHighlightColor(
    highlightColorConfig,
    highlightOpacityConfig
  );
  const outlineWidth = getValidatedOutlineWidth(outlineWidthConfig);

  return {
    rowsToStore: pipelineResult.updatedRows,
    resultsToStore,
    highlightColor,
    outlineWidth,
    fnrKeysToRemove: pipelineResult.toRemove,
  };
};

export const updatePropertySelectionState = (params: {
  pipelineResult: PropertyPipelineSuccess;
  previousRawResults:
    | SerializedQueryResultMap
    | Map<string, SerializedQueryResult>
    | null;
  selectedProperties: GridRowData[];
  dispatch: (action: unknown) => void;
  widgetId: string;
  removeHighlightForFnr: (
    fnr: FnrValue,
    normalize: (fnr: FnrValue | null | undefined) => string
  ) => void;
  normalizeFnrKey: (fnr: FnrValue | null | undefined) => string;
  highlightColorConfig: string;
  highlightOpacityConfig: number;
  outlineWidthConfig: number;
}): {
  rowsToStore: GridRowData[];
  resultsToStore: SerializedQueryResultMap;
  highlightColor: [number, number, number, number];
  outlineWidth: number;
} => {
  const {
    pipelineResult,
    previousRawResults,
    selectedProperties,
    dispatch,
    widgetId,
    removeHighlightForFnr,
    normalizeFnrKey: normalize,
    highlightColorConfig,
    highlightOpacityConfig,
    outlineWidthConfig,
  } = params;

  const update = computePropertySelectionUpdate({
    pipelineResult,
    previousRawResults,
    selectedProperties,
    normalizeFnrKey: normalize,
    highlightColorConfig,
    highlightOpacityConfig,
    outlineWidthConfig,
  });

  cleanupRemovedGraphics({
    toRemove: update.fnrKeysToRemove,
    removeHighlightForFnr,
    normalizeFnrKey: normalize,
  });

  dispatch(propertyActions.setSelectedProperties(update.rowsToStore, widgetId));
  dispatch(propertyActions.setRawResults(update.resultsToStore, widgetId));
  dispatch(propertyActions.setQueryInFlight(false, widgetId));

  return {
    rowsToStore: update.rowsToStore,
    resultsToStore: update.resultsToStore,
    highlightColor: update.highlightColor,
    outlineWidth: update.outlineWidth,
  };
};

export const scheduleGraphicsRendering = (params: {
  pipelineResult: PropertyPipelineSuccess;
  highlightColor: [number, number, number, number];
  outlineWidth: number;
  graphicsHelpers: SelectionGraphicsHelpers;
  getCurrentView: () => __esri.MapView | null | undefined;
  isStaleRequest: () => boolean;
  syncFn: (params: SelectionGraphicsParams) => void | Promise<unknown>;
}): void => {
  const {
    pipelineResult,
    highlightColor,
    outlineWidth,
    graphicsHelpers,
    getCurrentView,
    isStaleRequest,
    syncFn,
  } = params;

  const renderGraphics = () => {
    if (isStaleRequest()) {
      return;
    }

    const result = syncFn({
      graphicsToAdd: pipelineResult.graphicsToAdd,
      selectedRows: pipelineResult.updatedRows,
      getCurrentView,
      helpers: graphicsHelpers,
      highlightColor,
      outlineWidth,
    });

    if (
      result &&
      typeof result === "object" &&
      "catch" in result &&
      typeof result.catch === "function"
    ) {
      result.catch((error: unknown) => {
        console.log("Failed to render selection highlights", error, {
          selectionSize: pipelineResult.updatedRows.length,
        });
      });
    }
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      renderGraphics();
    });
    return;
  }

  renderGraphics();
};
