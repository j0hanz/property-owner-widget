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
  InflightQuery,
} from "../config/types"
import { buildFnrWhereClause, parseArcGISError, isAbortError } from "./utils"
import {
  QUERY_DEDUPLICATION_TIMEOUT,
  PROPERTY_QUERY_CACHE,
  OWNER_QUERY_CACHE,
} from "../config/constants"

const createQueryKey = (
  type: "property" | "owner",
  params: { [key: string]: any }
): string => {
  return `${type}:${JSON.stringify(params)}`
}

const getOrCreateQuery = <T>(
  cache: Map<string, InflightQuery>,
  key: string,
  queryFn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> => {
  const now = Date.now()
  const existing = cache.get(key)

  if (existing && now - existing.timestamp < QUERY_DEDUPLICATION_TIMEOUT) {
    if (signal?.aborted) {
      const abortError = new Error("AbortError")
      abortError.name = "AbortError"
      return Promise.reject(abortError)
    }
    return existing.promise as Promise<T>
  }

  const promise = queryFn()
    .catch((error) => {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error))
      throw normalizedError
    })
    .finally(() => {
      setTimeout(() => cache.delete(key), QUERY_DEDUPLICATION_TIMEOUT)
    })

  cache.set(key, { promise, timestamp: now })
  return promise
}

const createSignalOptions = (signal?: AbortSignal): any => {
  return signal ? { signal } : undefined
}

export const queryPropertyByPoint = async (
  point: __esri.Point,
  dataSourceId: string,
  dsManager: DataSourceManager,
  options?: { signal?: AbortSignal }
): Promise<QueryResult[]> => {
  const queryKey = createQueryKey("property", {
    x: Math.round(point.x * 100) / 100,
    y: Math.round(point.y * 100) / 100,
    wkid: point.spatialReference?.wkid,
    dsId: dataSourceId,
  })

  return getOrCreateQuery(
    PROPERTY_QUERY_CACHE,
    queryKey,
    async () => {
      try {
        if (options?.signal?.aborted) {
          const abortError = new Error("AbortError")
          abortError.name = "AbortError"
          throw abortError
        }

        const ds = dsManager.getDataSource(
          dataSourceId
        ) as FeatureLayerDataSource
        if (!ds) {
          throw new Error("Property data source not found")
        }

        console.log("Query parameters:", {
          geometry: {
            x: point.x,
            y: point.y,
            type: point.type,
          },
          spatialRef: {
            wkid: point.spatialReference?.wkid,
            wkt: point.spatialReference?.wkt,
          },
          dataSourceId,
          dataSourceUrl: ds.url,
        })

        const result = await ds.query(
          {
            geometry: point as any,
            returnGeometry: true,
            outFields: ["*"],
            spatialRel: "esriSpatialRelIntersects" as any,
          },
          createSignalOptions(options?.signal)
        )

        if (options?.signal?.aborted) {
          const abortError = new Error("AbortError")
          abortError.name = "AbortError"
          throw abortError
        }

        if (!result?.records) {
          return []
        }

        return result.records.map((record: FeatureDataRecord) => {
          const feature = record.getData()
          return {
            features: [feature as __esri.Graphic],
            propertyId: (feature.attributes as PropertyAttributes).FNR,
          }
        })
      } catch (error) {
        if (isAbortError(error)) {
          throw error as Error
        }
        throw new Error(parseArcGISError(error, "Property query failed"))
      }
    },
    options?.signal
  )
}

export const queryOwnerByFnr = async (
  fnr: string | number,
  dataSourceId: string,
  dsManager: DataSourceManager,
  options?: { signal?: AbortSignal }
): Promise<__esri.Graphic[]> => {
  const queryKey = createQueryKey("owner", {
    fnr: String(fnr),
    dsId: dataSourceId,
  })

  return getOrCreateQuery(
    OWNER_QUERY_CACHE,
    queryKey,
    async () => {
      try {
        if (options?.signal?.aborted) {
          const abortError = new Error("AbortError")
          abortError.name = "AbortError"
          throw abortError
        }

        const ds = dsManager.getDataSource(
          dataSourceId
        ) as FeatureLayerDataSource
        if (!ds) {
          throw new Error("Owner data source not found")
        }

        const result = await ds.query(
          {
            where: buildFnrWhereClause(fnr),
            returnGeometry: false,
            outFields: ["*"],
          },
          createSignalOptions(options?.signal)
        )

        if (options?.signal?.aborted) {
          const abortError = new Error("AbortError")
          abortError.name = "AbortError"
          throw abortError
        }

        if (!result?.records) {
          return []
        }

        return result.records.map(
          (record: FeatureDataRecord) => record.getData() as __esri.Graphic
        )
      } catch (error) {
        if (isAbortError(error)) {
          throw error as Error
        }
        throw new Error(parseArcGISError(error, "Owner query failed"))
      }
    },
    options?.signal
  )
}

export const clearQueryCache = () => {
  PROPERTY_QUERY_CACHE.clear()
  OWNER_QUERY_CACHE.clear()
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
