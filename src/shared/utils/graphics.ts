import { HEX_COLOR_PATTERN, HIGHLIGHT_MARKER_SIZE } from "../../config/constants";
import type { HighlightSymbolJSON, SelectionGraphicsHelpers } from "../../config/types";

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

export const syncGraphicsWithState = async (params: {
  graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: string | number }>;
  selectedRows: Array<{ FNR: string | number }>;
  view: __esri.MapView | null | undefined;
  helpers: SelectionGraphicsHelpers;
  highlightColor: [number, number, number, number];
  outlineWidth: number;
}): Promise<boolean> => {
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
    await helpers.highlightGraphics({
      entries: graphicsToProcess,
      view,
      extractFnr: helpers.extractFnr,
      normalizeFnrKey: helpers.normalizeFnrKey,
      highlightColor,
      outlineWidth,
    });
  }

  return true;
};
