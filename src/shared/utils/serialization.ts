import type {
  GraphicWithAggregates,
  QueryResult,
  SerializedQueryFeature,
  SerializedQueryResult,
  SerializedRecord,
  UnknownRecord,
} from "../../config/types";
import { isRecord } from "./helpers";

export const getStructuredCloneFn = ():
  | ((value: unknown) => unknown)
  | undefined => {
  if (typeof structuredClone !== "function") {
    return undefined;
  }

  try {
    structuredClone({ test: true });
    return structuredClone;
  } catch {
    return undefined;
  }
};

export const isPrimitive = (
  value: unknown
): value is string | number | boolean => {
  const valueType = typeof value;
  return (
    valueType === "string" || valueType === "number" || valueType === "boolean"
  );
};

const cloneRecordWithDepth = (
  value: UnknownRecord,
  depth: number,
  maxDepth: number
): unknown => {
  const withToJSON = value as UnknownRecord & { toJSON?: () => unknown };
  if (typeof withToJSON.toJSON === "function") {
    return clonePlainValue(withToJSON.toJSON(), depth + 1, maxDepth);
  }

  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch (_error) {
    const result: UnknownRecord = {};
    const entries = Object.entries(value);
    for (const [key, entryValue] of entries) {
      result[key] = clonePlainValue(entryValue, depth + 1, maxDepth);
    }
    return result;
  }
};

export const clonePlainValue = (
  value: unknown,
  depth = 0,
  maxDepth = 20
): unknown => {
  if (depth > maxDepth) {
    console.warn(
      "[serialization] Max clone depth exceeded, returning value as-is"
    );
    return value;
  }

  if (value == null) return null;
  if (isPrimitive(value)) return value;

  const structuredCloneFn = getStructuredCloneFn();
  if (typeof structuredCloneFn === "function") {
    try {
      return structuredCloneFn(value);
    } catch (_error) {
      // Fall through to manual cloning
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => clonePlainValue(item, depth + 1, maxDepth));
  }

  if (isRecord(value)) {
    return cloneRecordWithDepth(value, depth, maxDepth);
  }

  return null;
};

export const serializeGeometry = (
  geometry: __esri.Geometry | undefined
): SerializedRecord | null => {
  if (!geometry) return null;

  if (typeof geometry.toJSON === "function") {
    return geometry.toJSON() as SerializedRecord;
  }

  return clonePlainValue(geometry) as SerializedRecord | null;
};

export const serializeFeature = (
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
  const aggregateGeometries = (feature as GraphicWithAggregates)
    .aggregateGeometries;
  const attrs = feature.attributes;

  return {
    attributes:
      attrs && typeof attrs === "object"
        ? { ...(attrs as UnknownRecord) }
        : null,
    geometry: serializeGeometry(geometry),
    aggregateGeometries: clonePlainValue(
      aggregateGeometries ?? null
    ) as SerializedRecord | null,
    symbol: clonePlainValue(feature.symbol ?? null) as SerializedRecord | null,
    popupTemplate: clonePlainValue(
      feature.popupTemplate ?? null
    ) as SerializedRecord | null,
  };
};

export const serializePropertyResult = (
  result: QueryResult
): SerializedQueryResult => {
  const features = result?.features;
  const serializedFeatures: SerializedQueryFeature[] = [];

  if (Array.isArray(features)) {
    const featuresLen = features.length;
    for (let i = 0; i < featuresLen; i++) {
      serializedFeatures.push(serializeFeature(features[i]));
    }
  }

  return {
    propertyId: result?.propertyId ?? "",
    features: serializedFeatures,
  };
};
