import { stripHtml } from "./utils";
import { trackEvent, trackError } from "./telemetry";
import type {
  GridRowData,
  CsvHeaderValues,
  ExportOptions,
  SerializedQueryResult,
  SerializedQueryFeature,
  SerializedRecord,
  GeoJsonGeometry,
} from "../config/types";
import { CSV_HEADERS } from "../config/constants";

const sanitizeValue = (value: unknown): string => {
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
  if (typeof value === "object") {
    try {
      return stripHtml(JSON.stringify(value));
    } catch (error) {
      const typeName = (value as { constructor?: { name?: string } })
        .constructor?.name;
      trackError(
        "export_sanitize_object",
        error,
        `failed to serialize value of type ${typeName ?? typeof value}`
      );
      return "";
    }
  }
  if (typeof value === "symbol") {
    return stripHtml(value.description ?? "");
  }
  if (typeof value === "function") {
    return stripHtml(value.name ?? "");
  }
  return "";
};

const escapeCsvValue = (value: unknown): string => {
  const sanitized = sanitizeValue(value);
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
    };

    return CSV_HEADERS.map((header) => values[header]).join(",");
  });

  return [csvHeaders, ...csvRows].join("\n");
};

const cloneRecord = (
  record: SerializedRecord | null
): SerializedRecord | null => {
  if (!record) {
    return null;
  }
  return { ...record };
};

const stripRingsFromGeometry = (
  data: readonly SerializedQueryResult[]
): SerializedQueryResult[] => {
  return data.map((result) => {
    if (!result?.features) {
      return result;
    }

    const sanitizedFeatures = result.features.map(
      (feature): SerializedQueryFeature => {
        if (!feature) {
          return {
            attributes: null,
            geometry: null,
            aggregateGeometries: null,
            symbol: null,
            popupTemplate: null,
          };
        }

        const sanitized: SerializedQueryFeature = {
          attributes: cloneRecord(feature.attributes),
          geometry: null,
          aggregateGeometries: cloneRecord(feature.aggregateGeometries ?? null),
          symbol: cloneRecord(feature.symbol ?? null),
          popupTemplate: cloneRecord(feature.popupTemplate ?? null),
        };

        if (feature.geometry) {
          const { rings, ...other } = feature.geometry as {
            [key: string]: unknown;
            rings?: unknown;
          };
          sanitized.geometry = { ...other };
          void rings;
        }

        return sanitized;
      }
    );

    return {
      ...result,
      features: sanitizedFeatures,
    };
  });
};

export const convertToGeoJSON = (rows: GridRowData[]): SerializedRecord => {
  const features = (rows || [])
    .filter((row) => Boolean(row.geometryType))
    .map((row) => {
      let geojsonGeometry: GeoJsonGeometry = null;
      const geometryType = (row.geometryType || "").toLowerCase();
      if (geometryType === "polygon" || geometryType === "extent") {
        geojsonGeometry = {
          type: "Polygon",
        };
      } else if (geometryType === "polyline") {
        geojsonGeometry = {
          type: "MultiLineString",
        };
      } else if (geometryType === "point" || geometryType === "multipoint") {
        geojsonGeometry = {
          type: "Point",
        };
      }

      return {
        type: "Feature",
        id: row.id,
        properties: {
          FNR: sanitizeValue(row.FNR),
          UUID_FASTIGHET: sanitizeValue(row.UUID_FASTIGHET),
          FASTIGHET: sanitizeValue(row.FASTIGHET),
          BOSTADR: sanitizeValue(row.BOSTADR),
        },
        geometry: geojsonGeometry,
      };
    });

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
  options: ExportOptions
): void => {
  const { format, filename, rowCount, definition } = options;

  try {
    let content = "";
    let mimeType = "application/json;charset=utf-8";
    let extension = definition?.extension || "json";

    if (format === "json") {
      const cleanedData = stripRingsFromGeometry(rawData ?? []);
      content = JSON.stringify(cleanedData, null, 2);
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
