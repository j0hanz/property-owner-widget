import type {
  DataSourceManager,
  FeatureLayerDataSource,
  FeatureDataRecord,
} from "jimu-core"
import type {
  PropertyAttributes,
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
  queryFn: () => Promise<T>
): Promise<T> => {
  const now = Date.now()
  const existing = cache.get(key)

  if (existing && now - existing.timestamp < QUERY_DEDUPLICATION_TIMEOUT) {
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

  return getOrCreateQuery(PROPERTY_QUERY_CACHE, queryKey, async () => {
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

      const result = await ds.query({
        geometry: point as any,
        returnGeometry: true,
        outFields: ["*"],
        spatialRel: "esriSpatialRelIntersects" as any,
      })

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
  })
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

  return getOrCreateQuery(OWNER_QUERY_CACHE, queryKey, async () => {
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

      const result = await ds.query({
        where: buildFnrWhereClause(fnr),
        returnGeometry: false,
        outFields: ["*"],
      })

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
  })
}

export const clearQueryCache = () => {
  PROPERTY_QUERY_CACHE.clear()
  OWNER_QUERY_CACHE.clear()
}
