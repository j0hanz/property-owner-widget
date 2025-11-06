import type { MutableRefObject } from "react";
import {
  CURSOR_TOOLTIP_STYLE,
  HIGHLIGHT_MARKER_SIZE,
} from "../../config/constants";
import type { DataSourceManager } from "jimu-core";
import type {
  CursorTooltipStyle,
  EsriModules,
  CursorGraphicsState,
} from "../../config/types";
import { queryPropertyByPoint, queryOwnerByFnr } from "../api";
import { formatOwnerInfo, stripHtml } from "./privacy";
import { abortHelpers } from "./helpers";
import { validateDataSourcesCore, checkValidationFailure } from "./validation";
import { extractFnr } from "./processing";

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

  if (!tooltipText) {
    if (next.tooltipGraphic) {
      layer.remove(next.tooltipGraphic);
      next.tooltipGraphic = null;
      next.lastTooltipText = null;
    }
    return next;
  }

  if (next.lastTooltipText === tooltipText && next.tooltipGraphic) {
    next.tooltipGraphic.geometry = mapPoint;
    return next;
  }

  const symbol = buildTooltipSymbol(modules, tooltipText, style);

  if (!symbol) {
    if (next.tooltipGraphic) {
      layer.remove(next.tooltipGraphic);
      next.tooltipGraphic = null;
      next.lastTooltipText = null;
    }
    return next;
  }

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
  rafIdRef: MutableRefObject<number | null>;
  pendingMapPointRef: MutableRefObject<__esri.Point | null>;
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

export const cursorLifecycleHelpers = {
  cleanupHandles: (refs: {
    pointerMoveHandle: MutableRefObject<__esri.Handle | null>;
    pointerLeaveHandle: MutableRefObject<__esri.Handle | null>;
    rafId: MutableRefObject<number | null>;
    clearGraphics: () => void;
    cleanupQuery: () => void;
  }) => {
    if (refs.pointerMoveHandle.current) {
      refs.pointerMoveHandle.current.remove();
      refs.pointerMoveHandle.current = null;
      refs.clearGraphics();
    }

    if (refs.pointerLeaveHandle.current) {
      refs.pointerLeaveHandle.current.remove();
      refs.pointerLeaveHandle.current = null;
    }

    if (refs.rafId.current !== null) {
      cancelAnimationFrame(refs.rafId.current);
      refs.rafId.current = null;
    }
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
    lastCursorPointRef: MutableRefObject<__esri.Point | null>;
    pendingMapPointRef: MutableRefObject<__esri.Point | null>;
    cachedLayerRef: MutableRefObject<__esri.GraphicsLayer | null>;
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
