import copy from "copy-to-clipboard";
import type * as React from "react";
import type {
  DataSourceManager,
  FeatureLayerDataSource,
  ImmutableArray,
  UseDataSource,
} from "jimu-core";
import {
  runPropertySelectionPipeline,
  queryPropertyByPoint,
  queryOwnerByFnr,
} from "./api";
import { propertyActions } from "../extensions/store";
import {
  CURSOR_TOOLTIP_STYLE,
  HIGHLIGHT_MARKER_SIZE,
  HEX_COLOR_PATTERN,
  MAX_MASK_ASTERISKS,
  MIN_MASK_LENGTH,
} from "../config/constants";
import type {
  OwnerAttributes,
  ValidationResult,
  SelectionGraphicsHelpers,
  EsriModules,
  CursorTooltipStyle,
  IMConfig,
  GridRowData,
  ErrorState,
  SerializedQueryResult,
  SerializedQueryFeature,
  QueryResult,
  CursorGraphicsState,
  ProcessPropertyQueryParams,
  ProcessPropertyResult,
  FnrValue,
  SerializedRecord,
  UnknownRecord,
  MapClickValidationParams,
  UseDataSourceCandidate,
  MapViewWithPopupToggle,
  SerializedQueryResultMap,
  PropertyProcessingContext,
  ValidatedProperty,
  ProcessingAccumulator,
  OwnerQueryResolution,
  SelectionGraphicsParams,
  PropertySelectionPipelineResult,
  CreateGridRowParams,
} from "../config/types";

type ValidationFailureResult<T> = Extract<
  ValidationResult<T>,
  { valid: false }
>;

const HTML_WHITESPACE_PATTERN = /[\s\u00A0\u200B]+/g;

const sanitizeWhitespace = (value: string): string =>
  value.replace(HTML_WHITESPACE_PATTERN, " ").trim();

const sanitizeTextContent = (value: string): string => {
  if (!value) {
    return "";
  }

  const text = String(value);

  try {
    if (typeof DOMParser === "undefined") {
      return sanitizeWhitespace(text);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");
    const content = doc.body?.textContent ?? "";
    return sanitizeWhitespace(content);
  } catch (_error) {
    return sanitizeWhitespace(text);
  }
};

export const stripHtml = (value: string): string => sanitizeTextContent(value);

const stripHtmlInternal = (value: string): string => sanitizeTextContent(value);

const checkValidationFailure = <T>(
  result: ValidationResult<T>
): result is ValidationFailureResult<T> => !result.valid;

const isRecord = (value: unknown): value is UnknownRecord => {
  return typeof value === "object" && value !== null;
};

export const createValidationError = (
  type: ErrorState["type"],
  message: string,
  failureReason: string
): ValidationResult<never> => ({
  valid: false,
  error: { type, message },
  failureReason,
});

export const getDataSourceUrl = (
  dataSource: FeatureLayerDataSource | null | undefined
): string | null => {
  if (!dataSource) {
    return null;
  }

  if (typeof (dataSource as { url?: string }).url === "string") {
    return (dataSource as { url?: string }).url ?? null;
  }

  const layerDefinition = dataSource.getLayerDefinition?.();
  if (layerDefinition && typeof layerDefinition === "object") {
    const candidate = (layerDefinition as { url?: string | null }).url;
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  const dsJson = dataSource.getDataSourceJson?.();
  if (dsJson && typeof dsJson === "object") {
    const candidate = (dsJson as { url?: string | null }).url;
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return null;
};

const isQueryableDataSource = (
  dataSource: FeatureLayerDataSource | null
): dataSource is FeatureLayerDataSource => {
  return Boolean(dataSource && typeof dataSource.query === "function");
};

const isPrivateHost = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }

  if (/^10\./u.test(normalized) || /^192\.168\./u.test(normalized)) {
    return true;
  }

  return /^172\.(1[6-9]|2\d|3[0-1])\./u.test(normalized);
};

const isValidHttpsUrl = (url: URL): boolean => {
  return url.protocol === "https:" && (url.port === "" || url.port === "443");
};

const isValidArcGISPath = (pathname: string): boolean => {
  return /\/(?:MapServer|FeatureServer)\/\d+(?:\/query)?$/iu.test(pathname);
};

const isHostAllowed = (
  hostname: string,
  allowedHosts?: readonly string[]
): boolean => {
  if (!allowedHosts || allowedHosts.length === 0) {
    return true;
  }

  const normalizedHostname = hostname.trim().toLowerCase();
  return allowedHosts.some((host) => {
    const normalizedAllowed = host.trim().toLowerCase();
    if (!normalizedAllowed) {
      return false;
    }

    return (
      normalizedHostname === normalizedAllowed ||
      normalizedHostname.endsWith(`.${normalizedAllowed}`)
    );
  });
};

export const isValidArcGISUrl = (
  url: string,
  allowedHosts?: readonly string[]
): boolean => {
  if (!url || typeof url !== "string") {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!isValidHttpsUrl(parsed)) {
      return false;
    }

    if (isPrivateHost(parsed.hostname)) {
      return false;
    }

    if (!isValidArcGISPath(parsed.pathname)) {
      return false;
    }

    return isHostAllowed(parsed.hostname, allowedHosts);
  } catch (_error) {
    return false;
  }
};

const validateSingleDataSource = (
  dataSource: FeatureLayerDataSource | null,
  role: "property" | "owner",
  translate: (key: string) => string
): ValidationResult<{ dataSource: FeatureLayerDataSource }> => {
  if (!isQueryableDataSource(dataSource)) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      `${role}_data_source_invalid`
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
  if (!url || !isValidArcGISUrl(url, allowedHosts)) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorHostNotAllowed"),
      `${role}_disallowed_host`
    );
  }

  return { valid: true, data: { url } };
};

export const validateDataSourcesCore = (params: {
  propertyDsId: string | undefined;
  ownerDsId: string | undefined;
  dsManager: DataSourceManager | null;
  allowedHosts?: readonly string[];
  translate: (key: string) => string;
}): ValidationResult<{ manager: DataSourceManager }> => {
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
      "missing_data_source_manager"
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
  if (!propertyValidation.valid) {
    return propertyValidation as ValidationResult<{
      manager: DataSourceManager;
    }>;
  }

  const ownerValidation = validateSingleDataSource(ownerDs, "owner", translate);
  if (!ownerValidation.valid) {
    return ownerValidation as ValidationResult<{ manager: DataSourceManager }>;
  }

  const propertyDataSource = propertyValidation.data.dataSource;
  const ownerDataSource = ownerValidation.data.dataSource;

  const propertyUrlValidation = validateDataSourceUrl(
    propertyDataSource,
    "property",
    allowedHosts,
    translate
  );
  if (!propertyUrlValidation.valid) {
    return propertyUrlValidation as ValidationResult<{
      manager: DataSourceManager;
    }>;
  }

  const ownerUrlValidation = validateDataSourceUrl(
    ownerDataSource,
    "owner",
    allowedHosts,
    translate
  );
  if (!ownerUrlValidation.valid) {
    return ownerUrlValidation as ValidationResult<{
      manager: DataSourceManager;
    }>;
  }

  return { valid: true, data: { manager: dsManager } };
};

export const createValidationPipeline = <TContext>(
  initialSteps: Array<(context: TContext) => ValidationResult<TContext>> = []
) => {
  const steps = initialSteps.slice();

  const run = (initialContext: TContext): ValidationResult<TContext> => {
    let current = initialContext;
    for (const step of steps) {
      const result = step(current);
      if (!result.valid) {
        return result;
      }
      current = result.data;
    }
    return { valid: true, data: current };
  };

  const executor = ((context: TContext) => run(context)) as ((
    context: TContext
  ) => ValidationResult<TContext>) & {
    addStep: (
      step: (context: TContext) => ValidationResult<TContext>
    ) => typeof executor;
    run: (context: TContext) => ValidationResult<TContext>;
  };

  executor.addStep = (step) => {
    steps.push(step);
    return executor;
  };

  executor.run = run;

  return executor;
};
export const createSymbolCache = () => {
  const cache = new Map<
    string,
    | __esri.SimpleFillSymbol
    | __esri.SimpleLineSymbol
    | __esri.SimpleMarkerSymbol
  >();

  const resolveFromCache = (
    key: string
  ):
    | __esri.SimpleFillSymbol
    | __esri.SimpleLineSymbol
    | __esri.SimpleMarkerSymbol
    | null => {
    const cached = cache.get(key);
    return cached ?? null;
  };

  const storeSymbol = (
    key: string,
    symbol:
      | __esri.SimpleFillSymbol
      | __esri.SimpleLineSymbol
      | __esri.SimpleMarkerSymbol
      | null
  ): void => {
    if (symbol) {
      cache.set(key, symbol);
    }
  };

  return {
    getSymbolForGraphic: (params: {
      modules: EsriModules | null;
      graphic: __esri.Graphic | null | undefined;
      highlightColor: [number, number, number, number];
      outlineWidth: number;
    }):
      | __esri.SimpleFillSymbol
      | __esri.SimpleLineSymbol
      | __esri.SimpleMarkerSymbol
      | null => {
      const { modules, graphic, highlightColor, outlineWidth } = params;
      if (!modules || !graphic || !graphic.geometry) {
        return null;
      }

      const geometryType = graphic.geometry.type as string | undefined;
      const category = resolveGeometryCategory(geometryType);
      if (!category) {
        return null;
      }

      const cacheKey = `${category}-${highlightColor.join(",")}-${outlineWidth}`;
      const cachedSymbol = resolveFromCache(cacheKey);
      if (cachedSymbol) {
        return cachedSymbol;
      }

      const symbol = createHighlightSymbolInstance(
        modules,
        category,
        highlightColor,
        outlineWidth
      );
      storeSymbol(cacheKey, symbol);
      return symbol;
    },
    clear: () => {
      cache.clear();
    },
  } as const;
};

const resolveCollectionLength = (values: unknown): number => {
  if (!values) {
    return 0;
  }
  const candidate = values as { length?: number };
  if (typeof candidate.length === "number") {
    return candidate.length;
  }
  return 0;
};

export const computeSettingsVisibility = (params: {
  useMapWidgetIds?: ImmutableArray<string> | string[] | null;
  config: IMConfig;
}): {
  hasMapSelection: boolean;
  hasRequiredDataSources: boolean;
  canShowDisplayOptions: boolean;
  canShowRelationshipSettings: boolean;
  shouldDisableRelationshipSettings: boolean;
} => {
  const { useMapWidgetIds, config } = params;
  const hasMapSelection = resolveCollectionLength(useMapWidgetIds) > 0;
  const hasPropertyDataSource = Boolean(config.propertyDataSourceId);
  const hasOwnerDataSource = Boolean(config.ownerDataSourceId);
  const hasRequiredDataSources = hasPropertyDataSource && hasOwnerDataSource;
  const canShowDisplayOptions = hasMapSelection && hasRequiredDataSources;
  const canShowRelationshipSettings = canShowDisplayOptions;

  return {
    hasMapSelection,
    hasRequiredDataSources,
    canShowDisplayOptions,
    canShowRelationshipSettings,
    shouldDisableRelationshipSettings: !canShowRelationshipSettings,
  } as const;
};

export const resetDependentFields = (params: {
  shouldDisable: boolean;
  localBatchOwnerQuery: boolean;
  setLocalBatchOwnerQuery: (value: boolean) => void;
  isBatchOwnerQueryEnabled: boolean;
  updateBatchOwnerQuery: (value: boolean) => void;
  relationshipId: number | undefined;
  updateRelationshipId: (value: number | undefined) => void;
  localRelationshipId: string;
  setLocalRelationshipId: (value: string) => void;
  clearRelationshipError: () => void;
}): void => {
  if (!params.shouldDisable) {
    return;
  }

  if (params.localBatchOwnerQuery) {
    params.setLocalBatchOwnerQuery(false);
  }

  if (params.isBatchOwnerQueryEnabled) {
    params.updateBatchOwnerQuery(false);
  }

  if (typeof params.relationshipId !== "undefined") {
    params.updateRelationshipId(undefined);
  }

  if (params.localRelationshipId !== "0") {
    params.setLocalRelationshipId("0");
  }

  params.clearRelationshipError();
};

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

export const logger = {
  debug: (_context: string, _data?: { [key: string]: unknown }) => {
    // Debug logging disabled in production
  },
  warn: (_context: string, _data?: { [key: string]: unknown }) => {
    // Warning logging disabled in production
  },
  error: (
    context: string,
    error: unknown,
    data?: { [key: string]: unknown }
  ) => {
    console.error(`Property Widget: ${context}`, error, data || {});
  },
};

// ============================================================================
// PII MASKING & PRIVACY
// Owner name and address masking for privacy protection
// ============================================================================

const maskText = (text: string, minLength: number): string => {
  const normalized = stripHtmlInternal(text);
  if (normalized.length < minLength) return "***";
  return normalized;
};

const maskNameInternal = (name: string): string => {
  const normalized = maskText(name, MIN_MASK_LENGTH);
  if (normalized === "***") return normalized;

  return normalized
    .split(" ")
    .filter(Boolean)
    .map(
      (part) =>
        `${part.charAt(0)}${"*".repeat(Math.min(MAX_MASK_ASTERISKS, part.length - 1))}`
    )
    .join(" ");
};

const maskAddressInternal = (address: string): string => {
  const normalized = maskText(address, MIN_MASK_LENGTH);
  if (normalized === "***") return normalized;

  return `${normalized.substring(0, 2)}${"*".repeat(Math.min(5, normalized.length - 2))}`;
};

export const ownerPrivacy = {
  maskName: maskNameInternal,
  maskAddress: maskAddressInternal,
};

export const maskName = ownerPrivacy.maskName;
export const maskAddress = ownerPrivacy.maskAddress;

// ============================================================================
// OWNER PROCESSING PIPELINE
// Format, mask, and process owner information
// ============================================================================

const normalizeOwnerValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return stripHtmlInternal(String(value));
  if (typeof value === "string") return stripHtmlInternal(value);
  return "";
};

const buildOwnerIdentityKey = (
  owner: Partial<OwnerAttributes> & { [key: string]: unknown },
  context: { fnr?: string | number; propertyId?: string },
  sequence?: number
): string => {
  // Priority-ordered identity strategies
  const strategies = [
    // Priority 1: Use AGARLISTA if available (unique identifier)
    () => {
      const agarLista = normalizeOwnerValue(owner.AGARLISTA);
      return agarLista ? `A:${agarLista.toLowerCase()}` : null;
    },
    // Priority 2: Build identity from owner attributes
    () => {
      const parts = [
        owner.NAMN && `N:${normalizeOwnerValue(owner.NAMN)}`,
        owner.BOSTADR && `B:${normalizeOwnerValue(owner.BOSTADR)}`,
        owner.POSTNR && `P:${normalizeOwnerValue(owner.POSTNR)}`,
        owner.POSTADR && `C:${normalizeOwnerValue(owner.POSTADR)}`,
        owner.ORGNR && `O:${normalizeOwnerValue(owner.ORGNR)}`,
        owner.ANDEL && `S:${normalizeOwnerValue(owner.ANDEL)}`,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join("|").toLowerCase() : null;
    },
    // Priority 3: Fallback to context identifiers
    () => {
      const fallback = [
        context.propertyId && `PR:${normalizeOwnerValue(context.propertyId)}`,
        context.fnr !== undefined &&
          context.fnr !== null &&
          `FN:${String(context.fnr)}`,
        owner.OBJECTID !== undefined &&
          owner.OBJECTID !== null &&
          `OB:${String(owner.OBJECTID)}`,
        owner.UUID_FASTIGHET &&
          `UU:${normalizeOwnerValue(owner.UUID_FASTIGHET)}`,
      ].filter(Boolean);
      return fallback.length > 0 ? fallback.join("|").toLowerCase() : null;
    },
    // Priority 4: Use sequence as last resort
    () => `IX:${sequence ?? 0}`,
  ];

  for (const strategy of strategies) {
    const key = strategy();
    if (key) return key;
  }

  return `IX:${sequence ?? 0}`;
};

export const ownerIdentity = {
  buildKey: buildOwnerIdentityKey,
  normalizeValue: normalizeOwnerValue,
};

export const buildTooltipSymbol = (
  modules: EsriModules | null,
  text: string,
  style: CursorTooltipStyle
): __esri.TextSymbol | null => {
  if (!modules?.TextSymbol || !text) return null;
  const sanitized = stripHtml(text);
  if (!sanitized) return null;

  return new modules.TextSymbol({
    text: sanitized,
    color: style.textColor,
    backgroundColor: style.backgroundColor,
    horizontalAlignment: style.horizontalAlignment,
    verticalAlignment: style.verticalAlignment,
    xoffset: style.xoffset,
    yoffset: style.yoffset,
    lineWidth: style.lineWidth,
    lineHeight: style.lineHeight,
    font: {
      family: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
    },
    kerning: style.kerning,
  } as __esri.TextSymbolProperties);
};

export const syncCursorGraphics = ({
  modules,
  layer,
  mapPoint,
  tooltipText,
  highlightColor,
  existing,
  style = CURSOR_TOOLTIP_STYLE,
}: {
  modules: EsriModules | null;
  layer: __esri.GraphicsLayer | null;
  mapPoint: __esri.Point | null;
  tooltipText: string | null;
  highlightColor: [number, number, number, number];
  outlineWidth: number;
  existing: CursorGraphicsState | null;
  style?: CursorTooltipStyle;
}): CursorGraphicsState | null => {
  if (!modules?.Graphic || !layer) {
    return existing ?? null;
  }

  if (!mapPoint) {
    if (existing?.pointGraphic) {
      layer.remove(existing.pointGraphic);
    }
    if (existing?.tooltipGraphic) {
      layer.remove(existing.tooltipGraphic);
    }
    return null;
  }

  const next: CursorGraphicsState = {
    pointGraphic: existing?.pointGraphic ?? null,
    tooltipGraphic: existing?.tooltipGraphic ?? null,
    lastTooltipText: existing?.lastTooltipText ?? null,
  };

  if (!next.pointGraphic) {
    next.pointGraphic = new modules.Graphic({
      geometry: mapPoint,
      symbol: new modules.SimpleMarkerSymbol({
        style: "cross",
        size: HIGHLIGHT_MARKER_SIZE,
        color: highlightColor,
        outline: {
          color: [highlightColor[0], highlightColor[1], highlightColor[2], 1],
          width: 2.5,
        },
      }),
    });
    layer.add(next.pointGraphic);
  } else {
    next.pointGraphic.geometry = mapPoint;
  }

  if (tooltipText) {
    // Only rebuild symbol if text actually changed (performance optimization)
    const textChanged = next.lastTooltipText !== tooltipText;

    if (textChanged) {
      const symbol = buildTooltipSymbol(modules, tooltipText, style);
      if (symbol) {
        if (!next.tooltipGraphic) {
          next.tooltipGraphic = new modules.Graphic({
            geometry: mapPoint,
            symbol,
          });
          layer.add(next.tooltipGraphic);
        } else {
          next.tooltipGraphic.geometry = mapPoint;
          next.tooltipGraphic.symbol = symbol;
        }
        next.lastTooltipText = tooltipText;
      } else if (next.tooltipGraphic) {
        layer.remove(next.tooltipGraphic);
        next.tooltipGraphic = null;
        next.lastTooltipText = null;
      }
    } else if (next.tooltipGraphic) {
      // Text hasn't changed, just update position
      next.tooltipGraphic.geometry = mapPoint;
    }
  } else if (next.tooltipGraphic) {
    layer.remove(next.tooltipGraphic);
    next.tooltipGraphic = null;
    next.lastTooltipText = null;
  }

  return next;
};

export const createCursorTrackingState = (
  overrides?: Partial<CursorGraphicsState>
): CursorGraphicsState => ({
  pointGraphic: null,
  tooltipGraphic: null,
  lastTooltipText: null,
  ...overrides,
});

export const scheduleCursorUpdate = (params: {
  rafIdRef: React.MutableRefObject<number | null>;
  pendingMapPointRef: React.MutableRefObject<__esri.Point | null>;
  nextPoint: __esri.Point | null;
  onUpdate: (mapPoint: __esri.Point | null) => void;
}): void => {
  const { rafIdRef, pendingMapPointRef, nextPoint, onUpdate } = params;

  pendingMapPointRef.current = nextPoint;

  if (!nextPoint) {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    onUpdate(null);
    return;
  }

  if (rafIdRef.current !== null) {
    return;
  }

  rafIdRef.current = requestAnimationFrame(() => {
    const point = pendingMapPointRef.current;
    rafIdRef.current = null;
    if (point) {
      onUpdate(point);
      return;
    }
    onUpdate(null);
  });
};

const deduplicateEntries = (entries: string[]): string[] => {
  const seen = new Set<string>();
  return entries
    .map((e) => e.trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
};

const maskOwnerListEntry = (entry: string): string => {
  const match = entry.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!match) return ownerPrivacy.maskName(entry);

  const [, name, orgNr] = match;
  return `${ownerPrivacy.maskName(name.trim())} (${orgNr.trim()})`;
};

const formatOwnerList = (agarLista: string, maskPII: boolean): string => {
  const sanitized = stripHtmlInternal(String(agarLista));
  const uniqueEntries = deduplicateEntries(sanitized.split(";"));

  if (!maskPII) return uniqueEntries.join("; ");

  return uniqueEntries
    .map((entry) => maskOwnerListEntry(entry))
    .filter(Boolean)
    .join("; ");
};

const formatIndividualOwner = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  const rawName = stripHtmlInternal(owner.NAMN || "") || unknownOwnerText;
  const namePart =
    maskPII && rawName !== unknownOwnerText
      ? ownerPrivacy.maskName(rawName)
      : rawName;

  const rawAddress = stripHtmlInternal(owner.BOSTADR || "");
  const addressPart =
    maskPII && rawAddress ? ownerPrivacy.maskAddress(rawAddress) : rawAddress;

  const postalCode = stripHtmlInternal(owner.POSTNR || "").replace(/\s+/g, "");
  const city = stripHtmlInternal(owner.POSTADR || "");
  const orgNr = stripHtmlInternal(owner.ORGNR || "");

  const parts = [
    namePart,
    addressPart,
    postalCode && city ? `${postalCode} ${city}` : postalCode || city,
  ].filter(Boolean);

  const result = `${parts.join(", ")}${orgNr ? ` (${orgNr})` : ""}`.trim();
  return result || unknownOwnerText;
};

export const formatOwnerInfo = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  if (owner.AGARLISTA && typeof owner.AGARLISTA === "string") {
    return formatOwnerList(owner.AGARLISTA, maskPII);
  }
  return formatIndividualOwner(owner, maskPII, unknownOwnerText);
};

export const sanitizeForExport = (
  value: unknown,
  onSerializationError?: (error: unknown, typeName: string) => void
): string => {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return stripHtml(value);
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return stripHtml(String(value));
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "symbol") {
    return stripHtml(value.description ?? "");
  }

  if (typeof value === "function") {
    return stripHtml(value.name ?? "");
  }

  if (typeof value === "object") {
    try {
      return stripHtml(JSON.stringify(value));
    } catch (error) {
      const typeName = (value as { constructor?: { name?: string } })
        .constructor?.name;
      onSerializationError?.(error, typeName ?? typeof value);
      return "";
    }
  }

  return "";
};

export const buildExportRow = (params: {
  row: GridRowData;
  maskingEnabled: boolean;
  unknownOwnerText: string;
  sanitize: (value: unknown) => string;
}): { propertyLabel: string; ownerLabel: string } => {
  const { row, maskingEnabled, unknownOwnerText, sanitize } = params;
  const propertySource = row.FASTIGHET || row.FNR || "";

  const ownerSource = row.rawOwner
    ? formatOwnerInfo(row.rawOwner, maskingEnabled, unknownOwnerText)
    : row.BOSTADR || row.ADDRESS || unknownOwnerText;

  return {
    propertyLabel: sanitize(propertySource),
    ownerLabel: sanitize(ownerSource),
  };
};

const sanitizeClipboardCell = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  const raw =
    typeof value === "string" || typeof value === "number" ? String(value) : "";

  const sanitized = stripHtml(raw);
  if (!sanitized) {
    return "";
  }

  return sanitized.replace(/[\t\r\n]+/g, " ").trim();
};

export const applySortingToProperties = (
  properties: GridRowData[],
  sorting: Array<{ id: string; desc: boolean }>
): GridRowData[] => {
  if (!sorting || sorting.length === 0) {
    return [...properties];
  }

  const sorted = [...properties];

  sorting.forEach((sortItem) => {
    const { id, desc } = sortItem;

    sorted.sort((a, b) => {
      const aValue = a[id as keyof GridRowData];
      const bValue = b[id as keyof GridRowData];

      const toSortableString = (value: unknown): string => {
        if (value === null || value === undefined) return "";
        if (typeof value === "string") return value;
        if (typeof value === "number") return String(value);
        if (typeof value === "boolean") return String(value);
        return "";
      };

      const aStr = toSortableString(aValue);
      const bStr = toSortableString(bValue);

      const comparison = aStr.localeCompare(bStr, "sv", {
        numeric: true,
        sensitivity: "base",
      });

      return desc ? -comparison : comparison;
    });
  });

  return sorted;
};

export const formatPropertiesForClipboard = (
  properties: GridRowData[] | null | undefined,
  maskingEnabled: boolean,
  unknownOwnerText: string
): string => {
  if (!properties || properties.length === 0) {
    return "";
  }

  const rows = properties.map((property) => {
    const propertyLabel = sanitizeClipboardCell(
      property.FASTIGHET || property.FNR || ""
    );

    const ownerText = (() => {
      if (property.rawOwner) {
        const formattedOwner = formatOwnerInfo(
          property.rawOwner,
          maskingEnabled,
          unknownOwnerText
        );
        const sanitizedOwner = sanitizeClipboardCell(formattedOwner);
        return sanitizedOwner || sanitizeClipboardCell(unknownOwnerText);
      }

      const fallbackSanitized = sanitizeClipboardCell(property.BOSTADR);
      return fallbackSanitized || sanitizeClipboardCell(unknownOwnerText);
    })();

    return `${propertyLabel}\t${ownerText}`;
  });

  return rows.join("\n");
};

export const formatPropertyWithShare = (
  property: string,
  share?: string
): string => {
  const trimmedShare = share?.trim();
  const propertyWithNbsp = `${property}\u00A0`;
  return trimmedShare
    ? `${propertyWithNbsp}(${trimmedShare})`
    : propertyWithNbsp;
};

export const formatAddressOnly = (
  owner: OwnerAttributes,
  maskPII: boolean
): string => {
  // Build address string from BOSTADR (street), POSTNR (postal code), POSTADR (city)
  const rawAddress = stripHtmlInternal(owner.BOSTADR || "");
  const addressPart =
    maskPII && rawAddress ? ownerPrivacy.maskAddress(rawAddress) : rawAddress;

  const postalCode = stripHtmlInternal(owner.POSTNR || "").replace(/\s+/g, "");
  const city = stripHtmlInternal(owner.POSTADR || "");

  const parts: string[] = [];

  if (addressPart) parts.push(addressPart);

  const postalCity = [postalCode, city].filter(Boolean).join(" ");
  if (postalCity) parts.push(postalCity);

  return parts.join(", ");
};

// ============================================================================
// GRAPHICS & HIGHLIGHTING
// ============================================================================

export const buildHighlightColor = (
  color: string,
  opacity: number
): [number, number, number, number] => {
  const sanitized = typeof color === "string" ? color.trim() : "";
  const match = sanitized ? HEX_COLOR_PATTERN.exec(sanitized) : null;

  // If no valid color match, use the input color as-is (it's from config.json)
  const hex = match ? match[1] : color.replace("#", "");

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const clampedOpacity = (() => {
    if (typeof opacity !== "number" || !Number.isFinite(opacity)) return 0.4;
    if (opacity < 0) return 0;
    if (opacity > 1) return 1;
    return opacity;
  })();

  return [r, g, b, clampedOpacity];
};

type HighlightSymbolJSON<T extends "polygon" | "polyline" | "point"> =
  T extends "polygon"
    ? __esri.SimpleFillSymbolProperties
    : T extends "polyline"
      ? __esri.SimpleLineSymbolProperties
      : __esri.SimpleMarkerSymbolProperties;

export const buildHighlightSymbolJSON = <
  T extends "polygon" | "polyline" | "point",
>(
  highlightColor: [number, number, number, number],
  outlineWidth: number,
  geometryType: T
): HighlightSymbolJSON<T> => {
  const [r, g, b, a] = highlightColor;

  if (geometryType === "polyline") {
    return {
      style: "solid",
      color: [r, g, b, a],
      width: outlineWidth,
    } as unknown as HighlightSymbolJSON<T>;
  }

  if (geometryType === "point") {
    return {
      style: "cross",
      color: [r, g, b, a],
      size: HIGHLIGHT_MARKER_SIZE,
      outline: {
        style: "solid",
        color: [r, g, b, 1],
        width: outlineWidth,
      },
    } as unknown as HighlightSymbolJSON<T>;
  }

  return {
    style: "solid",
    color: [r, g, b, a],
    outline: {
      style: "solid",
      color: [r, g, b, 1],
      width: outlineWidth,
    },
  } as unknown as HighlightSymbolJSON<T>;
};

const resolveGeometryCategory = (
  geometryType: string | undefined
): "polygon" | "polyline" | "point" | null => {
  if (geometryType === "polygon" || geometryType === "extent") {
    return "polygon";
  }
  if (geometryType === "polyline") {
    return "polyline";
  }
  if (geometryType === "point" || geometryType === "multipoint") {
    return "point";
  }
  return null;
};

const createHighlightSymbolInstance = (
  modules: EsriModules,
  category: "polygon" | "polyline" | "point",
  highlightColor: [number, number, number, number],
  outlineWidth: number
):
  | __esri.SimpleFillSymbol
  | __esri.SimpleLineSymbol
  | __esri.SimpleMarkerSymbol
  | null => {
  if (category === "polygon") {
    const symbolJSON = buildHighlightSymbolJSON(
      highlightColor,
      outlineWidth,
      "polygon"
    );
    return new modules.SimpleFillSymbol(symbolJSON);
  }

  if (category === "polyline") {
    const symbolJSON = buildHighlightSymbolJSON(
      highlightColor,
      outlineWidth,
      "polyline"
    );
    return new modules.SimpleLineSymbol(symbolJSON);
  }

  if (category === "point") {
    const symbolJSON = buildHighlightSymbolJSON(
      highlightColor,
      outlineWidth,
      "point"
    );
    return new modules.SimpleMarkerSymbol(symbolJSON);
  }
  return null;
};

export const batchGraphicsRenderer = (params: {
  layer: __esri.GraphicsLayer | null | undefined;
  graphics: __esri.Graphic[];
  chunkSize?: number;
}): void => {
  const { layer, graphics, chunkSize = 10 } = params;
  if (!layer || !graphics.length) {
    return;
  }

  const safeChunkSize = chunkSize > 0 ? chunkSize : 10;

  const renderChunk = (offset: number) => {
    if (!layer || layer.destroyed || offset >= graphics.length) {
      return;
    }

    const nextSlice = graphics.slice(offset, offset + safeChunkSize);
    if (nextSlice.length > 0) {
      layer.addMany(nextSlice);
    }

    const nextOffset = offset + safeChunkSize;
    if (nextOffset < graphics.length) {
      requestAnimationFrame(() => {
        renderChunk(nextOffset);
      });
    }
  };

  requestAnimationFrame(() => {
    renderChunk(0);
  });
};

// ============================================================================
// PROPERTY & DATA UTILITIES
// ============================================================================

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

export const deduplicateOwnerEntries = (
  owners: OwnerAttributes[],
  context: { fnr: FnrValue; propertyId: string }
): OwnerAttributes[] => {
  const seen = new Set<string>();
  const unique: OwnerAttributes[] = [];

  owners.forEach((owner, index) => {
    if (!owner || typeof owner !== "object") {
      return;
    }

    try {
      const key = ownerIdentity.buildKey(owner, context, index);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      unique.push(owner);
    } catch (_error) {
      unique.push(owner);
    }
  });

  return unique;
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
        address: context.helpers.formatOwnerInfo(
          owner,
          maskPII,
          context.messages.unknownOwner
        ),
        geometryType,
        geometry: serializedGeometry,
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

export const isAbortError = (error: unknown): error is Error => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; message?: string };
  if (candidate.name === "AbortError") return true;
  return (
    typeof candidate.message === "string" &&
    candidate.message.toLowerCase().includes("abort")
  );
};

// ============================================================================
// NUMBER UTILITIES
// ============================================================================

export const numberHelpers = {
  isFiniteNumber: (value: unknown): value is number => {
    return typeof value === "number" && Number.isFinite(value);
  },

  clamp: (value: number, min: number, max: number): number => {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  },

  clampWithDefault: (
    value: unknown,
    min: number,
    max: number,
    defaultValue: number
  ): number => {
    if (!numberHelpers.isFiniteNumber(value)) return defaultValue;
    return numberHelpers.clamp(value, min, max);
  },
};

// ============================================================================
// ABORT SIGNAL MANAGEMENT
// ============================================================================

export const abortHelpers = {
  throwIfAborted: (signal?: AbortSignal): void => {
    if (signal?.aborted) {
      const error = new Error("AbortError");
      error.name = "AbortError";
      throw error;
    }
  },

  checkAbortedOrStale: (
    signal: AbortSignal,
    isStale: () => boolean
  ): "aborted" | "stale" | "active" => {
    if (isStale()) return "stale";
    if (signal.aborted) return "aborted";
    return "active";
  },

  handleOrThrow: (error: unknown, onAbort?: () => void): void => {
    if (isAbortError(error)) {
      onAbort?.();
      throw error;
    }
  },
};

export const parseArcGISError = (
  error: unknown,
  defaultMessage: string
): string => {
  if (!error) return defaultMessage;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    const details = "details" in error ? error.details : undefined;
    if (isRecord(details)) {
      const detailMessage = details.message;
      if (typeof detailMessage === "string") {
        return detailMessage;
      }
    }

    const message = "message" in error ? error.message : undefined;
    if (typeof message === "string") {
      return message;
    }
  }
  return defaultMessage;
};

export const getValidatedOutlineWidth = (width: unknown): number => {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return 1;
  }
  if (width < 0.5) return 0.5;
  if (width > 10) return 10;
  return width;
};

export const buildFnrWhereClause = (
  fnr: string | number,
  errorMessage = "Invalid FNR: must be a safe integer"
): string => {
  if (typeof fnr === "number") {
    if (!Number.isFinite(fnr) || !Number.isSafeInteger(fnr) || fnr < 0) {
      throw new Error(errorMessage);
    }
    return `FNR = ${fnr}`;
  }

  const sanitized = String(fnr).replace(/'/g, "''");
  if (!sanitized.trim()) {
    throw new Error("Invalid FNR: cannot be empty or whitespace-only");
  }

  return `FNR = '${sanitized}'`;
};

export const cleanupRemovedGraphics = (params: {
  toRemove: Set<string>;
  removeGraphicsForFnr: (
    fnr: FnrValue,
    normalize: (fnr: FnrValue | null | undefined) => string
  ) => void;
  normalizeFnrKey: (fnr: FnrValue | null | undefined) => string;
}): void => {
  const { toRemove, removeGraphicsForFnr, normalizeFnrKey: normalize } = params;

  toRemove.forEach((fnrKey) => {
    removeGraphicsForFnr(fnrKey, normalize);
  });
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

  // Efficient filtering using Set lookup
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

export const validateMapClickInputs = (
  params: MapClickValidationParams
): ValidationResult<{ mapPoint: __esri.Point }> => {
  const { event, modules, translate } = params;
  if (!modules) {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR",
        message: translate("errorLoadingModules"),
      },
      failureReason: "modules_not_loaded",
    };
  }

  if (!event?.mapPoint) {
    return {
      valid: false,
      error: { type: "GEOMETRY_ERROR", message: translate("errorNoMapPoint") },
      failureReason: "no_map_point",
    };
  }

  return { valid: true, data: { mapPoint: event.mapPoint } };
};

export const syncGraphicsWithState = (params: {
  graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: string | number }>;
  selectedRows: Array<{ FNR: string | number }>;
  view: __esri.MapView | null | undefined;
  helpers: SelectionGraphicsHelpers;
  highlightColor: [number, number, number, number];
  outlineWidth: number;
}): boolean => {
  const {
    graphicsToAdd,
    selectedRows,
    view,
    helpers,
    highlightColor,
    outlineWidth,
  } = params;

  if (!view) {
    return false;
  }

  const selectedFnrs = new Set(
    selectedRows.map((row) => helpers.normalizeFnrKey(row.FNR))
  );

  // Filter graphics that should be added
  const graphicsToProcess = graphicsToAdd.filter(({ fnr }) => {
    const fnrKey = helpers.normalizeFnrKey(fnr);
    return selectedFnrs.has(fnrKey);
  });

  // Use batch addition for better performance (single DOM update)
  if (graphicsToProcess.length > 0) {
    // Check if batch method is available (from updated useGraphicsLayer hook)
    if (helpers.addManyGraphicsToMap) {
      helpers.addManyGraphicsToMap(
        graphicsToProcess,
        view,
        helpers.extractFnr,
        helpers.normalizeFnrKey,
        highlightColor,
        outlineWidth
      );
    } else {
      // Fallback to individual additions if batch method not available
      graphicsToProcess.forEach(({ graphic }) => {
        helpers.addGraphicsToMap(
          graphic,
          view,
          helpers.extractFnr,
          helpers.normalizeFnrKey,
          highlightColor,
          outlineWidth
        );
      });
    }
  }

  return true;
};

export { isValidationSuccess, isValidationFailure } from "../config/types";

export type {
  CursorGraphicsState,
  ProcessPropertyQueryParams,
} from "../config/types";

export const validateMapClickPipeline = (params: {
  event: __esri.ViewClickEvent | null | undefined;
  modules: EsriModules | null;
  config: IMConfig;
  dsManager: DataSourceManager | null;
  translate: (key: string) => string;
}): ValidationResult<{
  mapPoint: __esri.Point;
  manager: DataSourceManager;
}> => {
  const { event, modules, config, dsManager, translate } = params;

  const mapValidation = validateMapClickInputs({
    event,
    modules,
    translate,
  });
  if (checkValidationFailure(mapValidation)) {
    return mapValidation as ValidationResult<{
      mapPoint: __esri.Point;
      manager: DataSourceManager;
    }>;
  }

  const dsValidation = validateDataSourcesCore({
    propertyDsId: config.propertyDataSourceId,
    ownerDsId: config.ownerDataSourceId,
    dsManager,
    allowedHosts: config.allowedHosts,
    translate,
  });
  if (checkValidationFailure(dsValidation)) {
    return dsValidation as ValidationResult<{
      mapPoint: __esri.Point;
      manager: DataSourceManager;
    }>;
  }

  // TypeScript type guard ensures we have .data here
  const validatedMap = mapValidation as {
    valid: true;
    data: { mapPoint: __esri.Point };
  };
  const validatedDs = dsValidation as {
    valid: true;
    data: { manager: DataSourceManager };
  };

  return {
    valid: true,
    data: {
      mapPoint: validatedMap.data.mapPoint,
      manager: validatedDs.data.manager,
    },
  };
};

export const validateMapClickRequest = (params: {
  event: __esri.ViewClickEvent | null | undefined;
  modules: EsriModules | null;
  config: IMConfig;
  dsManager: DataSourceManager | null;
  translate: (key: string) => string;
}): ValidationResult<{
  mapPoint: __esri.Point;
  manager: DataSourceManager;
}> => {
  const validation = validateMapClickPipeline(params);
  if (checkValidationFailure(validation)) {
    return validation;
  }

  return {
    valid: true,
    data: {
      mapPoint: validation.data.mapPoint,
      manager: validation.data.manager,
    },
  };
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
  } = params;

  const pipelineStart = performance.now();
  console.log("[PERF] Pipeline started at", pipelineStart - perfStart, "ms");

  const pipelineResult = await runPropertySelectionPipeline({
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

type PropertyPipelineSuccess = Extract<
  PropertySelectionPipelineResult,
  { status: "success" }
>;

export const updatePropertySelectionState = (params: {
  pipelineResult: PropertyPipelineSuccess;
  previousRawResults:
    | SerializedQueryResultMap
    | Map<string, SerializedQueryResult>
    | null;
  selectedProperties: GridRowData[];
  dispatch: ReturnType<typeof createPropertyDispatcher>;
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
    normalizeFnrKey,
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
    normalizeFnrKey
  );

  cleanupRemovedGraphics({
    toRemove: pipelineResult.toRemove,
    removeGraphicsForFnr,
    normalizeFnrKey,
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
  normalizeFnrKey: (fnr: FnrValue | null | undefined) => string
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
        normalizeFnrKey(fnrValue),
        serializePropertyResult(result)
      );
    }
  });

  let fallbackIndex = 0;

  const selectedByFnr = new Map<string, string>();
  selectedProperties.forEach((row) => {
    selectedByFnr.set(normalizeFnrKey(row.FNR), row.id);
  });

  rowsToProcess.forEach((row) => {
    const fnrKey = normalizeFnrKey(row.FNR);
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

export const createPropertyDispatcher = (
  dispatch: ((action: unknown) => void) | undefined,
  widgetId: string
) => {
  const safeDispatch = (action: unknown) => {
    if (!widgetId || typeof dispatch !== "function") return;
    dispatch(action);
  };

  return {
    setError: (error: ErrorState | null) => {
      safeDispatch(propertyActions.setError(error, widgetId));
    },
    clearError: () => {
      safeDispatch(propertyActions.clearError(widgetId));
    },
    setSelectedProperties: (properties: Iterable<GridRowData>) => {
      safeDispatch(
        propertyActions.setSelectedProperties(Array.from(properties), widgetId)
      );
    },
    clearAll: () => {
      safeDispatch(propertyActions.clearAll(widgetId));
    },
    setQueryInFlight: (inFlight: boolean) => {
      safeDispatch(propertyActions.setQueryInFlight(inFlight, widgetId));
    },
    setRawResults: (
      results: { [key: string]: SerializedQueryResult } | null
    ) => {
      safeDispatch(propertyActions.setRawResults(results, widgetId));
    },
    removeWidgetState: () => {
      safeDispatch(propertyActions.removeWidgetState(widgetId));
    },
  };
};

/** Computes list of widget IDs that should be closed when this widget opens */
export const computeWidgetsToClose = (
  runtimeInfo:
    | {
        [id: string]: { state?: unknown; isClassLoaded?: boolean } | undefined;
      }
    | null
    | undefined,
  currentWidgetId: string,
  widgets?: unknown
): string[] => {
  if (!runtimeInfo) return [];

  const ids: string[] = [];

  const hasGetMethod = (
    value: unknown
  ): value is { get: (key: string) => unknown } => {
    return isRecord(value) && typeof value.get === "function";
  };

  const resolveEntry = (collection: unknown, key: string): unknown => {
    if (!collection) return undefined;
    if (hasGetMethod(collection)) {
      return collection.get(key);
    }
    if (isRecord(collection)) {
      return collection[key];
    }
    return undefined;
  };

  const readString = (source: unknown, key: string): string => {
    if (!source) return "";
    if (hasGetMethod(source)) {
      const value = source.get(key);
      return typeof value === "string" ? value : "";
    }
    if (isRecord(source)) {
      const value = source[key];
      return typeof value === "string" ? value : "";
    }
    return "";
  };

  const hasPropertyKeyword = (value: string): boolean => {
    if (!value) return false;
    const normalized = value.toLowerCase();
    return normalized.includes("property") || normalized.includes("fastighet");
  };

  const isPropertyWidget = (targetId: string): boolean => {
    const entry = resolveEntry(widgets, targetId);
    if (!entry) return false;

    const manifest = resolveEntry(entry, "manifest");
    const values: string[] = [
      readString(entry, "name"),
      readString(entry, "label"),
      readString(entry, "manifestLabel"),
      readString(entry, "uri"),
      readString(entry, "widgetName"),
      readString(manifest, "name"),
      readString(manifest, "label"),
      readString(manifest, "uri"),
    ];

    return values.some(hasPropertyKeyword);
  };

  for (const [id, info] of Object.entries(runtimeInfo)) {
    if (id === currentWidgetId || !info) continue;
    const stateRaw = info.state;
    if (!stateRaw) continue;
    const normalizedSource =
      typeof stateRaw === "string"
        ? stateRaw
        : typeof stateRaw === "number"
          ? String(stateRaw)
          : null;

    if (!normalizedSource) {
      continue;
    }

    const normalized = normalizedSource.toUpperCase();

    // Skip widgets that are already closed or hidden
    if (normalized === "CLOSED" || normalized === "HIDDEN") {
      continue;
    }

    if (info.isClassLoaded && isPropertyWidget(id)) {
      ids.push(id);
    }
  }

  return ids;
};

export const executeHoverQuery = async (params: {
  mapPoint: __esri.Point;
  config: {
    propertyDataSourceId: string;
    ownerDataSourceId: string;
    allowedHosts?: readonly string[];
  };
  dsManager: DataSourceManager | null;
  signal: AbortSignal;
  enablePIIMasking: boolean;
  translate: (key: string) => string;
}): Promise<{ fastighet: string; bostadr: string } | null> => {
  const { mapPoint, config, dsManager, signal, enablePIIMasking, translate } =
    params;

  const dsValidation = validateDataSourcesCore({
    propertyDsId: config.propertyDataSourceId,
    ownerDsId: config.ownerDataSourceId,
    dsManager,
    allowedHosts: config.allowedHosts,
    translate,
  });

  if (checkValidationFailure(dsValidation)) {
    return null;
  }
  const { manager } = dsValidation.data;

  const propertyResults = await queryPropertyByPoint(
    mapPoint,
    config.propertyDataSourceId,
    manager,
    { signal }
  );

  abortHelpers.throwIfAborted(signal);

  if (!propertyResults.length || !propertyResults[0]?.features?.length) {
    return null;
  }

  const feature = propertyResults[0].features[0];
  const fnr = extractFnr(feature.attributes);
  const fastighet = feature.attributes?.FASTIGHET || "";

  if (!fnr || !fastighet) {
    return null;
  }

  const ownerFeatures = await queryOwnerByFnr(
    fnr,
    config.ownerDataSourceId,
    manager,
    { signal }
  );

  abortHelpers.throwIfAborted(signal);

  let bostadr = translate("unknownOwner");
  if (ownerFeatures.length > 0) {
    const ownerAttrs = ownerFeatures[0].attributes;
    bostadr = formatOwnerInfo(
      ownerAttrs,
      enablePIIMasking,
      translate("unknownOwner")
    );
  }

  return { fastighet, bostadr };
};

export const shouldSkipHoverQuery = (
  screenPoint: { x: number; y: number },
  lastQueryPoint: { x: number; y: number } | null,
  tolerancePx: number
): boolean => {
  if (!lastQueryPoint) return false;

  const dx = screenPoint.x - lastQueryPoint.x;
  const dy = screenPoint.y - lastQueryPoint.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return distance < tolerancePx;
};

export const updateGraphicSymbol = (
  graphic: __esri.Graphic,
  highlightColor: [number, number, number, number],
  outlineWidth: number,
  modules: EsriModules
): void => {
  if (!graphic || !graphic.geometry) return;

  const geometry = graphic.geometry;
  const symbolJSON = buildHighlightSymbolJSON(
    highlightColor,
    outlineWidth,
    geometry.type as "polygon" | "polyline" | "point"
  );

  if (geometry.type === "polygon" || geometry.type === "extent") {
    graphic.symbol = new modules.SimpleFillSymbol(
      symbolJSON as __esri.SimpleFillSymbolProperties
    );
  } else if (geometry.type === "polyline") {
    graphic.symbol = new modules.SimpleLineSymbol(
      symbolJSON as __esri.SimpleLineSymbolProperties
    );
  } else if (geometry.type === "point" || geometry.type === "multipoint") {
    graphic.symbol = new modules.SimpleMarkerSymbol(
      symbolJSON as __esri.SimpleMarkerSymbolProperties
    );
  }
};

export const validateNumericRange = (params: {
  value: string | number;
  min: number;
  max: number;
  errorMessage: string;
}): { valid: boolean; normalized?: number; error?: string } => {
  const { value, min, max, errorMessage } = params;
  const num = typeof value === "string" ? parseInt(value, 10) : value;

  if (isNaN(num) || num < min || num > max) {
    return { valid: false, error: errorMessage };
  }

  return { valid: true, normalized: num };
};

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const opacityHelpers = {
  toPercent: (value: number): number => {
    const clamped = clampNumber(value, 0, 1);
    return Math.round(clamped * 100);
  },
  fromPercent: (percent: number): number => {
    const clamped = clampNumber(percent, 0, 100);
    return clamped / 100;
  },
  formatPercent: (percent: number): string => {
    const normalized = clampNumber(Math.round(percent), 0, 100);
    return `${normalized}%`;
  },
};

export const outlineWidthHelpers = {
  normalize: (value: number): number => {
    const clamped = clampNumber(value, 0.5, 10);
    return Math.round(clamped * 2) / 2;
  },
  formatDisplay: (value: number): string => {
    const normalized = clampNumber(value, 0.5, 10);
    const halfStep = Math.round(normalized * 2) / 2;
    const rounded = Math.round(halfStep);
    if (Math.abs(halfStep - rounded) < 0.0001) {
      return String(rounded);
    }
    return halfStep.toFixed(1);
  },
};

export const copyToClipboard = (text: string): boolean => {
  try {
    return copy(text, {
      debug: false,
      format: "text/plain",
    });
  } catch (_error) {
    return false;
  }
};

export const normalizeHostValue = (value: string): string =>
  stripHtml(value || "").trim();

export const normalizeHostList = (
  hosts: readonly string[] | undefined
): string[] => {
  if (!hosts || hosts.length === 0) return [];
  const normalized = hosts.map(normalizeHostValue).filter((h) => h.length > 0);
  return Array.from(new Set(normalized));
};

const hasGetter = (
  value: unknown
): value is { get: (key: string) => unknown } => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { get?: unknown };
  return typeof candidate.get === "function";
};

const hasAsMutable = (
  value: unknown
): value is {
  asMutable: (options?: { deep?: boolean }) => UseDataSource | UseDataSource[];
} => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { asMutable?: unknown };
  return typeof candidate.asMutable === "function";
};

const isIndexedCollection = (
  collection: unknown
): collection is {
  readonly length?: number;
  readonly [index: number]: UseDataSourceCandidate;
} => {
  if (!collection || typeof collection !== "object") {
    return false;
  }

  const candidate = collection as { length?: unknown };
  return typeof candidate.length === "number";
};

export const dataSourceHelpers = {
  extractId: (useDataSource: UseDataSourceCandidate | null | undefined) => {
    if (!useDataSource || typeof useDataSource !== "object") {
      return null;
    }

    if (hasGetter(useDataSource)) {
      const value = useDataSource.get("dataSourceId");
      return typeof value === "string" ? value : null;
    }

    if ("dataSourceId" in useDataSource) {
      const value = (useDataSource as { dataSourceId?: unknown }).dataSourceId;
      return typeof value === "string" ? value : null;
    }

    return null;
  },

  findById: (
    useDataSources:
      | ImmutableArray<UseDataSource>
      | UseDataSource[]
      | UseDataSourceCandidate[]
      | null
      | undefined,
    dataSourceId?: string
  ): UseDataSourceCandidate | null => {
    if (!dataSourceId || !useDataSources) {
      return null;
    }

    const collection = useDataSources as {
      readonly find?: (
        predicate: (candidate: UseDataSourceCandidate) => boolean
      ) => UseDataSourceCandidate | undefined;
    };

    if (typeof collection.find === "function") {
      const match = collection.find((candidate) => {
        if (!candidate) {
          return false;
        }
        return dataSourceHelpers.extractId(candidate) === dataSourceId;
      });
      if (match) {
        return match;
      }
    }

    if (hasAsMutable(useDataSources)) {
      const mutable = useDataSources.asMutable({ deep: false });
      if (Array.isArray(mutable)) {
        return dataSourceHelpers.findById(mutable, dataSourceId);
      }
    }

    if (Array.isArray(useDataSources) || isIndexedCollection(useDataSources)) {
      const indexed = useDataSources as {
        readonly length?: number;
        readonly [index: number]: UseDataSourceCandidate;
      };

      const length = indexed.length ?? 0;
      for (let index = 0; index < length; index += 1) {
        const candidate = indexed[index];
        if (
          candidate &&
          dataSourceHelpers.extractId(candidate) === dataSourceId
        ) {
          return candidate;
        }
      }
    }

    return null;
  },
};

class PopupSuppressionManager {
  private readonly ownersByView = new WeakMap<__esri.MapView, Set<symbol>>();
  private readonly originalStateByView = new WeakMap<__esri.MapView, boolean>();

  private resolveView(view: __esri.MapView): MapViewWithPopupToggle {
    return view as MapViewWithPopupToggle;
  }

  acquire(ownerId: symbol, view: __esri.MapView | null | undefined): void {
    if (!view) return;

    const viewWithPopup = this.resolveView(view);
    const popupEnabled = viewWithPopup.popupEnabled;
    if (typeof popupEnabled !== "boolean") return;

    let owners = this.ownersByView.get(view);
    if (!owners) {
      owners = new Set();
      this.ownersByView.set(view, owners);
      this.originalStateByView.set(view, popupEnabled);
    }

    owners.add(ownerId);
    viewWithPopup.popupEnabled = false;
  }

  release(ownerId: symbol, view: __esri.MapView | null | undefined): void {
    if (!view) return;

    const owners = this.ownersByView.get(view);
    if (!owners || !owners.delete(ownerId)) return;

    if (owners.size === 0) {
      this.restorePopupState(view);
    }
  }

  private restorePopupState(view: __esri.MapView): void {
    const originalState = this.originalStateByView.get(view);

    if (originalState !== undefined) {
      const viewWithPopup = this.resolveView(view);
      viewWithPopup.popupEnabled = originalState;
      this.originalStateByView.delete(view);
      this.ownersByView.delete(view);
    }
  }
}

export const popupSuppressionManager = new PopupSuppressionManager();

// ============================================================================
// CURSOR LIFECYCLE MANAGEMENT
// RAF-batched cursor tracking with proper cleanup ordering
// ============================================================================

export const cursorLifecycleHelpers = {
  cleanupHandles: (refs: {
    pointerMoveHandle: React.MutableRefObject<__esri.Handle | null>;
    pointerLeaveHandle: React.MutableRefObject<__esri.Handle | null>;
    rafId: React.MutableRefObject<number | null>;
    clearGraphics: () => void;
    cleanupQuery: () => void;
  }) => {
    // Step 1: Remove pointer-move handle FIRST, clear graphics with it
    if (refs.pointerMoveHandle.current) {
      refs.pointerMoveHandle.current.remove();
      refs.pointerMoveHandle.current = null;
      refs.clearGraphics();
    }

    // Step 2: Remove pointer-leave handle
    if (refs.pointerLeaveHandle.current) {
      refs.pointerLeaveHandle.current.remove();
      refs.pointerLeaveHandle.current = null;
    }

    // Step 3: Cancel RAF LAST (no pending RAF if handles removed)
    if (refs.rafId.current !== null) {
      cancelAnimationFrame(refs.rafId.current);
      refs.rafId.current = null;
    }
  },

  setupCursorTracking: (params: {
    view: __esri.MapView;
    widgetId: string;
    ensureGraphicsLayer: (view: __esri.MapView) => void;
    cachedLayerRef: React.MutableRefObject<__esri.GraphicsLayer | null>;
    pointerMoveHandleRef: React.MutableRefObject<__esri.Handle | null>;
    pointerLeaveHandleRef: React.MutableRefObject<__esri.Handle | null>;
    rafIdRef: React.MutableRefObject<number | null>;
    lastCursorPointRef: React.MutableRefObject<__esri.Point | null>;
    pendingMapPointRef: React.MutableRefObject<__esri.Point | null>;
    lastHoverQueryPointRef: React.MutableRefObject<{
      x: number;
      y: number;
    } | null>;
    updateCursorPoint: (mapPoint: __esri.Point | null) => void;
    throttledHoverQuery: (
      mapPoint: __esri.Point,
      screenPoint: { x: number; y: number }
    ) => void;
    cleanupHoverQuery: () => void;
  }) => {
    const {
      view,
      widgetId,
      ensureGraphicsLayer,
      cachedLayerRef,
      pointerMoveHandleRef,
      pointerLeaveHandleRef,
      rafIdRef,
      lastCursorPointRef,
      pendingMapPointRef,
      lastHoverQueryPointRef,
      updateCursorPoint,
      throttledHoverQuery,
      cleanupHoverQuery,
    } = params;

    ensureGraphicsLayer(view);
    cachedLayerRef.current = view.map.findLayerById(
      `property-${widgetId}-highlight-layer`
    ) as __esri.GraphicsLayer | null;

    pointerMoveHandleRef.current = view.on("pointer-move", (event) => {
      const screenPoint = { x: event.x, y: event.y };
      const mapPoint = view.toMap(screenPoint);

      if (!mapPoint) {
        lastCursorPointRef.current = null;
        scheduleCursorUpdate({
          rafIdRef,
          pendingMapPointRef,
          nextPoint: null,
          onUpdate: updateCursorPoint,
        });
        cleanupHoverQuery();
        return;
      }

      lastCursorPointRef.current = mapPoint;
      scheduleCursorUpdate({
        rafIdRef,
        pendingMapPointRef,
        nextPoint: mapPoint,
        onUpdate: updateCursorPoint,
      });

      throttledHoverQuery(mapPoint, screenPoint);
    });

    pointerLeaveHandleRef.current = view.on("pointer-leave", () => {
      lastCursorPointRef.current = null;
      lastHoverQueryPointRef.current = null;
      scheduleCursorUpdate({
        rafIdRef,
        pendingMapPointRef,
        nextPoint: null,
        onUpdate: updateCursorPoint,
      });
      cleanupHoverQuery();
    });
  },

  resetCursorState: (refs: {
    lastCursorPointRef: React.MutableRefObject<__esri.Point | null>;
    pendingMapPointRef: React.MutableRefObject<__esri.Point | null>;
    cachedLayerRef: React.MutableRefObject<__esri.GraphicsLayer | null>;
    clearGraphics: () => void;
    cleanupQuery: () => void;
  }) => {
    refs.lastCursorPointRef.current = null;
    refs.pendingMapPointRef.current = null;
    refs.cachedLayerRef.current = null;
    refs.clearGraphics();
    refs.cleanupQuery();
  },

  teardownCursorTracking: (params: {
    rafId: React.MutableRefObject<number | null>;
    pointerMoveHandle: React.MutableRefObject<__esri.Handle | null>;
    pointerLeaveHandle: React.MutableRefObject<__esri.Handle | null>;
    lastCursorPointRef: React.MutableRefObject<__esri.Point | null>;
    pendingMapPointRef: React.MutableRefObject<__esri.Point | null>;
    cachedLayerRef: React.MutableRefObject<__esri.GraphicsLayer | null>;
    canTrackCursor: boolean;
    clearGraphics: () => void;
    cleanupQuery: () => void;
  }) => {
    if (params.rafId.current !== null) {
      cancelAnimationFrame(params.rafId.current);
      params.rafId.current = null;
    }
    if (params.pointerMoveHandle.current) {
      params.pointerMoveHandle.current.remove();
      params.pointerMoveHandle.current = null;
    }
    if (params.pointerLeaveHandle.current) {
      params.pointerLeaveHandle.current.remove();
      params.pointerLeaveHandle.current = null;
    }
    params.cleanupQuery();
    params.pendingMapPointRef.current = null;
    params.cachedLayerRef.current = null;
    if (!params.canTrackCursor) {
      params.lastCursorPointRef.current = null;
    }
    params.clearGraphics();
  },
};
