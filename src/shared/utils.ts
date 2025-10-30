import type {
  OwnerAttributes,
  ProcessPropertyResult,
  GridRowData,
  ValidationResult,
} from "../config/types"
import { isValidationFailure } from "../config/types"
import type { DataSourceManager, FeatureLayerDataSource } from "jimu-core"
import { loadArcGISJSAPIModules } from "jimu-arcgis"
import {
  MIN_MASK_LENGTH,
  MAX_MASK_ASTERISKS,
  OWNER_QUERY_CONCURRENCY,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_SYMBOL_ALPHA,
} from "../config/constants"

/** Sanitize HTML content and normalize whitespace */
const sanitizeText = (str: string): string => {
  if (!str) return ""
  const doc = new DOMParser().parseFromString(str, "text/html")
  const text = doc.body.textContent || ""
  return text.replace(/[\s\u00A0\u200B]+/g, " ").trim()
}

/** Public helper to strip HTML tags and normalize whitespace */
export const stripHtml = (value: string): string => sanitizeText(value)

/** Mask text with minimum length validation */
const maskText = (text: string, minLength: number): string => {
  const sanitized = sanitizeText(text)
  if (sanitized.length < minLength) return "***"
  return sanitized
}

/** Mask personal name (e.g., "John Doe" → "J*** D**") */
export const maskName = (name: string): string => {
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

/** Mask street address (e.g., "Main St 123" → "Ma*****") */
export const maskAddress = (address: string): string => {
  const normalized = maskText(address, MIN_MASK_LENGTH)
  if (normalized === "***") return normalized

  return `${normalized.substring(0, 2)}${"*".repeat(Math.min(5, normalized.length - 2))}`
}

/** Format owner information with optional PII masking */
export const formatOwnerInfo = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  // Check if this is a combined property/owner layer with AGARLISTA field
  if (owner.AGARLISTA && typeof owner.AGARLISTA === "string") {
    const agarLista = sanitizeText(owner.AGARLISTA)
    // AGARLISTA contains pre-formatted owner info, optionally mask it
    if (maskPII && agarLista) {
      // Split by semicolon for multiple owners, mask each
      return agarLista
        .split(";")
        .map((ownerEntry) => {
          const trimmed = ownerEntry.trim()
          // Try to extract name before organization number
          const match = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
          if (match) {
            const name = match[1].trim()
            const orgNr = match[2].trim()
            return `${maskName(name)} (${orgNr})`
          }
          return maskName(trimmed)
        })
        .join("; ")
    }
    return agarLista
  }

  // Original logic for separate owner layer with NAMN/BOSTADR fields
  const rawName = sanitizeText(owner.NAMN || "") || unknownOwnerText
  const namePart =
    maskPII && rawName !== unknownOwnerText ? maskName(rawName) : rawName

  const rawAddress = sanitizeText(owner.BOSTADR || "")
  const addressPart =
    maskPII && rawAddress ? maskAddress(rawAddress) : rawAddress

  const postalCode = sanitizeText(owner.POSTNR || "").replace(/\s+/g, "")
  const city = sanitizeText(owner.POSTADR || "")
  const orgNr = sanitizeText(owner.ORGNR || "")

  const parts = [
    namePart,
    addressPart,
    postalCode && city ? `${postalCode} ${city}` : postalCode || city,
  ].filter(Boolean)

  const result = parts.join(", ") + (orgNr ? ` (${orgNr})` : "")

  // Ensure we never return an empty string
  return result || unknownOwnerText
}

/** Format property designation with optional share percentage */
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
    if (typeof opacity !== "number" || !Number.isFinite(opacity)) {
      return fallbackOpacity
    }
    if (opacity < 0) return 0
    if (opacity > 1) return 1
    return opacity
  })()

  return [r, g, b, clampedOpacity]
}

/** Reformat existing grid rows with new PII masking setting */
export const reformatGridRows = (
  rows: GridRowData[],
  maskPII: boolean,
  unknownOwnerText: string
): GridRowData[] => {
  return rows.map((row) => {
    if (!row.rawOwner) {
      return row
    }
    return {
      ...row,
      BOSTADR: formatOwnerInfo(row.rawOwner, maskPII, unknownOwnerText),
    }
  })
}

/** Create unique row identifier from FNR and OBJECTID */
export const createRowId = (fnr: string | number, objectId: number): string =>
  `${fnr}_${objectId}`

/** Check if hostname is private IP or localhost */
const isPrivateHost = (hostname: string): boolean => {
  const lower = hostname.toLowerCase()
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "[::1]" ||
    /^10\./.test(lower) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower) ||
    /^192\.168\./.test(lower)
  )
}

/** Validate HTTPS URL with standard port (443 or default) */
const isValidHttpsUrl = (parsed: URL): boolean => {
  return (
    parsed.protocol === "https:" &&
    (parsed.port === "" || parsed.port === "443")
  )
}

/** Check if URL path matches ArcGIS service pattern */
const isValidArcGISPath = (pathname: string): boolean => {
  return /\/(MapServer|FeatureServer)\/\d+(\/query)?$/.test(pathname)
}

/** Verify hostname against allowlist (if configured) */
const isHostAllowed = (
  hostname: string,
  allowedHosts?: readonly string[]
): boolean => {
  if (!allowedHosts || allowedHosts.length === 0) return true
  return allowedHosts.some((h) => {
    if (hostname === h) return true
    const suffix = "." + h
    return hostname.endsWith(suffix)
  })
}

/** Validate ArcGIS REST service URL with host allowlist enforcement */
export const isValidArcGISUrl = (
  url: string,
  allowedHosts?: readonly string[]
): boolean => {
  try {
    const parsed = new URL(url)

    return (
      !isPrivateHost(parsed.hostname) &&
      isValidHttpsUrl(parsed) &&
      isValidArcGISPath(parsed.pathname) &&
      isHostAllowed(parsed.hostname, allowedHosts)
    )
  } catch (_error) {
    return false
  }
}

/** Build SQL WHERE clause with SQL injection protection (doubles apostrophes) */
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

/** Extract FNR value from feature attributes */
export const extractFnr = (
  attributes: { [key: string]: any } | null | undefined
): string | number | null => {
  if (!attributes) return null
  const value = attributes.FNR || attributes.fnr || null
  return value
}

/** Normalize FNR to string key for Map lookups */
export const normalizeFnrKey = (
  fnr: string | number | null | undefined
): string => {
  return fnr != null ? String(fnr) : ""
}

/** Check if error represents an aborted operation */
export const isAbortError = (error: any): boolean => {
  return (
    error?.name === "AbortError" ||
    (typeof error?.message === "string" &&
      error.message.toLowerCase().includes("abort"))
  )
}

/** Parse ArcGIS error object to user-friendly message */
export const parseArcGISError = (
  error: any,
  defaultMessage: string
): string => {
  if (!error) return defaultMessage
  if (typeof error === "string") return error
  return error.details?.message || error.message || defaultMessage
}

/** Extract data source URL from various possible locations */
const getDataSourceUrl = (
  dataSource: FeatureLayerDataSource | null | undefined
): string | null => {
  if (!dataSource) return null

  const layerUrl = (dataSource.getLayerDefinition?.() as any)?.url
  if (layerUrl) return layerUrl

  const jsonUrl = (dataSource.getDataSourceJson?.() as any)?.url
  if (jsonUrl) return jsonUrl

  return (dataSource as any)?.url || (dataSource as any)?.layer?.url || null
}

const createValidationError = (
  type: "VALIDATION_ERROR" | "QUERY_ERROR",
  message: string,
  reason: string
) => ({
  valid: false as const,
  error: { type, message },
  failureReason: reason,
})

const isQueryableDataSource = (ds: FeatureLayerDataSource | null): boolean => {
  return ds !== null && typeof ds.query === "function"
}

/** Validate data sources are available, queryable, and URLs are secure */
export const validateDataSources = (params: {
  propertyDsId: string | undefined
  ownerDsId: string | undefined
  dsManager: DataSourceManager | null
  allowedHosts?: readonly string[]
  translate: (key: string) => string
}): ValidationResult<{ manager: DataSourceManager }> => {
  const { propertyDsId, ownerDsId, dsManager, allowedHosts, translate } = params

  if (!propertyDsId || !ownerDsId) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "missing_data_sources"
    )
  }

  if (!dsManager) {
    return createValidationError(
      "QUERY_ERROR",
      translate("errorQueryFailed"),
      "no_data_source_manager"
    )
  }

  const propertyDs = dsManager.getDataSource(
    propertyDsId
  ) as FeatureLayerDataSource | null
  const ownerDs = dsManager.getDataSource(
    ownerDsId
  ) as FeatureLayerDataSource | null

  // Validate both data sources are queryable
  const propertyDsValidation = validateSingleDataSource(
    propertyDs,
    "property",
    translate
  )
  if (isValidationFailure(propertyDsValidation)) {
    return propertyDsValidation
  }

  const ownerDsValidation = validateSingleDataSource(
    ownerDs,
    "owner",
    translate
  )
  if (isValidationFailure(ownerDsValidation)) {
    return ownerDsValidation
  }

  // Type narrowing after successful validation
  if (!propertyDs || !ownerDs) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "missing_data_source_instance"
    )
  }

  // Validate both URLs against allowed hosts
  const propertyUrlValidation = validateDataSourceUrl(
    propertyDs,
    "property",
    allowedHosts,
    translate
  )
  if (isValidationFailure(propertyUrlValidation)) {
    return propertyUrlValidation
  }

  const ownerUrlValidation = validateDataSourceUrl(
    ownerDs,
    "owner",
    allowedHosts,
    translate
  )
  if (isValidationFailure(ownerUrlValidation)) {
    return ownerUrlValidation
  }

  // Type narrowing: both data sources validated as non-null and queryable
  if (!propertyDs || !ownerDs) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "data_source_null_after_validation"
    )
  }

  // Check if property and owner layers are from the same service (recommended)
  const propertyUrl = getDataSourceUrl(propertyDs)
  const ownerUrl = getDataSourceUrl(ownerDs)
  if (propertyUrl && ownerUrl) {
    const propertyService = propertyUrl.split("/MapServer/")[0]
    const ownerService = ownerUrl.split("/MapServer/")[0]
    if (propertyService !== ownerService) {
      console.warn(
        "⚠️ Configuration Warning: Property and owner layers use different MapServer services",
        {
          propertyService,
          ownerService,
          propertyUrl,
          ownerUrl,
          recommendation:
            "Both should typically use the same MapServer service with different layer indexes (e.g., layer 0 for properties, layer 1 for owners)",
        }
      )
    }
  }

  return { valid: true, data: { manager: dsManager } }
}

/**
 * Validate single data source is queryable
 * Internal helper for validateDataSources
 */
const validateSingleDataSource = (
  ds: FeatureLayerDataSource | null,
  dsType: "property" | "owner",
  translate: (key: string) => string
): ValidationResult<null> => {
  if (!ds) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      `${dsType}_ds_not_found`
    )
  }

  if (!isQueryableDataSource(ds)) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      `${dsType}_ds_not_queryable`
    )
  }

  return { valid: true, data: null }
}

/**
 * Validate data source URL against allowed hosts
 * Internal helper for validateDataSources
 */
const validateDataSourceUrl = (
  ds: FeatureLayerDataSource,
  dsType: "property" | "owner",
  allowedHosts: readonly string[] | undefined,
  translate: (key: string) => string
): ValidationResult<null> => {
  const normalizedHosts = allowedHosts
    ?.map((host) => host.trim())
    .filter((host) => host.length > 0)

  const url = getDataSourceUrl(ds)
  if (!url || !isValidArcGISUrl(url, normalizedHosts)) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorHostNotAllowed"),
      `${dsType}_disallowed_host`
    )
  }

  return { valid: true, data: null }
}

/** Remove graphics for properties no longer in selection */
export const cleanupRemovedGraphics = (params: {
  updatedRows: GridRowData[]
  previousRows: GridRowData[]
  removeGraphicsForFnr: (
    fnr: string | number,
    normalizeFnrKey: (fnr: any) => string
  ) => void
  normalizeFnrKey: (fnr: any) => string
}) => {
  const { updatedRows, previousRows, removeGraphicsForFnr, normalizeFnrKey } =
    params
  const updatedFnrKeys = new Set(
    updatedRows.map((row) => normalizeFnrKey(row.FNR))
  )

  previousRows.forEach((row) => {
    const fnrKey = normalizeFnrKey(row.FNR)
    if (!updatedFnrKeys.has(fnrKey)) {
      removeGraphicsForFnr(row.FNR, normalizeFnrKey)
    }
  })
}

/** Check if property already exists in selection (by FNR) */
export const isDuplicateProperty = (
  fnr: string | number,
  existingProperties: Array<{ FNR: string | number }>
): boolean => {
  const fnrKey = normalizeFnrKey(fnr)
  return existingProperties.some((p) => normalizeFnrKey(p.FNR) === fnrKey)
}

/** Determine if clicking property should remove it (toggle behavior) */
export const shouldToggleRemove = (
  fnr: string | number,
  existingProperties: Array<{ FNR: string | number }>,
  toggleEnabled: boolean
): boolean => {
  return toggleEnabled && isDuplicateProperty(fnr, existingProperties)
}

/** Calculate updated property list with toggle logic and max results enforcement */
export const calculatePropertyUpdates = <
  T extends {
    FNR: string | number
    id: string
  },
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

const validatePropertyFeature = (
  propertyResult: any,
  extractFnr: (attrs: any) => string | number | null
): { fnr: string | number; attrs: any; graphic: __esri.Graphic } | null => {
  console.log("validatePropertyFeature input:", {
    hasPropertyResult: !!propertyResult,
    hasFeatures: !!propertyResult?.features,
    featuresLength: propertyResult?.features?.length,
    firstFeature: propertyResult?.features?.[0],
  })

  const graphic = propertyResult.features?.[0]
  if (!graphic?.attributes || !graphic?.geometry) {
    console.log("validatePropertyFeature failed:", {
      hasGraphic: !!graphic,
      hasAttributes: !!graphic?.attributes,
      hasGeometry: !!graphic?.geometry,
    })
    return null
  }

  const attrKeys = Object.keys(graphic.attributes)
  console.log("validatePropertyFeature attributes:", {
    attributeKeys: attrKeys,
    allAttributes: graphic.attributes,
    attributePairs: attrKeys.map((k) => `${k}: ${graphic.attributes[k]}`),
  })

  const fnr = extractFnr(graphic.attributes)
  if (!fnr) {
    console.log("validatePropertyFeature: FNR extraction failed", {
      hasAttributes: !!graphic.attributes,
      FNR: graphic.attributes.FNR,
      fnr: graphic.attributes.fnr,
      allKeys: attrKeys,
    })
    return null
  }

  console.log("validatePropertyFeature success:", { fnr })
  return { fnr, attrs: graphic.attributes, graphic }
}

const validateAndDeduplicateProperties = (
  propertyResults: any[],
  extractFnr: (attrs: any) => string | number | null,
  maxResults?: number
): Array<{ fnr: string | number; attrs: any; graphic: __esri.Graphic }> => {
  const processedFnrs = new Set<string>()
  const validatedProperties: Array<{
    fnr: string | number
    attrs: any
    graphic: __esri.Graphic
  }> = []

  for (const propertyResult of propertyResults) {
    const validated = validatePropertyFeature(propertyResult, extractFnr)
    if (!validated) {
      continue
    }
    const fnrKey = normalizeFnrKey(validated.fnr)
    if (processedFnrs.has(fnrKey)) {
      continue
    }
    processedFnrs.add(fnrKey)
    validatedProperties.push(validated)
    if (maxResults && validatedProperties.length >= maxResults) break
  }

  return validatedProperties
}

const fetchOwnerDataForProperty = async (params: {
  fnr: string | number
  config: { ownerDataSourceId: string }
  dsManager: any
  signal?: AbortSignal
  helpers: {
    queryOwnerByFnr: (
      fnr: string | number,
      dataSourceId: string,
      dsManager: any,
      options?: { signal?: AbortSignal }
    ) => Promise<__esri.Graphic[]>
    isAbortError: (error: any) => boolean
  }
}): Promise<{ ownerFeatures: __esri.Graphic[]; queryFailed: boolean }> => {
  const { fnr, config, dsManager, signal, helpers } = params

  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const ownerFeatures = await helpers.queryOwnerByFnr(
      fnr,
      config.ownerDataSourceId,
      dsManager,
      { signal }
    )
    return { ownerFeatures, queryFailed: false }
  } catch (error) {
    if (helpers.isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error))
    }
    return { ownerFeatures: [], queryFailed: true }
  }
}

const processBatchOfProperties = async (params: {
  batch: Array<{ fnr: string | number; attrs: any; graphic: __esri.Graphic }>
  config: { ownerDataSourceId: string; enablePIIMasking: boolean }
  dsManager: any
  maxResults: number
  currentRowCount: number
  signal?: AbortSignal
  helpers: {
    queryOwnerByFnr: (
      fnr: string | number,
      dataSourceId: string,
      dsManager: any,
      options?: { signal?: AbortSignal }
    ) => Promise<__esri.Graphic[]>
    isAbortError: (error: any) => boolean
    createRowId: (fnr: string | number, objectId: number) => string
    formatPropertyWithShare: (property: string, share?: string) => string
    formatOwnerInfo: (
      owner: any,
      maskPII: boolean,
      unknownOwnerText: string
    ) => string
  }
  messages: {
    unknownOwner: string
    errorOwnerQueryFailed: string
    errorNoDataAvailable: string
  }
}): Promise<{
  rows: GridRowData[]
  graphics: Array<{ graphic: __esri.Graphic; fnr: string | number }>
}> => {
  const {
    batch,
    config,
    dsManager,
    maxResults,
    currentRowCount,
    signal,
    helpers,
    messages,
  } = params

  // Use promiseUtils.eachAlways for ArcGIS API-aligned promise handling
  const [promiseUtils] = await loadArcGISJSAPIModules([
    "esri/core/promiseUtils",
  ])

  const ownerData = await promiseUtils.eachAlways(
    batch.map((validated) =>
      fetchOwnerDataForProperty({
        fnr: validated.fnr,
        config: { ownerDataSourceId: config.ownerDataSourceId },
        dsManager,
        signal,
        helpers: {
          queryOwnerByFnr: helpers.queryOwnerByFnr,
          isAbortError: helpers.isAbortError,
        },
      }).then((result) => ({
        ...result,
        validated,
      }))
    )
  )

  const rows: GridRowData[] = []
  const graphics: Array<{ graphic: __esri.Graphic; fnr: string | number }> = []

  for (let i = 0; i < ownerData.length; i++) {
    const result = ownerData[i]
    const validated = batch[i]

    // Handle eachAlways result structure: { promise, value?, error? }
    if (result.error) {
      // Skip aborted queries, but create fallback rows for other failures
      if (helpers.isAbortError(result.error)) {
        continue
      }
      console.log("Owner query failed for property:", {
        fnr: validated.fnr,
        fastighet: validated.attrs?.FASTIGHET,
        error: result.error,
        errorMessage:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      })

      if (currentRowCount + rows.length >= maxResults) break

      const propertyRows = buildPropertyRows({
        fnr: validated.fnr,
        propertyAttrs: validated.attrs,
        ownerFeatures: [],
        queryFailed: true,
        propertyGraphic: validated.graphic,
        config: { enablePIIMasking: config.enablePIIMasking },
        helpers: {
          createRowId: helpers.createRowId,
          formatPropertyWithShare: helpers.formatPropertyWithShare,
          formatOwnerInfo: helpers.formatOwnerInfo,
        },
        messages,
      })

      const remaining = maxResults - (currentRowCount + rows.length)
      const rowsToAdd = propertyRows.slice(0, remaining)
      rows.push(...rowsToAdd)

      if (rowsToAdd.length > 0) {
        graphics.push({ graphic: validated.graphic, fnr: validated.fnr })
      }
      continue
    }

    // Validate value exists before destructuring
    if (!result.value) {
      console.log("Owner query returned no value for batch item")
      continue
    }

    const {
      validated: validatedFromValue,
      ownerFeatures,
      queryFailed,
    } = result.value
    if (currentRowCount + rows.length >= maxResults) break

    const propertyRows = buildPropertyRows({
      fnr: validatedFromValue.fnr,
      propertyAttrs: validatedFromValue.attrs,
      ownerFeatures,
      queryFailed,
      propertyGraphic: validatedFromValue.graphic,
      config: { enablePIIMasking: config.enablePIIMasking },
      helpers: {
        createRowId: helpers.createRowId,
        formatPropertyWithShare: helpers.formatPropertyWithShare,
        formatOwnerInfo: helpers.formatOwnerInfo,
      },
      messages,
    })

    const remaining = maxResults - (currentRowCount + rows.length)
    const rowsToAdd = propertyRows.slice(0, remaining)
    rows.push(...rowsToAdd)

    if (rowsToAdd.length > 0) {
      graphics.push({ graphic: validated.graphic, fnr: validated.fnr })
    }
  }

  return { rows, graphics }
}

const createGridRow = (params: {
  fnr: string | number
  objectId: number
  uuidFastighet: string
  fastighet: string
  bostadr: string
  graphic: __esri.Graphic
  createRowId: (fnr: string | number, objectId: number) => string
  rawOwner?: OwnerAttributes
}): GridRowData => ({
  id: params.createRowId(params.fnr, params.objectId),
  FNR: params.fnr,
  UUID_FASTIGHET: params.uuidFastighet,
  FASTIGHET: params.fastighet,
  BOSTADR: params.bostadr,
  graphic: params.graphic,
  rawOwner: params.rawOwner,
})

const buildPropertyRows = (params: {
  fnr: string | number
  propertyAttrs: any
  ownerFeatures: __esri.Graphic[]
  queryFailed: boolean
  propertyGraphic: __esri.Graphic
  config: { enablePIIMasking: boolean }
  helpers: {
    createRowId: (fnr: string | number, objectId: number) => string
    formatPropertyWithShare: (property: string, share?: string) => string
    formatOwnerInfo: (
      owner: any,
      maskPII: boolean,
      unknownOwnerText: string
    ) => string
  }
  messages: {
    unknownOwner: string
    errorOwnerQueryFailed: string
    errorNoDataAvailable: string
  }
}): GridRowData[] => {
  const {
    fnr,
    propertyAttrs,
    ownerFeatures,
    queryFailed,
    propertyGraphic,
    config,
    helpers,
    messages,
  } = params

  if (ownerFeatures.length > 0) {
    return ownerFeatures.map((ownerFeature) => {
      const attrs = ownerFeature.attributes || ownerFeature
      if (!attrs) {
        console.error("Owner feature has no attributes:", {
          ownerFeature,
          featureKeys: Object.keys(ownerFeature || {}),
        })
      }
      return createGridRow({
        fnr,
        objectId: attrs?.OBJECTID || 0,
        uuidFastighet: attrs?.UUID_FASTIGHET || "",
        fastighet: helpers.formatPropertyWithShare(
          attrs?.FASTIGHET || "",
          attrs?.ANDEL || ""
        ),
        bostadr: helpers.formatOwnerInfo(
          attrs,
          config.enablePIIMasking,
          messages.unknownOwner
        ),
        graphic: propertyGraphic,
        createRowId: helpers.createRowId,
        rawOwner: attrs as OwnerAttributes,
      })
    })
  }

  // When no owner features found, show appropriate message based on whether query failed
  const fallbackMessage = queryFailed
    ? messages.errorOwnerQueryFailed
    : messages.unknownOwner

  const fallbackOwner = {
    NAMN: fallbackMessage,
    BOSTADR: "",
    POSTNR: "",
    POSTADR: "",
    ORGNR: "",
    FNR: fnr,
  } as OwnerAttributes

  return [
    createGridRow({
      fnr,
      objectId: propertyAttrs.OBJECTID,
      uuidFastighet: propertyAttrs.UUID_FASTIGHET,
      fastighet: propertyAttrs.FASTIGHET,
      bostadr: fallbackMessage,
      graphic: propertyGraphic,
      createRowId: helpers.createRowId,
      rawOwner: fallbackOwner,
    }),
  ]
}

/** Process property results using batch relationship query (performance optimized) */
export const processPropertyResultsWithBatchQuery = async (params: {
  propertyResults: any[]
  config: {
    propertyDataSourceId: string
    ownerDataSourceId: string
    enablePIIMasking: boolean
    relationshipId: number
  }
  dsManager: any
  maxResults: number
  signal?: AbortSignal
  helpers: {
    extractFnr: (attrs: any) => string | number | null
    queryOwnersByRelationship: (
      propertyFnrs: Array<string | number>,
      propertyDataSourceId: string,
      ownerDataSourceId: string,
      dsManager: any,
      relationshipId: number,
      options?: { signal?: AbortSignal }
    ) => Promise<Map<string, any[]>>
    createRowId: (fnr: string | number, objectId: number) => string
    formatPropertyWithShare: (property: string, share?: string) => string
    formatOwnerInfo: (
      owner: any,
      maskPII: boolean,
      unknownOwnerText: string
    ) => string
    isAbortError: (error: any) => boolean
  }
  messages: {
    unknownOwner: string
    errorOwnerQueryFailed: string
    errorNoDataAvailable: string
  }
}): Promise<ProcessPropertyResult> => {
  const {
    propertyResults,
    config,
    dsManager,
    maxResults,
    helpers,
    messages,
    signal,
  } = params

  const graphicsToAdd: Array<{
    graphic: __esri.Graphic
    fnr: string | number
  }> = []
  const rowsToProcess: GridRowData[] = []

  const validatedProperties = validateAndDeduplicateProperties(
    propertyResults,
    helpers.extractFnr,
    maxResults
  )

  if (validatedProperties.length === 0) {
    return { rowsToProcess: [], graphicsToAdd: [] }
  }

  const fnrsToQuery = validatedProperties.map((p) => p.fnr)

  let ownersByFnr: Map<string, any[]>
  const failedFnrs = new Set<string>()
  try {
    ownersByFnr = await helpers.queryOwnersByRelationship(
      fnrsToQuery,
      config.propertyDataSourceId,
      config.ownerDataSourceId,
      dsManager,
      config.relationshipId,
      { signal }
    )
  } catch (error) {
    if (helpers.isAbortError(error)) {
      throw error as Error
    }
    console.error("Batch owner query failed:", error)
    ownersByFnr = new Map()
    fnrsToQuery.forEach((fnr) => failedFnrs.add(String(fnr)))
  }

  for (const { fnr, attrs, graphic } of validatedProperties) {
    const owners = ownersByFnr.get(String(fnr)) || []

    if (owners.length > 0) {
      for (const owner of owners) {
        const formattedOwner = helpers.formatOwnerInfo(
          owner,
          config.enablePIIMasking,
          messages.unknownOwner
        )
        const propertyWithShare = helpers.formatPropertyWithShare(
          attrs.FASTIGHET,
          owner.ANDEL
        )

        rowsToProcess.push(
          createGridRow({
            fnr,
            objectId: attrs.OBJECTID,
            uuidFastighet: attrs.UUID_FASTIGHET,
            fastighet: propertyWithShare,
            bostadr: formattedOwner,
            graphic,
            createRowId: helpers.createRowId,
            rawOwner: owner as OwnerAttributes,
          })
        )
      }
    } else {
      const fallbackMessage = failedFnrs.has(String(fnr))
        ? messages.errorOwnerQueryFailed
        : messages.unknownOwner
      const fallbackOwner = {
        NAMN: fallbackMessage,
        BOSTADR: "",
        POSTNR: "",
        POSTADR: "",
        ORGNR: "",
        FNR: fnr,
      } as OwnerAttributes
      rowsToProcess.push(
        createGridRow({
          fnr,
          objectId: attrs.OBJECTID,
          uuidFastighet: attrs.UUID_FASTIGHET,
          fastighet: attrs.FASTIGHET,
          bostadr: fallbackMessage,
          graphic,
          createRowId: helpers.createRowId,
          rawOwner: fallbackOwner,
        })
      )
    }

    graphicsToAdd.push({ graphic, fnr })
  }

  return { rowsToProcess, graphicsToAdd }
}

/** Process property results using individual owner queries (fallback method) */
export const processPropertyResults = async (params: {
  propertyResults: any[]
  config: {
    ownerDataSourceId: string
    enablePIIMasking: boolean
  }
  dsManager: any
  maxResults: number
  signal?: AbortSignal
  helpers: {
    extractFnr: (attrs: any) => string | number | null
    queryOwnerByFnr: (
      fnr: string | number,
      dataSourceId: string,
      dsManager: any,
      options?: { signal?: AbortSignal }
    ) => Promise<__esri.Graphic[]>
    createRowId: (fnr: string | number, objectId: number) => string
    formatPropertyWithShare: (property: string, share?: string) => string
    formatOwnerInfo: (
      owner: any,
      maskPII: boolean,
      unknownOwnerText: string
    ) => string
    isAbortError: (error: any) => boolean
  }
  messages: {
    unknownOwner: string
    errorOwnerQueryFailed: string
    errorNoDataAvailable: string
  }
}): Promise<ProcessPropertyResult> => {
  const {
    propertyResults,
    config,
    dsManager,
    maxResults,
    helpers,
    messages,
    signal,
  } = params

  const graphicsToAdd: Array<{
    graphic: __esri.Graphic
    fnr: string | number
  }> = []
  const rowsToProcess: GridRowData[] = []

  const validatedProperties = validateAndDeduplicateProperties(
    propertyResults,
    helpers.extractFnr
  )

  for (let index = 0; index < validatedProperties.length; ) {
    const remainingSlots = maxResults - rowsToProcess.length
    if (remainingSlots <= 0) break

    const batchSize = Math.min(
      remainingSlots,
      OWNER_QUERY_CONCURRENCY,
      validatedProperties.length - index
    )

    const batch = validatedProperties.slice(index, index + batchSize)

    const { rows, graphics } = await processBatchOfProperties({
      batch,
      config: {
        ownerDataSourceId: config.ownerDataSourceId,
        enablePIIMasking: config.enablePIIMasking,
      },
      dsManager,
      maxResults,
      currentRowCount: rowsToProcess.length,
      signal,
      helpers: {
        queryOwnerByFnr: helpers.queryOwnerByFnr,
        isAbortError: helpers.isAbortError,
        createRowId: helpers.createRowId,
        formatPropertyWithShare: helpers.formatPropertyWithShare,
        formatOwnerInfo: helpers.formatOwnerInfo,
      },
      messages,
    })

    rowsToProcess.push(...rows)
    graphicsToAdd.push(...graphics)

    index += batchSize
  }

  return { rowsToProcess, graphicsToAdd }
}

/** Validate map click event has required modules and geometry */
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

/** Synchronize map graphics layer with current selection state */
export const syncGraphicsWithState = (params: {
  graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: string | number }>
  selectedRows: Array<{ FNR: string | number }>
  view: __esri.MapView | null | undefined
  helpers: {
    addGraphicsToMap: (
      graphic: __esri.Graphic,
      view: __esri.MapView,
      extractFnr: (attrs: any) => string | number | null,
      normalizeFnrKey: (fnr: any) => string,
      highlightColor: [number, number, number, number],
      outlineWidth: number
    ) => void
    extractFnr: (attrs: any) => string | number | null
    normalizeFnrKey: (fnr: any) => string
  }
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
    if (!selectedFnrs.has(fnrKey)) {
      return
    }

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

// Re-export type guards from types module for convenience
export { isValidationSuccess, isValidationFailure } from "../config/types"

// Manage suppression of popups on MapView instances
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
