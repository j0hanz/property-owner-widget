import type {
  DataSourceManager,
  FeatureLayerDataSource,
  FeatureDataRecord,
} from "jimu-core"
import { loadArcGISJSAPIModules } from "jimu-arcgis"
import type {
  PropertyAttributes,
  OwnerAttributes,
  QueryResult,
  ProcessPropertyResult,
  GridRowData,
  PropertyProcessingContext,
  PropertyBatchQueryParams,
  PropertyIndividualQueryParams,
  ValidationResult,
} from "../config/types"
import { isValidationFailure } from "../config/types"
import {
  buildFnrWhereClause,
  parseArcGISError,
  isAbortError,
  ownerIdentity,
  normalizeFnrKey,
} from "./utils"
import { OWNER_QUERY_CONCURRENCY } from "../config/constants"

const createSignalOptions = (signal?: AbortSignal): any => {
  return signal ? { signal } : undefined
}

// =============================================================================
// URL AND DATASOURCE VALIDATION HELPERS
// =============================================================================

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

const isValidHttpsUrl = (parsed: URL): boolean => {
  return (
    parsed.protocol === "https:" &&
    (parsed.port === "" || parsed.port === "443")
  )
}

const isValidArcGISPath = (pathname: string): boolean => {
  return /\/(MapServer|FeatureServer)\/\d+(\/query)?$/.test(pathname)
}

const isHostAllowed = (
  hostname: string,
  allowedHosts?: readonly string[]
): boolean => {
  if (!allowedHosts || allowedHosts.length === 0) return true
  return allowedHosts.some((host) => {
    if (hostname === host) return true
    const suffix = `.${host}`
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

  if (!propertyDs || !ownerDs) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "missing_data_source_instance"
    )
  }

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

export const queryPropertyByPoint = async (
  point: __esri.Point,
  dataSourceId: string,
  dsManager: DataSourceManager,
  options?: { signal?: AbortSignal }
): Promise<QueryResult[]> => {
  try {
    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    const ds = dsManager.getDataSource(dataSourceId) as FeatureLayerDataSource
    if (!ds) {
      throw new Error("Property data source not found")
    }

    const layerUrl = ds.url
    if (!layerUrl) {
      throw new Error("Data source URL not available")
    }

    console.log("Querying layer:", {
      dataSourceId,
      url: layerUrl,
      pointX: point.x,
      pointY: point.y,
      wkid: point.spatialReference?.wkid,
    })

    // Load FeatureLayer and Query classes
    const [FeatureLayer, Query] = await loadArcGISJSAPIModules([
      "esri/layers/FeatureLayer",
      "esri/rest/support/Query",
    ])

    // Create a temporary FeatureLayer from the URL
    const layer = new FeatureLayer({
      url: layerUrl,
    })

    const query = new Query({
      geometry: point,
      returnGeometry: true,
      outFields: ["*"],
      spatialRelationship: "intersects",
    })

    const result = await layer.queryFeatures(
      query,
      createSignalOptions(options?.signal)
    )

    console.log("Query result:", {
      featureCount: result?.features?.length || 0,
      hasFeatures: !!(result?.features && result.features.length > 0),
      firstFeature: result?.features?.[0]?.attributes,
    })

    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    if (!result?.features || result.features.length === 0) {
      console.log("No features found at this location")
      return []
    }

    const mappedResults = result.features.map((feature: __esri.Graphic) => {
      return {
        features: [feature],
        propertyId: (feature.attributes as PropertyAttributes).FNR,
      }
    })

    console.log("Mapped results:", {
      count: mappedResults.length,
      propertyIds: mappedResults.map((r) => r.propertyId),
    })

    return mappedResults
  } catch (error) {
    if (isAbortError(error)) {
      throw error as Error
    }
    throw new Error(parseArcGISError(error, "Property query failed"))
  }
}

export const queryOwnerByFnr = async (
  fnr: string | number,
  dataSourceId: string,
  dsManager: DataSourceManager,
  options?: { signal?: AbortSignal }
): Promise<__esri.Graphic[]> => {
  try {
    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    const ds = dsManager.getDataSource(dataSourceId) as FeatureLayerDataSource
    if (!ds) {
      throw new Error("Owner data source not found")
    }

    const layerUrl = ds.url
    const layerDef = (ds as any).getLayerDefinition?.()
    console.log("Querying owner layer:", {
      dataSourceId,
      url: layerUrl,
      fnr,
      whereClause: buildFnrWhereClause(fnr),
      layerName: layerDef?.name || "unknown",
      layerFields: layerDef?.fields?.map((f: any) => f.name) || [],
    })

    const result = await ds.query(
      {
        where: buildFnrWhereClause(fnr),
        returnGeometry: false,
        outFields: ["*"],
      },
      createSignalOptions(options?.signal)
    )

    console.log("Owner query result:", {
      fnr,
      recordCount: result?.records?.length || 0,
      hasRecords: !!(result?.records && result.records.length > 0),
      firstRecord: result?.records?.[0]?.getData(),
    })

    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    if (!result?.records) {
      console.log("⚠️ Owner query returned no records:", {
        fnr,
        dataSourceId,
        url: layerUrl,
        possibleCause: "FNR not found in owner layer or wrong layer configured",
      })
      return []
    }

    if (result.records.length === 0) {
      console.log("⚠️ Owner query returned empty records array:", {
        fnr,
        dataSourceId,
        url: layerUrl,
        possibleCause: "No owner data for this FNR or querying wrong layer",
      })
    }

    return result.records.map((record: FeatureDataRecord) => {
      const data = record.getData()
      const graphic: any = {
        attributes: data, // The data IS the attributes
      }

      // Log ALL fields with their actual values to debug
      const allFields: any = {}
      Object.keys(data || {}).forEach((key) => {
        allFields[key] = data[key]
      })

      console.log("Owner record processed - ALL FIELDS:", {
        fnr,
        allFieldsWithValues: allFields,
        hasNAMN: "NAMN" in data,
        hasBOSTADR: "BOSTADR" in data,
        hasAGARLISTA: "AGARLISTA" in data,
        NAMNvalue: data.NAMN,
        BOSTADRvalue: data.BOSTADR,
        AGARLISTAvalue: data.AGARLISTA,
      })

      return graphic as __esri.Graphic
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error as Error
    }
    throw new Error(parseArcGISError(error, "Owner query failed"))
  }
}

export const clearQueryCache = () => {
  // Query caching has been disabled to ensure fresh results on every request
}

export const queryExtentForProperties = async (
  fnrs: Array<string | number>,
  dataSourceId: string,
  dsManager: DataSourceManager,
  options?: { signal?: AbortSignal }
): Promise<__esri.Extent | null> => {
  try {
    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    if (!fnrs || fnrs.length === 0) {
      return null
    }

    const ds = dsManager.getDataSource(dataSourceId) as FeatureLayerDataSource
    if (!ds) {
      throw new Error("Property data source not found")
    }

    const whereClause = fnrs.map((fnr) => buildFnrWhereClause(fnr)).join(" OR ")

    const result = await ds.query(
      {
        where: whereClause,
        returnGeometry: true,
        outFields: ["FNR"],
      },
      createSignalOptions(options?.signal)
    )

    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    if (!result?.records || result.records.length === 0) {
      return null
    }

    let extent: __esri.Extent | null = null
    result.records.forEach((record: FeatureDataRecord) => {
      const feature = record.getData()
      const geom = feature.geometry as __esri.Geometry
      if (
        geom &&
        geom.extent !== undefined &&
        geom.extent !== null &&
        typeof geom.extent.clone === "function"
      ) {
        if (!extent) {
          extent = geom.extent.clone()
        } else {
          extent = extent.union(geom.extent)
        }
      }
    })

    return extent
  } catch (error) {
    if (isAbortError(error)) {
      throw error as Error
    }
    throw new Error(parseArcGISError(error, "Extent query failed"))
  }
}

export const queryOwnersByRelationship = async (
  propertyFnrs: Array<string | number>,
  propertyDataSourceId: string,
  ownerDataSourceId: string,
  dsManager: DataSourceManager,
  relationshipId: number,
  options?: { signal?: AbortSignal }
): Promise<Map<string, OwnerAttributes[]>> => {
  try {
    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    if (!propertyFnrs || propertyFnrs.length === 0) {
      return new Map()
    }

    const propertyDs = dsManager.getDataSource(
      propertyDataSourceId
    ) as FeatureLayerDataSource
    if (!propertyDs) {
      throw new Error("Property data source not found")
    }

    const layerDefinition = propertyDs.getLayerDefinition() as any
    const layerUrl = layerDefinition?.url

    if (!layerUrl) {
      throw new Error("Property layer URL not available")
    }

    const modules = await loadArcGISJSAPIModules([
      "esri/tasks/QueryTask",
      "esri/rest/support/RelationshipQuery",
    ])
    const [QueryTask, RelationshipQuery] = modules

    const queryTask = new QueryTask({ url: layerUrl })
    const relationshipQuery = new RelationshipQuery()

    const objectIds: number[] = []
    const fnrToObjectIdMap = new Map<number, string>()

    const propertyResult = await propertyDs.query(
      {
        where: propertyFnrs.map((fnr) => buildFnrWhereClause(fnr)).join(" OR "),
        outFields: ["FNR", "OBJECTID"],
        returnGeometry: false,
      },
      createSignalOptions(options?.signal)
    )

    // Check abort immediately after async operation
    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    if (!propertyResult?.records || propertyResult.records.length === 0) {
      return new Map()
    }

    // Check abort before processing records
    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    propertyResult.records.forEach((record: FeatureDataRecord) => {
      const data = record.getData()
      const objectId = data.OBJECTID as number
      const fnr = String(data.FNR)
      objectIds.push(objectId)
      fnrToObjectIdMap.set(objectId, fnr)
    })

    relationshipQuery.objectIds = objectIds
    relationshipQuery.relationshipId = relationshipId
    relationshipQuery.outFields = ["*"]

    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    const result = await queryTask.executeRelationshipQuery(
      relationshipQuery,
      createSignalOptions(options?.signal)
    )

    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    const ownersByFnr = new Map<string, OwnerAttributes[]>()

    objectIds.forEach((objectId) => {
      const relatedRecords = result[objectId]
      const fnr = fnrToObjectIdMap.get(objectId)

      if (fnr && relatedRecords && relatedRecords.features) {
        const owners = relatedRecords.features.map(
          (feature: __esri.Graphic) => feature.attributes as OwnerAttributes
        )
        ownersByFnr.set(fnr, owners)
      }
    })

    return ownersByFnr
  } catch (error) {
    if (isAbortError(error)) {
      throw error as Error
    }
    throw new Error(parseArcGISError(error, "Relationship query failed"))
  }
}

// =============================================================================
// PROPERTY OWNER PROCESSING SERVICE
// =============================================================================

const deduplicateOwnerEntries = (
  entries: Array<
    __esri.Graphic | OwnerAttributes | { attributes?: OwnerAttributes }
  >,
  context: { fnr: string | number; propertyId?: string }
): OwnerAttributes[] => {
  const seen = new Set<string>()
  const uniqueOwners: OwnerAttributes[] = []

  entries.forEach((entry, index) => {
    const attrs = (entry as __esri.Graphic)?.attributes
      ? ((entry as __esri.Graphic).attributes as OwnerAttributes)
      : (entry as OwnerAttributes)

    if (!attrs || typeof attrs !== "object") {
      return
    }

    const identityKey = ownerIdentity.buildKey(attrs, context, index)
    if (seen.has(identityKey)) {
      return
    }

    seen.add(identityKey)
    uniqueOwners.push(attrs)
  })

  return uniqueOwners
}

const validatePropertyFeature = (
  propertyResult: any,
  extractFnr: (attrs: any) => string | number | null
): { fnr: string | number; attrs: any; graphic: __esri.Graphic } | null => {
  const graphic = propertyResult?.features?.[0]
  if (!graphic?.attributes || !graphic?.geometry) {
    return null
  }

  const fnr = extractFnr(graphic.attributes)
  if (!fnr) {
    return null
  }

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

const fetchOwnerDataForProperty = async (
  fnr: string | number,
  context: PropertyProcessingContext,
  config: { ownerDataSourceId: string }
): Promise<{ ownerFeatures: __esri.Graphic[]; queryFailed: boolean }> => {
  const { dsManager, signal, helpers } = context

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

const buildPropertyRows = (options: {
  fnr: string | number
  propertyAttrs: any
  ownerFeatures: Array<OwnerAttributes | __esri.Graphic>
  queryFailed: boolean
  propertyGraphic: __esri.Graphic
  config: { enablePIIMasking: boolean }
  context: PropertyProcessingContext
}): GridRowData[] => {
  const {
    fnr,
    propertyAttrs,
    ownerFeatures,
    queryFailed,
    propertyGraphic,
    config,
    context,
  } = options

  if (ownerFeatures.length > 0) {
    const uniqueOwners = deduplicateOwnerEntries(ownerFeatures, {
      fnr,
      propertyId: propertyAttrs?.UUID_FASTIGHET,
    })

    return uniqueOwners.map((attrs) => {
      return createGridRow({
        fnr,
        objectId: attrs?.OBJECTID || 0,
        uuidFastighet: attrs?.UUID_FASTIGHET || "",
        fastighet: context.helpers.formatPropertyWithShare(
          attrs?.FASTIGHET || "",
          attrs?.ANDEL || ""
        ),
        bostadr: context.helpers.formatOwnerInfo(
          attrs,
          config.enablePIIMasking,
          context.messages.unknownOwner
        ),
        graphic: propertyGraphic,
        createRowId: context.helpers.createRowId,
        rawOwner: attrs,
      })
    })
  }

  const fallbackMessage = queryFailed
    ? context.messages.errorOwnerQueryFailed
    : context.messages.unknownOwner

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
      createRowId: context.helpers.createRowId,
      rawOwner: fallbackOwner,
    }),
  ]
}

const processBatchOfProperties = async (params: {
  batch: Array<{ fnr: string | number; attrs: any; graphic: __esri.Graphic }>
  currentRowCount: number
  context: PropertyProcessingContext
  config: { ownerDataSourceId: string; enablePIIMasking: boolean }
}): Promise<{
  rows: GridRowData[]
  graphics: Array<{ graphic: __esri.Graphic; fnr: string | number }>
}> => {
  const { batch, context, config, currentRowCount } = params
  const { maxResults, helpers } = context

  const [promiseUtils] = await loadArcGISJSAPIModules([
    "esri/core/promiseUtils",
  ])

  const ownerData = await promiseUtils.eachAlways(
    batch.map((validated) =>
      fetchOwnerDataForProperty(validated.fnr, context, config).then(
        (result) => ({
          ...result,
          validated,
        })
      )
    )
  )

  const rows: GridRowData[] = []
  const graphics: Array<{ graphic: __esri.Graphic; fnr: string | number }> = []

  for (let i = 0; i < ownerData.length; i++) {
    const result = ownerData[i]

    if (result.error) {
      if (helpers.isAbortError(result.error)) {
        continue
      }

      if (currentRowCount + rows.length >= maxResults) break

      // Use batch[i] for error case (no validated in error result)
      const validated = batch[i]
      const propertyRows = buildPropertyRows({
        fnr: validated.fnr,
        propertyAttrs: validated.attrs,
        ownerFeatures: [],
        queryFailed: true,
        propertyGraphic: validated.graphic,
        config: { enablePIIMasking: config.enablePIIMasking },
        context,
      })

      const remaining = maxResults - (currentRowCount + rows.length)
      const rowsToAdd = propertyRows.slice(0, remaining)
      rows.push(...rowsToAdd)

      if (rowsToAdd.length > 0) {
        graphics.push({ graphic: validated.graphic, fnr: validated.fnr })
      }
      continue
    }

    if (!result.value) {
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
      context,
    })

    const remaining = maxResults - (currentRowCount + rows.length)
    const rowsToAdd = propertyRows.slice(0, remaining)
    rows.push(...rowsToAdd)

    if (rowsToAdd.length > 0) {
      graphics.push({
        graphic: validatedFromValue.graphic,
        fnr: validatedFromValue.fnr,
      })
    }
  }

  return { rows, graphics }
}

const processBatchQuery = async (
  params: PropertyBatchQueryParams
): Promise<ProcessPropertyResult> => {
  const { propertyResults, config, context } = params
  const { helpers, maxResults } = context

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

  let ownersByFnr: Map<string, OwnerAttributes[]>
  const failedFnrs = new Set<string>()
  try {
    ownersByFnr = await helpers.queryOwnersByRelationship(
      fnrsToQuery,
      config.propertyDataSourceId,
      config.ownerDataSourceId,
      context.dsManager,
      config.relationshipId,
      { signal: context.signal }
    )
  } catch (error) {
    if (helpers.isAbortError(error)) {
      throw error as Error
    }
    console.error("Batch owner query failed for FNRs:", fnrsToQuery, error)
    ownersByFnr = new Map()
    fnrsToQuery.forEach((fnr) => failedFnrs.add(String(fnr)))
  }
  for (const { fnr, attrs, graphic } of validatedProperties) {
    const owners = ownersByFnr.get(String(fnr)) || []

    if (owners.length > 0) {
      const ownersToProcess = deduplicateOwnerEntries(owners, {
        fnr,
        propertyId: attrs.UUID_FASTIGHET,
      })

      for (const owner of ownersToProcess) {
        const formattedOwner = context.helpers.formatOwnerInfo(
          owner,
          config.enablePIIMasking,
          context.messages.unknownOwner
        )
        const propertyWithShare = context.helpers.formatPropertyWithShare(
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
            createRowId: context.helpers.createRowId,
            rawOwner: owner,
          })
        )
      }
    } else {
      const fallbackMessage = failedFnrs.has(String(fnr))
        ? context.messages.errorOwnerQueryFailed
        : context.messages.unknownOwner
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
          createRowId: context.helpers.createRowId,
          rawOwner: fallbackOwner,
        })
      )
    }

    graphicsToAdd.push({ graphic, fnr })
  }

  return { rowsToProcess, graphicsToAdd }
}

const processIndividualQuery = async (
  params: PropertyIndividualQueryParams
): Promise<ProcessPropertyResult> => {
  const { propertyResults, config, context } = params
  const { helpers, maxResults } = context

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
      currentRowCount: rowsToProcess.length,
      context,
      config: {
        ownerDataSourceId: config.ownerDataSourceId,
        enablePIIMasking: config.enablePIIMasking,
      },
    })

    rowsToProcess.push(...rows)
    graphicsToAdd.push(...graphics)

    index += batchSize
  }

  return { rowsToProcess, graphicsToAdd }
}

export const propertyQueryService = {
  processBatch: processBatchQuery,
  processIndividual: processIndividualQuery,
}

export const queryPropertiesInBuffer = async (
  point: __esri.Point,
  bufferDistance: number,
  bufferUnit: "meters" | "kilometers" | "feet" | "miles",
  dataSourceId: string,
  dsManager: DataSourceManager,
  options?: { signal?: AbortSignal }
): Promise<PropertyAttributes[]> => {
  try {
    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    const modules = await loadArcGISJSAPIModules([
      "esri/geometry/geometryEngine",
    ])
    const [geometryEngine] = modules

    const bufferGeometry = geometryEngine.buffer(
      point,
      bufferDistance,
      bufferUnit
    ) as __esri.Polygon

    if (!bufferGeometry) {
      throw new Error("Failed to create buffer geometry")
    }

    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    const ds = dsManager.getDataSource(dataSourceId) as FeatureLayerDataSource
    if (!ds) {
      throw new Error("Property data source not found")
    }

    const result = await ds.query(
      {
        geometry: bufferGeometry,
        spatialRel: "esriSpatialRelIntersects" as any,
        returnGeometry: true,
        outFields: ["*"],
      },
      createSignalOptions(options?.signal)
    )

    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    if (!result?.records || result.records.length === 0) {
      return []
    }

    return result.records.map(
      (record: FeatureDataRecord) => record.getData() as PropertyAttributes
    )
  } catch (error) {
    if (isAbortError(error)) {
      throw error as Error
    }
    throw new Error(parseArcGISError(error, "Buffer query failed"))
  }
}
