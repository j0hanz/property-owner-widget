import type { ExportFormatDefinition } from "./types"

export const ESRI_MODULES_TO_LOAD = [
  "esri/symbols/SimpleFillSymbol",
  "esri/symbols/SimpleLineSymbol",
  "esri/symbols/SimpleMarkerSymbol",
  "esri/Graphic",
  "esri/layers/GraphicsLayer",
  "esri/geometry/Extent",
] as const

export const GRID_COLUMN_KEYS = {
  SELECT: "select",
  FASTIGHET: "FASTIGHET",
  BOSTADR: "BOSTADR",
} as const

export const QUERY_DEFAULTS = {
  RETURN_GEOMETRY: true,
  OUT_FIELDS: ["*"],
  SPATIAL_RELATIONSHIP: "intersects" as const,
  MAX_RETRY_ATTEMPTS: 2,
  TIMEOUT_MS: 15_000,
} as const
export const MIN_MASK_LENGTH = 3
export const MAX_MASK_ASTERISKS = 3
export const DEFAULT_HIGHLIGHT_COLOR = "#00B4D8"
export const HIGHLIGHT_SYMBOL_ALPHA = 0.4 // 40% opacity ensures underlying features visible.
export const OUTLINE_WIDTH = 2 // 2px meets WCAG 1.4.11 non-text contrast 3:1 ratio.
export const DEFAULT_MAX_RESULTS = 100
export const OWNER_QUERY_CONCURRENCY = 5

export const HIGHLIGHT_MARKER_SIZE = 12

// AbortController pool size for efficient cancellation management
// Size chosen to handle concurrent operations: 1 property query + 5 owner queries + 1 zoom query + buffer
export const ABORT_CONTROLLER_POOL_SIZE = 10

// Debounce duration (ms) for stabilizing loading indicator visibility
// 200ms balances perceived responsiveness vs flicker prevention
export const LOADING_VISIBILITY_DEBOUNCE_MS = 200

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
]
