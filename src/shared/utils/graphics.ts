import {
  HEX_COLOR_PATTERN,
  HIGHLIGHT_MARKER_SIZE,
} from "../../config/constants";
import type {
  EsriModules,
  HighlightSymbolJSON,
  SelectionGraphicsHelpers,
} from "../../config/types";

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

export const buildHighlightColor = (
  color: string,
  opacity: number
): [number, number, number, number] => {
  const sanitized = typeof color === "string" ? color.trim() : "";
  const match = sanitized ? HEX_COLOR_PATTERN.exec(sanitized) : null;

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

  const graphicsToProcess = graphicsToAdd.filter(({ fnr }) => {
    const fnrKey = helpers.normalizeFnrKey(fnr);
    return selectedFnrs.has(fnrKey);
  });

  if (graphicsToProcess.length > 0) {
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
