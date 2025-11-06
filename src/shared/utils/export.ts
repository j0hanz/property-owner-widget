import copy from "copy-to-clipboard";
import { trackEvent, trackError } from "../telemetry";
import { CSV_HEADERS, SORT_COMPARE_OPTIONS } from "../../config/constants";
import type {
  GridRowData,
  CsvHeaderValues,
  ExportOptions,
  SerializedQueryResult,
  SerializedRecord,
  GeoJsonGeometry,
  SerializationErrorHandler,
} from "../../config/types";
import { formatOwnerInfo, stripHtml } from "./privacy";

const handleSerializationError: SerializationErrorHandler = (
  error,
  typeName
) => {
  trackError(
    "export_sanitize_object",
    error,
    `failed to serialize value of type ${typeName}`
  );
};

export const sanitizeForExport = (
  value: unknown,
  onSerializationError?: SerializationErrorHandler
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
const sanitizeValue = (
  value: unknown,
  onError?: SerializationErrorHandler
): string => sanitizeForExport(value, onError);

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

  const activeSorting = sorting.filter((item) =>
    Boolean(item && typeof item.id === "string")
  );

  if (activeSorting.length === 0) {
    return [...properties];
  }

  const valueCache = new WeakMap<GridRowData, Map<string, string>>();

  const getSortableValue = (row: GridRowData, columnId: string): string => {
    let rowCache = valueCache.get(row);
    if (!rowCache) {
      rowCache = new Map();
      valueCache.set(row, rowCache);
    }

    const cachedValue = rowCache.get(columnId);
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    const rawValue = row[columnId as keyof GridRowData];
    const normalized = (() => {
      if (rawValue === null || rawValue === undefined) return "";
      if (typeof rawValue === "string") return rawValue;
      if (typeof rawValue === "number") return String(rawValue);
      if (typeof rawValue === "boolean") return String(rawValue);
      return "";
    })();

    rowCache.set(columnId, normalized);
    return normalized;
  };

  const comparatorOrder = [...activeSorting].reverse();

  const sorted = [...properties];
  sorted.sort((a, b) => {
    for (const sortItem of comparatorOrder) {
      const { id, desc } = sortItem;
      const key = id as keyof GridRowData;
      const aValue = getSortableValue(a, key as string);
      const bValue = getSortableValue(b, key as string);

      const comparison = aValue.localeCompare(
        bValue,
        "sv",
        SORT_COMPARE_OPTIONS
      );

      if (comparison !== 0) {
        return desc ? -comparison : comparison;
      }
    }

    return 0;
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

  const sanitizedUnknown = sanitizeClipboardCell(unknownOwnerText);

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
        return sanitizedOwner || sanitizedUnknown;
      }

      const fallbackSanitized = sanitizeClipboardCell(property.BOSTADR);
      return fallbackSanitized || sanitizedUnknown;
    })();

    return `${propertyLabel}\t${ownerText}`;
  });

  return rows.join("\n");
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

export const convertToJSON = (
  rows: GridRowData[],
  maskingEnabled: boolean,
  unknownOwnerText: string
): Array<{ FASTIGHET: string; ADDRESS: string }> => {
  if (!rows || rows.length === 0) {
    return [];
  }

  return rows.map((row) => {
    const exportRow = buildExportRow({
      row,
      maskingEnabled,
      unknownOwnerText,
      sanitize: (value: unknown) =>
        sanitizeValue(value, handleSerializationError),
    });

    return {
      FASTIGHET: exportRow.propertyLabel,
      ADDRESS: exportRow.ownerLabel,
    };
  });
};

const escapeCsvValue = (value: unknown): string => {
  const sanitized = sanitizeValue(value, handleSerializationError);
  if (sanitized === "") {
    return '""';
  }
  if (
    sanitized.includes(",") ||
    sanitized.includes('"') ||
    sanitized.includes("\n")
  ) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
};

export const convertToCSV = (rows: GridRowData[]): string => {
  if (!rows || rows.length === 0) {
    return "";
  }

  const csvHeaders = CSV_HEADERS.join(",");

  const csvRows = rows.map((row) => {
    const values: CsvHeaderValues = {
      FNR: escapeCsvValue(row.FNR),
      UUID_FASTIGHET: escapeCsvValue(row.UUID_FASTIGHET),
      FASTIGHET: escapeCsvValue(row.FASTIGHET),
      BOSTADR: escapeCsvValue(row.BOSTADR),
      ADDRESS: escapeCsvValue(row.ADDRESS),
    };

    return CSV_HEADERS.map((header) => values[header]).join(",");
  });

  return [csvHeaders, ...csvRows].join("\n");
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isCoordinateTuple = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length >= 2 && value.every(isFiniteNumber);

const isCoordinateMatrix = (value: unknown): value is number[][] =>
  Array.isArray(value) && value.length > 0 && value.every(isCoordinateTuple);

const isCoordinateTensor = (value: unknown): value is number[][][] =>
  Array.isArray(value) && value.length > 0 && value.every(isCoordinateMatrix);

const cloneTensor = (value: number[][][]): number[][][] =>
  value.map((matrix) => matrix.map((tuple) => tuple.slice()));

const cloneMatrix = (value: number[][]): number[][] =>
  value.map((tuple) => tuple.slice());

const buildExtentCoordinates = (value: {
  xmin?: unknown;
  ymin?: unknown;
  xmax?: unknown;
  ymax?: unknown;
}): number[][][] | null => {
  if (
    !isFiniteNumber(value.xmin) ||
    !isFiniteNumber(value.ymin) ||
    !isFiniteNumber(value.xmax) ||
    !isFiniteNumber(value.ymax)
  ) {
    return null;
  }

  const xmin = value.xmin;
  const ymin = value.ymin;
  const xmax = value.xmax;
  const ymax = value.ymax;

  if (xmin >= xmax || ymin >= ymax) {
    return null;
  }

  return [
    [
      [xmin, ymin],
      [xmax, ymin],
      [xmax, ymax],
      [xmin, ymax],
      [xmin, ymin],
    ],
  ];
};

const buildPointCoordinates = (value: {
  x?: unknown;
  y?: unknown;
  z?: unknown;
}): number[] | null => {
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return null;
  }

  const coordinates: number[] = [value.x, value.y];
  if (isFiniteNumber(value.z)) {
    coordinates.push(value.z);
  }

  return coordinates;
};

export const convertToGeoJSON = (rows: GridRowData[]): SerializedRecord => {
  const features = (rows || [])
    .filter((row) => Boolean(row.geometryType) && row.geometry)
    .map((row) => {
      const geometry = row.geometry as {
        rings?: unknown;
        paths?: unknown;
        points?: unknown;
        xmin?: unknown;
        ymin?: unknown;
        xmax?: unknown;
        ymax?: unknown;
        x?: unknown;
        y?: unknown;
        z?: unknown;
      };

      const geometryType = (row.geometryType || "").toLowerCase();
      let geojsonGeometry: GeoJsonGeometry = null;

      if (geometryType === "polygon") {
        const rings = geometry.rings;
        if (isCoordinateTensor(rings)) {
          geojsonGeometry = {
            type: "Polygon",
            coordinates: cloneTensor(rings),
          };
        }
      } else if (geometryType === "extent") {
        const coordinates = buildExtentCoordinates(geometry);
        if (coordinates) {
          geojsonGeometry = {
            type: "Polygon",
            coordinates,
          };
        }
      } else if (geometryType === "polyline") {
        const paths = geometry.paths;
        if (isCoordinateTensor(paths)) {
          geojsonGeometry = {
            type: "MultiLineString",
            coordinates: cloneTensor(paths),
          };
        }
      } else if (geometryType === "point") {
        const coordinates = buildPointCoordinates(geometry);
        if (coordinates) {
          geojsonGeometry = {
            type: "Point",
            coordinates,
          };
        }
      } else if (geometryType === "multipoint") {
        const points = geometry.points;
        if (isCoordinateMatrix(points)) {
          geojsonGeometry = {
            type: "MultiPoint",
            coordinates: cloneMatrix(points),
          };
        }
      }

      if (!geojsonGeometry) {
        return null;
      }

      return {
        type: "Feature",
        id: row.id,
        properties: {
          FNR: sanitizeValue(row.FNR, handleSerializationError),
          UUID_FASTIGHET: sanitizeValue(
            row.UUID_FASTIGHET,
            handleSerializationError
          ),
          FASTIGHET: sanitizeValue(row.FASTIGHET, handleSerializationError),
          BOSTADR: sanitizeValue(row.BOSTADR, handleSerializationError),
        },
        geometry: geojsonGeometry,
      } as SerializedRecord;
    })
    .filter((feature): feature is SerializedRecord => feature !== null);

  return {
    type: "FeatureCollection",
    features,
  };
};

const buildFilename = (
  baseName: string,
  extension: string,
  rowCount: number
): string => {
  const safeBase =
    baseName.replace(/[^a-zA-Z0-9-_]/g, "-") || "property-export";
  const timestamp = new Date().toISOString().split("T")[0];
  return `${safeBase}-${rowCount}rows-${timestamp}.${extension}`;
};

export const exportData = (
  rawData: readonly SerializedQueryResult[] | null | undefined,
  selectedProperties: GridRowData[],
  options: ExportOptions,
  maskingEnabled: boolean,
  unknownOwnerText: string
): void => {
  const { format, filename, rowCount, definition } = options;

  try {
    void rawData;
    let content = "";
    let mimeType = "application/json;charset=utf-8";
    let extension = definition?.extension || "json";

    if (format === "json") {
      const jsonData = convertToJSON(
        selectedProperties,
        maskingEnabled,
        unknownOwnerText
      );
      content = JSON.stringify(jsonData, null, 2);
      mimeType = definition?.mimeType || "application/json;charset=utf-8";
    } else if (format === "csv") {
      content = convertToCSV(selectedProperties);
      mimeType = definition?.mimeType || "text/csv;charset=utf-8";
      extension = definition?.extension || "csv";
    } else if (format === "geojson") {
      content = JSON.stringify(convertToGeoJSON(selectedProperties), null, 2);
      mimeType = definition?.mimeType || "application/geo+json;charset=utf-8";
      extension = definition?.extension || "geojson";
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const finalFilename = buildFilename(filename, extension, rowCount);

    const link = document.createElement("a");
    link.href = url;
    link.download = finalFilename;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);

    trackEvent({
      category: "Export",
      action: `export_${format}`,
      label: "success",
      value: rowCount,
    });
  } catch (error) {
    console.error("Export failed:", error);
    trackError(`export_${format}`, error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }
};
