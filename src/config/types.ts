import type { ImmutableObject, DataSourceManager } from "jimu-core"
import type { ColumnDef } from "@tanstack/react-table"
import type { WidgetStyles } from "./style"

export interface Config {
  propertyDataSourceId: string
  ownerDataSourceId: string
  displayColumns: readonly string[]
  maxResults: number
  enableToggleRemoval: boolean
  allowedHosts?: readonly string[]
  enablePIIMasking: boolean
  relationshipId?: number
  enableBatchOwnerQuery: boolean
}

export type IMConfig = ImmutableObject<Config>

export interface PropertyAttributes {
  OBJECTID: number
  FNR: string | number
  UUID_FASTIGHET: string
  FASTIGHET: string
  [key: string]: any
}

export interface OwnerAttributes {
  OBJECTID: number
  FNR: string | number
  UUID_FASTIGHET: string
  FASTIGHET: string
  NAMN?: string
  BOSTADR?: string
  POSTNR?: string
  POSTADR?: string
  ANDEL?: string
  ORGNR?: string
  AGARLISTA?: string
  [key: string]: any
}

export interface GridRowData {
  id: string
  FNR: string | number
  UUID_FASTIGHET: string
  FASTIGHET: string
  BOSTADR: string
  graphic?: __esri.Graphic
}

export interface SelectionGraphicsHelpers {
  addGraphicsToMap: (
    graphic: __esri.Graphic | null | undefined,
    view: __esri.MapView | null | undefined,
    extractFnr: (attrs: any) => string | number | null,
    normalizeFnrKey: (fnr: any) => string,
    highlightColor: [number, number, number, number],
    outlineWidth: number
  ) => void
  extractFnr: (attrs: any) => string | number | null
  normalizeFnrKey: (fnr: any) => string
}

export interface SelectionGraphicsParams {
  graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: string | number }>
  selectedRows: GridRowData[]
  getCurrentView: () => __esri.MapView | null | undefined
  helpers: SelectionGraphicsHelpers
  highlightColor: [number, number, number, number]
  outlineWidth: number
}

export interface ErrorBoundaryProps {
  children: React.ReactNode
  styles: WidgetStyles
  translate: (id: string) => string
}

export interface ErrorState {
  type: "QUERY_ERROR" | "NETWORK_ERROR" | "VALIDATION_ERROR" | "GEOMETRY_ERROR"
  message: string
  details?: string
}

export interface PropertyWidgetState {
  error: ErrorState | null
  selectedProperties: GridRowData[]
}

export interface QueryResult {
  features: __esri.Graphic[]
  propertyId: string | number
}

export interface InflightQuery {
  promise: Promise<unknown>
  timestamp: number
}

export interface EsriModules {
  SimpleFillSymbol: new (
    properties?: __esri.SimpleFillSymbolProperties
  ) => __esri.SimpleFillSymbol
  Graphic: new (properties?: __esri.GraphicProperties) => __esri.Graphic
  GraphicsLayer: new (
    properties?: __esri.GraphicsLayerProperties
  ) => __esri.GraphicsLayer
  Extent: new (properties?: __esri.ExtentProperties) => __esri.Extent
}

export interface UrlErrors {
  property: string | null
  owner: string | null
}

export interface ProcessPropertyResult {
  rowsToProcess: GridRowData[]
  graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: string | number }>
}

export interface TelemetryEvent {
  category: string
  action: string
  label?: string
  value?: number
}

export interface PerformanceMetric {
  operation: string
  duration: number
  success: boolean
  error?: string
}

// =============================================================================
// VALIDATION RESULT TYPES
// Discriminated unions for type-safe validation results
// =============================================================================

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ValidationSuccess<T> = {
  readonly valid: true
  readonly data: T
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ValidationFailure = {
  readonly valid: false
  readonly error: ErrorState
  readonly failureReason: string
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

/** Type guard for validation success */
export function isValidationSuccess<T>(
  result: ValidationResult<T>
): result is ValidationSuccess<T> {
  return result.valid
}

/** Type guard for validation failure */
export function isValidationFailure<T>(
  result: ValidationResult<T>
): result is ValidationFailure {
  return !result.valid
}

// =============================================================================
// QUERY PROCESSING TYPES
// Interfaces for property query operations and context
// =============================================================================

export interface PropertyQueryHelpers {
  extractFnr: (attrs: unknown) => string | number | null
  queryOwnerByFnr: (
    fnr: string | number,
    dataSourceId: string,
    dsManager: DataSourceManager,
    options?: { signal?: AbortSignal }
  ) => Promise<__esri.Graphic[]>
  queryOwnersByRelationship: (
    propertyFnrs: Array<string | number>,
    propertyDataSourceId: string,
    ownerDataSourceId: string,
    dsManager: DataSourceManager,
    relationshipId: number,
    options?: { signal?: AbortSignal }
  ) => Promise<Map<string, OwnerAttributes[]>>
  createRowId: (fnr: string | number, objectId: number) => string
  formatPropertyWithShare: (property: string, share?: string) => string
  formatOwnerInfo: (
    owner: OwnerAttributes,
    maskPII: boolean,
    unknownText: string
  ) => string
  isAbortError: (error: unknown) => boolean
}

export interface PropertyQueryMessages {
  readonly unknownOwner: string
  readonly errorOwnerQueryFailed: string
  readonly errorNoDataAvailable: string
}

export interface PropertyProcessingContext {
  readonly dsManager: DataSourceManager
  readonly maxResults: number
  readonly signal?: AbortSignal
  readonly helpers: PropertyQueryHelpers
  readonly messages: PropertyQueryMessages
}

export interface StandardQueryConfig {
  readonly ownerDataSourceId: string
  readonly enablePIIMasking: boolean
}

export interface BatchQueryConfig extends StandardQueryConfig {
  readonly propertyDataSourceId: string
  readonly relationshipId: number
}

export type FlexDirection = "row" | "column"

export interface StyleObject {
  [key: string]: any
}

export interface PropertyTableProps {
  data: GridRowData[]
  columns: Array<ColumnDef<GridRowData, any>>
  translate: (key: string) => string
  styles: WidgetStyles
}
