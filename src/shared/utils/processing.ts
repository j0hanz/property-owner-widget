import type { DataSourceManager } from "jimu-core";
import type {
  GridRowData,
  CreateGridRowParams,
  ProcessingAccumulator,
  PropertyProcessingContext,
  OwnerQueryResolution,
  OwnerAttributes,
  QueryResult,
  ValidatedProperty,
  PropertySelectionPipelineResult,
  PropertySelectionPipelineParams,
  PropertyPipelineSuccess,
  ProcessPropertyQueryParams,
  ProcessPropertyResult,
  FnrValue,
  SerializedQueryResult,
  SerializedQueryResultMap,
  SerializedQueryFeature,
  SerializedRecord,
  UnknownRecord,
  SelectionGraphicsParams,
  SelectionGraphicsHelpers,
  IMConfig,
  PropertyDispatcher,
} from "../../config/types";
import { deduplicateOwnerEntries } from "./privacy";
import { cleanupRemovedGraphics, isRecord } from "./helpers";
import { buildHighlightColor } from "./graphics";
import { getValidatedOutlineWidth } from "./formatting";

export const createRowId = (fnr: string | number, objectId: number): string =>
  `${fnr}_${objectId}`;

export const extractFnr = (
  attributes: { [key: string]: unknown } | null | undefined
): string | number | null => {
  if (!attributes) return null;
  const fnr = attributes.FNR ?? attributes.fnr;
  if (typeof fnr === "string" || typeof fnr === "number") {
    return fnr;
  }
  return null;
};

export const normalizeFnrKey = (
  fnr: string | number | null | undefined
): string => {
  return fnr != null ? String(fnr) : "";
};

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

export const buildPropertyRows = (
  validated: ValidatedProperty,
  owners: OwnerAttributes[],
  queryFailed: boolean,
  maskPII: boolean,
  context: PropertyProcessingContext
): GridRowData[] => {
  const geometry = validated.graphic.geometry;
  const geometryType = geometry?.type ?? null;
  const serializedGeometry =
    geometry && typeof geometry.toJSON === "function"
      ? geometry.toJSON()
      : null;

  if (owners.length > 0) {
    const uniqueOwners = deduplicateOwnerEntries(owners, {
      fnr: validated.fnr,
      propertyId: validated.attrs.UUID_FASTIGHET,
    });

    return uniqueOwners.map((owner) => {
      const formattedOwner = context.helpers.formatOwnerInfo(
        owner,
        maskPII,
        context.messages.unknownOwner
      );

      return createGridRow({
        fnr: validated.fnr,
        objectId: owner.OBJECTID ?? validated.attrs.OBJECTID,
        uuidFastighet: owner.UUID_FASTIGHET ?? validated.attrs.UUID_FASTIGHET,
        fastighet: context.helpers.formatPropertyWithShare(
          owner.FASTIGHET ?? validated.attrs.FASTIGHET,
          owner.ANDEL
        ),
        bostadr: formattedOwner,
        address: formattedOwner,
        geometryType,
        geometry: serializedGeometry,
        createRowId: context.helpers.createRowId,
        rawOwner: owner,
      });
    });
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
      address: "",
      geometryType,
      geometry: serializedGeometry,
      createRowId: context.helpers.createRowId,
      rawOwner: fallbackOwner,
    }),
  ];
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

  const selectedFnrKeys = new Set(
    selectedProperties.map((row) => normalize(row.FNR))
  );
  if (selectedFnrKeys.size === 0) {
    return null;
  }

  const keysToRemove = new Set<string>();

  for (const result of propertyResults) {
    const feature = result?.features?.[0] ?? null;
    const attributes = (feature?.attributes ?? null) as {
      [key: string]: unknown;
    } | null;
    const fnr = extract(attributes);
    if (fnr == null) {
      return null;
    }

    const key = normalize(fnr);
    if (!selectedFnrKeys.has(key)) {
      return null;
    }
    keysToRemove.add(key);
  }

  if (keysToRemove.size === 0) {
    return null;
  }

  const updatedRows = selectedProperties.filter((row) => {
    return !keysToRemove.has(normalize(row.FNR));
  });

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

export const calculatePropertyUpdates = <
  T extends { FNR: string | number; id: string },
>(
  rowsToProcess: T[],
  existingProperties: T[],
  toggleEnabled: boolean,
  maxResults: number
): { toRemove: Set<string>; toAdd: T[]; updatedRows: T[] } => {
  const existingByFnr = new Map<string, T[]>();
  const seenIds = new Set<string>();

  existingProperties.forEach((row) => {
    const fnrKey = normalizeFnrKey(row.FNR);
    const existingGroup = existingByFnr.get(fnrKey);
    if (existingGroup) {
      existingGroup.push(row);
    } else {
      existingByFnr.set(fnrKey, [row]);
    }
    seenIds.add(row.id);
  });

  const toRemove = new Set<string>();
  const toAdd: T[] = [];

  rowsToProcess.forEach((row) => {
    const fnrKey = normalizeFnrKey(row.FNR);

    if (toggleEnabled && !toRemove.has(fnrKey)) {
      const existingGroup = existingByFnr.get(fnrKey);
      if (existingGroup && existingGroup.length > 0) {
        toRemove.add(fnrKey);
        return;
      }
    }

    if (seenIds.has(row.id)) {
      return;
    }

    toAdd.push(row);
    seenIds.add(row.id);
  });

  const updatedRows =
    toRemove.size > 0
      ? existingProperties.filter(
          (row) => !toRemove.has(normalizeFnrKey(row.FNR))
        )
      : existingProperties.slice();

  updatedRows.push(...toAdd);

  if (updatedRows.length > maxResults) {
    updatedRows.length = maxResults;
  }

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
  const prevMap =
    prev instanceof Map
      ? prev
      : new Map(Object.entries(prev || {}).map(([key, value]) => [key, value]));

  const structuredCloneFn = (
    globalThis as unknown as {
      structuredClone?: (value: unknown) => unknown;
    }
  ).structuredClone;

  const clonePlainValue = (value: unknown): unknown => {
    if (value == null) {
      return null;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (typeof structuredCloneFn === "function") {
      try {
        return structuredCloneFn(value);
      } catch (_error) {
        // Fall back to manual cloning when structuredClone is unavailable
      }
    }

    if (Array.isArray(value)) {
      return value.map((item) => clonePlainValue(item));
    }

    if (isRecord(value)) {
      const withToJSON = value as UnknownRecord & {
        toJSON?: () => unknown;
      };
      if (typeof withToJSON.toJSON === "function") {
        return clonePlainValue(withToJSON.toJSON());
      }

      try {
        return JSON.parse(JSON.stringify(value)) as unknown;
      } catch (_error) {
        const result: UnknownRecord = {};
        Object.entries(value).forEach(([key, entryValue]) => {
          result[key] = clonePlainValue(entryValue);
        });
        return result;
      }
    }

    return null;
  };

  type GraphicWithAggregates = __esri.Graphic & {
    aggregateGeometries?: unknown;
  };

  const serializeFeature = (
    feature: __esri.Graphic | undefined | null
  ): SerializedQueryFeature => {
    if (!feature) {
      return {
        attributes: null,
        geometry: null,
        aggregateGeometries: null,
        symbol: null,
        popupTemplate: null,
      };
    }

    const geometry = feature.geometry as __esri.Geometry | undefined;
    const geometryJson = geometry
      ? typeof geometry.toJSON === "function"
        ? (geometry.toJSON() as SerializedRecord)
        : (clonePlainValue(geometry) as SerializedRecord | null)
      : null;

    const aggregateGeometries = (feature as GraphicWithAggregates)
      .aggregateGeometries;

    return {
      attributes:
        feature.attributes && typeof feature.attributes === "object"
          ? {
              ...(feature.attributes as UnknownRecord),
            }
          : null,
      geometry: geometryJson ?? null,
      aggregateGeometries: clonePlainValue(
        aggregateGeometries ?? null
      ) as SerializedRecord | null,
      symbol: clonePlainValue(
        feature.symbol ?? null
      ) as SerializedRecord | null,
      popupTemplate: clonePlainValue(
        feature.popupTemplate ?? null
      ) as SerializedRecord | null,
    };
  };

  const serializePropertyResult = (
    result: QueryResult
  ): SerializedQueryResult => ({
    propertyId: result?.propertyId ?? "",
    features: Array.isArray(result?.features)
      ? result.features.map((feature) => serializeFeature(feature))
      : [],
  });

  const updated = new Map(prevMap);

  const propertyResultsByFnr = new Map<string, SerializedQueryResult>();
  propertyResults.forEach((result) => {
    const feature = result?.features?.[0];
    const attributes = feature?.attributes as
      | { FNR?: string | number; fnr?: string | number }
      | undefined;
    const fnrValue = attributes?.FNR ?? attributes?.fnr;
    if (fnrValue != null) {
      propertyResultsByFnr.set(
        normalize(fnrValue),
        serializePropertyResult(result)
      );
    }
  });

  let fallbackIndex = 0;

  const selectedByFnr = new Map<string, string>();
  selectedProperties.forEach((row) => {
    selectedByFnr.set(normalize(row.FNR), row.id);
  });

  rowsToProcess.forEach((row) => {
    const fnrKey = normalize(row.FNR);
    let propertyResult = propertyResultsByFnr.get(fnrKey);

    if (!propertyResult && propertyResults.length > 0) {
      const fallback = serializePropertyResult(
        propertyResults[Math.min(fallbackIndex, propertyResults.length - 1)]
      );
      fallbackIndex += 1;
      propertyResult = fallback;
    }

    if (propertyResult) {
      updated.set(row.id, propertyResult);
    }
  });

  toRemove.forEach((removedKey) => {
    const removedId = selectedByFnr.get(removedKey);
    if (removedId) {
      updated.delete(removedId);
    }
  });

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
  perfStart: number;
  runPipeline: (
    input: PropertySelectionPipelineParams
  ) => Promise<PropertySelectionPipelineResult>;
}): Promise<PropertySelectionPipelineResult> => {
  const {
    mapPoint,
    config,
    dsManager,
    maxResults,
    toggleEnabled,
    enablePIIMasking,
    selectedProperties,
    signal,
    translate,
    perfStart,
    runPipeline,
  } = params;

  const pipelineStart = performance.now();
  console.log("[PERF] Pipeline started at", pipelineStart - perfStart, "ms");

  const pipelineResult = await runPipeline({
    mapPoint,
    propertyDataSourceId: config.propertyDataSourceId,
    ownerDataSourceId: config.ownerDataSourceId,
    dsManager,
    maxResults,
    toggleEnabled,
    enableBatchOwnerQuery: config.enableBatchOwnerQuery,
    relationshipId: config.relationshipId,
    enablePIIMasking,
    signal,
    selectedProperties,
    translate,
  });

  const pipelineEnd = performance.now();
  console.log(
    "[PERF] Pipeline completed at",
    pipelineEnd - perfStart,
    "ms",
    "(took",
    pipelineEnd - pipelineStart,
    "ms)"
  );

  return pipelineResult;
};

export const updatePropertySelectionState = (params: {
  pipelineResult: PropertyPipelineSuccess;
  previousRawResults:
    | SerializedQueryResultMap
    | Map<string, SerializedQueryResult>
    | null;
  selectedProperties: GridRowData[];
  dispatch: PropertyDispatcher;
  removeGraphicsForFnr: (
    fnr: FnrValue,
    normalize: (fnr: FnrValue | null | undefined) => string
  ) => void;
  normalizeFnrKey: (fnr: FnrValue | null | undefined) => string;
  highlightColorConfig: string;
  highlightOpacityConfig: number;
  outlineWidthConfig: number;
  perfStart: number;
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
    removeGraphicsForFnr,
    normalizeFnrKey: normalize,
    highlightColorConfig,
    highlightOpacityConfig,
    outlineWidthConfig,
    perfStart,
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

  cleanupRemovedGraphics({
    toRemove: pipelineResult.toRemove,
    removeGraphicsForFnr,
    normalizeFnrKey: normalize,
  });

  const resultsToStore =
    updatedRawResults instanceof Map
      ? (Object.fromEntries(updatedRawResults) as SerializedQueryResultMap)
      : updatedRawResults;

  const highlightColor = buildHighlightColor(
    highlightColorConfig,
    highlightOpacityConfig
  );
  const outlineWidth = getValidatedOutlineWidth(outlineWidthConfig);

  const reduxStart = performance.now();
  console.log("[PERF] Redux update started at", reduxStart - perfStart, "ms");

  dispatch.setSelectedProperties(pipelineResult.updatedRows);
  dispatch.setRawResults(resultsToStore);
  dispatch.setQueryInFlight(false);

  const reduxEnd = performance.now();
  console.log(
    "[PERF] Redux update completed at",
    reduxEnd - perfStart,
    "ms",
    "(took",
    reduxEnd - reduxStart,
    "ms)"
  );
  console.log("[PERF] UI VISIBLE TIME:", reduxEnd - perfStart, "ms");

  return {
    rowsToStore: pipelineResult.updatedRows,
    resultsToStore,
    highlightColor,
    outlineWidth,
  };
};

export const scheduleGraphicsRendering = (params: {
  pipelineResult: PropertyPipelineSuccess;
  highlightColor: [number, number, number, number];
  outlineWidth: number;
  graphicsHelpers: SelectionGraphicsHelpers;
  getCurrentView: () => __esri.MapView | null | undefined;
  isStaleRequest: () => boolean;
  perfStart: number;
  syncFn: (params: SelectionGraphicsParams) => void;
}): void => {
  const {
    pipelineResult,
    highlightColor,
    outlineWidth,
    graphicsHelpers,
    getCurrentView,
    isStaleRequest,
    perfStart,
    syncFn,
  } = params;

  const renderGraphics = () => {
    if (isStaleRequest()) {
      return;
    }

    const graphicsStart = performance.now();
    console.log(
      "[PERF] Graphics rendering started at",
      graphicsStart - perfStart,
      "ms"
    );

    syncFn({
      graphicsToAdd: pipelineResult.graphicsToAdd,
      selectedRows: pipelineResult.updatedRows,
      getCurrentView,
      helpers: graphicsHelpers,
      highlightColor,
      outlineWidth,
    });

    const graphicsEnd = performance.now();
    console.log(
      "[PERF] Graphics rendering completed at",
      graphicsEnd - perfStart,
      "ms",
      "(took",
      graphicsEnd - graphicsStart,
      "ms)"
    );
    console.log(
      "[PERF] TOTAL TIME (with async graphics):",
      graphicsEnd - perfStart,
      "ms"
    );
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      renderGraphics();
    });
    return;
  }

  renderGraphics();
};
