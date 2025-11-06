import type { FnrValue, MapViewWithPopupToggle } from "../../config/types";
import { HTML_WHITESPACE_PATTERN } from "../../config/constants";

export const isRecord = (
  value: unknown
): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
};

export const hasGetter = (
  value: unknown
): value is { get: (key: string) => unknown } => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { get?: unknown };
  return typeof candidate.get === "function";
};

export const hasGetMethod = (
  value: unknown
): value is { get: (key: string) => unknown } => {
  return isRecord(value) && typeof value.get === "function";
};

export const hasAsMutable = <T = unknown>(
  value: unknown
): value is { asMutable: (options?: { deep?: boolean }) => T | T[] } => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { asMutable?: unknown };
  return typeof candidate.asMutable === "function";
};

export const isIndexedCollection = <T = unknown>(
  collection: unknown
): collection is {
  readonly length?: number;
  readonly [index: number]: T;
} => {
  if (!collection || typeof collection !== "object") {
    return false;
  }

  const candidate = collection as { length?: unknown };
  return typeof candidate.length === "number";
};

export const hasFind = <T = unknown>(
  collection: unknown
): collection is {
  readonly find: (predicate: (item: T) => boolean) => T | undefined;
} => {
  if (!collection || typeof collection !== "object") {
    return false;
  }
  const candidate = collection as { find?: unknown };
  return typeof candidate.find === "function";
};

export const resolveEntry = (collection: unknown, key: string): unknown => {
  if (!collection) return undefined;
  if (hasGetMethod(collection)) {
    return collection.get(key);
  }
  if (isRecord(collection)) {
    return collection[key];
  }
  return undefined;
};

export const getStringValue = (source: unknown, key: string): string => {
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

export const readString = getStringValue;

export const extractStringFromImmutable = (
  useDataSource: unknown,
  key: string
): string | null => {
  if (!useDataSource || typeof useDataSource !== "object") {
    return null;
  }

  if (hasGetter(useDataSource)) {
    const value = useDataSource.get(key);
    return typeof value === "string" ? value : null;
  }

  if (key in useDataSource) {
    const value = (useDataSource as { [key: string]: unknown })[key];
    return typeof value === "string" ? value : null;
  }

  return null;
};

export const normalizeValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
};

export const resolveCollectionLength = (values: unknown): number => {
  if (!values) {
    return 0;
  }
  const candidate = values as { length?: number };
  if (typeof candidate.length === "number") {
    return candidate.length;
  }
  return 0;
};

export const sanitizeWhitespace = (value: string): string =>
  value.replace(HTML_WHITESPACE_PATTERN, " ").trim();

export const sanitizeTextContent = (value: string): string => {
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

export const sanitizeClipboardCell = (value: unknown): string => {
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

export const normalizeHostValue = (value: string): string =>
  stripHtml(value || "").trim();

export const logger = {
  debug: (_context: string, _data?: { [key: string]: unknown }) => {
    void _context;
    void _data;
  },
  warn: (_context: string, _data?: { [key: string]: unknown }) => {
    void _context;
    void _data;
  },
  error: (
    context: string,
    error: unknown,
    data?: { [key: string]: unknown }
  ) => {
    console.error(`Property Widget: ${context}`, error, data || {});
  },
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
    const details =
      "details" in error ? (error as { details?: unknown }).details : undefined;
    if (isRecord(details)) {
      const detailMessage = (details as { message?: unknown }).message;
      if (typeof detailMessage === "string") {
        return detailMessage;
      }
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return defaultMessage;
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

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

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

export { clampNumber };

export const validateNumericRange = (params: {
  value: string | number;
  min: number;
  max: number;
  errorMessage: string;
}): { valid: boolean; normalized?: number; error?: string } => {
  const { value, min, max, errorMessage } = params;
  const num = typeof value === "string" ? parseInt(value, 10) : value;

  if (Number.isNaN(num) || num < min || num > max) {
    return { valid: false, error: errorMessage };
  }

  return { valid: true, normalized: num };
};
