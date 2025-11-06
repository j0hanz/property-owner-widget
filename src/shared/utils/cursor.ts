import type { MutableRefObject } from "react";
import type { DataSourceManager } from "jimu-core";
import {
  CURSOR_TOOLTIP_STYLE,
  HIGHLIGHT_MARKER_SIZE,
  SYMBOL_CACHE_MAX_SIZE,
} from "../../config/constants";
import type {
  CursorGraphicsState,
  CursorTooltipStyle,
  EsriModules,
  HoverQueryConfig,
} from "../../config/types";
import { queryOwnerByFnr, queryPropertyByPoint } from "../api";
import { abortHelpers, stripHtml } from "./helpers";
import { formatOwnerInfo } from "./privacy";
import { extractFnr } from "./processing";
import { checkValidationFailure, validateDataSourcesCore } from "./validation";

const createOpaqueColor = (
  color: [number, number, number, number]
): [number, number, number, number] => [color[0], color[1], color[2], 1];

const createSymbolCache = () => {
  const cache = new Map<string, __esri.SimpleMarkerSymbol>();
  const maxSize = SYMBOL_CACHE_MAX_SIZE;

  return {
    get: (key: string): __esri.SimpleMarkerSymbol | undefined => cache.get(key),
    set: (key: string, symbol: __esri.SimpleMarkerSymbol): void => {
      if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      cache.set(key, symbol);
    },
    clear: (): void => {
      cache.clear();
    },
  };
};

const symbolCache = createSymbolCache();

const sanitizeTooltipText = (
  text: string | null | undefined
): string | null => {
  if (!text) return null;
  const sanitized = stripHtml(text).trim();
  return sanitized.length > 0 ? sanitized : null;
};

const createTooltipTextSymbol = (
  modules: EsriModules,
  sanitizedText: string,
  style: CursorTooltipStyle
): __esri.TextSymbol =>
  new modules.TextSymbol({
    text: sanitizedText,
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

export const buildTooltipSymbol = (
  modules: EsriModules,
  text: string,
  style: CursorTooltipStyle
): __esri.TextSymbol | null => {
  const sanitized = sanitizeTooltipText(text);
  if (!sanitized) return null;

  return createTooltipTextSymbol(modules, sanitized, style);
};

const clearTooltipGraphic = (
  layer: __esri.GraphicsLayer,
  state: CursorGraphicsState
): void => {
  if (state.tooltipGraphic) {
    layer.remove(state.tooltipGraphic);
    state.tooltipGraphic = null;
    state.lastTooltipText = null;
  }
};

const clearAllGraphics = (
  layer: __esri.GraphicsLayer,
  state: CursorGraphicsState
): void => {
  if (state.pointGraphic) {
    layer.remove(state.pointGraphic);
    state.pointGraphic = null;
  }
  if (state.tooltipGraphic) {
    layer.remove(state.tooltipGraphic);
    state.tooltipGraphic = null;
  }
  state.lastTooltipText = null;
};

const createPointGraphic = (
  modules: EsriModules,
  mapPoint: __esri.Point,
  highlightColor: [number, number, number, number]
): __esri.Graphic => {
  const cacheKey = highlightColor.join(",");
  let symbol = symbolCache.get(cacheKey);

  if (!symbol) {
    symbol = new modules.SimpleMarkerSymbol({
      style: "cross",
      size: HIGHLIGHT_MARKER_SIZE,
      color: highlightColor,
      outline: { color: createOpaqueColor(highlightColor), width: 2.5 },
    });
    symbolCache.set(cacheKey, symbol);
  }
  return new modules.Graphic({
    geometry: mapPoint,
    symbol,
  });
};

const updateOrCreateGraphic = <T extends __esri.Graphic>(
  layer: __esri.GraphicsLayer,
  existing: T | null,
  create: () => T,
  update: (graphic: T) => void
): T => {
  if (!existing) {
    const graphic = create();
    layer.add(graphic);
    return graphic;
  }
  update(existing);
  return existing;
};

const syncPointGraphic = (
  modules: EsriModules,
  layer: __esri.GraphicsLayer,
  state: CursorGraphicsState,
  mapPoint: __esri.Point,
  highlightColor: [number, number, number, number]
): void => {
  state.pointGraphic = updateOrCreateGraphic(
    layer,
    state.pointGraphic,
    () => createPointGraphic(modules, mapPoint, highlightColor),
    (graphic) => {
      graphic.geometry = mapPoint;
    }
  );
};

const syncTooltipGraphic = (
  modules: EsriModules,
  layer: __esri.GraphicsLayer,
  state: CursorGraphicsState,
  mapPoint: __esri.Point,
  tooltipText: string,
  style: CursorTooltipStyle
): void => {
  const sanitized = sanitizeTooltipText(tooltipText);
  if (!sanitized) {
    clearTooltipGraphic(layer, state);
    return;
  }

  if (state.lastTooltipText === sanitized) {
    if (state.tooltipGraphic) {
      state.tooltipGraphic.geometry = mapPoint;
    }
    return;
  }

  const symbol = createTooltipTextSymbol(modules, sanitized, style);
  if (!symbol) {
    clearTooltipGraphic(layer, state);
    return;
  }

  state.tooltipGraphic = updateOrCreateGraphic(
    layer,
    state.tooltipGraphic,
    () => new modules.Graphic({ geometry: mapPoint, symbol }),
    (graphic) => {
      graphic.geometry = mapPoint;
      graphic.symbol = symbol;
    }
  );
  state.lastTooltipText = sanitized;
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
  existing: CursorGraphicsState | null;
  style?: CursorTooltipStyle;
}): CursorGraphicsState | null => {
  if (!modules?.Graphic || !modules.TextSymbol || !layer) {
    return existing || null;
  }

  if (!mapPoint) {
    if (existing) clearAllGraphics(layer, existing);
    return null;
  }

  const state: CursorGraphicsState = existing || createCursorTrackingState();

  syncPointGraphic(modules, layer, state, mapPoint, highlightColor);

  if (tooltipText) {
    syncTooltipGraphic(modules, layer, state, mapPoint, tooltipText, style);
    return state;
  }

  clearTooltipGraphic(layer, state);
  return state;
};

export const createCursorTrackingState = (
  overrides?: Partial<CursorGraphicsState>
): CursorGraphicsState => ({
  pointGraphic: null,
  tooltipGraphic: null,
  lastTooltipText: null,
  ...overrides,
});

const cancelScheduledUpdate = (
  rafIdRef: MutableRefObject<number | null>
): void => {
  if (rafIdRef.current !== null) {
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = null;
  }
};

export const scheduleCursorUpdate = (params: {
  rafIdRef: MutableRefObject<number | null>;
  pendingMapPointRef: MutableRefObject<__esri.Point | null>;
  nextPoint: __esri.Point | null;
  onUpdate: (mapPoint: __esri.Point | null) => void;
}): void => {
  const { rafIdRef, pendingMapPointRef, nextPoint, onUpdate } = params;

  pendingMapPointRef.current = nextPoint;

  if (!nextPoint) {
    cancelScheduledUpdate(rafIdRef);
    onUpdate(null);
    return;
  }

  if (rafIdRef.current !== null) return;

  rafIdRef.current = requestAnimationFrame(() => {
    rafIdRef.current = null;
    onUpdate(pendingMapPointRef.current);
  });
};

const validateAndGetManager = (
  config: {
    propertyDataSourceId: string;
    ownerDataSourceId: string;
    allowedHosts?: readonly string[];
  },
  dsManager: DataSourceManager | null,
  translate: (key: string) => string
): DataSourceManager | null => {
  const dsValidation = validateDataSourcesCore({
    propertyDsId: config.propertyDataSourceId,
    ownerDsId: config.ownerDataSourceId,
    dsManager,
    allowedHosts: config.allowedHosts,
    translate,
  });

  if (checkValidationFailure(dsValidation)) return null;
  return dsValidation.data.manager;
};

const queryPropertyData = async (
  mapPoint: __esri.Point,
  dataSourceId: string,
  manager: DataSourceManager,
  signal: AbortSignal
): Promise<{ fnr: string; fastighet: string } | null> => {
  const results = await queryPropertyByPoint(mapPoint, dataSourceId, manager, {
    signal,
  });
  abortHelpers.throwIfAborted(signal);

  if (!results.length || !results[0]?.features?.length) return null;

  const feature = results[0].features[0];
  const fnr = extractFnr(feature.attributes);
  const fastighet = feature.attributes?.FASTIGHET || "";

  if (!fnr || !fastighet) return null;

  return { fnr: String(fnr), fastighet };
};

const queryOwnerData = async (
  fnr: string,
  dataSourceId: string,
  manager: DataSourceManager,
  signal: AbortSignal,
  enablePIIMasking: boolean,
  unknownOwnerLabel: string
): Promise<string> => {
  const ownerFeatures = await queryOwnerByFnr(fnr, dataSourceId, manager, {
    signal,
  });
  abortHelpers.throwIfAborted(signal);

  if (ownerFeatures.length === 0) return unknownOwnerLabel;

  return formatOwnerInfo(
    ownerFeatures[0].attributes,
    enablePIIMasking,
    unknownOwnerLabel
  );
};

export const executeHoverQuery = async (params: {
  mapPoint: __esri.Point;
  config: HoverQueryConfig;
  dsManager: DataSourceManager | null;
  signal: AbortSignal;
  enablePIIMasking: boolean;
  translate: (key: string) => string;
}): Promise<{ fastighet: string; bostadr: string } | null> => {
  const { mapPoint, config, dsManager, signal, enablePIIMasking, translate } =
    params;

  const manager = validateAndGetManager(config, dsManager, translate);
  if (!manager) {
    return null;
  }

  const propertyData = await queryPropertyData(
    mapPoint,
    config.propertyDataSourceId,
    manager,
    signal
  );
  if (!propertyData) {
    return null;
  }

  const unknownOwnerLabel = translate("unknownOwner");
  let bostadr: string;

  try {
    bostadr = await queryOwnerData(
      propertyData.fnr,
      config.ownerDataSourceId,
      manager,
      signal,
      enablePIIMasking,
      unknownOwnerLabel
    );
  } catch (ownerError) {
    bostadr = unknownOwnerLabel;
  }

  return { fastighet: propertyData.fastighet, bostadr };
};

export const shouldSkipHoverQuery = (
  screenPoint: { x: number; y: number },
  lastQueryPoint: { x: number; y: number } | null,
  tolerancePx: number,
  hasTrustedResult: boolean
): boolean => {
  if (!lastQueryPoint) return false;
  if (!hasTrustedResult) return false;

  const deltaX = screenPoint.x - lastQueryPoint.x;
  const deltaY = screenPoint.y - lastQueryPoint.y;
  const distanceSquared = deltaX * deltaX + deltaY * deltaY;
  const toleranceSquared = tolerancePx * tolerancePx;

  return distanceSquared < toleranceSquared;
};

const removeEventHandle = (
  handleRef: MutableRefObject<__esri.Handle | null>
): void => {
  if (handleRef.current) {
    handleRef.current.remove();
    handleRef.current = null;
  }
};

const resetRefState = (...refs: Array<MutableRefObject<unknown>>): void => {
  for (const ref of refs) {
    ref.current = null;
  }
};

export const cursorLifecycleHelpers = {
  cleanupHandles: (refs: {
    pointerMoveHandle: MutableRefObject<__esri.Handle | null>;
    pointerLeaveHandle: MutableRefObject<__esri.Handle | null>;
    rafId: MutableRefObject<number | null>;
    clearGraphics: () => void;
    cleanupQuery: () => void;
  }) => {
    const {
      pointerMoveHandle,
      pointerLeaveHandle,
      rafId,
      clearGraphics,
      cleanupQuery,
    } = refs;

    // Cancel RAF first to prevent any pending frame from executing
    cancelScheduledUpdate(rafId);
    // Then remove event handles
    removeEventHandle(pointerMoveHandle);
    removeEventHandle(pointerLeaveHandle);
    // Cancel any ongoing hover work before wiping graphics
    cleanupQuery();
    // Finally clear graphics
    clearGraphics();
  },

  setupCursorTracking: (params: {
    view: __esri.MapView;
    widgetId: string;
    ensureGraphicsLayer: (view: __esri.MapView) => void;
    cachedLayerRef: MutableRefObject<__esri.GraphicsLayer | null>;
    pointerMoveHandleRef: MutableRefObject<__esri.Handle | null>;
    pointerLeaveHandleRef: MutableRefObject<__esri.Handle | null>;
    rafIdRef: MutableRefObject<number | null>;
    lastCursorPointRef: MutableRefObject<__esri.Point | null>;
    pendingMapPointRef: MutableRefObject<__esri.Point | null>;
    lastHoverQueryPointRef: MutableRefObject<{ x: number; y: number } | null>;
    updateCursorPoint: (mapPoint: __esri.Point | null) => void;
    throttledHitTest: (event: __esri.ViewPointerMoveEvent) => void;
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
      throttledHitTest,
      cleanupHoverQuery,
    } = params;

    ensureGraphicsLayer(view);
    cachedLayerRef.current = view.map.findLayerById(
      `property-${widgetId}-highlight-layer`
    ) as __esri.GraphicsLayer | null;

    pointerMoveHandleRef.current = view.on("pointer-move", (event) => {
      const mapPoint = view.toMap({ x: event.x, y: event.y });

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
      // Use hitTest instead of spatial queries - instant client-side detection
      throttledHitTest(event);
    });

    pointerLeaveHandleRef.current = view.on("pointer-leave", () => {
      resetRefState(lastCursorPointRef, lastHoverQueryPointRef);
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
    lastCursorPointRef: MutableRefObject<__esri.Point | null>;
    pendingMapPointRef: MutableRefObject<__esri.Point | null>;
    cachedLayerRef: MutableRefObject<__esri.GraphicsLayer | null>;
    clearGraphics: () => void;
    cleanupQuery: () => void;
  }) => {
    const {
      lastCursorPointRef,
      pendingMapPointRef,
      cachedLayerRef,
      clearGraphics,
      cleanupQuery,
    } = refs;
    resetRefState(lastCursorPointRef, pendingMapPointRef, cachedLayerRef);
    clearGraphics();
    cleanupQuery();
  },

  teardownCursorTracking: (params: {
    rafId: MutableRefObject<number | null>;
    pointerMoveHandle: MutableRefObject<__esri.Handle | null>;
    pointerLeaveHandle: MutableRefObject<__esri.Handle | null>;
    lastCursorPointRef: MutableRefObject<__esri.Point | null>;
    pendingMapPointRef: MutableRefObject<__esri.Point | null>;
    cachedLayerRef: MutableRefObject<__esri.GraphicsLayer | null>;
    canTrackCursor: boolean;
    clearGraphics: () => void;
    cleanupQuery: () => void;
  }) => {
    const {
      rafId,
      pointerMoveHandle,
      pointerLeaveHandle,
      lastCursorPointRef,
      pendingMapPointRef,
      cachedLayerRef,
      canTrackCursor,
      clearGraphics,
      cleanupQuery,
    } = params;

    cancelScheduledUpdate(rafId);
    removeEventHandle(pointerMoveHandle);
    removeEventHandle(pointerLeaveHandle);
    cleanupQuery();
    resetRefState(pendingMapPointRef, cachedLayerRef);
    if (!canTrackCursor) resetRefState(lastCursorPointRef);
    clearGraphics();
  },
};
