import type {
  OwnerAttributes,
  GridRowData,
  ValidationResult,
  SelectionGraphicsHelpers,
} from "../config/types"
import {
  MIN_MASK_LENGTH,
  MAX_MASK_ASTERISKS,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_SYMBOL_ALPHA,
} from "../config/constants"

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
  const agarLista = normalizeOwnerValue(owner.AGARLISTA)
  if (agarLista) return `agarlista:${agarLista.toLowerCase()}`

  const identityParts = [
    normalizeOwnerValue(owner.NAMN),
    normalizeOwnerValue(owner.BOSTADR),
    normalizeOwnerValue(owner.POSTNR),
    normalizeOwnerValue(owner.POSTADR),
    normalizeOwnerValue(owner.ORGNR),
    normalizeOwnerValue(owner.ANDEL),
  ]

  const hasIdentity = identityParts.some((part) => part !== "")
  if (hasIdentity) {
    return `owner:${identityParts.map((part) => part.toLowerCase()).join("|")}`
  }

  const fallbackParts: string[] = []
  if (context.propertyId) {
    fallbackParts.push(
      `property:${normalizeOwnerValue(context.propertyId).toLowerCase()}`
    )
  }
  if (context.fnr !== undefined && context.fnr !== null) {
    fallbackParts.push(
      `fnr:${normalizeOwnerValue(String(context.fnr)).toLowerCase()}`
    )
  }
  if (owner.OBJECTID !== undefined && owner.OBJECTID !== null) {
    fallbackParts.push(`objectid:${String(owner.OBJECTID).toLowerCase()}`)
  }
  if (owner.UUID_FASTIGHET) {
    fallbackParts.push(
      `uuid:${normalizeOwnerValue(owner.UUID_FASTIGHET).toLowerCase()}`
    )
  }

  if (fallbackParts.length === 0) {
    fallbackParts.push(`index:${sequence ?? 0}`)
  }

  return fallbackParts.join("|")
}

export const ownerIdentity = {
  buildKey: buildOwnerIdentityKey,
  normalizeValue: normalizeOwnerValue,
}

export const formatOwnerInfo = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  if (owner.AGARLISTA && typeof owner.AGARLISTA === "string") {
    const agarLista = sanitizeText(owner.AGARLISTA)
    if (!maskPII) return agarLista

    return agarLista
      .split(";")
      .map((entry) => {
        const trimmed = entry.trim()
        if (!trimmed) return ""
        const match = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
        if (!match) return ownerPrivacy.maskName(trimmed)
        const name = match[1].trim()
        const orgNr = match[2].trim()
        return `${ownerPrivacy.maskName(name)} (${orgNr})`
      })
      .filter(Boolean)
      .join("; ")
  }

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

export const formatPropertyWithShare = (
  property: string,
  share?: string
): string => {
  const trimmedShare = share?.trim()
  return trimmedShare ? `${property} (${trimmedShare})` : property
}

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

export const createRowId = (fnr: string | number, objectId: number): string =>
  `${fnr}_${objectId}`

export const extractFnr = (
  attributes: { [key: string]: unknown } | null | undefined
): string | number | null => {
  if (!attributes) return null
  const candidate = attributes as { [key: string]: unknown }
  const fnr = candidate.FNR ?? candidate.fnr
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

export const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false
  const candidate = error as { name?: string; message?: string }
  if (candidate.name === "AbortError") return true
  return (
    typeof candidate.message === "string" &&
    candidate.message.toLowerCase().includes("abort")
  )
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
  updatedRows: GridRowData[]
  previousRows: GridRowData[]
  removeGraphicsForFnr: (
    fnr: string | number,
    normalize: (fnr: any) => string
  ) => void
  normalizeFnrKey: (fnr: any) => string
}): void => {
  const {
    updatedRows,
    previousRows,
    removeGraphicsForFnr,
    normalizeFnrKey: normalize,
  } = params
  const updatedFnrs = new Set(updatedRows.map((row) => normalize(row.FNR)))

  previousRows.forEach((row) => {
    const fnrKey = normalize(row.FNR)
    if (!updatedFnrs.has(fnrKey)) {
      removeGraphicsForFnr(row.FNR, normalize)
    }
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
  return toggleEnabled && isDuplicateProperty(fnr, existingProperties)
}

export const calculatePropertyUpdates = <
  T extends { FNR: string | number; id: string },
>(
  rowsToProcess: T[],
  existingProperties: T[],
  toggleEnabled: boolean,
  maxResults: number
): { toRemove: Set<string>; toAdd: T[]; updatedRows: T[] } => {
  const toRemove = new Set<string>()
  const toAdd: T[] = []

  const existingFnrKeys = new Set(
    existingProperties.map((row) => normalizeFnrKey(row.FNR))
  )
  const existingRowIds = new Set(existingProperties.map((row) => row.id))
  const toAddIds = new Set<string>()
  const toggledFnrs = new Set<string>()

  for (const row of rowsToProcess) {
    const fnrKey = normalizeFnrKey(row.FNR)
    if (
      toggleEnabled &&
      existingFnrKeys.has(fnrKey) &&
      !toggledFnrs.has(fnrKey)
    ) {
      toRemove.add(fnrKey)
      toggledFnrs.add(fnrKey)
      continue
    }

    if (existingRowIds.has(row.id) || toAddIds.has(row.id)) {
      continue
    }

    toAdd.push(row)
    toAddIds.add(row.id)
  }

  const afterRemoval = existingProperties.filter(
    (row) => !toRemove.has(normalizeFnrKey(row.FNR))
  )

  const updatedRows = [...afterRemoval, ...toAdd]
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
    console.log(
      "syncGraphicsWithState: view is null or undefined, cannot sync graphics"
    )
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
