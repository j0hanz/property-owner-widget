import type {
  DataSourceManager,
  ImmutableArray,
  ImmutableObject,
  IMState,
  UseDataSource,
} from "jimu-core";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import type { Immutable } from "seamless-immutable";
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
}

export type IMConfig = ImmutableObject<Config>;

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
  ADDRESS: string;
  geometryType?: string | null;
  geometry?: SerializedRecord | null;
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
  ADDRESS: string;
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
  highlightGraphics: (params: {
    entries: Array<{
      graphic: __esri.Graphic;
      fnr: FnrValue | null | undefined;
    }>;
    view: __esri.MapView | null | undefined;
    extractFnr: (attrs: AttributeMap | null | undefined) => FnrValue | null;
    normalizeFnrKey: (fnr: FnrValue | null | undefined) => NormalizedFnr;
    highlightColor: [number, number, number, number];
    outlineWidth: number;
  }) => Promise<void>;
  removeHighlightForFnr: (
    fnr: FnrValue | null | undefined,
    normalizeFnrKey: (fnr: FnrValue | null | undefined) => NormalizedFnr
  ) => void;
  clearHighlights: () => void;
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
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
}

export interface LoadingBlockProps {
  styles: WidgetStyles;
  translate: (key: string) => string;
  size?: number;
}

export interface WidgetStartupState {
  isInitializing: boolean;
  shouldShowSpinner: boolean;
  modulesReady: boolean;
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

export interface HoverQueryConfig {
  propertyDataSourceId: string;
  ownerDataSourceId: string;
  allowedHosts?: readonly string[];
}

export interface GeometryInput {
  rings?: unknown;
  paths?: unknown;
  points?: unknown;
  xmin?: unknown;
  ymin?: unknown;
  xmax?: unknown;
  ymax?: unknown;
  x?: unknown;
  y?: unknown;
  z?: unknown;
}

export interface ExportContent {
  content: string;
  mimeType: string;
  extension: string;
}

export type GraphicWithAggregates = __esri.Graphic & {
  aggregateGeometries?: unknown;
};

export interface ValidationPipelineExecutor<TContext> {
  (context: TContext): ValidationResult<TContext>;
  addStep: (
    step: (context: TContext) => ValidationResult<TContext>
  ) => ValidationPipelineExecutor<TContext>;
  run: (context: TContext) => ValidationResult<TContext>;
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

// =============================================================================
// BROWSER & WINDOW INTERFACES
// Privacy signal interfaces for telemetry
// =============================================================================

export type NavigatorWithPrivacy = Navigator & {
  globalPrivacyControl?: boolean;
  msDoNotTrack?: string;
};

export type WindowWithPrivacy = Window & {
  doNotTrack?: string;
};

// =============================================================================
// UTILITY INTERFACES
// Generic utility types used across modules
// =============================================================================

export interface UnknownRecord {
  [key: string]: unknown;
}

export type UseDataSourceCandidate =
  | UseDataSource
  | ImmutableObject<UseDataSource>
  | null
  | undefined;

export type MapViewWithPopupToggle = __esri.MapView & {
  popupEnabled?: boolean;
};

// =============================================================================
// CONFIGURATION INTERFACES
// Config manipulation and settings panel types
// =============================================================================

export interface ConfigDictionary {
  readonly [key: string]: unknown;
}

export interface ConfigWithSet<T> {
  readonly set: (key: string, value: unknown) => T;
}

export type ConfigUpdater = (key: string, value: unknown) => void;

export interface EsriStubGlobal {
  __ESRI_TEST_STUB__?: (
    modules: readonly string[]
  ) => EsriModules | Promise<EsriModules> | Partial<EsriModules>;
}

// =============================================================================
// EXPORT & GEOJSON TYPES
// Data export format types
// =============================================================================

export type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiLineString"; coordinates: number[][][] }
  | { type: "Point"; coordinates: number[] }
  | { type: "MultiPoint"; coordinates: number[][] }
  | null;

// =============================================================================
// SETTINGS PANEL INTERFACES
// Settings panel form validation and manipulation
// =============================================================================

export interface FieldErrors {
  [key: string]: string | undefined;
}

export type ImmutableArrayFactory = <T>(
  values: readonly T[]
) => ImmutableArray<T>;

export interface MutableAccessor<T> {
  asMutable?: (options?: { deep?: boolean }) => T;
}

// =============================================================================
// ARCGIS API CONSTRUCTORS & INTERFACES
// ArcGIS JS API constructor types and query interfaces
// =============================================================================

export type FeatureLayerConstructor = new (
  properties?: __esri.FeatureLayerProperties
) => __esri.FeatureLayer;

export type QueryConstructor = new (
  properties?: __esri.QueryProperties
) => __esri.Query;

export interface PromiseUtilsLike {
  eachAlways: <T>(
    promises: Array<Promise<T>>
  ) => Promise<Array<{ value?: T; error?: unknown }>>;
}

export interface RelationshipQueryLike {
  objectIds: number[];
  relationshipId: number;
  outFields: string[];
}

export interface QueryTaskLike {
  executeRelationshipQuery: (
    query: RelationshipQueryLike,
    options?: SignalOptions
  ) => Promise<{
    [objectId: number]: { features?: __esri.Graphic[] } | undefined;
  }>;
}

export type QueryTaskConstructor = new (...args: unknown[]) => QueryTaskLike;

export type RelationshipQueryConstructor = new (
  ...args: unknown[]
) => RelationshipQueryLike;

export interface SignalOptions {
  signal: AbortSignal;
}

// =============================================================================
// DATA SOURCE VALIDATION INTERFACES
// Data source validation and processing types
// =============================================================================

export interface ValidateDataSourcesParams {
  propertyDsId?: string | null;
  ownerDsId?: string | null;
  dsManager: DataSourceManager | null;
  allowedHosts?: readonly string[];
  translate: (key: string) => string;
}

export interface ValidatedProperty {
  fnr: FnrValue;
  attrs: PropertyAttributes;
  graphic: __esri.Graphic;
}

export interface OwnerFetchSuccess {
  validated: ValidatedProperty;
  owners: OwnerAttributes[];
  queryFailed: boolean;
}

export interface OwnerQueryResolution {
  value?: OwnerFetchSuccess;
  error?: unknown;
}

export interface ProcessingAccumulator {
  rows: GridRowData[];
  graphics: Array<{ graphic: __esri.Graphic; fnr: FnrValue }>;
}

export interface CreateGridRowParams {
  fnr: FnrValue;
  objectId: number;
  uuidFastighet: string;
  fastighet: string;
  bostadr: string;
  address: string;
  geometryType: string | null;
  geometry?: SerializedRecord | null;
  createRowId: (fnr: FnrValue, objectId: number) => string;
  rawOwner?: OwnerAttributes;
}

export interface MapClickValidationParams {
  event: __esri.ViewClickEvent | null | undefined;
  modules: EsriModules | null;
  translate: (key: string) => string;
}

// =============================================================================
// REDUX ACTION TYPES
// Redux action union types for state management
// =============================================================================

export type PropertyAction =
  | {
      type: "PROPERTY_WIDGET/SET_ERROR";
      error: ErrorState | null;
      widgetId: string;
    }
  | {
      type: "PROPERTY_WIDGET/CLEAR_ERROR";
      widgetId: string;
    }
  | {
      type: "PROPERTY_WIDGET/SET_SELECTED_PROPERTIES";
      properties: GridRowData[];
      widgetId: string;
    }
  | {
      type: "PROPERTY_WIDGET/CLEAR_ALL";
      widgetId: string;
    }
  | {
      type: "PROPERTY_WIDGET/SET_QUERY_IN_FLIGHT";
      inFlight: boolean;
      widgetId: string;
    }
  | {
      type: "PROPERTY_WIDGET/SET_RAW_RESULTS";
      results: { [key: string]: SerializedQueryResult } | null;
      widgetId: string;
    }
  | {
      type: "PROPERTY_WIDGET/REMOVE_WIDGET_STATE";
      widgetId: string;
    };

/**
 * Redux dispatch function type
 * Used in dispatcher to safely dispatch actions to Redux store
 */
export type DispatchFn = ((action: unknown) => void) | undefined;

/**
 * Property dispatcher interface
 * Provides type-safe methods for dispatching property widget actions
 * Created by createPropertyDispatcher factory function
 */
export interface PropertyDispatcher {
  setError: (error: ErrorState | null) => void;
  clearError: () => void;
  setSelectedProperties: (properties: Iterable<GridRowData>) => void;
  clearAll: () => void;
  setQueryInFlight: (inFlight: boolean) => void;
  setRawResults: (
    results: { [key: string]: SerializedQueryResult } | null
  ) => void;
  removeWidgetState: () => void;
}

/**
 * Error handler for serialization failures during export
 * Receives error and type name for telemetry tracking
 */
export type SerializationErrorHandler = (
  error: unknown,
  typeName: string
) => void;

export type SeamlessImmutableFactory = <T>(input: T) => Immutable<T>;

// =============================================================================
// VALIDATION UTILITY TYPES
// Helper types for validation result extraction
// =============================================================================

export type ValidationFailureResult<T> = Extract<
  ValidationResult<T>,
  { valid: false }
>;

export type HighlightSymbolJSON<T extends "polygon" | "polyline" | "point"> =
  T extends "polygon"
    ? __esri.SimpleFillSymbolProperties
    : T extends "polyline"
      ? __esri.SimpleLineSymbolProperties
      : __esri.SimpleMarkerSymbolProperties;

// =============================================================================
// RUNTIME WIDGET TYPES
// Types for clipboard, pipeline execution, and error boundaries
// =============================================================================

export interface ClipboardPayload {
  text: string;
  count: number;
  isSorted: boolean;
}

export interface PipelineExecutionContext {
  mapPoint: __esri.Point;
  manager: DataSourceManager;
  controller: AbortController;
  isStaleRequest: () => boolean;
  selectionForPipeline: GridRowData[];
}

export type PipelineRunResult =
  | { status: "stale" }
  | { status: "aborted" }
  | { status: "empty" }
  | { status: "success"; pipelineResult: PropertyPipelineSuccess };

export type PropertyPipelineSuccess = Extract<
  PropertySelectionPipelineResult,
  { status: "success" }
>;

// =============================================================================
// STORE EXTENSION TYPES
// Types for Redux store state manipulation
// =============================================================================

export interface PropertySubStateMap {
  [key: string]: ImmutableObject<PropertyWidgetState>;
}
