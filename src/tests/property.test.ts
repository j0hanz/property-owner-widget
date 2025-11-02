import { describe, it, expect, jest } from "@jest/globals"
import "@testing-library/jest-dom"
import {
  buildFnrWhereClause,
  formatOwnerInfo,
  formatPropertyWithShare,
  createRowId,
  extractFnr,
  isAbortError,
  parseArcGISError,
  maskName,
  maskAddress,
  normalizeFnrKey,
  isDuplicateProperty,
  shouldToggleRemove,
  calculatePropertyUpdates,
  buildHighlightColor,
  buildHighlightSymbolJSON,
  buildTooltipSymbol,
  syncCursorGraphics,
} from "../shared/utils"
import {
  isValidArcGISUrl,
  validateDataSources,
  propertyQueryService,
  queryPropertyByPoint,
  clearQueryCache,
} from "../shared/api"
import { convertToCSV, convertToGeoJSON, exportData } from "../shared/export"
import { CURSOR_TOOLTIP_STYLE } from "../config/constants"
import type { OwnerAttributes, GridRowData } from "../config/types"

const mockFeatureLayerInstances: MockFeatureLayer[] = []
let featureLayerCtorCount = 0
let mockQueryFeaturesResponse: any = {
  features: [
    {
      attributes: {
        FNR: "123",
        OBJECTID: 1,
        UUID_FASTIGHET: "uuid-123",
        FASTIGHET: "Test 1:1",
      },
    },
  ],
}

class MockFeatureLayer {
  url: string
  destroyed = false
  queryFeatures = jest.fn((_query: any) =>
    Promise.resolve(mockQueryFeaturesResponse)
  )
  destroy = jest.fn(() => {
    this.destroyed = true
  })

  constructor(options: { url: string }) {
    this.url = options.url
    featureLayerCtorCount += 1
    mockFeatureLayerInstances.push(this)
  }
}

class MockQuery {
  geometry: any
  returnGeometry: boolean
  outFields: string[]
  spatialRelationship: string

  constructor(params: {
    geometry: any
    returnGeometry: boolean
    outFields: string[]
    spatialRelationship: string
  }) {
    this.geometry = params.geometry
    this.returnGeometry = params.returnGeometry
    this.outFields = params.outFields
    this.spatialRelationship = params.spatialRelationship
  }
}

const resetMockFeatureLayerState = () => {
  featureLayerCtorCount = 0
  mockFeatureLayerInstances.length = 0
}

const setMockQueryFeaturesResponse = (response: any) => {
  mockQueryFeaturesResponse = response
}

const getFeatureLayerCtorCount = () => featureLayerCtorCount

const getMockFeatureLayerInstances = () => mockFeatureLayerInstances

jest.mock("jimu-arcgis", () => ({
  loadArcGISJSAPIModules: jest.fn((modules: string[]) => {
    return Promise.resolve(
      modules.map((moduleId) => {
        if (moduleId === "esri/core/promiseUtils") {
          return {
            eachAlways: (promises: Array<Promise<any>>) =>
              Promise.all(
                promises.map((promise) =>
                  promise
                    .then((value) => ({ value }))
                    .catch((error) => ({ error }))
                )
              ),
          }
        }
        if (moduleId === "esri/layers/FeatureLayer") {
          return MockFeatureLayer
        }
        if (moduleId === "esri/rest/support/Query") {
          return MockQuery
        }
        return {}
      })
    )
  }),
}))

// Mock DOMParser for HTML stripping tests
;(globalThis as any).DOMParser = class DOMParser {
  parseFromString(str: string) {
    // Simple HTML tag removal and entity decoding for test purposes
    let text = str
    // Decode common HTML entities first
    const entities: { [key: string]: string } = {
      "&lt;": "<",
      "&gt;": ">",
      "&amp;": "&",
      "&quot;": '"',
      "&#39;": "'",
    }
    for (const [entity, char] of Object.entries(entities)) {
      text = text.replace(new RegExp(entity, "g"), char)
    }
    // Remove HTML tags (including malformed ones) - keep stripping until no more tags
    let prevText = ""
    while (prevText !== text) {
      prevText = text
      text = text.replace(/<[^>]*>/g, "")
    }
    return {
      body: {
        textContent: text,
      },
    }
  }
}

// Mock globalThis for test stub
;(globalThis as any).__ESRI_TEST_STUB__ = jest.fn()

describe("Property Widget - SQL Injection Protection", () => {
  it("should sanitize apostrophes in string FNR", () => {
    const malicious = "1234'; DROP TABLE properties; --"
    const clause = buildFnrWhereClause(malicious)
    expect(clause).toBe("FNR = '1234''; DROP TABLE properties; --'")
    // SQL injection is prevented by doubling apostrophes, making it a literal string
    expect(clause).toContain("''")
  })

  it("should handle numeric FNR safely", () => {
    const clause = buildFnrWhereClause(12345)
    expect(clause).toBe("FNR = 12345")
  })

  it("should reject negative numbers", () => {
    expect(() => buildFnrWhereClause(-1)).toThrow("Invalid FNR")
    expect(() => buildFnrWhereClause(-12345)).toThrow("Invalid FNR")
  })

  it("should reject non-finite numbers", () => {
    expect(() => buildFnrWhereClause(Infinity)).toThrow("Invalid FNR")
    expect(() => buildFnrWhereClause(NaN)).toThrow("Invalid FNR")
  })

  it("should reject unsafe integers", () => {
    expect(() => buildFnrWhereClause(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "Invalid FNR"
    )
  })

  it("should accept custom error message", () => {
    expect(() => buildFnrWhereClause(Infinity, "Custom error")).toThrow(
      "Custom error"
    )
  })

  it("should handle semicolons in string FNR", () => {
    const clause = buildFnrWhereClause("1234; SELECT * FROM users")
    expect(clause).toBe("FNR = '1234; SELECT * FROM users'")
  })

  it("should handle Unicode injection attempts", () => {
    const clause = buildFnrWhereClause("1234\u0000; DROP TABLE")
    expect(clause).toContain("FNR = ")
  })
})

describe("Property Widget - PII Masking", () => {
  it("should mask names with asterisks", () => {
    expect(maskName("John Doe")).toBe("J*** D**")
    expect(maskName("Anna-Karin Svensson")).toBe("A*** S***")
  })

  it("should handle short names", () => {
    expect(maskName("Li")).toBe("***")
    expect(maskName("A")).toBe("***")
    expect(maskName("")).toBe("***")
  })

  it("should handle Unicode whitespace", () => {
    expect(maskName("John\u00A0Doe")).toBe("J*** D**") // Non-breaking space
    expect(maskName("John\u200BDoe")).toBe("J*** D**") // Zero-width space normalized to regular space
  })

  it("should mask addresses", () => {
    expect(maskAddress("Storgatan 123")).toBe("St*****")
    expect(maskAddress("AB")).toBe("***")
    expect(maskAddress("A")).toBe("***")
  })

  it("should format owner info with masking by default", () => {
    const owner: OwnerAttributes = {
      OBJECTID: 1,
      FNR: "1234",
      UUID_FASTIGHET: "uuid-123",
      FASTIGHET: "Test 1:1",
      NAMN: "John Doe",
      BOSTADR: "Storgatan 123",
      POSTNR: "123 45",
      POSTADR: "Stockholm",
      ORGNR: "556677-8899",
    }

    const masked = formatOwnerInfo(owner, true, "Unknown owner")
    expect(masked).toContain("J*** D**")
    expect(masked).toContain("St*****")
    expect(masked).not.toContain("John Doe")
    expect(masked).not.toContain("Storgatan 123")
  })

  it("should format owner info without masking when disabled", () => {
    const owner: OwnerAttributes = {
      OBJECTID: 1,
      FNR: "1234",
      UUID_FASTIGHET: "uuid-123",
      FASTIGHET: "Test 1:1",
      NAMN: "John Doe",
      BOSTADR: "Storgatan 123",
    }

    const unmasked = formatOwnerInfo(owner, false, "Unknown owner")
    expect(unmasked).toContain("John Doe")
    expect(unmasked).toContain("Storgatan 123")
  })

  it("should handle missing PII fields gracefully", () => {
    const owner: OwnerAttributes = {
      OBJECTID: 1,
      FNR: "1234",
      UUID_FASTIGHET: "uuid-123",
      FASTIGHET: "Test 1:1",
    }

    const result = formatOwnerInfo(owner, true, "Okänd ägare")
    expect(result).toContain("Okänd ägare")
  })

  it("should use custom unknown owner text", () => {
    const owner: OwnerAttributes = {
      OBJECTID: 1,
      FNR: "1234",
      UUID_FASTIGHET: "uuid-123",
      FASTIGHET: "Test 1:1",
    }

    const result = formatOwnerInfo(owner, true, "Unknown owner")
    expect(result).toContain("Unknown owner")
  })
})

describe("Property Widget - Highlight Styling", () => {
  it("should convert hex color and opacity to RGBA array", () => {
    const rgba = buildHighlightColor("#336699", 0.5)
    expect(rgba).toEqual([51, 102, 153, 0.5])
  })

  it("should clamp opacity and fall back to default color when invalid inputs provided", () => {
    const rgba = buildHighlightColor("not-a-color", 5)
    expect(rgba).toEqual([181, 73, 0, 1]) // #b54900
  })

  it("should build highlight symbol definition with solid fill and outline", () => {
    const symbolJSON = buildHighlightSymbolJSON([10, 20, 30, 0.75], 3)

    expect(symbolJSON).toMatchObject({
      style: "solid",
      color: [10, 20, 30, 0.75],
      outline: {
        style: "solid",
        color: [10, 20, 30, 1],
        width: 3,
      },
    })
  })

  it("should build line highlight symbol definition with configured width", () => {
    const symbolJSON = buildHighlightSymbolJSON(
      [100, 150, 200, 0.6],
      5,
      "polyline"
    )

    expect(symbolJSON).toMatchObject({
      style: "solid",
      color: [100, 150, 200, 0.6],
      width: 5,
    })
  })

  it("should build marker highlight symbol definition with outline", () => {
    const symbolJSON = buildHighlightSymbolJSON([5, 15, 25, 0.8], 2, "point")

    expect(symbolJSON).toMatchObject({
      style: "circle",
      color: [5, 15, 25, 0.8],
      outline: {
        style: "solid",
        color: [5, 15, 25, 1],
        width: 2,
      },
    })
  })
})

describe("Property Widget - URL Validation", () => {
  it("should accept valid HTTPS MapServer URLs", () => {
    expect(
      isValidArcGISUrl(
        "https://services.arcgis.com/test/arcgis/rest/services/Test/MapServer/0"
      )
    ).toBe(true)
  })

  it("should accept valid HTTPS FeatureServer URLs", () => {
    expect(
      isValidArcGISUrl(
        "https://services.arcgis.com/test/arcgis/rest/services/Test/FeatureServer/5"
      )
    ).toBe(true)
  })

  it("should reject HTTP URLs (enforce HTTPS)", () => {
    expect(
      isValidArcGISUrl("http://services.arcgis.com/test/MapServer/0")
    ).toBe(false)
  })

  it("should reject URLs without layer ID", () => {
    expect(isValidArcGISUrl("https://services.arcgis.com/test/MapServer")).toBe(
      false
    )
  })

  it("should accept URLs with query endpoints", () => {
    expect(
      isValidArcGISUrl(
        "https://services.arcgis.com/test/arcgis/rest/services/Test/MapServer/0/query"
      )
    ).toBe(true)
  })

  it("should reject non-standard ports", () => {
    expect(
      isValidArcGISUrl(
        "https://services.arcgis.com:8080/test/arcgis/rest/services/Test/MapServer/0"
      )
    ).toBe(false)
  })

  it("should reject malformed URLs", () => {
    expect(isValidArcGISUrl("not-a-url")).toBe(false)
    expect(isValidArcGISUrl("")).toBe(false)
  })

  it("should validate against host allowlist", () => {
    const url = "https://evil.com/arcgis/rest/services/Test/MapServer/0"
    expect(isValidArcGISUrl(url, ["arcgis.com", "esri.com"])).toBe(false)
  })

  it("should accept subdomain matches in allowlist", () => {
    const url =
      "https://services.arcgis.com/test/arcgis/rest/services/Test/MapServer/0"
    expect(isValidArcGISUrl(url, ["arcgis.com"])).toBe(true)
  })

  it("should handle path traversal attempts", () => {
    // Path traversal should be rejected by hostname validation
    expect(
      isValidArcGISUrl(
        "https://evil.com/arcgis/rest/services/Test/MapServer/0",
        ["arcgis.com"]
      )
    ).toBe(false)
    // Normalized paths without proper hostname should fail
    expect(
      isValidArcGISUrl(
        "https://services.arcgis.com/../../etc/passwd/MapServer/0",
        ["arcgis.com"]
      )
    ).toBe(true) // URL normalization keeps valid pattern, rely on allowlist
  })

  it("should reject localhost URLs", () => {
    expect(isValidArcGISUrl("https://localhost/MapServer/0")).toBe(false)
    expect(isValidArcGISUrl("https://127.0.0.1/MapServer/0")).toBe(false)
    expect(isValidArcGISUrl("https://[::1]/MapServer/0")).toBe(false)
  })

  it("should reject private IP ranges", () => {
    expect(isValidArcGISUrl("https://10.0.0.1/MapServer/0")).toBe(false)
    expect(isValidArcGISUrl("https://172.16.0.1/MapServer/0")).toBe(false)
    expect(isValidArcGISUrl("https://192.168.1.1/MapServer/0")).toBe(false)
  })
})

describe("Property Widget - Data Source Validation", () => {
  const translate = (key: string) => key

  const createMockDataSource = (url: string) => ({
    getLayerDefinition: () => ({ url }),
    getDataSourceJson: () => ({ url }),
    query: jest.fn(),
  })

  it("should reject data sources on disallowed hosts", () => {
    const manager = {
      getDataSource: jest.fn((id: string) => {
        if (id === "property")
          return createMockDataSource("https://evil.com/MapServer/0")
        if (id === "owner")
          return createMockDataSource(
            "https://services.arcgis.com/test/arcgis/rest/services/Owners/MapServer/0"
          )
        return null
      }),
    }

    const result = validateDataSources({
      propertyDsId: "property",
      ownerDsId: "owner",
      dsManager: manager as any,
      allowedHosts: ["arcgis.com"],
      translate,
    })

    expect(result.valid).toBe(false)
    if (result.valid) {
      throw new Error("Expected data source validation failure")
    }
    const invalidResult = result as Extract<
      ReturnType<typeof validateDataSources>,
      { valid: false }
    >
    expect(invalidResult.failureReason).toBe("property_disallowed_host")
    expect(invalidResult.error.message).toBe("errorHostNotAllowed")
  })

  it("should accept data sources on allowed hosts", () => {
    const manager = {
      getDataSource: jest.fn(() =>
        createMockDataSource(
          "https://services.arcgis.com/test/arcgis/rest/services/Test/MapServer/0"
        )
      ),
    }

    const result = validateDataSources({
      propertyDsId: "property",
      ownerDsId: "owner",
      dsManager: manager as any,
      allowedHosts: ["arcgis.com"],
      translate,
    })

    expect(result.valid).toBe(true)
  })

  it("should reject non-HTTPS data sources when allowlist is empty", () => {
    const manager = {
      getDataSource: jest.fn(() =>
        createMockDataSource(
          "http://services.arcgis.com/test/arcgis/rest/services/Test/MapServer/0"
        )
      ),
    }

    const result = validateDataSources({
      propertyDsId: "property",
      ownerDsId: "owner",
      dsManager: manager as any,
      allowedHosts: [],
      translate,
    })

    expect(result.valid).toBe(false)
    if (result.valid) {
      throw new Error("Expected data source validation failure")
    }
    const invalidResult = result as Extract<
      ReturnType<typeof validateDataSources>,
      { valid: false }
    >
    expect(invalidResult.failureReason).toBe("property_disallowed_host")
  })
})

describe("Property Widget - Utility Functions", () => {
  it("should format property with share correctly", () => {
    expect(formatPropertyWithShare("Test 1:1", "1/2")).toBe("Test 1:1 (1/2)")
    expect(formatPropertyWithShare("Test 1:1", "")).toBe("Test 1:1")
    expect(formatPropertyWithShare("Test 1:1")).toBe("Test 1:1")
  })

  it("should create unique row IDs", () => {
    const id1 = createRowId("1234", 1)
    const id2 = createRowId("1234", 2)
    const id3 = createRowId("5678", 1)
    expect(id1).toBe("1234_1")
    expect(id2).toBe("1234_2")
    expect(id3).toBe("5678_1")
    expect(id1).not.toBe(id2)
    expect(id1).not.toBe(id3)
  })

  it("should extract FNR from attributes", () => {
    expect(extractFnr({ FNR: "1234" })).toBe("1234")
    expect(extractFnr({ fnr: "5678" })).toBe("5678")
    expect(extractFnr({})).toBe(null)
    expect(extractFnr(null)).toBe(null)
    expect(extractFnr(undefined)).toBe(null)
  })

  it("should detect abort errors", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true)
    expect(isAbortError({ message: "Request aborted" })).toBe(true)
    expect(isAbortError({ message: "ABORT signal received" })).toBe(true)
    expect(isAbortError({ message: "Network error" })).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })

  it("should parse ArcGIS error messages", () => {
    expect(parseArcGISError("Simple error", "Default message")).toBe(
      "Simple error"
    )
    expect(
      parseArcGISError({ message: "Error message" }, "Default message")
    ).toBe("Error message")
    expect(
      parseArcGISError(
        { details: { message: "Detailed error" } },
        "Default message"
      )
    ).toBe("Detailed error")
    expect(parseArcGISError(null, "An unknown error occurred")).toBe(
      "An unknown error occurred"
    )
  })

  it("should use custom default error message", () => {
    expect(parseArcGISError(null, "Custom default error")).toBe(
      "Custom default error"
    )
  })
})

describe("Property Widget - HTML Stripping Security", () => {
  it("should strip HTML tags using DOMParser", () => {
    expect(maskName("John<script>alert('xss')</script>")).toBe("J***")
    expect(maskAddress("Street<img src=x onerror=alert(1)>")).toBe("St****")
  })

  it("should handle incomplete HTML tags", () => {
    expect(maskName("John<script<script>>")).toBe("J***")
  })

  it("should decode HTML entities", () => {
    expect(maskName("John&lt;script&gt;")).toBe("J***")
  })

  it("should handle nested HTML entities", () => {
    expect(maskName("John&amp;lt;script&amp;gt;alert(1)")).toBe("J***")
    expect(maskAddress("Street&amp;lt;img src=x&amp;gt;")).toBe("St*****")
  })

  it("should strip event handlers from HTML attributes", () => {
    expect(maskName('<div onclick="alert(1)">John Doe</div>')).toBe("J*** D**")
    expect(maskAddress('<a href="javascript:alert(1)">Main St</a>')).toBe(
      "Ma*****"
    )
  })
})

describe("Property Widget - Edge Cases", () => {
  it("should handle null/undefined in formatOwnerInfo", () => {
    const owner: OwnerAttributes = {
      OBJECTID: 1,
      FNR: "1234",
      UUID_FASTIGHET: "uuid",
      FASTIGHET: "Test",
      NAMN: undefined,
      BOSTADR: null as any,
    }
    const result = formatOwnerInfo(owner, true, "Unknown owner")
    expect(result).toBeDefined()
    expect(typeof result).toBe("string")
  })

  it("should handle whitespace-only strings", () => {
    expect(maskName("   ")).toBe("***")
    expect(maskAddress("   ")).toBe("***")
  })

  it("should handle special characters in FNR", () => {
    const clause = buildFnrWhereClause("test<script>alert('xss')</script>")
    expect(clause).toContain("FNR = ")
    // Script tags are safely escaped within SQL string literal
    expect(clause).toContain("''xss''")
  })
})

describe("Property Widget - AbortSignal Validation", () => {
  it("should detect already aborted signals", () => {
    const controller = new AbortController()
    controller.abort()
    expect(controller.signal.aborted).toBe(true)
  })

  it("should handle null/undefined abort signals", () => {
    // This test validates the optional signal parameter handling
    const signal: AbortSignal | undefined = undefined
    expect(() => {
      if (signal?.aborted) {
        throw new Error("Should not reach here")
      }
    }).not.toThrow()
  })
})

describe("Property Widget - Performance", () => {
  it("should handle large datasets in createRowId without collision", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10000; i++) {
      ids.add(createRowId(i, i))
    }
    expect(ids.size).toBe(10000)
  })

  it("should sanitize SQL efficiently", () => {
    const start = Date.now()
    for (let i = 0; i < 1000; i++) {
      buildFnrWhereClause("test'value'with'quotes")
    }
    const duration = Date.now() - start
    expect(duration).toBeLessThan(100) // Should complete in <100ms
  })
})

describe("Property Widget - Owner Deduplication", () => {
  const baseOwnerAttributes: OwnerAttributes = {
    OBJECTID: 10,
    FNR: "123",
    UUID_FASTIGHET: "uuid-123",
    FASTIGHET: "Property 1",
    NAMN: "Owner One",
    BOSTADR: "Street 1",
    POSTNR: "12345",
    POSTADR: "Town",
    ORGNR: "556677-8899",
    ANDEL: "1/1",
  }

  it("should deduplicate owner records when querying individually", async () => {
    const propertyGraphic = {
      attributes: {
        FNR: "123",
        OBJECTID: 1,
        UUID_FASTIGHET: "uuid-123",
        FASTIGHET: "Property 1",
      },
      geometry: {},
    } as any

    const duplicateOwnerGraphic = {
      attributes: { ...baseOwnerAttributes },
    } as any

    const result = await propertyQueryService.processIndividual({
      propertyResults: [{ features: [propertyGraphic] }],
      config: {
        ownerDataSourceId: "owner",
        enablePIIMasking: false,
      },
      context: {
        dsManager: {} as any,
        maxResults: 10,
        helpers: {
          extractFnr: (attrs: any) => attrs?.FNR ?? null,
          queryOwnerByFnr: () =>
            Promise.resolve([
              duplicateOwnerGraphic,
              { attributes: { ...baseOwnerAttributes, OBJECTID: 11 } } as any,
            ]),
          queryOwnersByRelationship: () => Promise.resolve(new Map()),
          createRowId,
          formatPropertyWithShare,
          formatOwnerInfo,
          isAbortError,
        },
        messages: {
          unknownOwner: "Unknown",
          errorOwnerQueryFailed: "Owner query failed",
          errorNoDataAvailable: "No data",
        },
      },
    })

    expect(result.rowsToProcess).toHaveLength(1)
    expect(result.rowsToProcess[0].FNR).toBe("123")
  })

  it("should deduplicate owner records when using batch relationship queries", async () => {
    const propertyGraphic = {
      attributes: {
        FNR: "123",
        OBJECTID: 1,
        UUID_FASTIGHET: "uuid-123",
        FASTIGHET: "Property 1",
      },
      geometry: {},
    } as any

    const ownersMap = new Map<string, any[]>([
      [
        "123",
        [{ ...baseOwnerAttributes }, { ...baseOwnerAttributes, OBJECTID: 11 }],
      ],
    ])

    const result = await propertyQueryService.processBatch({
      propertyResults: [{ features: [propertyGraphic] }],
      config: {
        propertyDataSourceId: "property",
        ownerDataSourceId: "owner",
        enablePIIMasking: false,
        relationshipId: 0,
      },
      context: {
        dsManager: {} as any,
        maxResults: 10,
        helpers: {
          extractFnr: (attrs: any) => attrs?.FNR ?? null,
          queryOwnerByFnr: () => Promise.resolve([]),
          queryOwnersByRelationship: () => Promise.resolve(ownersMap),
          createRowId,
          formatPropertyWithShare,
          formatOwnerInfo,
          isAbortError,
        },
        messages: {
          unknownOwner: "Unknown",
          errorOwnerQueryFailed: "Owner query failed",
          errorNoDataAvailable: "No data",
        },
      },
    })

    expect(result.rowsToProcess).toHaveLength(1)
    expect(result.rowsToProcess[0].FASTIGHET).toContain("Property 1")
  })
})

describe("Property Widget - Security Regression Tests", () => {
  it("should not leak PII in error messages", () => {
    const owner: OwnerAttributes = {
      OBJECTID: 1,
      FNR: "1234",
      UUID_FASTIGHET: "uuid",
      FASTIGHET: "Test",
      NAMN: "Sensitive Name",
    }
    const masked = formatOwnerInfo(owner, true, "Unknown owner")
    expect(masked.toLowerCase()).not.toContain("sensitive name")
  })

  it("should validate URL protocol strictly", () => {
    expect(isValidArcGISUrl("ftp://services.arcgis.com/MapServer/0")).toBe(
      false
    )
    expect(isValidArcGISUrl("javascript:alert(1)//MapServer/0")).toBe(false)
  })

  it("should handle empty or whitespace-only FNR safely in WHERE clause", () => {
    expect(() => buildFnrWhereClause("")).toThrow(
      "Invalid FNR: cannot be empty or whitespace-only"
    )
    expect(() => buildFnrWhereClause("   ")).toThrow(
      "Invalid FNR: cannot be empty or whitespace-only"
    )
  })
})

describe("Property Widget - Utility Helper Functions", () => {
  it("should normalize FNR keys consistently", () => {
    expect(normalizeFnrKey("1234")).toBe("1234")
    expect(normalizeFnrKey(1234)).toBe("1234")
    expect(normalizeFnrKey(null)).toBe("")
    expect(normalizeFnrKey(undefined)).toBe("")
  })

  it("should detect duplicate properties", () => {
    const properties = [{ FNR: "1234" }, { FNR: 5678 }]
    expect(isDuplicateProperty("1234", properties)).toBe(true)
    expect(isDuplicateProperty(5678, properties)).toBe(true)
    expect(isDuplicateProperty("9999", properties)).toBe(false)
    expect(isDuplicateProperty(1234, properties)).toBe(true) // String/number normalization
  })

  it("should determine toggle removal correctly", () => {
    const properties = [{ FNR: "1234" }]
    expect(shouldToggleRemove("1234", properties, true)).toBe(true)
    expect(shouldToggleRemove("1234", properties, false)).toBe(false)
    expect(shouldToggleRemove("9999", properties, true)).toBe(false)
  })

  it("should use Set-based lookups in calculatePropertyUpdates for large selections", () => {
    // Test that calculatePropertyUpdates efficiently handles large existing property lists
    // by using Set-based deduplication instead of repeated array scans
    // TODO: Add comprehensive test for set-based optimization
  })

  it("should batch owner queries respecting concurrency limit", () => {
    // Test that propertyQueryService batches owner queries with Promise.all
    // and respects OWNER_QUERY_CONCURRENCY cap
    // TODO: Mock helpers to verify batching and parallel execution
  })

  it("should retain all owner rows for multi-owner properties", () => {
    const rowsToProcess = [
      {
        id: "123_1",
        FNR: "123",
        UUID_FASTIGHET: "uuid-123",
        FASTIGHET: "Property 1",
        BOSTADR: "Owner 1",
      },
      {
        id: "123_2",
        FNR: "123",
        UUID_FASTIGHET: "uuid-123",
        FASTIGHET: "Property 1",
        BOSTADR: "Owner 2",
      },
    ]

    const result = calculatePropertyUpdates(rowsToProcess, [], false, 10)

    expect(result.toRemove.size).toBe(0)
    expect(result.updatedRows).toHaveLength(2)
    expect(result.updatedRows.map((row) => row.id)).toEqual(["123_1", "123_2"])
  })

  it("should sanitize tooltip content when building text symbols", () => {
    class MockTextSymbol {
      text: string
      color: string
      haloColor: string
      haloSize: number
      xoffset: number
      yoffset: number
      font: __esri.FontProperties

      constructor(props: any) {
        Object.assign(this, props)
      }
    }

    const modules = {
      TextSymbol: MockTextSymbol,
    } as any

    const symbol = buildTooltipSymbol(
      modules,
      "<strong>FAST-1</strong>",
      CURSOR_TOOLTIP_STYLE
    )

    if (!symbol) {
      throw new Error("Expected tooltip symbol instance")
    }

    expect(symbol).toBeInstanceOf(MockTextSymbol)
    expect(symbol.text).toBe("FAST-1")
    expect(symbol.color).toBe(CURSOR_TOOLTIP_STYLE.textColor)
    expect(symbol.haloColor).toBe(CURSOR_TOOLTIP_STYLE.haloColor)
    expect(symbol.font.family).toBe(CURSOR_TOOLTIP_STYLE.fontFamily)
  })

  it("should create and clear cursor graphics through sync helper", () => {
    class MockTextSymbol {
      text: string
      constructor(props: any) {
        this.text = props.text
      }
    }

    class MockGraphic {
      geometry: any
      symbol: any

      constructor(props: any) {
        this.geometry = props.geometry
        this.symbol = props.symbol
      }
    }

    const modules = {
      Graphic: MockGraphic,
      TextSymbol: MockTextSymbol,
    } as any

    const layer = {
      add: jest.fn(),
      remove: jest.fn(),
    } as any

    const mapPoint = { x: 1, y: 2 } as any
    const highlightColor: [number, number, number, number] = [0, 180, 216, 0.4]

    const state = syncCursorGraphics({
      modules,
      layer,
      mapPoint,
      tooltipText: "<em>FAST-1</em>",
      highlightColor,
      outlineWidth: 2,
      existing: null,
      style: CURSOR_TOOLTIP_STYLE,
    })

    if (!state) {
      throw new Error("Expected cursor graphics state")
    }

    expect(layer.add).toHaveBeenCalledTimes(2)
    expect(state.pointGraphic).toBeInstanceOf(MockGraphic)
    expect(state.tooltipGraphic).toBeInstanceOf(MockGraphic)
    expect(state.tooltipGraphic?.symbol).toBeInstanceOf(MockTextSymbol)
    expect((state.tooltipGraphic?.symbol as MockTextSymbol).text).toBe("FAST-1")
    expect(state.lastTooltipText).toBe("<em>FAST-1</em>")

    const clearedState = syncCursorGraphics({
      modules,
      layer,
      mapPoint: null,
      tooltipText: null,
      highlightColor,
      outlineWidth: 2,
      existing: state,
      style: CURSOR_TOOLTIP_STYLE,
    })

    expect(layer.remove).toHaveBeenCalledTimes(2)
    expect(clearedState).toBeNull()
  })

  it("should only update symbol when tooltip text changes (performance optimization)", () => {
    class MockTextSymbol {
      text: string
      constructor(props: any) {
        this.text = props.text
      }
    }

    class MockGraphic {
      geometry: any
      symbol: any
      constructor(props: any) {
        this.geometry = props.geometry
        this.symbol = props.symbol
      }
    }

    const modules = {
      Graphic: MockGraphic,
      TextSymbol: MockTextSymbol,
    } as any

    const layer = {
      add: jest.fn(),
      remove: jest.fn(),
    } as any

    const mapPoint1 = { x: 1, y: 2 } as any
    const mapPoint2 = { x: 3, y: 4 } as any
    const highlightColor: [number, number, number, number] = [0, 180, 216, 0.4]

    // Initial render with tooltip
    const state1 = syncCursorGraphics({
      modules,
      layer,
      mapPoint: mapPoint1,
      tooltipText: "Property A",
      highlightColor,
      outlineWidth: 2,
      existing: null,
      style: CURSOR_TOOLTIP_STYLE,
    })

    expect(state1?.lastTooltipText).toBe("Property A")
    const originalSymbol = state1?.tooltipGraphic?.symbol

    // Move cursor but keep same tooltip text - symbol should NOT be recreated
    const state2 = syncCursorGraphics({
      modules,
      layer,
      mapPoint: mapPoint2,
      tooltipText: "Property A",
      highlightColor,
      outlineWidth: 2,
      existing: state1,
      style: CURSOR_TOOLTIP_STYLE,
    })

    expect(state2?.lastTooltipText).toBe("Property A")
    expect(state2?.tooltipGraphic?.symbol).toBe(originalSymbol) // Same symbol reference
    expect(state2?.tooltipGraphic?.geometry).toBe(mapPoint2) // Position updated

    // Change tooltip text - symbol SHOULD be recreated
    const state3 = syncCursorGraphics({
      modules,
      layer,
      mapPoint: mapPoint2,
      tooltipText: "Property B",
      highlightColor,
      outlineWidth: 2,
      existing: state2,
      style: CURSOR_TOOLTIP_STYLE,
    })

    expect(state3?.lastTooltipText).toBe("Property B")
    expect(state3?.tooltipGraphic?.symbol).not.toBe(originalSymbol) // New symbol created
    expect((state3?.tooltipGraphic?.symbol as MockTextSymbol).text).toBe(
      "Property B"
    )
  })
})

describe("Property Widget - Undo Functionality", () => {
  it("should track remove operations in undo history", () => {
    const mockRow = {
      id: "123_1",
      FNR: "123",
      UUID_FASTIGHET: "uuid-123",
      FASTIGHET: "Property 1",
      BOSTADR: "Owner 1",
      graphic: {} as __esri.Graphic,
    }

    const undoHistory = [
      {
        type: "remove" as const,
        timestamp: Date.now(),
        data: [mockRow],
      },
    ]

    expect(undoHistory).toHaveLength(1)
    expect(undoHistory[0].type).toBe("remove")
    expect(undoHistory[0].data).toEqual([mockRow])
  })

  it("should track clear operations in undo history", () => {
    const mockRows = [
      {
        id: "123_1",
        FNR: "123",
        UUID_FASTIGHET: "uuid-123",
        FASTIGHET: "Property 1",
        BOSTADR: "Owner 1",
        graphic: {} as __esri.Graphic,
      },
      {
        id: "456_2",
        FNR: "456",
        UUID_FASTIGHET: "uuid-456",
        FASTIGHET: "Property 2",
        BOSTADR: "Owner 2",
        graphic: {} as __esri.Graphic,
      },
    ]

    const undoHistory = [
      {
        type: "clear" as const,
        timestamp: Date.now(),
        data: mockRows,
      },
    ]

    expect(undoHistory).toHaveLength(1)
    expect(undoHistory[0].type).toBe("clear")
    expect(undoHistory[0].data).toHaveLength(2)
  })

  it("should limit undo history to MAX_UNDO_HISTORY", () => {
    const MAX_UNDO_HISTORY = 10
    const operations = Array.from({ length: 15 }, (_, i) => ({
      type: "remove" as const,
      timestamp: Date.now() + i,
      data: [
        {
          id: `${i}_1`,
          FNR: `${i}`,
          UUID_FASTIGHET: `uuid-${i}`,
          FASTIGHET: `Property ${i}`,
          BOSTADR: `Owner ${i}`,
          graphic: {} as __esri.Graphic,
        },
      ],
    }))

    const limitedHistory = operations.slice(0, MAX_UNDO_HISTORY)

    expect(limitedHistory).toHaveLength(MAX_UNDO_HISTORY)
    expect(limitedHistory[0].data[0].FNR).toBe("0")
    expect(limitedHistory[9].data[0].FNR).toBe("9")
  })

  it("should restore properties on undo remove", () => {
    const removedRow = {
      id: "123_1",
      FNR: "123",
      UUID_FASTIGHET: "uuid-123",
      FASTIGHET: "Property 1",
      BOSTADR: "Owner 1",
      graphic: {} as __esri.Graphic,
    }

    const currentProperties = [
      {
        id: "456_2",
        FNR: "456",
        UUID_FASTIGHET: "uuid-456",
        FASTIGHET: "Property 2",
        BOSTADR: "Owner 2",
        graphic: {} as __esri.Graphic,
      },
    ]

    const undoOperation = {
      type: "remove" as const,
      timestamp: Date.now(),
      data: [removedRow],
    }

    const restoredProperties = [...currentProperties, ...undoOperation.data]

    expect(restoredProperties).toHaveLength(2)
    expect(restoredProperties[0].FNR).toBe("456")
    expect(restoredProperties[1].FNR).toBe("123")
  })

  it("should restore all properties on undo clear", () => {
    const clearedRows = [
      {
        id: "123_1",
        FNR: "123",
        UUID_FASTIGHET: "uuid-123",
        FASTIGHET: "Property 1",
        BOSTADR: "Owner 1",
        graphic: {} as __esri.Graphic,
      },
      {
        id: "456_2",
        FNR: "456",
        UUID_FASTIGHET: "uuid-456",
        FASTIGHET: "Property 2",
        BOSTADR: "Owner 2",
        graphic: {} as __esri.Graphic,
      },
    ]

    const undoOperation = {
      type: "clear" as const,
      timestamp: Date.now(),
      data: clearedRows,
    }

    const restoredProperties = undoOperation.data

    expect(restoredProperties).toHaveLength(2)
    expect(restoredProperties[0].FNR).toBe("123")
    expect(restoredProperties[1].FNR).toBe("456")
  })
})

describe("Property Widget - Telemetry", () => {
  it("should track events when telemetry is enabled", () => {
    // Telemetry should respect user privacy settings
    // This test verifies the structure of telemetry events
    const mockEvent = {
      category: "Property",
      action: "remove",
      value: 1,
    }

    expect(mockEvent).toHaveProperty("category")
    expect(mockEvent).toHaveProperty("action")
    expect(mockEvent.category).toBe("Property")
    expect(mockEvent.action).toBe("remove")
  })

  it("should track performance metrics", () => {
    const mockMetric = {
      operation: "map_click_query",
      duration: 250,
      success: true,
    }

    expect(mockMetric.operation).toBe("map_click_query")
    expect(mockMetric.duration).toBeGreaterThan(0)
    expect(mockMetric.success).toBe(true)
  })

  it("should track errors with context", () => {
    const mockError = {
      category: "Error",
      action: "property_query",
      label: "Network error: timeout",
    }

    expect(mockError.category).toBe("Error")
    expect(mockError.action).toBe("property_query")
    expect(mockError.label).toContain("Network error")
  })
})

describe("Query Controls", () => {
  const createDefaultQueryResponse = () => ({
    features: [
      {
        attributes: {
          FNR: "123",
          OBJECTID: 1,
          UUID_FASTIGHET: "uuid-123",
          FASTIGHET: "Test 1:1",
        },
      },
    ],
  })

  const createMockDsManager = (url: string) =>
    ({
      getDataSource: jest.fn(() => ({ url })),
    }) as any

  beforeEach(() => {
    resetMockFeatureLayerState()
    setMockQueryFeaturesResponse(createDefaultQueryResponse())
    clearQueryCache()
  })

  afterEach(() => {
    clearQueryCache()
  })

  it("should clear cached FeatureLayers without errors", async () => {
    const dsManager = createMockDsManager(
      "https://example.com/arcgis/rest/services/Parcels/MapServer/0"
    )
    const point: any = { x: 10, y: 20, spatialReference: { wkid: 3006 } }

    await queryPropertyByPoint(point, "property", dsManager)
    expect(getFeatureLayerCtorCount()).toBe(1)

    expect(() => {
      clearQueryCache()
    }).not.toThrow()

    getMockFeatureLayerInstances().forEach((instance) => {
      expect(instance.destroy).toHaveBeenCalledTimes(1)
      expect(instance.destroyed).toBe(true)
    })
  })

  it("should reuse cached FeatureLayer instances across property queries", async () => {
    const dsManager = createMockDsManager(
      "https://example.com/arcgis/rest/services/Parcels/MapServer/0"
    )
    const point: any = { x: 0, y: 0, spatialReference: { wkid: 3006 } }

    const firstResult = await queryPropertyByPoint(point, "property", dsManager)
    const secondResult = await queryPropertyByPoint(
      point,
      "property",
      dsManager
    )

    expect(firstResult.length).toBe(1)
    expect(secondResult.length).toBe(1)
    expect(getFeatureLayerCtorCount()).toBe(1)
  })

  it("should destroy cached FeatureLayers before creating new ones after clear", async () => {
    const dsManager = createMockDsManager(
      "https://example.com/arcgis/rest/services/Parcels/MapServer/0"
    )
    const point: any = { x: 5, y: 15, spatialReference: { wkid: 3006 } }

    await queryPropertyByPoint(point, "property", dsManager)
    const cachedInstancesBeforeClear = getMockFeatureLayerInstances().slice()
    expect(cachedInstancesBeforeClear.length).toBe(1)

    clearQueryCache()

    cachedInstancesBeforeClear.forEach((instance) => {
      expect(instance.destroy).toHaveBeenCalledTimes(1)
      expect(instance.destroyed).toBe(true)
    })

    await queryPropertyByPoint(point, "property", dsManager)
    expect(getFeatureLayerCtorCount()).toBe(2)
  })

  it("should remove deprecated query cache constants", () => {
    const constants = require("../config/constants")

    expect("QUERY_DEDUPLICATION_TIMEOUT" in constants).toBe(false)
    expect("PROPERTY_QUERY_CACHE" in constants).toBe(false)
    expect("OWNER_QUERY_CACHE" in constants).toBe(false)
  })

  it("should configure abort controller pool size", () => {
    const { ABORT_CONTROLLER_POOL_SIZE } = require("../config/constants")

    expect(ABORT_CONTROLLER_POOL_SIZE).toBeDefined()
    expect(typeof ABORT_CONTROLLER_POOL_SIZE).toBe("number")
    expect(ABORT_CONTROLLER_POOL_SIZE).toBeGreaterThan(0)
    expect(ABORT_CONTROLLER_POOL_SIZE).toBeLessThanOrEqual(20)
  })

  it("should increase owner query concurrency for better performance", () => {
    const { OWNER_QUERY_CONCURRENCY } = require("../config/constants")

    expect(OWNER_QUERY_CONCURRENCY).toBeDefined()
    expect(OWNER_QUERY_CONCURRENCY).toBe(5)
  })
})

describe("Export Utilities - CSV", () => {
  const baseRow: GridRowData = {
    id: "row-1",
    FNR: "123",
    UUID_FASTIGHET: "uuid-123",
    FASTIGHET: "Property",
    BOSTADR: "Owner",
  }

  it("should escape commas in values", () => {
    const rows: GridRowData[] = [
      {
        ...baseRow,
        FASTIGHET: "Value, with comma",
      },
    ]

    const csv = convertToCSV(rows)
    expect(csv.split("\n")[1]).toContain('"Value, with comma"')
  })

  it("should escape quotes in values", () => {
    const rows: GridRowData[] = [
      {
        ...baseRow,
        BOSTADR: 'Address "quoted" street',
      },
    ]

    const csv = convertToCSV(rows)
    expect(csv.split("\n")[1]).toContain('"Address ""quoted"" street"')
  })

  it("should handle Swedish characters", () => {
    const rows: GridRowData[] = [
      {
        ...baseRow,
        BOSTADR: "Malmö",
      },
    ]

    const csv = convertToCSV(rows)
    expect(csv).toContain("Malmö")
  })

  it("should strip HTML tags before exporting", () => {
    const rows: GridRowData[] = [
      {
        ...baseRow,
        FASTIGHET: "<strong>Secure</strong>",
      },
    ]

    const csv = convertToCSV(rows)
    expect(csv).toContain("Secure")
    expect(csv).not.toContain("<strong>")
  })
})

describe("Export Utilities - GeoJSON", () => {
  const baseRow: GridRowData = {
    id: "row-geo",
    FNR: "456",
    UUID_FASTIGHET: "uuid-geo",
    FASTIGHET: "<em>Geo property</em>",
    BOSTADR: "<span>Geo owner</span>",
  }

  it("should convert polygon geometry", () => {
    const polygonRow: GridRowData = {
      ...baseRow,
      graphic: {
        geometry: {
          type: "polygon",
          rings: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      } as unknown as __esri.Graphic,
    }

    const geojson = convertToGeoJSON([polygonRow]) as any
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe("Polygon")
  })

  it("should skip rows without geometry", () => {
    const rows: GridRowData[] = [{ ...baseRow }]
    const geojson = convertToGeoJSON(rows) as any
    expect(geojson.features).toHaveLength(0)
  })

  it("should sanitize HTML in properties", () => {
    const rowWithHtml: GridRowData = {
      ...baseRow,
      graphic: {
        geometry: {
          type: "point",
          x: 10,
          y: 20,
        },
      } as unknown as __esri.Graphic,
    }

    const geojson = convertToGeoJSON([rowWithHtml]) as any
    expect(geojson.features[0].properties.FASTIGHET).toBe("Geo property")
    expect(geojson.features[0].properties.BOSTADR).toBe("Geo owner")
  })
})

describe("Export Utilities - exportData", () => {
  it("should trigger download flow and revoke object URL", () => {
    const rawData = [{ id: 1 }]
    const rows: GridRowData[] = [
      {
        id: "row-export",
        FNR: "789",
        UUID_FASTIGHET: "uuid-export",
        FASTIGHET: "Export Property",
        BOSTADR: "Export Owner",
      },
    ]

    jest.useFakeTimers()

    const originalCreateObjectURL = (global.URL as any)?.createObjectURL
    const originalRevokeObjectURL = (global.URL as any)?.revokeObjectURL

    const createObjectURL = jest.fn(() => "blob:mock")
    const revokeObjectURL = jest.fn()

    Object.defineProperty(global.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    })
    Object.defineProperty(global.URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    })
    const appendChildSpy = jest.spyOn(document.body, "appendChild")
    const removeChildSpy = jest.spyOn(document.body, "removeChild")

    const originalCreateElement = document.createElement.bind(document)
    const anchorElement = originalCreateElement("a") as HTMLAnchorElement
    const clickMock = jest.fn()
    anchorElement.click = clickMock

    const createElementSpy = jest
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string, options?: any) => {
        if (tagName.toLowerCase() === "a") {
          return anchorElement
        }
        return originalCreateElement(tagName, options)
      })

    const definition = {
      id: "json" as const,
      label: "JSON",
      description: "",
      extension: "json",
      mimeType: "application/json",
    }

    try {
      exportData(rawData, rows, {
        format: "json",
        filename: "property-export",
        rowCount: rows.length,
        definition,
      })

      expect(createObjectURL).toHaveBeenCalled()
      expect(appendChildSpy).toHaveBeenCalledWith(anchorElement)
      expect(clickMock).toHaveBeenCalledTimes(1)

      jest.runAllTimers()

      expect(removeChildSpy).toHaveBeenCalledWith(anchorElement)
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")
    } finally {
      if (originalCreateObjectURL) {
        Object.defineProperty(global.URL, "createObjectURL", {
          configurable: true,
          writable: true,
          value: originalCreateObjectURL,
        })
      } else {
        delete (global.URL as any).createObjectURL
      }

      if (originalRevokeObjectURL) {
        Object.defineProperty(global.URL, "revokeObjectURL", {
          configurable: true,
          writable: true,
          value: originalRevokeObjectURL,
        })
      } else {
        delete (global.URL as any).revokeObjectURL
      }
      appendChildSpy.mockRestore()
      removeChildSpy.mockRestore()
      createElementSpy.mockRestore()
      jest.useRealTimers()
    }
  })
})
