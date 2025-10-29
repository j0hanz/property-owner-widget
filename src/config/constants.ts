import type { InflightQuery } from "./types"

export const ESRI_MODULES_TO_LOAD = [
  "esri/symbols/SimpleFillSymbol",
  "esri/Graphic",
  "esri/layers/GraphicsLayer",
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
export const DEFAULT_HIGHLIGHT_COLOR = "#00B4D8"
export const HIGHLIGHT_SYMBOL_ALPHA = 0.4 // 40% opacity ensures underlying features visible.
export const HIGHLIGHT_COLOR_RGBA: [number, number, number, number] = [
  0,
  180,
  216,
  HIGHLIGHT_SYMBOL_ALPHA,
]
export const OUTLINE_WIDTH = 2 // 2px meets WCAG 1.4.11 non-text contrast 3:1 ratio.
export const DEFAULT_MAX_RESULTS = 100
export const OWNER_QUERY_CONCURRENCY = 5
export const MAX_UNDO_HISTORY = 10

// Request deduplication timeout (ms) - prevents duplicate queries within this window
export const QUERY_DEDUPLICATION_TIMEOUT = 300

// AbortController pool size for efficient cancellation management
export const ABORT_CONTROLLER_POOL_SIZE = 10

export const PROPERTY_QUERY_CACHE = new Map<string, InflightQuery>()
export const OWNER_QUERY_CACHE = new Map<string, InflightQuery>()
