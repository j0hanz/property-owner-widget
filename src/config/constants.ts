import type { ExportFormatDefinition } from "./types"

export const ESRI_MODULES_TO_LOAD = [
  "esri/symbols/SimpleFillSymbol",
  "esri/symbols/SimpleLineSymbol",
  "esri/symbols/SimpleMarkerSymbol",
  "esri/symbols/TextSymbol",
  "esri/Graphic",
  "esri/layers/GraphicsLayer",
  "esri/geometry/Extent",
] as const

export const GRID_COLUMN_KEYS = {
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
export const DEFAULT_HIGHLIGHT_COLOR = "#b54900"
export const HIGHLIGHT_SYMBOL_ALPHA = 0.5
export const OUTLINE_WIDTH = 1
export const DEFAULT_MAX_RESULTS = 100
export const OWNER_QUERY_CONCURRENCY = 5

export const HIGHLIGHT_MARKER_SIZE = 12

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
} as const

// Size matches OWNER_QUERY_CONCURRENCY to handle typical concurrent operations
export const ABORT_CONTROLLER_POOL_SIZE = 5

// Debounce duration for loading indicator visibility to prevent flicker
export const LOADING_VISIBILITY_DEBOUNCE_MS = 200

// Pixel tolerance for hover queries to improve usability
export const HOVER_QUERY_TOLERANCE_PX = 10

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
