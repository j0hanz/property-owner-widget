import type { ExportFormatDefinition } from "./types";

export const ESRI_MODULES_TO_LOAD = [
  "esri/symbols/SimpleFillSymbol",
  "esri/symbols/SimpleLineSymbol",
  "esri/symbols/SimpleMarkerSymbol",
  "esri/symbols/TextSymbol",
  "esri/Graphic",
  "esri/layers/GraphicsLayer",
  "esri/geometry/Extent",
] as const;

export const GRID_COLUMN_KEYS = {
  FASTIGHET: "FASTIGHET",
  BOSTADR: "BOSTADR",
} as const;

export const QUERY_DEFAULTS = {
  RETURN_GEOMETRY: true,
  OUT_FIELDS: ["*"],
  SPATIAL_RELATIONSHIP: "intersects" as const,
  MAX_RETRY_ATTEMPTS: 2,
  TIMEOUT_MS: 15_000,
} as const;
export const MIN_MASK_LENGTH = 3;
export const MAX_MASK_ASTERISKS = 3;
export const DEFAULT_MAX_RESULTS = 100;
export const OWNER_QUERY_CONCURRENCY = 20;

export const HIGHLIGHT_MARKER_SIZE = 12;

export const CURSOR_TOOLTIP_STYLE = {
  textColor: "#000000",
  backgroundColor: "#ffffffe0",
  fontFamily: "sans-serif",
  fontSize: 10,
  fontWeight: "normal" as const,
  verticalAlignment: "top" as const,
  horizontalAlignment: "center" as const,
  yoffset: 28,
  xoffset: 0,
  lineWidth: 192,
  lineHeight: 1,
  kerning: true,
} as const;

// Size matches OWNER_QUERY_CONCURRENCY to handle typical concurrent operations
export const ABORT_CONTROLLER_POOL_SIZE = 5;

// Debounce duration for loading indicator visibility to prevent flicker
export const LOADING_VISIBILITY_DEBOUNCE_MS = 200;

// Pixel tolerance for hover queries to improve usability
export const HOVER_QUERY_TOLERANCE_PX = 10;

export const EXPORT_FORMATS: ExportFormatDefinition[] = [
  {
    id: "json",
    label: "JSON",
    description: "Raw query results with full metadata",
    extension: "json",
    mimeType: "application/json",
  },
  {
    id: "csv",
    label: "CSV",
    description: "Spreadsheet format (attributes only)",
    extension: "csv",
    mimeType: "text/csv",
  },
  {
    id: "geojson",
    label: "GeoJSON",
    description: "Geographic data format",
    extension: "geojson",
    mimeType: "application/geo+json",
  },
];

// Hex color validation pattern
export const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/;

// Query cache settings
export const QUERY_CACHE_MAX_SIZE = 100;
export const QUERY_CACHE_EVICTION_PERCENTAGE = 0.2;

// CSV export settings
export const CSV_HEADERS = [
  "FNR",
  "UUID_FASTIGHET",
  "FASTIGHET",
  "BOSTADR",
] as const;

// Hover query settings
export const HOVER_QUERY_THROTTLE_MS = 50;
