import type {
  OwnerAttributes,
  ValidationResult,
  SelectionGraphicsHelpers,
  EsriModules,
  CursorTooltipStyle,
  IMConfig,
} from "../config/types"
import type { DataSourceManager } from "jimu-core"
import { isValidationFailure as checkValidationFailure } from "../config/types"
import { validateDataSources as validateDataSourcesCore } from "../shared/api"
import {
  MIN_MASK_LENGTH,
  MAX_MASK_ASTERISKS,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_SYMBOL_ALPHA,
  HIGHLIGHT_MARKER_SIZE,
  OUTLINE_WIDTH,
  CURSOR_TOOLTIP_STYLE,
} from "../config/constants"

// ============================================================================
// HTML SANITIZATION & TEXT PROCESSING
// ============================================================================

/** Sanitize arbitrary HTML/text content */
const sanitizeText = (value: string): string => {
  if (!value) return ""
  const doc = new DOMParser().parseFromString(value, "text/html")
  const text = doc.body.textContent || ""
  return text.replace(/[\s\u00A0\u200B]+/g, " ").trim()
}

export const textSanitizer = {
  sanitize: sanitizeText,
  stripHtml: (value: string) => sanitizeText(value),
}

export const stripHtml = (value: string): string =>
  textSanitizer.stripHtml(value)

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

export const logger = {
  debug: (context: string, data?: { [key: string]: any }) => {
    // Debug logging disabled in production
  },
  warn: (context: string, data?: { [key: string]: any }) => {
    // Warning logging disabled in production
  },
  error: (context: string, error: unknown, data?: { [key: string]: any }) => {
    console.error(`Property Widget: ${context}`, error, data || {})
  },
}

// ============================================================================
// PII MASKING & PRIVACY
// Owner name and address masking for privacy protection
// ============================================================================

const maskText = (text: string, minLength: number): string => {
  const normalized = sanitizeText(text)
  if (normalized.length < minLength) return "***"
  return normalized
}

const maskNameInternal = (name: string): string => {
  const normalized = maskText(name, MIN_MASK_LENGTH)
  if (normalized === "***") return normalized

  return normalized
    .split(" ")
    .filter(Boolean)
    .map(
      (part) =>
        `${part.charAt(0)}${"*".repeat(Math.min(MAX_MASK_ASTERISKS, part.length - 1))}`
    )
    .join(" ")
}

const maskAddressInternal = (address: string): string => {
  const normalized = maskText(address, MIN_MASK_LENGTH)
  if (normalized === "***") return normalized

  return `${normalized.substring(0, 2)}${"*".repeat(Math.min(5, normalized.length - 2))}`
}

export const ownerPrivacy = {
  maskName: maskNameInternal,
  maskAddress: maskAddressInternal,
}

export const maskName = ownerPrivacy.maskName
export const maskAddress = ownerPrivacy.maskAddress

// ============================================================================
// OWNER PROCESSING PIPELINE
// Format, mask, and process owner information
// ============================================================================

const normalizeOwnerValue = (value: unknown): string => {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return sanitizeText(String(value))
  if (typeof value === "string") return sanitizeText(value)
  return ""
}

const buildOwnerIdentityKey = (
  owner: Partial<OwnerAttributes> & { [key: string]: unknown },
  context: { fnr?: string | number; propertyId?: string },
  sequence?: number
): string => {
  // Priority 1: Use AGARLISTA if available (unique identifier)
  const agarLista = normalizeOwnerValue(owner.AGARLISTA)
  if (agarLista) return `A:${agarLista.toLowerCase()}`

  // Priority 2: Build identity from owner attributes
  const parts = [
    owner.NAMN && `N:${normalizeOwnerValue(owner.NAMN)}`,
    owner.BOSTADR && `B:${normalizeOwnerValue(owner.BOSTADR)}`,
    owner.POSTNR && `P:${normalizeOwnerValue(owner.POSTNR)}`,
    owner.POSTADR && `C:${normalizeOwnerValue(owner.POSTADR)}`,
    owner.ORGNR && `O:${normalizeOwnerValue(owner.ORGNR)}`,
    owner.ANDEL && `S:${normalizeOwnerValue(owner.ANDEL)}`,
  ].filter(Boolean)

  if (parts.length > 0) {
    return parts.join("|").toLowerCase()
  }

  // Priority 3: Fallback to context identifiers
  const fallback = [
    context.propertyId && `PR:${normalizeOwnerValue(context.propertyId)}`,
    context.fnr !== undefined &&
      context.fnr !== null &&
      `FN:${String(context.fnr)}`,
    owner.OBJECTID !== undefined &&
      owner.OBJECTID !== null &&
      `OB:${String(owner.OBJECTID)}`,
    owner.UUID_FASTIGHET && `UU:${normalizeOwnerValue(owner.UUID_FASTIGHET)}`,
  ].filter(Boolean)

  if (fallback.length > 0) {
    return fallback.join("|").toLowerCase()
  }

  // Priority 4: Use sequence as last resort
  return `IX:${sequence ?? 0}`
}

export const ownerIdentity = {
  buildKey: buildOwnerIdentityKey,
  normalizeValue: normalizeOwnerValue,
}

export interface CursorGraphicsState {
  pointGraphic: __esri.Graphic | null
  tooltipGraphic: __esri.Graphic | null
  lastTooltipText: string | null
}

export const buildTooltipSymbol = (
  modules: EsriModules | null,
  text: string,
  style: CursorTooltipStyle
): __esri.TextSymbol | null => {
  if (!modules?.TextSymbol || !text) return null
  const sanitized = stripHtml(text)
  if (!sanitized) return null

  return new modules.TextSymbol({
    text: sanitized,
    color: style.textColor,
    backgroundColor: style.backgroundColor,
    horizontalAlignment: style.horizontalAlignment,
    verticalAlignment: style.verticalAlignment,
    xoffset: style.xoffset,
    yoffset: style.yoffset,
    lineWidth: style.lineWidth,
    lineHeight: style.lineHeight,
    font: {
      family: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
    },
    kerning: style.kerning,
  } as __esri.TextSymbolProperties)
}

export const syncCursorGraphics = ({
  modules,
  layer,
  mapPoint,
  tooltipText,
  highlightColor,
  existing,
  style = CURSOR_TOOLTIP_STYLE,
}: {
  modules: EsriModules | null
  layer: __esri.GraphicsLayer | null
  mapPoint: __esri.Point | null
  tooltipText: string | null
  highlightColor: [number, number, number, number]
  outlineWidth: number
  existing: CursorGraphicsState | null
  style?: CursorTooltipStyle
}): CursorGraphicsState | null => {
  if (!modules?.Graphic || !layer) {
    return existing ?? null
  }

  if (!mapPoint) {
    if (existing?.pointGraphic) {
      layer.remove(existing.pointGraphic)
    }
    if (existing?.tooltipGraphic) {
      layer.remove(existing.tooltipGraphic)
    }
    return null
  }

  const next: CursorGraphicsState = {
    pointGraphic: existing?.pointGraphic ?? null,
    tooltipGraphic: existing?.tooltipGraphic ?? null,
    lastTooltipText: existing?.lastTooltipText ?? null,
  }

  if (!next.pointGraphic) {
    next.pointGraphic = new modules.Graphic({
      geometry: mapPoint,
      symbol: {
        type: "simple-marker",
        style: "cross",
        size: HIGHLIGHT_MARKER_SIZE,
        color: highlightColor,
        outline: {
          color: [highlightColor[0], highlightColor[1], highlightColor[2], 1],
          width: 2.5,
        },
      } as any,
    })
    layer.add(next.pointGraphic)
  } else {
    next.pointGraphic.geometry = mapPoint
  }

  if (tooltipText) {
    // Only rebuild symbol if text actually changed (performance optimization)
    const textChanged = next.lastTooltipText !== tooltipText

    if (textChanged) {
      const symbol = buildTooltipSymbol(modules, tooltipText, style)
      if (symbol) {
        if (!next.tooltipGraphic) {
          next.tooltipGraphic = new modules.Graphic({
            geometry: mapPoint,
            symbol,
          })
          layer.add(next.tooltipGraphic)
        } else {
          next.tooltipGraphic.geometry = mapPoint
          next.tooltipGraphic.symbol = symbol
        }
        next.lastTooltipText = tooltipText
      } else if (next.tooltipGraphic) {
        layer.remove(next.tooltipGraphic)
        next.tooltipGraphic = null
        next.lastTooltipText = null
      }
    } else if (next.tooltipGraphic) {
      // Text hasn't changed, just update position
      next.tooltipGraphic.geometry = mapPoint
    }
  } else if (next.tooltipGraphic) {
    layer.remove(next.tooltipGraphic)
    next.tooltipGraphic = null
    next.lastTooltipText = null
  }

  return next
}

const deduplicateEntries = (entries: string[]): string[] => {
  const seen = new Set<string>()
  return entries
    .map((e) => e.trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false
      seen.add(entry)
      return true
    })
}

const maskOwnerListEntry = (entry: string): string => {
  const match = entry.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (!match) return ownerPrivacy.maskName(entry)

  const [, name, orgNr] = match
  return `${ownerPrivacy.maskName(name.trim())} (${orgNr.trim()})`
}

const formatOwnerList = (agarLista: string, maskPII: boolean): string => {
  const sanitized = sanitizeText(String(agarLista))
  const uniqueEntries = deduplicateEntries(sanitized.split(";"))

  if (!maskPII) return uniqueEntries.join("; ")

  return uniqueEntries
    .map((entry) => maskOwnerListEntry(entry))
    .filter(Boolean)
    .join("; ")
}

const formatIndividualOwner = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  const rawName = sanitizeText(owner.NAMN || "") || unknownOwnerText
  const namePart =
    maskPII && rawName !== unknownOwnerText
      ? ownerPrivacy.maskName(rawName)
      : rawName

  const rawAddress = sanitizeText(owner.BOSTADR || "")
  const addressPart =
    maskPII && rawAddress ? ownerPrivacy.maskAddress(rawAddress) : rawAddress

  const postalCode = sanitizeText(owner.POSTNR || "").replace(/\s+/g, "")
  const city = sanitizeText(owner.POSTADR || "")
  const orgNr = sanitizeText(owner.ORGNR || "")

  const parts = [
    namePart,
    addressPart,
    postalCode && city ? `${postalCode} ${city}` : postalCode || city,
  ].filter(Boolean)

  const result = `${parts.join(", ")}${orgNr ? ` (${orgNr})` : ""}`.trim()
  return result || unknownOwnerText
}

export const formatOwnerInfo = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  if (owner.AGARLISTA && typeof owner.AGARLISTA === "string") {
    return formatOwnerList(owner.AGARLISTA, maskPII)
  }
  return formatIndividualOwner(owner, maskPII, unknownOwnerText)
}

export const formatPropertyWithShare = (
  property: string,
  share?: string
): string => {
  const trimmedShare = share?.trim()
  return trimmedShare ? `${property} (${trimmedShare})` : property
}

/**
 * Owner Processing Pipeline
 * Consolidated API for owner data formatting and masking
 */
export const ownerProcessing = {
  format: formatOwnerInfo,
  mask: { name: maskName, address: maskAddress },
  buildIdentity: ownerIdentity.buildKey,
  processBatch: (
    owners: OwnerAttributes[],
    maskPII: boolean,
    unknownText: string
  ) => owners.map((o) => formatOwnerInfo(o, maskPII, unknownText)),
}

// ============================================================================
// GRAPHICS & HIGHLIGHTING
// ============================================================================

const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/

export const buildHighlightColor = (
  color?: string,
  opacity?: number
): [number, number, number, number] => {
  const fallbackOpacity = HIGHLIGHT_SYMBOL_ALPHA
  const fallbackColor = DEFAULT_HIGHLIGHT_COLOR

  const sanitized = typeof color === "string" ? color.trim() : ""
  const match = sanitized ? HEX_COLOR_PATTERN.exec(sanitized) : null
  const hex = match ? match[1] : fallbackColor.replace("#", "")

  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)

  const clampedOpacity = (() => {
    if (typeof opacity !== "number" || !Number.isFinite(opacity))
      return fallbackOpacity
    if (opacity < 0) return 0
    if (opacity > 1) return 1
    return opacity
  })()

  return [r, g, b, clampedOpacity]
}

export const buildHighlightSymbolJSON = (
  highlightColor: [number, number, number, number],
  outlineWidth: number,
  geometryType?: "polygon" | "polyline" | "point"
):
  | __esri.SimpleFillSymbolProperties
  | __esri.SimpleLineSymbolProperties
  | __esri.SimpleMarkerSymbolProperties => {
  const [r, g, b, a] = highlightColor

  if (geometryType === "polyline") {
    return {
      style: "solid",
      color: [r, g, b, a],
      width: outlineWidth,
    } as __esri.SimpleLineSymbolProperties
  }

  if (geometryType === "point") {
    return {
      style: "cross",
      color: [r, g, b, a],
      size: HIGHLIGHT_MARKER_SIZE,
      outline: {
        style: "solid",
        color: [r, g, b, 1],
        width: outlineWidth,
      },
    } as __esri.SimpleMarkerSymbolProperties
  }

  // Default to polygon
  return {
    style: "solid",
    color: [r, g, b, a],
    outline: {
      style: "solid",
      color: [r, g, b, 1],
      width: outlineWidth,
    },
  } as __esri.SimpleFillSymbolProperties
}

// ============================================================================
// PROPERTY & DATA UTILITIES
// ============================================================================

export const createRowId = (fnr: string | number, objectId: number): string =>
  `${fnr}_${objectId}`

export const extractFnr = (
  attributes: { [key: string]: unknown } | null | undefined
): string | number | null => {
  if (!attributes) return null
  const fnr = attributes.FNR ?? attributes.fnr
  if (typeof fnr === "string" || typeof fnr === "number") {
    return fnr
  }
  return null
}

export const normalizeFnrKey = (
  fnr: string | number | null | undefined
): string => {
  return fnr != null ? String(fnr) : ""
}

export const isAbortError = (error: unknown): error is Error => {
  if (!error || typeof error !== "object") return false
  const candidate = error as { name?: string; message?: string }
  if (candidate.name === "AbortError") return true
  return (
    typeof candidate.message === "string" &&
    candidate.message.toLowerCase().includes("abort")
  )
}

// ============================================================================
// NUMBER UTILITIES
// ============================================================================

export const numberHelpers = {
  isFiniteNumber: (value: unknown): value is number => {
    return typeof value === "number" && Number.isFinite(value)
  },

  clamp: (value: number, min: number, max: number): number => {
    if (!Number.isFinite(value)) return min
    if (value < min) return min
    if (value > max) return max
    return value
  },

  clampWithDefault: (
    value: unknown,
    min: number,
    max: number,
    defaultValue: number
  ): number => {
    if (!numberHelpers.isFiniteNumber(value)) return defaultValue
    return numberHelpers.clamp(value, min, max)
  },
}

// ============================================================================
// ABORT SIGNAL MANAGEMENT
// ============================================================================

export const abortHelpers = {
  throwIfAborted: (signal?: AbortSignal): void => {
    if (signal?.aborted) {
      const error = new Error("AbortError")
      error.name = "AbortError"
      throw error
    }
  },

  checkAbortedOrStale: (
    signal: AbortSignal,
    isStale: () => boolean
  ): "aborted" | "stale" | "active" => {
    if (isStale()) return "stale"
    if (signal.aborted) return "aborted"
    return "active"
  },

  handleOrThrow: (error: unknown, onAbort?: () => void): void => {
    if (isAbortError(error)) {
      onAbort?.()
      throw error
    }
  },
}

export const parseArcGISError = (
  error: unknown,
  defaultMessage: string
): string => {
  if (!error) return defaultMessage
  if (typeof error === "string") return error
  if (typeof (error as any).details?.message === "string") {
    return (error as any).details.message
  }
  if (typeof (error as any).message === "string") {
    return (error as any).message
  }
  return defaultMessage
}

export const getValidatedOutlineWidth = (
  width: unknown,
  defaultWidth: number = OUTLINE_WIDTH
): number => {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return defaultWidth
  }
  if (width < 0.5) return 0.5
  if (width > 10) return 10
  return width
}

export const typeGuards = {
  isString: (value: unknown): value is string => {
    return typeof value === "string"
  },

  isFiniteNumber: (value: unknown): value is number => {
    return typeof value === "number" && Number.isFinite(value)
  },

  isNonEmptyString: (value: unknown): value is string => {
    return typeof value === "string" && value.length > 0
  },
}

export const buildFnrWhereClause = (
  fnr: string | number,
  errorMessage = "Invalid FNR: must be a safe integer"
): string => {
  if (typeof fnr === "number") {
    if (!Number.isFinite(fnr) || !Number.isSafeInteger(fnr) || fnr < 0) {
      throw new Error(errorMessage)
    }
    return `FNR = ${fnr}`
  }

  const sanitized = String(fnr).replace(/'/g, "''")
  if (!sanitized.trim()) {
    throw new Error("Invalid FNR: cannot be empty or whitespace-only")
  }

  return `FNR = '${sanitized}'`
}

export const cleanupRemovedGraphics = (params: {
  toRemove: Set<string>
  removeGraphicsForFnr: (
    fnr: string | number,
    normalize: (fnr: any) => string
  ) => void
  normalizeFnrKey: (fnr: any) => string
}): void => {
  const { toRemove, removeGraphicsForFnr, normalizeFnrKey: normalize } = params

  toRemove.forEach((fnrKey) => {
    removeGraphicsForFnr(fnrKey, normalize)
  })
}

export const isDuplicateProperty = (
  fnr: string | number,
  existingProperties: Array<{ FNR: string | number }>
): boolean => {
  const fnrKey = normalizeFnrKey(fnr)
  return existingProperties.some((row) => normalizeFnrKey(row.FNR) === fnrKey)
}

export const shouldToggleRemove = (
  fnr: string | number,
  existingProperties: Array<{ FNR: string | number }>,
  toggleEnabled: boolean
): boolean => {
  if (!toggleEnabled) return false
  return isDuplicateProperty(fnr, existingProperties)
}

export const calculatePropertyUpdates = <
  T extends { FNR: string | number; id: string },
>(
  rowsToProcess: T[],
  existingProperties: T[],
  toggleEnabled: boolean,
  maxResults: number
): { toRemove: Set<string>; toAdd: T[]; updatedRows: T[] } => {
  // Precompute normalized FNR keys for efficiency
  const existingFnrKeys = existingProperties.map((r) => normalizeFnrKey(r.FNR))
  const processFnrKeys = rowsToProcess.map((r) => normalizeFnrKey(r.FNR))

  const existingByFnr = new Map<string, T[]>()
  const remainingIds = new Set<string>()

  existingProperties.forEach((row, idx) => {
    const fnrKey = existingFnrKeys[idx]
    const existingGroup = existingByFnr.get(fnrKey)
    if (existingGroup) {
      existingGroup.push(row)
    } else {
      existingByFnr.set(fnrKey, [row])
    }
    remainingIds.add(row.id)
  })

  const toRemove = new Set<string>()
  const toAdd: T[] = []
  const addedIds = new Set<string>()

  rowsToProcess.forEach((row, idx) => {
    const fnrKey = processFnrKeys[idx]
    if (toggleEnabled && !toRemove.has(fnrKey)) {
      const existingGroup = existingByFnr.get(fnrKey)
      if (existingGroup && existingGroup.length > 0) {
        toRemove.add(fnrKey)
        existingGroup.forEach((existing) => {
          remainingIds.delete(existing.id)
        })
        return
      }
    }

    if (remainingIds.has(row.id) || addedIds.has(row.id)) {
      return
    }

    toAdd.push(row)
    addedIds.add(row.id)
  })

  const updatedRows = existingProperties.filter(
    (row) => !toRemove.has(normalizeFnrKey(row.FNR))
  )
  updatedRows.push(...toAdd)

  if (updatedRows.length > maxResults) {
    updatedRows.length = maxResults
  }

  return { toRemove, toAdd, updatedRows }
}

export const validateMapClickInputs = (
  event: any,
  modules: any,
  config: any,
  translate: (key: string) => string
): ValidationResult<{ mapPoint: __esri.Point }> => {
  if (!modules) {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR",
        message: translate("errorLoadingModules"),
      },
      failureReason: "modules_not_loaded",
    }
  }

  if (!event?.mapPoint) {
    return {
      valid: false,
      error: { type: "GEOMETRY_ERROR", message: translate("errorNoMapPoint") },
      failureReason: "no_map_point",
    }
  }

  return { valid: true, data: { mapPoint: event.mapPoint } }
}

export const syncGraphicsWithState = (params: {
  graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: string | number }>
  selectedRows: Array<{ FNR: string | number }>
  view: __esri.MapView | null | undefined
  helpers: SelectionGraphicsHelpers
  highlightColor: [number, number, number, number]
  outlineWidth: number
}): boolean => {
  const {
    graphicsToAdd,
    selectedRows,
    view,
    helpers,
    highlightColor,
    outlineWidth,
  } = params

  if (!view) {
    return false
  }

  const selectedFnrs = new Set(
    selectedRows.map((row) => helpers.normalizeFnrKey(row.FNR))
  )

  graphicsToAdd.forEach(({ graphic, fnr }) => {
    const fnrKey = helpers.normalizeFnrKey(fnr)
    if (!selectedFnrs.has(fnrKey)) return

    helpers.addGraphicsToMap(
      graphic,
      view,
      helpers.extractFnr,
      helpers.normalizeFnrKey,
      highlightColor,
      outlineWidth
    )
  })
  return true
}

export { isValidationSuccess, isValidationFailure } from "../config/types"

export const validateMapClickPipeline = (params: {
  event: any
  modules: EsriModules | null
  config: IMConfig
  dsManager: DataSourceManager | null
  translate: (key: string) => string
}): ValidationResult<{
  mapPoint: __esri.Point
  manager: DataSourceManager
}> => {
  const { event, modules, config, dsManager, translate } = params

  const mapValidation = validateMapClickInputs(
    event,
    modules,
    config,
    translate
  )
  if (checkValidationFailure(mapValidation)) {
    return mapValidation as ValidationResult<{
      mapPoint: __esri.Point
      manager: DataSourceManager
    }>
  }

  const dsValidation = validateDataSourcesCore({
    propertyDsId: config.propertyDataSourceId,
    ownerDsId: config.ownerDataSourceId,
    dsManager,
    allowedHosts: config.allowedHosts,
    translate,
  })
  if (checkValidationFailure(dsValidation)) {
    return dsValidation as ValidationResult<{
      mapPoint: __esri.Point
      manager: DataSourceManager
    }>
  }

  // TypeScript type guard ensures we have .data here
  const validatedMap = mapValidation as {
    valid: true
    data: { mapPoint: __esri.Point }
  }
  const validatedDs = dsValidation as {
    valid: true
    data: { manager: DataSourceManager }
  }

  return {
    valid: true,
    data: {
      mapPoint: validatedMap.data.mapPoint,
      manager: validatedDs.data.manager,
    },
  }
}

interface ProcessPropertyQueryParams {
  propertyResults: any[]
  config: {
    propertyDataSourceId: string
    ownerDataSourceId: string
    enablePIIMasking: boolean
    relationshipId?: number
    enableBatchOwnerQuery?: boolean
  }
  processingContext: any
  services: {
    processBatch: (params: any) => Promise<any>
    processIndividual: (params: any) => Promise<any>
  }
}

export const processPropertyQueryResults = async (
  params: ProcessPropertyQueryParams
): Promise<{ rowsToProcess: any[]; graphicsToAdd: any[] }> => {
  const { propertyResults, config, processingContext, services } = params

  const useBatchQuery =
    config.enableBatchOwnerQuery &&
    config.relationshipId !== undefined &&
    config.propertyDataSourceId

  if (useBatchQuery && config.relationshipId !== undefined) {
    return await services.processBatch({
      propertyResults,
      config: {
        propertyDataSourceId: config.propertyDataSourceId,
        ownerDataSourceId: config.ownerDataSourceId,
        enablePIIMasking: config.enablePIIMasking,
        relationshipId: config.relationshipId,
      },
      context: processingContext,
    })
  }

  return await services.processIndividual({
    propertyResults,
    config: {
      ownerDataSourceId: config.ownerDataSourceId,
      enablePIIMasking: config.enablePIIMasking,
    },
    context: processingContext,
  })
}

export const updateRawPropertyResults = (
  prev: Map<string, any>,
  rowsToProcess: any[],
  propertyResults: any[],
  toRemove: Set<string>,
  selectedProperties: any[],
  normalizeFnrKey: (fnr: any) => string
): Map<string, any> => {
  const updated = new Map(prev)

  const selectedByFnr = new Map<string, string>()
  selectedProperties.forEach((row) => {
    selectedByFnr.set(normalizeFnrKey(row.FNR), row.id)
  })

  rowsToProcess.forEach((row, index) => {
    if (index < propertyResults.length) {
      updated.set(row.id, propertyResults[index])
    }
  })

  toRemove.forEach((removedKey) => {
    const removedId = selectedByFnr.get(removedKey)
    if (removedId) {
      updated.delete(removedId)
    }
  })

  return updated
}

/** Computes list of widget IDs that should be closed when this widget opens */
export const computeWidgetsToClose = (
  runtimeInfo:
    | { [id: string]: { state?: any; isClassLoaded?: boolean } | undefined }
    | null
    | undefined,
  widgetId: string
): string[] => {
  if (!runtimeInfo) return []

  const ids: string[] = []

  for (const [id, info] of Object.entries(runtimeInfo)) {
    if (id === widgetId || !info) continue
    const stateRaw = info.state
    if (!stateRaw) continue
    const normalized = String(stateRaw).toUpperCase()

    // Skip widgets that are already closed or hidden
    if (normalized === "CLOSED" || normalized === "HIDDEN") {
      continue
    }

    ids.push(id)
  }

  return ids
}

export const validateNumericRange = (params: {
  value: string | number
  min: number
  max: number
  errorMessage: string
}): { valid: boolean; normalized?: number; error?: string } => {
  const { value, min, max, errorMessage } = params
  const num = typeof value === "string" ? parseInt(value, 10) : value

  if (isNaN(num) || num < min || num > max) {
    return { valid: false, error: errorMessage }
  }

  return { valid: true, normalized: num }
}

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export const opacityHelpers = {
  toPercent: (value: number): number => {
    const clamped = clampNumber(value, 0, 1)
    return Math.round(clamped * 100)
  },
  fromPercent: (percent: number): number => {
    const clamped = clampNumber(percent, 0, 100)
    return clamped / 100
  },
  formatPercent: (percent: number): string => {
    const normalized = clampNumber(Math.round(percent), 0, 100)
    return `${normalized}%`
  },
}

export const outlineWidthHelpers = {
  normalize: (value: number): number => {
    const clamped = clampNumber(value, 0.5, 10)
    return Math.round(clamped * 2) / 2
  },
  formatDisplay: (value: number): string => {
    const normalized = clampNumber(value, 0.5, 10)
    const halfStep = Math.round(normalized * 2) / 2
    const rounded = Math.round(halfStep)
    if (Math.abs(halfStep - rounded) < 0.0001) {
      return String(rounded)
    }
    return halfStep.toFixed(1)
  },
}

export const normalizeHostValue = (value: string): string =>
  stripHtml(value || "").trim()

export const normalizeHostList = (
  hosts: readonly string[] | undefined
): string[] => {
  if (!hosts || hosts.length === 0) return []
  const normalized = hosts.map(normalizeHostValue).filter((h) => h.length > 0)
  return Array.from(new Set(normalized))
}

export const dataSourceHelpers = {
  extractId: (useDataSource: unknown): string | null => {
    if (!useDataSource) {
      return null
    }

    const getId = (useDataSource as any)?.get
    if (typeof getId === "function") {
      return getId.call(useDataSource, "dataSourceId") ?? null
    }

    return (useDataSource as any)?.dataSourceId ?? null
  },

  findById: (useDataSources: unknown, dataSourceId?: string): unknown => {
    if (!dataSourceId || !useDataSources) {
      return null
    }

    const collection = useDataSources as {
      find?: (predicate: (candidate: unknown) => boolean) => unknown
    }

    if (typeof collection.find !== "function") {
      return null
    }

    const match = collection.find((candidate: unknown) => {
      if (!candidate) {
        return false
      }
      return dataSourceHelpers.extractId(candidate) === dataSourceId
    })

    return match ?? null
  },
}

class PopupSuppressionManager {
  private readonly ownersByView = new WeakMap<__esri.MapView, Set<symbol>>()
  private readonly originalStateByView = new WeakMap<__esri.MapView, boolean>()

  acquire(ownerId: symbol, view: __esri.MapView | null | undefined): void {
    if (!view) return

    const popupEnabled = (view as any).popupEnabled
    if (typeof popupEnabled !== "boolean") return

    let owners = this.ownersByView.get(view)
    if (!owners) {
      owners = new Set()
      this.ownersByView.set(view, owners)
      this.originalStateByView.set(view, popupEnabled)
    }

    owners.add(ownerId)
    ;(view as any).popupEnabled = false
  }

  release(ownerId: symbol, view: __esri.MapView | null | undefined): void {
    if (!view) return

    const owners = this.ownersByView.get(view)
    if (!owners || !owners.delete(ownerId)) return

    if (owners.size === 0) {
      this.restorePopupState(view)
    }
  }

  private restorePopupState(view: __esri.MapView): void {
    const originalState = this.originalStateByView.get(view)

    if (originalState !== undefined) {
      ;(view as any).popupEnabled = originalState
      this.originalStateByView.delete(view)
      this.ownersByView.delete(view)
    }
  }
}

export const popupSuppressionManager = new PopupSuppressionManager()
