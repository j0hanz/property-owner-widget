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
} from "../config/types"
import { buildFnrWhereClause, parseArcGISError, isAbortError } from "./utils"

const createSignalOptions = (signal?: AbortSignal): any => {
  return signal ? { signal } : undefined
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
      if (geom && geom.extent) {
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

    if (options?.signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      throw abortError
    }

    if (!propertyResult?.records || propertyResult.records.length === 0) {
      return new Map()
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
