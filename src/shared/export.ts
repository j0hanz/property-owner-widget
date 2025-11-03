import { stripHtml } from "./utils"
import { trackEvent, trackError } from "./telemetry"
import type {
  GridRowData,
  CsvHeaderValues,
  ExportOptions,
} from "../config/types"
import { CSV_HEADERS } from "../config/constants"

const sanitizeValue = (value: any): string => {
  if (value == null) {
    return ""
  }
  return stripHtml(String(value))
}

const escapeCsvValue = (value: any): string => {
  const sanitized = sanitizeValue(value)
  if (
    sanitized.includes(",") ||
    sanitized.includes('"') ||
    sanitized.includes("\n")
  ) {
    return `"${sanitized.replace(/"/g, '""')}"`
  }
  return sanitized
}

export const convertToCSV = (rows: GridRowData[]): string => {
  if (!rows || rows.length === 0) {
    return ""
  }

  const csvHeaders = CSV_HEADERS.join(",")

  const csvRows = rows.map((row) => {
    const values: CsvHeaderValues = {
      FNR: escapeCsvValue(row.FNR),
      UUID_FASTIGHET: escapeCsvValue(row.UUID_FASTIGHET),
      FASTIGHET: escapeCsvValue(row.FASTIGHET),
      BOSTADR: escapeCsvValue(row.BOSTADR),
    }

    return CSV_HEADERS.map((header) => values[header]).join(",")
  })

  return [csvHeaders, ...csvRows].join("\n")
}

const stripRingsFromGeometry = (data: any[]): any[] => {
  return data.map((result) => {
    if (!result?.features) return result

    return {
      ...result,
      features: result.features.map((feature: any) => {
        if (!feature) return feature

        // Convert feature to plain object, preserving all properties
        const plainFeature: any = {
          aggregateGeometries: feature.aggregateGeometries ?? null,
          geometry: null,
          symbol: feature.symbol ?? null,
          attributes: feature.attributes ?? null,
          popupTemplate: feature.popupTemplate ?? null,
        }

        if (feature.geometry) {
          // Extract geometry properties, excluding rings
          const geom = feature.geometry
          const { rings, ...otherGeomProps } = geom

          plainFeature.geometry = otherGeomProps
        }

        return plainFeature
      }),
    }
  })
}

export const convertToGeoJSON = (rows: GridRowData[]): object => {
  const features = (rows || [])
    .filter((row) => Boolean(row.geometryType))
    .map((row) => {
      let geojsonGeometry: any = null
      const geometryType = (row.geometryType || "").toLowerCase()
      if (geometryType === "polygon" || geometryType === "extent") {
        geojsonGeometry = {
          type: "Polygon",
        }
      } else if (geometryType === "polyline") {
        geojsonGeometry = {
          type: "MultiLineString",
        }
      } else if (geometryType === "point" || geometryType === "multipoint") {
        geojsonGeometry = {
          type: "Point",
        }
      }

      return {
        type: "Feature",
        id: row.id,
        properties: {
          FNR: sanitizeValue(row.FNR),
          UUID_FASTIGHET: sanitizeValue(row.UUID_FASTIGHET),
          FASTIGHET: sanitizeValue(row.FASTIGHET),
          BOSTADR: sanitizeValue(row.BOSTADR),
        },
        geometry: geojsonGeometry,
      }
    })

  return {
    type: "FeatureCollection",
    features,
  }
}

const buildFilename = (
  baseName: string,
  extension: string,
  rowCount: number
): string => {
  const safeBase = baseName.replace(/[^a-zA-Z0-9-_]/g, "-") || "property-export"
  const timestamp = new Date().toISOString().split("T")[0]
  return `${safeBase}-${rowCount}rows-${timestamp}.${extension}`
}

export const exportData = (
  rawData: any[] | null | undefined,
  selectedProperties: GridRowData[],
  options: ExportOptions
): void => {
  const { format, filename, rowCount, definition } = options

  try {
    let content = ""
    let mimeType = "application/json;charset=utf-8"
    let extension = definition?.extension || "json"

    if (format === "json") {
      const cleanedData = stripRingsFromGeometry(rawData ?? [])
      content = JSON.stringify(cleanedData, null, 2)
      mimeType = definition?.mimeType || "application/json;charset=utf-8"
    } else if (format === "csv") {
      content = convertToCSV(selectedProperties)
      mimeType = definition?.mimeType || "text/csv;charset=utf-8"
      extension = definition?.extension || "csv"
    } else if (format === "geojson") {
      content = JSON.stringify(convertToGeoJSON(selectedProperties), null, 2)
      mimeType = definition?.mimeType || "application/geo+json;charset=utf-8"
      extension = definition?.extension || "geojson"
    } else {
      throw new Error(`Unsupported format: ${format}`)
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)

    const finalFilename = buildFilename(filename, extension, rowCount)

    const link = document.createElement("a")
    link.href = url
    link.download = finalFilename
    link.style.display = "none"

    document.body.appendChild(link)
    link.click()

    setTimeout(() => {
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }, 100)

    trackEvent({
      category: "Export",
      action: `export_${format}`,
      label: "success",
      value: rowCount,
    })
  } catch (error) {
    console.error("Export failed:", error)
    trackError(`export_${format}`, error)
    if (error instanceof Error) {
      throw error
    }
    throw new Error(String(error))
  }
}
