import type { FnrValue, MapViewWithPopupToggle } from "../../config/types";

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

export const isRecord = (
  value: unknown
): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
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
