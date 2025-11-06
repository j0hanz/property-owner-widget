/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  type AllWidgetProps,
  appActions,
  DataSourceComponent,
  DataSourceManager,
  getAppStore,
  hooks,
  type ImmutableObject,
  type IMState,
  jsx,
  React,
  ReactRedux,
  type UseDataSource,
  WidgetState,
} from "jimu-core";
import { JimuMapViewComponent } from "jimu-arcgis";
import {
  Alert,
  Button,
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownMenu,
  defaultMessages as jimuUIMessages,
  Loading,
  LoadingType,
  SVG,
} from "jimu-ui";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { shallowEqual } from "react-redux";
import {
  CURSOR_TOOLTIP_STYLE,
  EXPORT_FORMATS,
  MIN_SPINNER_DISPLAY_MS,
  WIDGET_STARTUP_DELAY_MS,
} from "../config/constants";
import { ErrorType } from "../config/enums";
import { useWidgetStyles } from "../config/style";
import type {
  ErrorBoundaryProps,
  ErrorState,
  ExportFormat,
  GridRowData,
  IMConfig,
  IMStateWithProperty,
  PipelineExecutionContext,
  PipelineRunResult,
  PropertyPipelineSuccess,
  SelectionGraphicsHelpers,
  SelectionGraphicsParams,
  SerializedQueryResult,
  SerializedQueryResultMap,
} from "../config/types";
import { createPropertySelectors, propertyActions } from "../extensions/store";
import { clearQueryCache, runPropertySelectionPipeline } from "../shared/api";
import {
  createPropertyTableColumns,
  getDefaultSorting,
} from "../shared/config";
import {
  useAbortControllerPool,
  useEsriModules,
  useGraphicsLayer,
  useHitTestHover,
  useMapViewLifecycle,
  usePopupManager,
  useThrottle,
  useWidgetStartup,
} from "../shared/hooks";
import {
  createPerformanceTracker,
  trackError,
  trackEvent,
  trackFeatureUsage,
} from "../shared/telemetry";
import {
  abortHelpers,
  buildClipboardPayload,
  buildHighlightColor,
  buildResultsMap,
  collectSelectedRawData,
  computeWidgetsToClose,
  copyToClipboard,
  type CursorGraphicsState,
  cursorLifecycleHelpers,
  dataSourceHelpers,
  executePropertyQueryPipeline,
  exportData,
  extractFnr,
  formatOwnerInfo,
  getValidatedOutlineWidth,
  isAbortError,
  isValidationFailure,
  logger,
  normalizeFnrKey,
  notifyCopyOutcome,
  readAppWidgetsFromState,
  scheduleGraphicsRendering,
  syncCursorGraphics,
  syncGraphicsWithState,
  updatePropertySelectionState,
  validateMapClickRequest,
} from "../shared/utils/index";
import { PropertyTable } from "./components/table";
import defaultMessages from "./translations/default";
import clearIcon from "../assets/clear-selection-general.svg";
import setupIcon from "../assets/config-missing.svg";
import copyButton from "../assets/copy.svg";
import exportIcon from "../assets/export.svg";
import mapSelect from "../assets/map-select.svg";

const syncSelectionGraphics = async (params: SelectionGraphicsParams) => {
  const {
    graphicsToAdd,
    selectedRows,
    getCurrentView,
    helpers,
    highlightColor,
    outlineWidth,
  } = params;

  const view = getCurrentView();
  if (!view) {
    return;
  }

  await syncGraphicsWithState({
    graphicsToAdd,
    selectedRows,
    view,
    helpers,
    highlightColor,
    outlineWidth,
  });
};

const resolveWidgetId = (props: AllWidgetProps<IMConfig>): string => {
  const widgetIdProp = (props as unknown as { widgetId?: string }).widgetId;
  const fallbackId = props.id as unknown as string;
  if (typeof widgetIdProp === "string" && widgetIdProp.length > 0) {
    return widgetIdProp;
  }
  return fallbackId ?? fallbackId;
};

// Error boundaries require class components in React (no functional equivalent)
class PropertyWidgetErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  { hasError: boolean; error: Error | null }
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    trackError("error_boundary", error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div css={this.props.styles.errorWrap}>
          <Alert
            type="error"
            fullWidth
            css={this.props.styles.alert}
            text={this.props.translate("errorBoundaryMessage")}
          />
          {this.state.error && (
            <div css={this.props.styles.errorHint}>
              {this.state.error.message}
            </div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

const WidgetContent = (props: AllWidgetProps<IMConfig>): React.ReactElement => {
  const { config, id, useMapWidgetIds } = props;
  const styles = useWidgetStyles();
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages);

  const widgetId = resolveWidgetId(props);
  const selectorsRef = React.useRef(createPropertySelectors(widgetId));
  const selectors = selectorsRef.current;
  const dispatch = ReactRedux.useDispatch();

  const runtimeState = ReactRedux.useSelector((state: IMState) => {
    const widgetInfo = state.widgetsRuntimeInfo?.[widgetId];
    if (widgetInfo?.state !== undefined) {
      return widgetInfo.state;
    }
    return state.widgetsRuntimeInfo?.[id]?.state;
  });
  const prevRuntimeState = hooks.usePrevious(runtimeState);

  const error = ReactRedux.useSelector<IMStateWithProperty, ErrorState | null>(
    selectors.selectError
  );
  const selectedProperties = ReactRedux.useSelector<
    IMStateWithProperty,
    GridRowData[]
  >(selectors.selectSelectedProperties, shallowEqual);
  const rawPropertyResults = ReactRedux.useSelector<
    IMStateWithProperty,
    SerializedQueryResultMap | null
  >(selectors.selectRawResults, shallowEqual);
  const selectedCount = selectedProperties.length;
  const hasSelectedProperties = selectedCount > 0;

  const [urlFeedback, setUrlFeedback] = React.useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  hooks.useUpdateEffect(() => {
    if (!urlFeedback || typeof window === "undefined") {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setUrlFeedback(null);
    }, 4000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [urlFeedback]);

  hooks.useUpdateEffect(() => {
    if (hasSelectedProperties) return;
    if (urlFeedback) {
      setUrlFeedback(null);
    }
  }, [hasSelectedProperties]);

  // Latest value refs: Provide current values to callbacks without triggering re-renders
  const selectedPropertiesRef =
    hooks.useLatest<GridRowData[]>(selectedProperties);
  const rawPropertyResultsRef =
    hooks.useLatest<SerializedQueryResultMap | null>(rawPropertyResults);

  const prepareQueryExecution = hooks.useEventCallback(
    (
      event: __esri.ViewClickEvent,
      tracker: ReturnType<typeof createPerformanceTracker>
    ): PipelineExecutionContext | null => {
      const validation = validateMapClickRequest({
        event,
        modules,
        config,
        dsManager: dsManagerRef.current,
        translate,
      });

      if (isValidationFailure(validation)) {
        const { error, failureReason } = validation;
        setError(error.type as ErrorType, error.message);
        tracker.failure(failureReason);
        trackError("map_click_validation", failureReason);
        return null;
      }

      const { mapPoint, manager } = validation.data;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const isStaleRequest = () => requestId !== requestIdRef.current;

      dispatch(propertyActions.clearError(widgetId));
      dispatch(propertyActions.setQueryInFlight(true, widgetId));

      const currentSelection = selectedPropertiesRef.current ?? [];
      const selectionForPipeline = [...currentSelection];

      const controller = getController();

      return {
        mapPoint,
        manager,
        controller,
        isStaleRequest,
        selectionForPipeline,
      };
    }
  );

  const runSelectionPipeline = hooks.useEventCallback(
    async (params: {
      context: PipelineExecutionContext;
      perfStart: number;
    }): Promise<PipelineRunResult> => {
      const { context } = params;

      const pipelineResult = await executePropertyQueryPipeline({
        mapPoint: context.mapPoint,
        config,
        dsManager: context.manager,
        maxResults,
        toggleEnabled,
        enablePIIMasking: piiMaskingEnabled,
        selectedProperties: context.selectionForPipeline,
        signal: context.controller.signal,
        translate,
        runPipeline: runPropertySelectionPipeline,
      });

      const abortStatus = abortHelpers.checkAbortedOrStale(
        context.controller.signal,
        context.isStaleRequest
      );

      if (abortStatus === "stale") {
        return { status: "stale" };
      }

      if (abortStatus === "aborted") {
        return { status: "aborted" };
      }

      if (pipelineResult.status === "empty") {
        return { status: "empty" };
      }

      return {
        status: "success",
        pipelineResult,
      };
    }
  );

  const finalizeSelection = hooks.useEventCallback(
    (params: {
      pipelineResult: PropertyPipelineSuccess;
      context: PipelineExecutionContext;
      perfStart: number;
    }): number => {
      const { pipelineResult, context } = params;

      const removedRows = context.selectionForPipeline.filter((row) =>
        pipelineResult.toRemove.has(normalizeFnrKey(row.FNR))
      );

      if (removedRows.length > 0) {
        trackEvent({
          category: "Property",
          action: "toggle_remove",
          value: removedRows.length,
        });
      }

      if (context.isStaleRequest()) {
        return pipelineResult.rowsToProcess.length;
      }

      const stateUpdate = updatePropertySelectionState({
        pipelineResult,
        previousRawResults: rawPropertyResultsRef.current,
        selectedProperties: context.selectionForPipeline,
        dispatch,
        widgetId,
        removeHighlightForFnr,
        normalizeFnrKey,
        highlightColorConfig,
        highlightOpacityConfig,
        outlineWidthConfig,
      });

      rawPropertyResultsRef.current = stateUpdate.resultsToStore;

      const graphicsHelpers = {
        highlightGraphics,
        clearHighlights,
        ensureLayerView,
        applyHighlightOptions,
        removeHighlightForFnr,
        extractFnr,
        normalizeFnrKey,
      } satisfies SelectionGraphicsHelpers;

      scheduleGraphicsRendering({
        pipelineResult,
        highlightColor: stateUpdate.highlightColor,
        outlineWidth: stateUpdate.outlineWidth,
        graphicsHelpers,
        getCurrentView,
        isStaleRequest: context.isStaleRequest,
        syncFn: syncSelectionGraphics,
      });

      return pipelineResult.rowsToProcess.length;
    }
  );

  const handleSelectionError = hooks.useEventCallback(
    (
      error: unknown,
      tracker: ReturnType<typeof createPerformanceTracker>,
      context: PipelineExecutionContext
    ) => {
      if (context.isStaleRequest()) {
        return;
      }

      if (isAbortError(error)) {
        tracker.failure("aborted");
        dispatch(propertyActions.setQueryInFlight(false, widgetId));
        return;
      }

      logger.error("Property query error:", error, {
        message: error instanceof Error ? error.message : undefined,
        stack: error instanceof Error ? error.stack : undefined,
        propertyDsId: config.propertyDataSourceId,
        ownerDsId: config.ownerDataSourceId,
      });
      setError(ErrorType.QUERY_ERROR, translate("errorQueryFailed"));
      tracker.failure("query_error");
      dispatch(propertyActions.setQueryInFlight(false, widgetId));
      trackError("property_query", error);
    }
  );

  hooks.useEffectOnce(() => {
    // Widget mounted
  });

  const propertyUseDataSource = (() => {
    const candidate = dataSourceHelpers.findById(
      props.useDataSources,
      config.propertyDataSourceId
    );
    if (!candidate) return null;
    const mutableCandidate = candidate as {
      asMutable?: (options?: { deep?: boolean }) => unknown;
    };
    if (typeof mutableCandidate.asMutable === "function") {
      return candidate as ImmutableObject<UseDataSource>;
    }
    return null;
  })();
  const ownerUseDataSource = (() => {
    const candidate = dataSourceHelpers.findById(
      props.useDataSources,
      config.ownerDataSourceId
    );
    if (!candidate) return null;
    const mutableCandidate = candidate as {
      asMutable?: (options?: { deep?: boolean }) => unknown;
    };
    if (typeof mutableCandidate.asMutable === "function") {
      return candidate as ImmutableObject<UseDataSource>;
    }
    return null;
  })();
  const propertyUseDataSourceId = dataSourceHelpers.extractId(
    propertyUseDataSource
  );
  const ownerUseDataSourceId = dataSourceHelpers.extractId(ownerUseDataSource);

  // ArcGIS resource refs: Singleton manager and query tracking
  const dsManagerRef = React.useRef<DataSourceManager | null>(null);
  if (!dsManagerRef.current) {
    dsManagerRef.current = DataSourceManager.getInstance();
  }

  const {
    modules,
    loading: modulesLoading,
    error: modulesError,
  } = useEsriModules();

  // Debounced startup state to prevent spinner flicker
  const { shouldShowLoading } = useWidgetStartup({
    modulesLoading,
    startupDelay: WIDGET_STARTUP_DELAY_MS,
    minSpinnerDisplay: MIN_SPINNER_DISPLAY_MS,
  });

  const {
    ensureLayerView,
    clearHighlights,
    removeHighlightForFnr,
    highlightGraphics,
    applyHighlightOptions,
    destroyGraphicsLayer,
  } = useGraphicsLayer({
    widgetId,
    propertyDataSourceId: config.propertyDataSourceId,
    dsManagerRef,
  });
  const { disablePopup, restorePopup } = usePopupManager(widgetId);
  const { getController, releaseController, abortAll } =
    useAbortControllerPool();
  const requestIdRef = React.useRef(0); // Increments for each query to detect stale requests

  const resetSelectionState = hooks.useEventCallback(
    (shouldTrackClear: boolean) => {
      abortAll();
      clearQueryCache();
      clearHighlights();

      const previousSelection = selectedPropertiesRef.current ?? [];
      if (shouldTrackClear && previousSelection.length > 0) {
        trackEvent({
          category: "Property",
          action: "clear_all",
          value: previousSelection.length,
        });
      }

      dispatch(propertyActions.clearAll(widgetId));
      dispatch(propertyActions.setRawResults(null, widgetId));
      dispatch(propertyActions.setQueryInFlight(false, widgetId));
    }
  );

  const handleClearAll = hooks.useEventCallback(() => {
    resetSelectionState(true);
  });

  const handleWidgetReset = hooks.useEventCallback(() => {
    resetSelectionState(false);
  });

  const setError = hooks.useEventCallback(
    (type: ErrorType, message: string, details?: string) => {
      dispatch(propertyActions.setError({ type, message, details }, widgetId));
    }
  );

  const renderConfiguredContent = () => {
    if (hasSelectedProperties) {
      const tableData = Array.isArray(selectedProperties)
        ? selectedProperties
        : Array.from(selectedProperties as Iterable<GridRowData>);
      return (
        <PropertyTable
          data={tableData}
          columns={tableColumns}
          translate={translate}
          styles={styles}
          sorting={tableSorting}
          onSortingChange={setTableSorting}
        />
      );
    }

    return (
      <div css={styles.emptyState} role="status" aria-live="polite">
        <SVG
          css={styles.svgState}
          src={mapSelect}
          width={100}
          height={100}
          aria-label={translate("clickMapToSelectProperties")}
        />
        <div css={styles.messageState}>
          {translate("clickMapToSelectProperties")}
        </div>
      </div>
    );
  };

  const maxResults = config.maxResults;
  const toggleEnabled = config.enableToggleRemoval;
  const piiMaskingEnabled = config.enablePIIMasking;
  const mapWidgetId = useMapWidgetIds?.[0];
  const highlightColorConfig = config.highlightColor;
  const highlightOpacityConfig = config.highlightOpacity;
  const outlineWidthConfig = config.outlineWidth;

  // View ref for hover queries
  const currentViewRef = React.useRef<__esri.MapView | null>(null);

  // Hover hitTest hook (client-side, instant)
  const {
    hoverTooltipData,
    isQuerying,
    performHitTest,
    lastHoverQueryPointRef,
    cleanup: cleanupHoverQuery,
    hasCompletedFirstHitTest,
  } = useHitTestHover({
    dataSourceId: config.propertyDataSourceId,
    dsManagerRef: dsManagerRef,
    viewRef: currentViewRef,
    enablePIIMasking: piiMaskingEnabled,
    translate,
  });

  // Use ref to avoid closure capture issues
  const hoverTooltipDataRef = hooks.useLatest(hoverTooltipData);
  const isQueryingRef = hooks.useLatest(isQuerying);
  const hasCompletedFirstQueryRef = hooks.useLatest(hasCompletedFirstHitTest);

  // Throttled hitTest function (50ms is standard for pointer-move)
  const throttledHitTest = useThrottle((event: __esri.ViewPointerMoveEvent) => {
    lastHoverQueryPointRef.current = { x: event.x, y: event.y };
    performHitTest(event);
  }, 50);

  hooks.useUpdateEffect(() => {
    const currentSelection = selectedPropertiesRef.current ?? [];
    if (currentSelection.length === 0) return;

    trackFeatureUsage("pii_masking_toggled", piiMaskingEnabled);

    const reformattedProperties = currentSelection.map((row) => {
      if (!row.rawOwner || typeof row.rawOwner !== "object") {
        return row;
      }
      const formattedOwner = formatOwnerInfo(
        row.rawOwner,
        piiMaskingEnabled,
        translate("unknownOwner")
      );
      return {
        ...row,
        BOSTADR: formattedOwner,
        ADDRESS: formattedOwner,
      };
    });

    dispatch(
      propertyActions.setSelectedProperties(reformattedProperties, widgetId)
    );
  }, [piiMaskingEnabled, translate, dispatch, widgetId]);

  hooks.useUpdateEffect(() => {
    const currentSelection = selectedPropertiesRef.current ?? [];
    if (currentSelection.length <= maxResults) return;

    trackEvent({
      category: "Property",
      action: "max_results_trim",
      value: currentSelection.length - maxResults,
    });

    const trimmedProperties = currentSelection.slice(0, maxResults);
    const removedProperties = currentSelection.slice(maxResults);

    removedProperties.forEach((prop) => {
      const fnr = prop.FNR;
      if (fnr != null) {
        removeHighlightForFnr(fnr, normalizeFnrKey);
      }
    });

    dispatch(
      propertyActions.setSelectedProperties(trimmedProperties, widgetId)
    );

    const existingRaw = rawPropertyResultsRef.current;
    if (existingRaw && Object.keys(existingRaw).length > 0) {
      const nextRaw: SerializedQueryResultMap = {};
      Object.keys(existingRaw).forEach((key) => {
        if (!removedProperties.some((prop) => prop.id === key)) {
          const rawValue = existingRaw[key];
          if (rawValue) {
            const clonedValue = JSON.parse(
              JSON.stringify(rawValue)
            ) as SerializedQueryResult;
            nextRaw[key] = clonedValue;
          }
        }
      });
      dispatch(propertyActions.setRawResults(nextRaw, widgetId));
    }
  }, [
    maxResults,
    normalizeFnrKey,
    removeHighlightForFnr,
    trackEvent,
    dispatch,
    widgetId,
  ]);

  hooks.useUpdateEffect(() => {
    trackFeatureUsage("toggle_removal_changed", toggleEnabled);
  }, [toggleEnabled]);

  hooks.useUpdateEffect(() => {
    trackFeatureUsage(
      "batch_owner_query_changed",
      config.enableBatchOwnerQuery ?? false
    );
  }, [config.enableBatchOwnerQuery, config.relationshipId]);

  const tableColumnsRef = React.useRef<Array<ColumnDef<GridRowData>>>(
    createPropertyTableColumns({ translate })
  );
  const tableColumns = tableColumnsRef.current;

  const [tableSorting, setTableSorting] =
    React.useState<SortingState>(getDefaultSorting());

  const closeOtherWidgets = hooks.useEventCallback(() => {
    if (!config?.autoCloseOtherWidgets) return;
    if (!widgetId) return;

    const store = typeof getAppStore === "function" ? getAppStore() : null;
    if (!store) return;

    const state = store.getState?.();
    if (!state) return;

    const runtimeInfo = state.widgetsRuntimeInfo as
      | {
          [id: string]:
            | { state?: WidgetState | string; isClassLoaded?: boolean }
            | undefined;
        }
      | undefined;

    const appWidgets = readAppWidgetsFromState(state);
    const targets = computeWidgetsToClose(runtimeInfo, widgetId, appWidgets);
    if (targets.length === 0) return;

    const safeTargets = targets.filter((targetId) => {
      const targetInfo = runtimeInfo?.[targetId];
      return Boolean(targetInfo?.isClassLoaded);
    });

    if (safeTargets.length === 0) return;

    trackEvent({
      category: "Widget",
      action: "close_other_widgets",
      value: safeTargets.length,
    });
    dispatch(appActions.closeWidgets(safeTargets));
  });

  const handleExport = hooks.useEventCallback((format: ExportFormat) => {
    if (!hasSelectedProperties) return;

    const resultsMap = buildResultsMap(rawPropertyResults);
    if (!resultsMap || resultsMap.size === 0) return;

    const selectedRows = [...selectedProperties];
    const selectedRawData = collectSelectedRawData(selectedRows, resultsMap);
    if (selectedRawData.length === 0) return;

    try {
      exportData(
        selectedRawData,
        selectedRows,
        {
          format,
          filename: "property-export",
          rowCount: selectedRows.length,
          definition: EXPORT_FORMATS.find((item) => item.id === format),
        },
        config.enablePIIMasking,
        translate("unknownOwner")
      );

      trackEvent({
        category: "Export",
        action: `export_${format}`,
        label: tableSorting.length > 0 ? "sorted" : "unsorted",
        value: selectedRows.length,
      });
    } catch (error) {
      trackError(`export_${format}`, error);
    }
  });

  const handleExportFormatSelect = hooks.useEventCallback(
    (format: ExportFormat) => {
      if (!["json", "csv", "geojson"].includes(format)) {
        return;
      }
      handleExport(format);
    }
  );

  const handleCopyToClipboard = hooks.useEventCallback(() => {
    setUrlFeedback(null);

    const currentSelection = selectedPropertiesRef.current ?? [];
    if (!currentSelection || currentSelection.length === 0) return;

    const selectionArray = [...currentSelection];

    try {
      const payload = buildClipboardPayload(
        selectionArray,
        tableSorting,
        piiMaskingEnabled,
        translate
      );

      if (!payload) return;

      const copySucceeded = copyToClipboard(payload.text);
      notifyCopyOutcome(
        copySucceeded,
        payload,
        translate,
        setUrlFeedback,
        trackEvent
      );
    } catch (error) {
      setUrlFeedback({
        type: "error",
        text: translate("copyFailed"),
      });
      trackError("copy_properties", error);
    }
  });

  const handlePropertyDataSourceFailed = hooks.useEventCallback(() => {
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"));
  });

  const handleOwnerDataSourceFailed = hooks.useEventCallback(() => {
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"));
  });

  const handleMapClickCore = hooks.useEventCallback(
    async (event: __esri.ViewClickEvent) => {
      const perfStart = performance.now();
      const tracker = createPerformanceTracker("map_click_query");

      const context = prepareQueryExecution(event, tracker);

      if (!context) {
        return;
      }

      const { controller } = context;

      try {
        const outcome = await runSelectionPipeline({
          context,
          perfStart,
        });

        if (outcome.status === "stale") {
          return;
        }

        if (outcome.status === "aborted") {
          tracker.failure("aborted");
          dispatch(propertyActions.setQueryInFlight(false, widgetId));
          return;
        }

        if (outcome.status === "empty") {
          dispatch(propertyActions.setQueryInFlight(false, widgetId));
          tracker.success();
          return;
        }

        const processedCount = finalizeSelection({
          pipelineResult: outcome.pipelineResult,
          context,
          perfStart,
        });

        tracker.success();
        trackEvent({
          category: "Query",
          action: "property_query",
          label: "success",
          value: processedCount,
        });
        trackFeatureUsage("pii_masking", piiMaskingEnabled);
        trackFeatureUsage("toggle_removal", toggleEnabled);
      } catch (error) {
        handleSelectionError(error, tracker, context);
      } finally {
        releaseController(controller);
      }
    }
  );

  const { onActiveViewChange, getCurrentView, reactivateMapView, cleanup } =
    useMapViewLifecycle({
      modules,
      ensureLayerView,
      destroyGraphicsLayer,
      disablePopup,
      restorePopup,
      onMapClick: handleMapClickCore,
    });

  // Update view ref when view changes
  hooks.useUpdateEffect(() => {
    const view = getCurrentView();
    currentViewRef.current = view;
  }, [getCurrentView]);

  // Simple graphics layer manager for cursor tooltips (separate from highlight layer)
  const ensureGraphicsLayer = hooks.useEventCallback((view: __esri.MapView) => {
    if (!view || !modules) return;

    const layerId = `property-${widgetId}-highlight-layer`;
    const existing = view.map.findLayerById(layerId);

    if (existing) return;

    if (!cachedLayerRef.current) {
      cachedLayerRef.current = new modules.GraphicsLayer({
        id: layerId,
        listMode: "hide",
      });
    }

    if (!view.map.findLayerById(cachedLayerRef.current.id)) {
      view.map.add(cachedLayerRef.current);
    }
  });

  // Cursor tracking state and refs
  const cursorGraphicsStateRef = React.useRef<CursorGraphicsState | null>(null);
  const pointerMoveHandleRef = React.useRef<__esri.Handle | null>(null);
  const pointerLeaveHandleRef = React.useRef<__esri.Handle | null>(null);
  const lastCursorPointRef = React.useRef<__esri.Point | null>(null);
  const cachedLayerRef = React.useRef<__esri.GraphicsLayer | null>(null);
  const rafIdRef = React.useRef<number | null>(null);
  const pendingMapPointRef = React.useRef<__esri.Point | null>(null);
  const cursorTooltipNoPropertyText = translate("cursorTooltipNoProperty");
  const cursorTooltipFormatText = translate("cursorTooltipFormat");
  const tooltipNoPropertyRef = hooks.useLatest(cursorTooltipNoPropertyText);
  const tooltipFormatRef = hooks.useLatest(cursorTooltipFormatText);
  const highlightColorConfigRef = hooks.useLatest(highlightColorConfig);
  const highlightOpacityConfigRef = hooks.useLatest(highlightOpacityConfig);

  const clearCursorGraphics = hooks.useEventCallback(() => {
    // Cancel any pending RAF update
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingMapPointRef.current = null;

    const state = cursorGraphicsStateRef.current;
    if (!state) {
      return;
    }

    const layer = cachedLayerRef.current;
    if (layer) {
      if (state.pointGraphic) {
        layer.remove(state.pointGraphic);
      }
      if (state.tooltipGraphic) {
        layer.remove(state.tooltipGraphic);
      }
    }

    cursorGraphicsStateRef.current = null;
  });

  const updateCursorPoint = hooks.useEventCallback(
    (mapPoint: __esri.Point | null) => {
      if (!mapPoint) {
        clearCursorGraphics();
        return;
      }

      if (!modules?.Graphic || !modules?.TextSymbol) {
        clearCursorGraphics();
        return;
      }

      const layer = cachedLayerRef.current;
      if (!layer) {
        clearCursorGraphics();
        return;
      }

      if (!modules?.Graphic || !modules?.TextSymbol) {
        clearCursorGraphics();
        return;
      }

      const currentHighlightColor = buildHighlightColor(
        highlightColorConfigRef.current,
        highlightOpacityConfigRef.current
      );

      let tooltipText: string | null = null;

      const currentHoverData = hoverTooltipDataRef.current;
      const hasCompleted = hasCompletedFirstQueryRef.current;
      const isCurrentlyQuerying = isQueryingRef.current;

      if (currentHoverData) {
        tooltipText = tooltipFormatRef.current.replace(
          "{fastighet}",
          currentHoverData.fastighet
        );
      } else if (
        hasCompleted &&
        !isCurrentlyQuerying &&
        lastCursorPointRef.current
      ) {
        tooltipText = tooltipNoPropertyRef.current;
      }

      cursorGraphicsStateRef.current = syncCursorGraphics({
        modules,
        layer,
        mapPoint,
        tooltipText,
        highlightColor: currentHighlightColor,
        existing: cursorGraphicsStateRef.current,
        style: CURSOR_TOOLTIP_STYLE,
      });
    }
  );

  // Setup pointer-move listener when widget is active
  hooks.useUpdateEffect(() => {
    const view = getCurrentView();
    if (!view) {
      return undefined;
    }

    const isActive =
      runtimeState === WidgetState.Opened ||
      runtimeState === WidgetState.Active;

    cursorLifecycleHelpers.cleanupHandles({
      pointerMoveHandle: pointerMoveHandleRef,
      pointerLeaveHandle: pointerLeaveHandleRef,
      rafId: rafIdRef,
      clearGraphics: clearCursorGraphics,
      cleanupQuery: cleanupHoverQuery,
    });

    const canTrackCursor =
      isActive && !!modules?.TextSymbol && !!modules?.Graphic;

    if (canTrackCursor) {
      cursorLifecycleHelpers.setupCursorTracking({
        view,
        widgetId,
        ensureGraphicsLayer,
        cachedLayerRef,
        pointerMoveHandleRef,
        pointerLeaveHandleRef,
        rafIdRef,
        lastCursorPointRef,
        pendingMapPointRef,
        lastHoverQueryPointRef,
        updateCursorPoint,
        throttledHitTest,
        cleanupHoverQuery,
      });
    } else {
      cursorLifecycleHelpers.resetCursorState({
        lastCursorPointRef,
        pendingMapPointRef,
        cachedLayerRef,
        clearGraphics: clearCursorGraphics,
        cleanupQuery: cleanupHoverQuery,
      });
    }

    return () => {
      cursorLifecycleHelpers.teardownCursorTracking({
        rafId: rafIdRef,
        pointerMoveHandle: pointerMoveHandleRef,
        pointerLeaveHandle: pointerLeaveHandleRef,
        lastCursorPointRef,
        pendingMapPointRef,
        cachedLayerRef,
        canTrackCursor,
        clearGraphics: clearCursorGraphics,
        cleanupQuery: cleanupHoverQuery,
      });
    };
  }, [runtimeState, modules, widgetId]);

  // Cleanup cursor point on unmount
  hooks.useUnmount(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (pointerMoveHandleRef.current) {
      pointerMoveHandleRef.current.remove();
      pointerMoveHandleRef.current = null;
    }
    if (pointerLeaveHandleRef.current) {
      pointerLeaveHandleRef.current.remove();
      pointerLeaveHandleRef.current = null;
    }
    cleanupHoverQuery();
    pendingMapPointRef.current = null;
    cachedLayerRef.current = null;
    lastCursorPointRef.current = null;
    clearCursorGraphics();
  });

  hooks.useUpdateEffect(() => {
    // Update cursor point to refresh tooltip when hover data changes
    if (!lastCursorPointRef.current) return;
    updateCursorPoint(lastCursorPointRef.current);
  }, [hoverTooltipData]);

  hooks.useUpdateEffect(() => {
    const view = getCurrentView();
    if (!view) {
      return;
    }

    const currentHighlightColor = buildHighlightColor(
      highlightColorConfig,
      highlightOpacityConfig
    );
    const currentOutlineWidth = getValidatedOutlineWidth(outlineWidthConfig);

    applyHighlightOptions(view, currentHighlightColor, currentOutlineWidth);
  }, [
    getCurrentView,
    applyHighlightOptions,
    highlightColorConfig,
    highlightOpacityConfig,
    outlineWidthConfig,
  ]);

  hooks.useUpdateEffect(() => {
    const isOpening =
      (runtimeState === WidgetState.Opened ||
        runtimeState === WidgetState.Active) &&
      (prevRuntimeState === WidgetState.Closed ||
        prevRuntimeState === WidgetState.Hidden ||
        typeof prevRuntimeState === "undefined");

    if (isOpening && modules) {
      const currentView = getCurrentView();
      if (currentView) {
        reactivateMapView();
        trackEvent({
          category: "Property",
          action: "widget_reopened",
          label: "from_controller",
        });
      }
    }
  }, [
    runtimeState,
    prevRuntimeState,
    modules,
    reactivateMapView,
    getCurrentView,
  ]);

  hooks.useUpdateEffect(() => {
    if (
      runtimeState === WidgetState.Closed &&
      prevRuntimeState !== WidgetState.Closed
    ) {
      handleWidgetReset();
      cleanup();
    }
  }, [runtimeState, prevRuntimeState, handleWidgetReset, cleanup]);

  hooks.useUpdateEffect(() => {
    const isOpening =
      (runtimeState === WidgetState.Opened ||
        runtimeState === WidgetState.Active) &&
      (prevRuntimeState === WidgetState.Closed ||
        prevRuntimeState === WidgetState.Hidden ||
        typeof prevRuntimeState === "undefined");

    if (isOpening) {
      closeOtherWidgets();
    }
  }, [runtimeState, prevRuntimeState, closeOtherWidgets]);

  hooks.useUnmount(() => {
    abortAll();
    clearQueryCache();
    clearHighlights();
    dispatch(propertyActions.removeWidgetState(widgetId));
  });

  const isConfigured = config.propertyDataSourceId && config.ownerDataSourceId;

  if (shouldShowLoading) {
    return (
      <div
        css={styles.parent}
        role="region"
        aria-label={translate("widgetTitle")}
      >
        <div
          css={styles.emptyState}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Loading
            css={styles.loadingState}
            type={LoadingType.Donut}
            width={150}
            height={150}
            aria-label={translate("loadingModules")}
          />
        </div>
      </div>
    );
  }

  if (modulesError) {
    return (
      <div
        css={styles.parent}
        role="region"
        aria-label={translate("widgetTitle")}
      >
        <div css={styles.body} role="main">
          <div css={styles.emptyState} role="status" aria-live="polite">
            <SVG
              css={styles.svgState}
              src={setupIcon}
              width={100}
              height={100}
            />
            <div css={styles.messageState}>
              {translate("widgetNotConfigured")}
            </div>
          </div>
        </div>

        <div css={styles.footer}>
          <div css={styles.col}>{translate("propertySelected")}</div>
          <div css={styles.col}>0</div>

          <div css={styles.footerAlertOverlay}>
            <Alert
              type="error"
              fullWidth
              css={styles.alert}
              text={translate("errorLoadingModules")}
              role="alert"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      css={styles.parent}
      role="region"
      aria-label={translate("widgetTitle")}
    >
      {propertyUseDataSource ? (
        <DataSourceComponent
          key={`${id}-property-ds`}
          useDataSource={propertyUseDataSource}
          onCreateDataSourceFailed={handlePropertyDataSourceFailed}
        />
      ) : null}
      {ownerUseDataSource &&
      ownerUseDataSourceId !== propertyUseDataSourceId ? (
        <DataSourceComponent
          key={`${id}-owner-ds`}
          useDataSource={ownerUseDataSource}
          onCreateDataSourceFailed={handleOwnerDataSourceFailed}
        />
      ) : null}
      <div css={styles.header}>
        <div css={styles.headerActions}>
          <div css={styles.buttons}>
            <Button
              type="tertiary"
              icon
              onClick={handleCopyToClipboard}
              title={translate("copyToClipboard")}
              aria-label={translate("copyToClipboard")}
              disabled={!hasSelectedProperties}
            >
              <SVG src={copyButton} size={20} />
            </Button>
            <Dropdown
              activeIcon
              menuRole="listbox"
              aria-label={translate("exportData")}
            >
              <DropdownButton
                arrow={false}
                icon
                type="tertiary"
                disabled={!hasSelectedProperties}
                title={translate("exportData")}
                role="combobox"
              >
                <SVG src={exportIcon} size={20} />
              </DropdownButton>
              <DropdownMenu alignment="start">
                {EXPORT_FORMATS.map((format) => (
                  <DropdownItem
                    key={format.id}
                    onClick={() => handleExportFormatSelect(format.id)}
                    role="menuitem"
                    title={translate(`export${format.label}Desc`)}
                  >
                    {translate(`export${format.label}`)}
                  </DropdownItem>
                ))}
              </DropdownMenu>
            </Dropdown>
            <Button
              type="tertiary"
              icon
              onClick={handleClearAll}
              title={translate("clearAll")}
              disabled={!hasSelectedProperties}
            >
              <SVG src={clearIcon} size={20} />
            </Button>
          </div>
        </div>
      </div>
      <div css={styles.body} role="main">
        {!isConfigured ? (
          <div css={styles.emptyState} role="status" aria-live="polite">
            <SVG
              css={styles.svgState}
              src={setupIcon}
              width={100}
              height={100}
            />
            <div css={styles.messageState}>
              {translate("widgetNotConfigured")}
            </div>
          </div>
        ) : (
          renderConfiguredContent()
        )}
      </div>

      <div css={styles.footer}>
        <div css={styles.col}>{translate("propertySelected")}</div>
        <div css={styles.col}>{selectedCount}</div>

        {urlFeedback || error ? (
          <div css={styles.footerAlertOverlay}>
            {error ? (
              <Alert
                type="error"
                fullWidth
                css={styles.alert}
                text={error.message}
                role="alert"
              />
            ) : null}
            {urlFeedback ? (
              <>
                <Alert
                  type={urlFeedback.type}
                  fullWidth
                  css={styles.alert}
                  text={urlFeedback.text}
                  role="status"
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {mapWidgetId ? (
        <JimuMapViewComponent
          useMapWidgetId={mapWidgetId}
          onActiveViewChange={onActiveViewChange}
        />
      ) : null}
    </div>
  );
};

const Widget = (props: AllWidgetProps<IMConfig>): React.ReactElement => {
  const styles = useWidgetStyles();
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages);
  return (
    <PropertyWidgetErrorBoundary styles={styles} translate={translate}>
      <WidgetContent {...props} />
    </PropertyWidgetErrorBoundary>
  );
};

export default Widget;
