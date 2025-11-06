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
  ADDRESS: "ADDRESS",
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
export const SYMBOL_CACHE_MAX_SIZE = 100;

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

export const EXPORT_FORMATS: ExportFormatDefinition[] = [
  {
    id: "json",
    label: "JSON",
    description: "Property designations with owner information",
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
export const QUERY_CACHE_MAX_SIZE = 50;
export const QUERY_CACHE_EVICTION_PERCENTAGE = 0.2;

// CSV export settings
// Header order: FNR, UUID_FASTIGHET, FASTIGHET, BOSTADR, ADDRESS
export const CSV_HEADERS = [
  "FNR",
  "UUID_FASTIGHET",
  "FASTIGHET",
  "BOSTADR",
  "ADDRESS",
] as const;

// Redux store action types
export const PROPERTY_ACTION_TYPES = [
  "PROPERTY_WIDGET/SET_ERROR",
  "PROPERTY_WIDGET/CLEAR_ERROR",
  "PROPERTY_WIDGET/SET_SELECTED_PROPERTIES",
  "PROPERTY_WIDGET/CLEAR_ALL",
  "PROPERTY_WIDGET/SET_QUERY_IN_FLIGHT",
  "PROPERTY_WIDGET/SET_RAW_RESULTS",
  "PROPERTY_WIDGET/REMOVE_WIDGET_STATE",
] as const;

// HTML sanitization patterns
export const HTML_WHITESPACE_PATTERN = /[\s\u00A0\u200B]+/g;

// Sorting and comparison options
export const SORT_COMPARE_OPTIONS: Intl.CollatorOptions = {
  numeric: true,
  sensitivity: "base",
} as const;

// Privacy: Owner identity key prefixes for deduplication
export const IDENTITY_KEY_PREFIXES = {
  OWNER_LIST: "A",
  NAME: "N",
  ADDRESS: "B",
  POSTAL_CODE: "P",
  CITY: "C",
  ORG_NUMBER: "O",
  SHARE: "S",
  PROPERTY: "PR",
  FNR: "FN",
  OBJECT_ID: "OB",
  UUID: "UU",
  INDEX: "IX",
} as const;

// Privacy: Character codes and defaults
export const SPACE_CHAR_CODE = 32;
export const DEFAULT_MASK = "***";

// Validation: Network security patterns
export const LOCALHOST_PATTERNS = ["localhost", "127.0.0.1", "::1", "[::1]"];
export const PRIVATE_IP_REGEX =
  /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/u;
