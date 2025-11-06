const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
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

export const getValidatedOutlineWidth = (width: unknown): number => {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return 1;
  }
  if (width < 0.5) return 0.5;
  if (width > 10) return 10;
  return width;
};
