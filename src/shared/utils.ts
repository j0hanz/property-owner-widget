import type {
  OwnerAttributes,
  ProcessPropertyResult,
  GridRowData,
} from "../config/types"
import type { DataSourceManager, FeatureLayerDataSource } from "jimu-core"
import { loadArcGISJSAPIModules } from "jimu-arcgis"
import {
  MIN_MASK_LENGTH,
  MAX_MASK_ASTERISKS,
  OWNER_QUERY_CONCURRENCY,
} from "../config/constants"

const stripHtml = (str: string): string => {
  if (!str) return ""
  // Use DOMParser to safely parse and extract text content
  const doc = new DOMParser().parseFromString(str, "text/html")
  return doc.body.textContent || ""
}

export const maskName = (name: string): string => {
  // Strip HTML first for security
  const stripped = stripHtml(name)
  // Normalize whitespace including non-breaking spaces, tabs, zero-width spaces
  const normalized = stripped?.replace(/[\s\u00A0\u200B]+/g, " ").trim() || ""
  if (normalized.length < MIN_MASK_LENGTH) return "***"
  const parts = normalized.split(" ")
  return parts
    .map((part) =>
      part.length > 0
        ? `${part.charAt(0)}${"*".repeat(Math.min(MAX_MASK_ASTERISKS, part.length - 1))}`
        : ""
    )
    .filter(Boolean)
    .join(" ")
}

export const maskAddress = (address: string): string => {
  // Strip HTML first for security
  const stripped = stripHtml(address)
  const normalized = stripped?.replace(/[\s\u00A0\u200B]+/g, " ").trim() || ""
  if (normalized.length < MIN_MASK_LENGTH) return "***"
  // Show only first 2 characters of address for privacy
  return `${normalized.substring(0, 2)}${"*".repeat(Math.min(5, normalized.length - 2))}`
}

export const formatOwnerInfo = (
  owner: OwnerAttributes,
  maskPII: boolean,
  unknownOwnerText: string
): string => {
  const rawName = stripHtml(owner.NAMN?.trim?.() || unknownOwnerText)
  const namePart =
    maskPII && rawName !== unknownOwnerText ? maskName(rawName) : rawName
  const rawAddress = stripHtml(owner.BOSTADR?.trim?.() || "")
  const addressPart =
    maskPII && rawAddress ? maskAddress(rawAddress) : rawAddress
  const postalCode = stripHtml(owner.POSTNR?.replace(/\s+/g, "") || "")
  const city = stripHtml(owner.POSTADR?.trim?.() || "")
  // Organization numbers are public records in Sweden, no masking needed
  const trimmedOrgNr = stripHtml(owner.ORGNR?.trim?.() || "")
  const orgNrSuffix = trimmedOrgNr ? ` (${trimmedOrgNr})` : ""

  const parts = [
    namePart,
    addressPart,
    postalCode && city ? `${postalCode} ${city}` : postalCode || city,
  ].filter(Boolean)

  return parts.join(", ") + orgNrSuffix
}

export const formatPropertyWithShare = (
  property: string,
  share?: string
): string => {
  const trimmedShare = share?.trim?.()
  return trimmedShare ? `${property} (${trimmedShare})` : property
}

export const createRowId = (fnr: string | number, objectId: number): string =>
  `${fnr}_${objectId}`

export const isValidArcGISUrl = (
  url: string,
  allowedHosts?: readonly string[]
): boolean => {
  try {
    const parsed = new URL(url)

    // Reject localhost and private IP ranges for security
    const hostname = parsed.hostname.toLowerCase()
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^192\.168\./.test(hostname)
    ) {
      return false
    }

    // Enforce HTTPS only for security.
    const protocolValid = parsed.protocol === "https:"
    // Validate standard HTTPS port (443) or no explicit port.
    const portValid = parsed.port === "" || parsed.port === "443"
    // Validate path ends with MapServer or FeatureServer and required layer ID or /query endpoint.
    const pathValid = /\/(MapServer|FeatureServer)\/\d+(\/query)?$/.test(
      parsed.pathname
    )
    // Check host allowlist if provided.
    const hostValid =
      !allowedHosts ||
      allowedHosts.length === 0 ||
      allowedHosts.some(
        (h) => parsed.hostname === h || parsed.hostname.endsWith("." + h)
      )
    return protocolValid && portValid && pathValid && hostValid
  } catch (_error) {
    return false
  }
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

  // Reject empty or whitespace-only strings
  if (sanitized.trim().length === 0) {
    throw new Error("Invalid FNR: cannot be empty or whitespace-only")
  }

  return `FNR = '${sanitized}'`
}

export const extractFnr = (
  attributes: { [key: string]: any } | null | undefined
): string | number | null => {
  if (!attributes) return null
  const value = attributes.FNR || attributes.fnr || null
  return value
}

export const normalizeFnrKey = (
  fnr: string | number | null | undefined
): string => {
  return fnr != null ? String(fnr) : ""
}

export const isAbortError = (error: any): boolean => {
  if (!error) return false
  if (error.name === "AbortError") return true
  if (
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("abort")
  ) {
    return true
  }
  return false
}

export const parseArcGISError = (
  error: any,
  defaultMessage: string
): string => {
  if (!error) {
    return defaultMessage
  }

  if (typeof error === "string") {
    return error
  }

  if (error.details?.message) {
    return error.details.message
  }

  if (error.message) {
    return error.message
  }

  return defaultMessage
}

const getDataSourceUrl = (
  dataSource: FeatureLayerDataSource | null | undefined
): string | null => {
  if (!dataSource) return null

  const layerDefinition = dataSource.getLayerDefinition?.()
  const definitionUrl =
    layerDefinition && typeof layerDefinition === "object"
      ? (layerDefinition as { url?: string }).url
      : undefined
  if (typeof definitionUrl === "string" && definitionUrl.length > 0) {
    return definitionUrl
  }

  const dataSourceJson = dataSource.getDataSourceJson?.()
  const jsonUrl =
    dataSourceJson && typeof dataSourceJson === "object"
      ? (dataSourceJson as { url?: string }).url
      : undefined
  if (typeof jsonUrl === "string" && jsonUrl.length > 0) {
    return jsonUrl
  }

  const sourceUrl = (dataSource as any)?.url || (dataSource as any)?.layer?.url
  return sourceUrl || null
}

export const validateDataSources = (params: {
  propertyDsId: string | undefined
  ownerDsId: string | undefined
  dsManager: DataSourceManager | null
  allowedHosts?: readonly string[]
  translate: (key: string) => string
}):
  | { valid: true; manager: DataSourceManager }
  | {
      valid: false
      error: { type: any; message: string }
      failureReason: string
    } => {
  const { propertyDsId, ownerDsId, dsManager, allowedHosts, translate } = params

  if (!propertyDsId || !ownerDsId) {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR" as const,
        message: translate("errorNoDataAvailable"),
      },
      failureReason: "missing_data_sources",
    }
  }

  if (!dsManager) {
    return {
      valid: false,
      error: {
        type: "QUERY_ERROR" as const,
        message: translate("errorQueryFailed"),
      },
      failureReason: "no_data_source_manager",
    }
  }

  const propertyDs = dsManager.getDataSource(
    propertyDsId
  ) as FeatureLayerDataSource | null
  const ownerDs = dsManager.getDataSource(
    ownerDsId
  ) as FeatureLayerDataSource | null

  if (!propertyDs || !ownerDs) {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR" as const,
        message: translate("errorNoDataAvailable"),
      },
      failureReason: "missing_data_source_instance",
    }
  }

  // Validate data source type supports querying
  if (typeof propertyDs.query !== "function") {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR" as const,
        message: translate("errorNoDataAvailable"),
      },
      failureReason: "property_ds_not_queryable",
    }
  }

  if (typeof ownerDs.query !== "function") {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR" as const,
        message: translate("errorNoDataAvailable"),
      },
      failureReason: "owner_ds_not_queryable",
    }
  }

  const normalizedHosts = allowedHosts
    ?.map((host) => host.trim())
    .filter((host) => host.length > 0)

  const propertyUrl = getDataSourceUrl(propertyDs)
  if (
    !propertyUrl ||
    !isValidArcGISUrl(
      propertyUrl,
      normalizedHosts && normalizedHosts.length > 0
        ? normalizedHosts
        : undefined
    )
  ) {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR" as const,
        message: translate("errorHostNotAllowed"),
      },
      failureReason: "property_disallowed_host",
    }
  }

  const ownerUrl = getDataSourceUrl(ownerDs)
  if (
    !ownerUrl ||
    !isValidArcGISUrl(
      ownerUrl,
      normalizedHosts && normalizedHosts.length > 0
        ? normalizedHosts
        : undefined
    )
  ) {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR" as const,
        message: translate("errorHostNotAllowed"),
      },
      failureReason: "owner_disallowed_host",
    }
  }

  return { valid: true, manager: dsManager }
}

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

export const isDuplicateProperty = (
  fnr: string | number,
  existingProperties: Array<{ FNR: string | number }>
): boolean => {
  const fnrKey = String(fnr)
  return existingProperties.some((p) => String(p.FNR) === fnrKey)
}

export const shouldToggleRemove = (
  fnr: string | number,
  existingProperties: Array<{ FNR: string | number }>,
  toggleEnabled: boolean
): boolean => {
  return toggleEnabled && isDuplicateProperty(fnr, existingProperties)
}

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
  const propertyGraphic = propertyResult.features?.[0]
  if (!propertyGraphic?.attributes) return null

  // Validate graphic has required geometry
  if (!propertyGraphic.geometry) return null

  const propertyAttrs = propertyGraphic.attributes
  const fnr = extractFnr(propertyAttrs)
  if (!fnr) return null

  return { fnr, attrs: propertyAttrs, graphic: propertyGraphic }
}

const fetchOwnerDataForProperty = async (params: {
  fnr: string | number
  config: {
    ownerDataSourceId: string
  }
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
  let ownerFeatures: __esri.Graphic[] = []
  let queryFailed = false

  try {
    if (signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }
    ownerFeatures = await helpers.queryOwnerByFnr(
      fnr,
      config.ownerDataSourceId,
      dsManager,
      { signal }
    )
  } catch (ownerError) {
    if (helpers.isAbortError(ownerError)) {
      throw ownerError instanceof Error
        ? ownerError
        : new Error(String(ownerError))
    }
    queryFailed = true
  }

  return { ownerFeatures, queryFailed }
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

  for (const result of ownerData) {
    // Handle eachAlways result structure: { promise, value?, error? }
    if (result.error) {
      // Skip aborted queries, log other failures
      if (!helpers.isAbortError(result.error)) {
        console.log("Owner query failed for batch item:", result.error)
      }
      continue
    }

    const { validated, ownerFeatures, queryFailed } = result.value
    if (currentRowCount + rows.length >= maxResults) break

    const propertyRows = buildPropertyRows({
      fnr: validated.fnr,
      propertyAttrs: validated.attrs,
      ownerFeatures,
      queryFailed,
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
  }

  return { rows, graphics }
}

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
      const ownerAttrs = ownerFeature.attributes
      return {
        id: helpers.createRowId(fnr, ownerAttrs.OBJECTID),
        FNR: fnr,
        UUID_FASTIGHET: ownerAttrs.UUID_FASTIGHET,
        FASTIGHET: helpers.formatPropertyWithShare(
          ownerAttrs.FASTIGHET,
          ownerAttrs.ANDEL || ""
        ),
        BOSTADR: helpers.formatOwnerInfo(
          ownerAttrs,
          config.enablePIIMasking,
          messages.unknownOwner
        ),
        graphic: propertyGraphic,
      }
    })
  }

  return [
    {
      id: helpers.createRowId(fnr, propertyAttrs.OBJECTID),
      FNR: fnr,
      UUID_FASTIGHET: propertyAttrs.UUID_FASTIGHET,
      FASTIGHET: propertyAttrs.FASTIGHET,
      BOSTADR: queryFailed
        ? messages.errorOwnerQueryFailed
        : messages.errorNoDataAvailable,
      graphic: propertyGraphic,
    },
  ]
}

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
  const processedFnrs = new Set<string | number>()
  const validatedProperties: Array<{
    fnr: string | number
    attrs: any
    graphic: __esri.Graphic
  }> = []

  for (const propertyResult of propertyResults) {
    const validated = validatePropertyFeature(
      propertyResult,
      helpers.extractFnr
    )
    if (validated && !processedFnrs.has(validated.fnr)) {
      processedFnrs.add(validated.fnr)
      validatedProperties.push(validated)
    }
  }

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

export const validateMapClickInputs = (
  event: any,
  modules: any,
  config: any,
  translate: (key: string) => string
):
  | { valid: true; mapPoint: __esri.Point }
  | { valid: false; error: { type: any; message: string } } => {
  if (!modules) {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR",
        message: translate("errorLoadingModules"),
      },
    }
  }

  const mapPoint = event?.mapPoint
  if (!mapPoint) {
    return {
      valid: false,
      error: { type: "GEOMETRY_ERROR", message: translate("errorNoMapPoint") },
    }
  }

  return { valid: true, mapPoint }
}

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
