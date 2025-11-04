import type { ImmutableObject, DataSourceManager, IMState } from "jimu-core";
import type { ColumnDef } from "@tanstack/react-table";
import type { WidgetStyles } from "./style";

export interface AttributeMap {
  [key: string]: unknown;
}
export type FnrValue = string | number;
export type NormalizedFnr = string;

export interface SerializedRecord {
  [key: string]: unknown;
}

// =============================================================================
// WIDGET CONFIGURATION
// Core configuration interface for property widget settings
// =============================================================================

/**
 * Widget configuration stored in app config
 * All properties are immutable at runtime - updates via onSettingChange only
 */
export interface Config {
  propertyDataSourceId: string;
  ownerDataSourceId: string;
  displayColumns: readonly string[];
  maxResults: number;
  enableToggleRemoval: boolean;
  allowedHosts?: readonly string[];
  enablePIIMasking: boolean;
  relationshipId?: number;
  enableBatchOwnerQuery: boolean;
  highlightColor?: string;
  highlightOpacity?: number;
  outlineWidth?: number;
  autoCloseOtherWidgets?: boolean;
  fbwebbBaseUrl?: string;
  fbwebbUser?: string;
  fbwebbPassword?: string;
  fbwebbDatabase?: string;
}

export type IMConfig = ImmutableObject<Config>;

export interface FBWebbConfig {
  baseUrl: string;
  user: string;
  password: string;
  database: string;
}

export const isFBWebbConfigured = (
  config: IMConfig | Config
): config is IMConfig &
  Required<
    Pick<
      Config,
      "fbwebbBaseUrl" | "fbwebbUser" | "fbwebbPassword" | "fbwebbDatabase"
    >
  > => {
  const baseUrl = (config as Config).fbwebbBaseUrl;
  const user = (config as Config).fbwebbUser;
  const password = (config as Config).fbwebbPassword;
  const database = (config as Config).fbwebbDatabase;

  return Boolean(baseUrl && user && password && database);
};

// =============================================================================
// DATA ATTRIBUTES
// Property and owner data structures from ArcGIS feature layers
// =============================================================================

export interface PropertyAttributes extends AttributeMap {
  OBJECTID: number;
  FNR: FnrValue;
  UUID_FASTIGHET: string;
  FASTIGHET: string;
}

export interface OwnerAttributes extends AttributeMap {
  OBJECTID: number;
  FNR: FnrValue;
  UUID_FASTIGHET: string;
  FASTIGHET: string;
  NAMN?: string;
  BOSTADR?: string;
  POSTNR?: string;
  POSTADR?: string;
  ANDEL?: string;
  ORGNR?: string;
  AGARLISTA?: string;
}

// =============================================================================
// GRID & EXPORT
// Data grid row structure and export format definitions
// =============================================================================

export interface GridRowData {
  id: string;
  FNR: FnrValue;
  UUID_FASTIGHET: string;
  FASTIGHET: string;
  BOSTADR: string;
  geometryType?: string | null;
  rawOwner?: OwnerAttributes;
}

export type ExportFormat = "json" | "csv" | "geojson";

export interface ExportFormatDefinition {
  id: ExportFormat;
  label: string;
  description: string;
  icon?: string;
  extension: string;
  mimeType: string;
}

export interface CsvHeaderValues {
  FNR: string;
  UUID_FASTIGHET: string;
  FASTIGHET: string;
  BOSTADR: string;
}

export interface ExportOptions {
  format: ExportFormat;
  filename: string;
  rowCount: number;
  definition?: ExportFormatDefinition;
}

// =============================================================================
// GRAPHICS & SELECTION
// Graphics layer manipulation and selection management
// =============================================================================

export interface SelectionGraphicsHelpers {
  addGraphicsToMap: (
    graphic: __esri.Graphic | null | undefined,
    view: __esri.MapView | null | undefined,
    extractFnr: (attrs: AttributeMap | null | undefined) => FnrValue | null,
    normalizeFnrKey: (fnr: FnrValue | null | undefined) => NormalizedFnr,
    highlightColor: [number, number, number, number],
    outlineWidth: number
  ) => void;
  addManyGraphicsToMap?: (
    graphics: Array<{ graphic: __esri.Graphic; fnr: FnrValue }>,
    view: __esri.MapView | null | undefined,
    extractFnr: (attrs: AttributeMap | null | undefined) => FnrValue | null,
    normalizeFnrKey: (fnr: FnrValue | null | undefined) => NormalizedFnr,
    highlightColor: [number, number, number, number],
    outlineWidth: number
  ) => void;
  extractFnr: (attrs: AttributeMap | null | undefined) => FnrValue | null;
  normalizeFnrKey: (fnr: FnrValue | null | undefined) => NormalizedFnr;
}

export interface SelectionGraphicsParams {
  graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: FnrValue }>;
  selectedRows: GridRowData[];
  getCurrentView: () => __esri.MapView | null | undefined;
  helpers: SelectionGraphicsHelpers;
  highlightColor: [number, number, number, number];
  outlineWidth: number;
}

// =============================================================================
// ERROR & STATE MANAGEMENT
// Widget error states and runtime state structure
// =============================================================================

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  styles: WidgetStyles;
  translate: (id: string) => string;
}

export interface ErrorState {
  type: "QUERY_ERROR" | "NETWORK_ERROR" | "VALIDATION_ERROR" | "GEOMETRY_ERROR";
  message: string;
  details?: string;
}

export interface PropertyWidgetState {
  error: ErrorState | null;
  selectedProperties: GridRowData[];
  isQueryInFlight: boolean;
  rawPropertyResults: SerializedQueryResultMap | null;
}

export interface IMPropertyGlobalState {
  readonly byId: {
    readonly [widgetId: string]: ImmutableObject<PropertyWidgetState>;
  };
}

export interface IMStateWithProperty extends IMState {
  readonly "property-state"?: IMPropertyGlobalState;
}

export interface QueryResult {
  features: __esri.Graphic[];
  propertyId: FnrValue;
}

export interface SerializedQueryFeature {
  attributes: SerializedRecord | null;
  geometry: SerializedRecord | null;
  aggregateGeometries?: SerializedRecord | null;
  symbol?: SerializedRecord | null;
  popupTemplate?: SerializedRecord | null;
}

export interface SerializedQueryResult {
  propertyId: FnrValue;
  features: SerializedQueryFeature[];
}

export interface SerializedQueryResultMap {
  [key: string]: SerializedQueryResult;
}

// =============================================================================
// ARCGIS JS API MODULES
// TypeScript interfaces for lazy-loaded ArcGIS modules
// =============================================================================

export interface EsriModules {
  SimpleFillSymbol: new (
    properties?: __esri.SimpleFillSymbolProperties
  ) => __esri.SimpleFillSymbol;
  SimpleLineSymbol: new (
    properties?: __esri.SimpleLineSymbolProperties
  ) => __esri.SimpleLineSymbol;
  SimpleMarkerSymbol: new (
    properties?: __esri.SimpleMarkerSymbolProperties
  ) => __esri.SimpleMarkerSymbol;
  TextSymbol: new (
    properties?: __esri.TextSymbolProperties
  ) => __esri.TextSymbol;
  Graphic: new (properties?: __esri.GraphicProperties) => __esri.Graphic;
  GraphicsLayer: new (
    properties?: __esri.GraphicsLayerProperties
  ) => __esri.GraphicsLayer;
  Extent: new (properties?: __esri.ExtentProperties) => __esri.Extent;
}

export interface CursorTooltipStyle {
  readonly textColor: string;
  readonly backgroundColor: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: __esri.FontProperties["weight"];
  readonly verticalAlignment: __esri.TextSymbolProperties["verticalAlignment"];
  readonly horizontalAlignment: __esri.TextSymbolProperties["horizontalAlignment"];
  readonly yoffset: number;
  readonly xoffset: number;
  readonly lineWidth: number;
  readonly lineHeight: number;
  readonly kerning: boolean;
}

export interface UrlErrors {
  property: string | null;
  owner: string | null;
}

export interface ProcessPropertyResult {
  rowsToProcess: GridRowData[];
  graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: FnrValue }>;
}

export interface TelemetryEvent {
  category: string;
  action: string;
  label?: string;
  value?: number;
}

export interface PerformanceMetric {
  operation: string;
  duration: number;
  success: boolean;
  error?: string;
}

// =============================================================================
// VALIDATION RESULT TYPES
// Discriminated unions for type-safe validation results
// Use isValidationSuccess() and isValidationFailure() type guards
// =============================================================================

/**
 * Validation success result
 * Contains validated data of type T
 * Use type guard: if (isValidationSuccess(result)) { result.data... }
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ValidationSuccess<T> = {
  readonly valid: true;
  readonly data: T;
};

/**
 * Validation failure result
 * Contains error state and failure reason for debugging
 * Use type guard: if (isValidationFailure(result)) { result.error... }
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ValidationFailure = {
  readonly valid: false;
  readonly error: ErrorState;
  readonly failureReason: string;
};

/**
 * Discriminated union for validation results
 * Check result.valid to determine success/failure
 * Prefer type guards for type narrowing
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/** Type guard for validation success */
export function isValidationSuccess<T>(
  result: ValidationResult<T>
): result is ValidationSuccess<T> {
  return result.valid && "data" in result;
}

/** Type guard for validation failure */
export function isValidationFailure<T>(
  result: ValidationResult<T>
): result is ValidationFailure {
  return !result.valid;
}

// =============================================================================
// QUERY PROCESSING TYPES
// Interfaces for property query operations and context
// Used by processPropertyQueryResults pipeline
// =============================================================================

export interface PropertyQueryHelpers {
  extractFnr: (attrs: AttributeMap | null | undefined) => FnrValue | null;
  queryOwnerByFnr: (
    fnr: FnrValue,
    dataSourceId: string,
    dsManager: DataSourceManager,
    options?: { signal?: AbortSignal }
  ) => Promise<__esri.Graphic[]>;
  queryOwnersByRelationship: (
    propertyFnrs: FnrValue[],
    propertyDataSourceId: string,
    ownerDataSourceId: string,
    dsManager: DataSourceManager,
    relationshipId: number,
    options?: { signal?: AbortSignal }
  ) => Promise<Map<string, OwnerAttributes[]>>;
  createRowId: (fnr: FnrValue, objectId: number) => string;
  formatPropertyWithShare: (property: string, share?: string) => string;
  formatOwnerInfo: (
    owner: OwnerAttributes,
    maskPII: boolean,
    unknownText: string
  ) => string;
  isAbortError: (error: unknown) => boolean;
}

export interface PropertyQueryMessages {
  readonly unknownOwner: string;
  readonly errorOwnerQueryFailed: string;
  readonly errorNoDataAvailable: string;
}

export interface PropertyProcessingContext {
  readonly dsManager: DataSourceManager;
  readonly maxResults: number;
  readonly signal?: AbortSignal;
  readonly helpers: PropertyQueryHelpers;
  readonly messages: PropertyQueryMessages;
}

export interface StandardQueryConfig {
  readonly ownerDataSourceId: string;
  readonly enablePIIMasking: boolean;
}

export interface BatchQueryConfig extends StandardQueryConfig {
  readonly propertyDataSourceId: string;
  readonly relationshipId: number;
}

export interface PropertyIndividualQueryParams {
  readonly propertyResults: QueryResult[];
  readonly config: StandardQueryConfig;
  readonly context: PropertyProcessingContext;
}

export interface PropertyBatchQueryParams {
  readonly propertyResults: QueryResult[];
  readonly config: BatchQueryConfig;
  readonly context: PropertyProcessingContext;
}

export type FlexDirection = "row" | "column";

export type StyleValue = string | number | undefined | StyleObject;

export interface StyleObject {
  [key: string]: StyleValue;
}

export interface PropertyTableProps {
  data: GridRowData[];
  columns: Array<ColumnDef<GridRowData>>;
  translate: (key: string) => string;
  styles: WidgetStyles;
}

export interface LoadingBlockProps {
  styles: WidgetStyles;
  translate: (key: string) => string;
  size?: number;
}

// =============================================================================
// UTILITY INTERFACES FROM SHARED MODULES
// Interfaces extracted from utils.ts, api.ts, hooks.ts, and export.ts
// =============================================================================

export interface CursorGraphicsState {
  pointGraphic: __esri.Graphic | null;
  tooltipGraphic: __esri.Graphic | null;
  lastTooltipText: string | null;
}

export interface ProcessPropertyQueryParams {
  propertyResults: QueryResult[];
  config: {
    propertyDataSourceId: string;
    ownerDataSourceId: string;
    enablePIIMasking: boolean;
    relationshipId?: number;
    enableBatchOwnerQuery?: boolean;
  };
  processingContext: PropertyProcessingContext;
  services: {
    processBatch: (
      params: PropertyBatchQueryParams
    ) => Promise<ProcessPropertyResult>;
    processIndividual: (
      params: PropertyIndividualQueryParams
    ) => Promise<ProcessPropertyResult>;
  };
}

export interface PropertySelectionPipelineParams {
  mapPoint: __esri.Point;
  propertyDataSourceId: string;
  ownerDataSourceId: string;
  dsManager: DataSourceManager;
  maxResults: number;
  toggleEnabled: boolean;
  enableBatchOwnerQuery?: boolean;
  relationshipId?: number;
  enablePIIMasking: boolean;
  signal: AbortSignal;
  selectedProperties: GridRowData[];
  translate: (key: string) => string;
}

export type PropertySelectionPipelineResult =
  | { status: "empty" }
  | {
      status: "success";
      rowsToProcess: GridRowData[];
      graphicsToAdd: Array<{
        graphic: __esri.Graphic;
        fnr: FnrValue;
      }>;
      updatedRows: GridRowData[];
      toRemove: Set<string>;
      propertyResults: QueryResult[];
    };

export interface HoverQueryParams {
  config: {
    propertyDataSourceId: string;
    ownerDataSourceId: string;
    allowedHosts?: readonly string[];
  };
  dsManager: DataSourceManager | null;
  enablePIIMasking: boolean;
  translate: (key: string) => string;
}

export type DebouncedFn<T extends (...args: unknown[]) => void> = ((
  ...args: Parameters<T>
) => void) & {
  cancel: () => void;
};
