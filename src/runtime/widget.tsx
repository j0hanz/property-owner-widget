/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  React,
  jsx,
  hooks,
  type AllWidgetProps,
  DataSourceManager,
  DataSourceComponent,
  ReactRedux,
  type IMState,
  WidgetState,
  appActions,
  getAppStore,
} from "jimu-core"
import { JimuMapViewComponent } from "jimu-arcgis"
import {
  Alert,
  Button,
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownMenu,
  Loading,
  LoadingType,
  SVG,
  TextInput,
  defaultMessages as jimuUIMessages,
} from "jimu-ui"
import { PropertyTable } from "./components/table"
import { createPropertyTableColumns } from "../shared/config"
import defaultMessages from "./translations/default"
import type { ColumnDef } from "@tanstack/react-table"
import type {
  IMConfig,
  ErrorBoundaryProps,
  GridRowData,
  SelectionGraphicsParams,
  ExportFormat,
  SerializedQueryResult,
} from "../config/types"
import { isFBWebbConfigured } from "../config/types"
import { ErrorType } from "../config/enums"
import { useWidgetStyles } from "../config/style"
import {
  useEsriModules,
  useGraphicsLayer,
  usePopupManager,
  useMapViewLifecycle,
  useAbortControllerPool,
  useDebounce,
  useThrottle,
  useHoverQuery,
} from "../shared/hooks"
import { clearQueryCache, runPropertySelectionPipeline } from "../shared/api"
import {
  formatOwnerInfo,
  extractFnr,
  isAbortError,
  normalizeFnrKey,
  validateMapClickPipeline,
  syncGraphicsWithState,
  cleanupRemovedGraphics,
  isValidationFailure,
  buildHighlightColor,
  computeWidgetsToClose,
  dataSourceHelpers,
  getValidatedOutlineWidth,
  updateRawPropertyResults,
  logger,
  syncCursorGraphics,
  abortHelpers,
  shouldSkipHoverQuery,
  updateGraphicSymbol,
  createPropertyDispatcher,
  cursorLifecycleHelpers,
  generateFBWebbUrl,
  copyToClipboard,
  maskPassword,
} from "../shared/utils"
import { createPropertySelectors } from "../extensions/store"
import type { CursorGraphicsState } from "../shared/utils"
import {
  EXPORT_FORMATS,
  CURSOR_TOOLTIP_STYLE,
  HOVER_QUERY_TOLERANCE_PX,
} from "../config/constants"
import {
  trackEvent,
  trackError,
  trackFeatureUsage,
  createPerformanceTracker,
} from "../shared/telemetry"
import clearIcon from "../assets/clear-selection-general.svg"
import setupIcon from "../assets/config-missing.svg"
import mapSelect from "../assets/map-select.svg"
import exportIcon from "../assets/export.svg"
import linkAddIcon from "../assets/link-add.svg"
import { exportData } from "../shared/export"

const syncSelectionGraphics = (params: SelectionGraphicsParams) => {
  const {
    graphicsToAdd,
    selectedRows,
    getCurrentView,
    helpers,
    highlightColor,
    outlineWidth,
  } = params

  const view = getCurrentView()
  if (!view) {
    return
  }

  syncGraphicsWithState({
    graphicsToAdd,
    selectedRows,
    view,
    helpers,
    highlightColor,
    outlineWidth,
  })
}

// Error boundaries require class components in React (no functional equivalent)
class PropertyWidgetErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  { hasError: boolean; error: Error | null }
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    trackError("error_boundary", error, errorInfo.componentStack)
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
      )
    }
    return this.props.children
  }
}

const WidgetContent = (props: AllWidgetProps<IMConfig>): React.ReactElement => {
  const { config, id, useMapWidgetIds } = props
  const styles = useWidgetStyles()
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages)

  const widgetIdProp = (props as unknown as { widgetId?: string }).widgetId
  const widgetId =
    (typeof widgetIdProp === "string" && widgetIdProp.length > 0
      ? widgetIdProp
      : (id as unknown as string)) ?? (id as unknown as string)

  const selectorsRef = React.useRef(createPropertySelectors(widgetId))
  const previousWidgetId = hooks.usePrevious(widgetId)
  if (
    !selectorsRef.current ||
    (previousWidgetId && previousWidgetId !== widgetId)
  ) {
    selectorsRef.current = createPropertySelectors(widgetId)
  }
  const selectors = selectorsRef.current

  const runtimeState = ReactRedux.useSelector((state: IMState) => {
    const widgetInfo = state.widgetsRuntimeInfo?.[widgetId]
    if (widgetInfo?.state !== undefined) {
      return widgetInfo.state
    }
    return state.widgetsRuntimeInfo?.[id]?.state
  })
  const prevRuntimeState = hooks.usePrevious(runtimeState)

  const error = ReactRedux.useSelector(selectors.selectError)
  const selectedProperties = ReactRedux.useSelector(
    selectors.selectSelectedProperties
  )
  const rawPropertyResults = ReactRedux.useSelector(selectors.selectRawResults)
  const selectedCount =
    typeof (selectedProperties as any)?.length === "number"
      ? (selectedProperties as any).length
      : 0
  const hasSelectedProperties = selectedCount > 0

  const [urlFeedback, setUrlFeedback] = React.useState<{
    type: "success" | "warning" | "error"
    text: string
    url?: string
  } | null>(null)

  React.useEffect(() => {
    if (!urlFeedback || urlFeedback.url) return
    if (typeof window === "undefined") return
    const timeout = window.setTimeout(() => {
      setUrlFeedback(null)
    }, 4000)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [urlFeedback])

  hooks.useUpdateEffect(() => {
    if (hasSelectedProperties) return
    if (urlFeedback) {
      setUrlFeedback(null)
    }
  }, [hasSelectedProperties])

  const propertyDispatchRef = React.useRef(
    createPropertyDispatcher(props.dispatch, widgetId)
  )
  hooks.useUpdateEffect(() => {
    propertyDispatchRef.current = createPropertyDispatcher(
      props.dispatch,
      widgetId
    )
  }, [props.dispatch, widgetId])

  const selectedPropertiesRef = hooks.useLatest(selectedProperties)
  const rawPropertyResultsRef = hooks.useLatest(rawPropertyResults)

  hooks.useEffectOnce(() => {
    // Widget mounted
  })

  const propertyUseDataSource = dataSourceHelpers.findById(
    props.useDataSources,
    config.propertyDataSourceId
  ) as any
  const ownerUseDataSource = dataSourceHelpers.findById(
    props.useDataSources,
    config.ownerDataSourceId
  ) as any
  const propertyUseDataSourceId = dataSourceHelpers.extractId(
    propertyUseDataSource
  )
  const ownerUseDataSourceId = dataSourceHelpers.extractId(ownerUseDataSource)

  const {
    modules,
    loading: modulesLoading,
    error: modulesError,
  } = useEsriModules()
  const {
    ensureGraphicsLayer,
    clearGraphics,
    removeGraphicsForFnr,
    addGraphicsToMap,
    destroyGraphicsLayer,
  } = useGraphicsLayer(modules, widgetId)
  const { disablePopup, restorePopup } = usePopupManager(widgetId)
  const { getController, releaseController, abortAll } =
    useAbortControllerPool()

  const dsManagerRef = React.useRef<DataSourceManager | null>(null)
  if (!dsManagerRef.current) {
    dsManagerRef.current = DataSourceManager.getInstance()
  }
  const requestIdRef = React.useRef(0)

  const resetSelectionState = hooks.useEventCallback(
    (shouldTrackClear: boolean) => {
      abortAll()
      clearQueryCache()
      clearGraphics()

      const previousSelection = selectedPropertiesRef.current ?? []
      if (shouldTrackClear && previousSelection.length > 0) {
        trackEvent({
          category: "Property",
          action: "clear_all",
          value: previousSelection.length,
        })
      }

      propertyDispatchRef.current.clearAll()
      propertyDispatchRef.current.setRawResults(null)
      propertyDispatchRef.current.setQueryInFlight(false)
    }
  )

  const handleClearAll = hooks.useEventCallback(() => {
    resetSelectionState(true)
  })

  const handleWidgetReset = hooks.useEventCallback(() => {
    resetSelectionState(false)
  })

  const setError = hooks.useEventCallback(
    (type: ErrorType, message: string, details?: string) => {
      propertyDispatchRef.current.setError({ type, message, details })
    }
  )

  const renderConfiguredContent = () => {
    if (hasSelectedProperties) {
      const tableData = Array.isArray(selectedProperties)
        ? selectedProperties
        : Array.from(selectedProperties as Iterable<GridRowData>)
      return (
        <PropertyTable
          data={tableData}
          columns={tableColumns}
          translate={translate}
          styles={styles}
        />
      )
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
    )
  }

  const maxResults = config.maxResults
  const toggleEnabled = config.enableToggleRemoval
  const piiMaskingEnabled = config.enablePIIMasking
  const mapWidgetId = useMapWidgetIds?.[0]
  const highlightColorConfig = config.highlightColor
  const highlightOpacityConfig = config.highlightOpacity
  const outlineWidthConfig = config.outlineWidth

  // Hover query hook
  const {
    hoverTooltipData,
    isHoverQueryActive,
    queryPropertyAtPoint,
    lastHoverQueryPointRef,
    cleanup: cleanupHoverQuery,
  } = useHoverQuery({
    config: {
      propertyDataSourceId: config.propertyDataSourceId,
      ownerDataSourceId: config.ownerDataSourceId,
      allowedHosts: config.allowedHosts,
    },
    dsManager: dsManagerRef.current,
    enablePIIMasking: piiMaskingEnabled,
    translate,
  })

  // Throttled hover query with spatial tolerance
  const throttledHoverQuery = useThrottle(
    (mapPoint: __esri.Point, screenPoint: { x: number; y: number }) => {
      if (
        shouldSkipHoverQuery(
          screenPoint,
          lastHoverQueryPointRef.current,
          HOVER_QUERY_TOLERANCE_PX
        )
      ) {
        return
      }
      lastHoverQueryPointRef.current = screenPoint
      queryPropertyAtPoint(mapPoint)
    },
    100
  )

  hooks.useUpdateEffect(() => {
    const currentSelection = selectedPropertiesRef.current ?? []
    if (currentSelection.length === 0) return

    trackFeatureUsage("pii_masking_toggled", piiMaskingEnabled)

    const reformattedProperties = currentSelection.map((row) => {
      if (!row.rawOwner || typeof row.rawOwner !== "object") {
        return row
      }
      return {
        ...row,
        BOSTADR: formatOwnerInfo(
          row.rawOwner,
          piiMaskingEnabled,
          translate("unknownOwner")
        ),
      }
    })

    propertyDispatchRef.current.setSelectedProperties(reformattedProperties)
  }, [piiMaskingEnabled, translate])

  hooks.useUpdateEffect(() => {
    const currentSelection = selectedPropertiesRef.current ?? []
    if (currentSelection.length <= maxResults) return

    trackEvent({
      category: "Property",
      action: "max_results_trim",
      value: currentSelection.length - maxResults,
    })

    const trimmedProperties = currentSelection.slice(0, maxResults)
    const removedProperties = currentSelection.slice(maxResults)

    removedProperties.forEach((prop) => {
      const fnr = prop.FNR
      if (fnr != null) {
        removeGraphicsForFnr(fnr, normalizeFnrKey)
      }
    })

    propertyDispatchRef.current.setSelectedProperties(trimmedProperties)

    const existingRaw = rawPropertyResultsRef.current
    if (existingRaw && Object.keys(existingRaw).length > 0) {
      const nextRaw: { [key: string]: SerializedQueryResult } = {}
      Object.keys(existingRaw).forEach((key) => {
        if (!removedProperties.some((prop) => prop.id === key)) {
          const rawValue = existingRaw[key]
          // Convert immutable object to plain object
          nextRaw[key] = JSON.parse(JSON.stringify(rawValue))
        }
      })
      propertyDispatchRef.current.setRawResults(nextRaw as any)
    }
  }, [maxResults, normalizeFnrKey, removeGraphicsForFnr, trackEvent])

  hooks.useUpdateEffect(() => {
    trackFeatureUsage("toggle_removal_changed", toggleEnabled)
  }, [toggleEnabled])

  hooks.useUpdateEffect(() => {
    trackFeatureUsage(
      "batch_owner_query_changed",
      config.enableBatchOwnerQuery ?? false
    )
  }, [config.enableBatchOwnerQuery, config.relationshipId])

  const tableColumnsRef = React.useRef<Array<ColumnDef<GridRowData, any>>>(
    createPropertyTableColumns({ translate })
  )
  const tableColumns = tableColumnsRef.current

  const closeOtherWidgets = hooks.useEventCallback(() => {
    if (!config?.autoCloseOtherWidgets) return
    if (!widgetId) return

    const store = typeof getAppStore === "function" ? getAppStore() : null
    if (!store) return

    const state = store.getState?.()
    if (!state) return

    const runtimeInfo = state.widgetsRuntimeInfo as
      | {
          [id: string]:
            | { state?: WidgetState | string; isClassLoaded?: boolean }
            | undefined
        }
      | undefined

    const appWidgets = (state as any)?.appConfig?.widgets
    const targets = computeWidgetsToClose(runtimeInfo, widgetId, appWidgets)
    if (targets.length === 0) return

    const safeTargets = targets.filter((targetId) => {
      const targetInfo = runtimeInfo?.[targetId]
      return Boolean(targetInfo?.isClassLoaded)
    })

    if (safeTargets.length === 0) return

    trackEvent({
      category: "Widget",
      action: "close_other_widgets",
      value: safeTargets.length,
    })
    props.dispatch(appActions.closeWidgets(safeTargets))
  })

  const handleExport = hooks.useEventCallback((format: ExportFormat) => {
    console.log("[Export] Starting export:", {
      format,
      hasSelectedProperties,
      rawPropertyResults,
    })

    if (!hasSelectedProperties) {
      console.log("[Export] No selected properties, aborting")
      return
    }

    if (!rawPropertyResults) {
      console.log("[Export] No raw results available, aborting")
      return
    }

    // Convert rawPropertyResults to Map for consistent access
    let resultsMap: Map<string, any>
    if (rawPropertyResults instanceof Map) {
      resultsMap = rawPropertyResults
    } else if (rawPropertyResults && typeof rawPropertyResults === "object") {
      // Handle Redux immutable object or plain object
      resultsMap = new Map()
      // Use for...in to handle both plain objects and Immutable objects
      for (const key in rawPropertyResults) {
        if (Object.prototype.hasOwnProperty.call(rawPropertyResults, key)) {
          const value = (rawPropertyResults as any)[key]
          if (value !== null && value !== undefined) {
            resultsMap.set(key, value)
          }
        }
      }
    } else {
      console.log(
        "[Export] Invalid rawPropertyResults type:",
        typeof rawPropertyResults
      )
      return
    }

    console.log("[Export] Results map size:", resultsMap.size)
    if (resultsMap.size === 0) {
      console.log("[Export] Results map is empty, aborting")
      return
    }

    const selectedRawData: any[] = []
    selectedProperties.forEach((row) => {
      const rawData = resultsMap.get(row.id)
      console.log("[Export] Looking up row:", row.id, "Found:", !!rawData)
      if (rawData) selectedRawData.push(rawData)
    })

    console.log("[Export] Selected raw data count:", selectedRawData.length)
    if (selectedRawData.length === 0) {
      console.log("[Export] No raw data found for selected rows, aborting")
      return
    }

    const selectedRows = Array.isArray(selectedProperties)
      ? selectedProperties
      : Array.from(selectedProperties as Iterable<GridRowData>)

    try {
      exportData(selectedRawData, selectedRows, {
        format,
        filename: "property-export",
        rowCount: selectedRows.length,
        definition: EXPORT_FORMATS.find((item) => item.id === format),
      })
    } catch (error) {
      console.error("Export failed", error)
    }
  })

  const handleExportFormatSelect = hooks.useEventCallback(
    (format: ExportFormat) => {
      if (!["json", "csv", "geojson"].includes(format)) {
        return
      }
      handleExport(format)
    }
  )

  const handleGenerateUrl = hooks.useEventCallback(() => {
    setUrlFeedback(null)
    const tracker = createPerformanceTracker("generate_fbwebb_url")

    if (!isFBWebbConfigured(config)) {
      setError(
        ErrorType.VALIDATION_ERROR,
        translate("errorFBWebbNotConfigured")
      )
      tracker.failure("config_missing")
      return
    }

    const currentSelection = selectedPropertiesRef.current ?? []
    if (currentSelection.length === 0) {
      setError(
        ErrorType.VALIDATION_ERROR,
        translate("errorNoPropertiesSelected")
      )
      tracker.failure("no_selection")
      return
    }

    try {
      const selectionArray = Array.isArray(currentSelection)
        ? currentSelection
        : Array.from(currentSelection as Iterable<GridRowData>)
      const fnrs = selectionArray
        .map((row) => row.FNR)
        .filter(
          (fnr): fnr is string | number => fnr !== null && fnr !== undefined
        )

      console.log("[URL Generation] FBWebb request", {
        propertyCount: selectionArray.length,
        baseUrl: config.fbwebbBaseUrl,
        user: config.fbwebbUser,
        database: config.fbwebbDatabase,
        password: maskPassword(config.fbwebbPassword),
      })

      const url = generateFBWebbUrl(fnrs, config.fbwebbBaseUrl, {
        user: config.fbwebbUser,
        password: config.fbwebbPassword,
        database: config.fbwebbDatabase,
      })

      const copySucceeded = copyToClipboard(url)
      const countMessage = translate("urlGeneratedFor").replace(
        "{count}",
        String(fnrs.length)
      )

      if (copySucceeded) {
        const successMessage =
          `${translate("urlCopiedSuccess")} ${countMessage}`.trim()
        setUrlFeedback({ type: "success", text: successMessage })
        trackEvent({
          category: "Property",
          action: "generate_url",
          label: "fbwebb",
          value: fnrs.length,
        })
        tracker.success()
      } else {
        const warningMessage =
          `${translate("urlCopyManualFallback")} ${countMessage}`.trim()
        setUrlFeedback({ type: "warning", text: warningMessage, url })
        trackEvent({
          category: "Property",
          action: "generate_url_manual_copy",
          label: "fbwebb",
          value: fnrs.length,
        })
        tracker.failure("clipboard_fallback")
      }

      console.log("[URL Generation] FBWebb URL ready", {
        length: url.length,
        password: maskPassword(config.fbwebbPassword),
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : "unknown_error"

      setUrlFeedback({
        type: "error",
        text: translate("errorUrlGenerationFailed"),
      })

      setError(
        ErrorType.VALIDATION_ERROR,
        translate("errorUrlGenerationFailed"),
        errorMessage
      )

      trackError("generate_fbwebb_url", error, errorMessage)
      tracker.failure(errorMessage)
    }
  })

  const handlePropertyDataSourceFailed = hooks.useEventCallback(() => {
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
  })

  const handleOwnerDataSourceFailed = hooks.useEventCallback(() => {
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
  })

  const handleMapClick = hooks.useEventCallback(
    async (event: __esri.ViewClickEvent) => {
      const perfStart = performance.now()
      console.log("[PERF] Map click started at", perfStart)
      // Don't abort all on every click - only abort when starting new query
      // abortAll() removes ability to benefit from any caching
      const tracker = createPerformanceTracker("map_click_query")

      const validation = validateMapClickPipeline({
        event,
        modules,
        config,
        dsManager: dsManagerRef.current,
        translate,
      })

      if (isValidationFailure(validation)) {
        const { error, failureReason } = validation
        setError(error.type as ErrorType, error.message)
        tracker.failure(failureReason)
        trackError("map_click_validation", failureReason)
        return
      }

      const { mapPoint, manager } = validation.data

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const isStaleRequest = () => requestId !== requestIdRef.current

      propertyDispatchRef.current.clearError()
      propertyDispatchRef.current.setQueryInFlight(true)

      const currentSelection = selectedPropertiesRef.current ?? []
      const selectionForPipeline = Array.isArray(currentSelection)
        ? currentSelection
        : Array.from(currentSelection as Iterable<GridRowData>)

      const controller = getController()

      try {
        const pipelineStart = performance.now()
        console.log(
          "[PERF] Pipeline started at",
          pipelineStart - perfStart,
          "ms"
        )
        const pipelineResult = await runPropertySelectionPipeline({
          mapPoint,
          propertyDataSourceId: config.propertyDataSourceId,
          ownerDataSourceId: config.ownerDataSourceId,
          dsManager: manager,
          maxResults,
          toggleEnabled,
          enableBatchOwnerQuery: config.enableBatchOwnerQuery,
          relationshipId: config.relationshipId,
          enablePIIMasking: piiMaskingEnabled,
          signal: controller.signal,
          selectedProperties: selectionForPipeline,
          translate,
        })
        const pipelineEnd = performance.now()
        console.log(
          "[PERF] Pipeline completed at",
          pipelineEnd - perfStart,
          "ms",
          "(took",
          pipelineEnd - pipelineStart,
          "ms)"
        )

        const abortStatus = abortHelpers.checkAbortedOrStale(
          controller.signal,
          isStaleRequest
        )
        if (abortStatus === "stale") {
          return
        }
        if (abortStatus === "aborted") {
          tracker.failure("aborted")
          return
        }

        if (pipelineResult.status === "empty") {
          if (!isStaleRequest()) {
            propertyDispatchRef.current.setQueryInFlight(false)
          }
          tracker.success()
          return
        }

        const removedRows = selectionForPipeline.filter((row) =>
          pipelineResult.toRemove.has(normalizeFnrKey(row.FNR))
        )

        if (removedRows.length > 0) {
          trackEvent({
            category: "Property",
            action: "toggle_remove",
            value: removedRows.length,
          })
        }

        if (!isStaleRequest()) {
          const prevRawResults = rawPropertyResultsRef.current

          // Convert prevRawResults to a proper Map
          let baseRawResults: Map<string, SerializedQueryResult>
          if (prevRawResults instanceof Map) {
            baseRawResults = prevRawResults
          } else if (prevRawResults && typeof prevRawResults === "object") {
            // Handle plain objects or immutable objects from Redux
            baseRawResults = new Map<string, SerializedQueryResult>()
            Object.keys(prevRawResults).forEach((key) => {
              const value = (prevRawResults as any)[key]
              if (value && typeof value === "object") {
                baseRawResults.set(key, value as SerializedQueryResult)
              }
            })
          } else {
            baseRawResults = new Map<string, SerializedQueryResult>()
          }

          const updatedRawResults = updateRawPropertyResults(
            baseRawResults,
            pipelineResult.rowsToProcess,
            pipelineResult.propertyResults,
            pipelineResult.toRemove,
            selectionForPipeline,
            normalizeFnrKey
          )

          // Convert Map back to plain object for Redux storage
          const conversionStart = performance.now()
          const plainResults: { [key: string]: SerializedQueryResult } = {}
          updatedRawResults.forEach((value, key) => {
            plainResults[key] = value
          })
          console.log(
            "[PERF] Conversion to plain object at",
            conversionStart - perfStart,
            "ms"
          )

          // Store results but don't update UI yet
          const dispatch = propertyDispatchRef.current
          const resultsToStore = plainResults
          const rowsToStore = pipelineResult.updatedRows

          // Clean up removed graphics first
          cleanupRemovedGraphics({
            toRemove: pipelineResult.toRemove,
            removeGraphicsForFnr,
            normalizeFnrKey,
          })

          const highlightColor = buildHighlightColor(
            highlightColorConfig,
            highlightOpacityConfig
          )
          const outlineWidth = getValidatedOutlineWidth(outlineWidthConfig)

          // Add graphics to map first (synchronous)
          const graphicsStart = performance.now()
          console.log(
            "[PERF] Graphics sync started at",
            graphicsStart - perfStart,
            "ms"
          )
          syncSelectionGraphics({
            graphicsToAdd: pipelineResult.graphicsToAdd,
            selectedRows: pipelineResult.updatedRows,
            getCurrentView,
            helpers: {
              addGraphicsToMap,
              extractFnr,
              normalizeFnrKey,
            },
            highlightColor,
            outlineWidth,
          })
          const graphicsEnd = performance.now()
          console.log(
            "[PERF] Graphics sync completed at",
            graphicsEnd - perfStart,
            "ms",
            "(took",
            graphicsEnd - graphicsStart,
            "ms)"
          )

          // Now update Redux state AFTER graphics are visible
          const reduxStart = performance.now()
          console.log(
            "[PERF] Redux update started at",
            reduxStart - perfStart,
            "ms"
          )
          dispatch.setSelectedProperties(rowsToStore)
          dispatch.setRawResults(resultsToStore as any)
          dispatch.setQueryInFlight(false)
          const reduxEnd = performance.now()
          console.log(
            "[PERF] Redux update completed at",
            reduxEnd - perfStart,
            "ms",
            "(took",
            reduxEnd - reduxStart,
            "ms)"
          )
          console.log("[PERF] TOTAL TIME:", reduxEnd - perfStart, "ms")
        }

        tracker.success()
        trackEvent({
          category: "Query",
          action: "property_query",
          label: "success",
          value: pipelineResult.rowsToProcess.length,
        })
        trackFeatureUsage("pii_masking", piiMaskingEnabled)
        trackFeatureUsage("toggle_removal", toggleEnabled)
      } catch (error) {
        if (isStaleRequest()) {
          return
        }

        if (isAbortError(error)) {
          tracker.failure("aborted")
          propertyDispatchRef.current.setQueryInFlight(false)
          return
        }

        logger.error("Property query error:", error, {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          propertyDsId: config.propertyDataSourceId,
          ownerDsId: config.ownerDataSourceId,
        })
        setError(ErrorType.QUERY_ERROR, translate("errorQueryFailed"))
        tracker.failure("query_error")
        trackError("property_query", error)
      } finally {
        releaseController(controller)
      }
    }
  )

  const { onActiveViewChange, getCurrentView, reactivateMapView } =
    useMapViewLifecycle({
      modules,
      ensureGraphicsLayer,
      destroyGraphicsLayer,
      disablePopup,
      restorePopup,
      onMapClick: handleMapClick,
    })

  // Cursor point marker tracking
  const cursorGraphicsStateRef = React.useRef<CursorGraphicsState | null>(null)
  const pointerMoveHandleRef = React.useRef<__esri.Handle | null>(null)
  const pointerLeaveHandleRef = React.useRef<__esri.Handle | null>(null)
  const lastCursorPointRef = React.useRef<__esri.Point | null>(null)
  const cachedLayerRef = React.useRef<__esri.GraphicsLayer | null>(null)
  const rafIdRef = React.useRef<number | null>(null)
  const pendingMapPointRef = React.useRef<__esri.Point | null>(null)
  const cursorTooltipNoPropertyText = translate("cursorTooltipNoProperty")
  const cursorTooltipFormatText = translate("cursorTooltipFormat")
  const tooltipNoPropertyRef = hooks.useLatest(cursorTooltipNoPropertyText)
  const tooltipFormatRef = hooks.useLatest(cursorTooltipFormatText)
  const highlightColorConfigRef = hooks.useLatest(highlightColorConfig)
  const highlightOpacityConfigRef = hooks.useLatest(highlightOpacityConfig)
  const outlineWidthConfigRef = hooks.useLatest(outlineWidthConfig)

  const clearCursorGraphics = hooks.useEventCallback(() => {
    // Cancel any pending RAF update
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    pendingMapPointRef.current = null

    if (!cursorGraphicsStateRef.current) {
      return
    }

    const layer = cachedLayerRef.current
    if (layer) {
      if (cursorGraphicsStateRef.current.pointGraphic) {
        layer.remove(cursorGraphicsStateRef.current.pointGraphic)
      }
      if (cursorGraphicsStateRef.current.tooltipGraphic) {
        layer.remove(cursorGraphicsStateRef.current.tooltipGraphic)
      }
    }

    cursorGraphicsStateRef.current = null
  })

  const updateCursorPoint = hooks.useEventCallback(
    (mapPoint: __esri.Point | null) => {
      if (!mapPoint) {
        clearCursorGraphics()
        return
      }

      if (!modules?.Graphic || !modules?.TextSymbol) {
        clearCursorGraphics()
        return
      }

      const layer = cachedLayerRef.current
      if (!layer) {
        clearCursorGraphics()
        return
      }

      if (!modules?.Graphic || !modules?.TextSymbol) {
        clearCursorGraphics()
        return
      }

      const currentHighlightColor = buildHighlightColor(
        highlightColorConfigRef.current,
        highlightOpacityConfigRef.current
      )
      const currentOutlineWidth = getValidatedOutlineWidth(
        outlineWidthConfigRef.current
      )

      let tooltipText: string | null = null

      if (hoverTooltipData) {
        tooltipText = tooltipFormatRef.current.replace(
          "{fastighet}",
          hoverTooltipData.fastighet
        )
      } else if (!isHoverQueryActive) {
        tooltipText = tooltipNoPropertyRef.current
      }

      cursorGraphicsStateRef.current = syncCursorGraphics({
        modules,
        layer,
        mapPoint,
        tooltipText,
        highlightColor: currentHighlightColor,
        outlineWidth: currentOutlineWidth,
        existing: cursorGraphicsStateRef.current,
        style: CURSOR_TOOLTIP_STYLE,
      })
    }
  )

  // Setup pointer-move listener when widget is active
  hooks.useUpdateEffect(() => {
    const view = getCurrentView()
    if (!view) return

    const isActive =
      runtimeState === WidgetState.Opened || runtimeState === WidgetState.Active

    cursorLifecycleHelpers.cleanupHandles({
      pointerMoveHandle: pointerMoveHandleRef,
      pointerLeaveHandle: pointerLeaveHandleRef,
      rafId: rafIdRef,
      clearGraphics: clearCursorGraphics,
      cleanupQuery: cleanupHoverQuery,
    })

    const canTrackCursor =
      isActive && !!modules?.TextSymbol && !!modules?.Graphic

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
        throttledHoverQuery,
        cleanupHoverQuery,
      })
    } else {
      cursorLifecycleHelpers.resetCursorState({
        lastCursorPointRef,
        pendingMapPointRef,
        cachedLayerRef,
        clearGraphics: clearCursorGraphics,
        cleanupQuery: cleanupHoverQuery,
      })
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
      })
    }
  }, [runtimeState, modules, widgetId])

  // Cleanup cursor point on unmount
  hooks.useUnmount(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (pointerMoveHandleRef.current) {
      pointerMoveHandleRef.current.remove()
      pointerMoveHandleRef.current = null
    }
    if (pointerLeaveHandleRef.current) {
      pointerLeaveHandleRef.current.remove()
      pointerLeaveHandleRef.current = null
    }
    cleanupHoverQuery()
    pendingMapPointRef.current = null
    cachedLayerRef.current = null
    lastCursorPointRef.current = null
    clearCursorGraphics()
  })

  hooks.useUpdateEffect(() => {
    // Update cursor point to refresh tooltip when hover data changes
    if (!lastCursorPointRef.current) return
    updateCursorPoint(lastCursorPointRef.current)
  }, [hoverTooltipData, isHoverQueryActive])

  // Sync selection graphics when highlight config changes (incremental update)
  const debouncedSyncGraphics = useDebounce(() => {
    const currentSelection = selectedPropertiesRef.current ?? []
    const selectionArray = Array.isArray(currentSelection)
      ? currentSelection
      : Array.from(currentSelection as Iterable<GridRowData>)
    if (selectionArray.length === 0) return

    const view = getCurrentView()
    if (!view || !modules) return

    const layer = view.map.findLayerById(
      `property-${widgetId}-highlight-layer`
    ) as __esri.GraphicsLayer | null
    if (!layer) return

    const currentHighlightColor = buildHighlightColor(
      highlightColorConfig,
      highlightOpacityConfig
    )
    const currentOutlineWidth = getValidatedOutlineWidth(outlineWidthConfig)

    const selectedFnrKeys = new Set(
      selectionArray.map((row) => normalizeFnrKey(row.FNR))
    )

    layer.graphics.forEach((graphic: __esri.Graphic) => {
      if (!graphic?.geometry) return

      const fnr = extractFnr(graphic.attributes)
      if (!fnr) return

      const fnrKey = normalizeFnrKey(fnr)
      if (!selectedFnrKeys.has(fnrKey)) return

      updateGraphicSymbol(
        graphic,
        currentHighlightColor,
        currentOutlineWidth,
        modules
      )
    })
  }, 100)

  hooks.useUpdateEffect(() => {
    debouncedSyncGraphics()
  }, [highlightColorConfig, highlightOpacityConfig, outlineWidthConfig])

  hooks.useUpdateEffect(() => {
    const isOpening =
      (runtimeState === WidgetState.Opened ||
        runtimeState === WidgetState.Active) &&
      (prevRuntimeState === WidgetState.Closed ||
        prevRuntimeState === WidgetState.Hidden ||
        typeof prevRuntimeState === "undefined")

    if (isOpening && modules) {
      const currentView = getCurrentView()
      if (currentView) {
        reactivateMapView()
        trackEvent({
          category: "Property",
          action: "widget_reopened",
          label: "from_controller",
        })
      }
    }
  }, [
    runtimeState,
    prevRuntimeState,
    modules,
    reactivateMapView,
    getCurrentView,
  ])

  hooks.useUpdateEffect(() => {
    if (
      runtimeState === WidgetState.Closed &&
      prevRuntimeState !== WidgetState.Closed
    ) {
      handleWidgetReset()
    }
  }, [runtimeState, prevRuntimeState, handleWidgetReset])

  hooks.useUpdateEffect(() => {
    const isOpening =
      (runtimeState === WidgetState.Opened ||
        runtimeState === WidgetState.Active) &&
      (prevRuntimeState === WidgetState.Closed ||
        prevRuntimeState === WidgetState.Hidden ||
        typeof prevRuntimeState === "undefined")

    if (isOpening) {
      closeOtherWidgets()
    }
  }, [runtimeState, prevRuntimeState, closeOtherWidgets])

  hooks.useUnmount(() => {
    abortAll()
    clearQueryCache()
    clearGraphics()
    propertyDispatchRef.current.removeWidgetState()
  })

  const isConfigured = config.propertyDataSourceId && config.ownerDataSourceId

  if (modulesLoading) {
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
    )
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
    )
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
            {isFBWebbConfigured(config) ? (
              <Button
                type="tertiary"
                icon
                onClick={handleGenerateUrl}
                title={translate("generateUrl")}
                aria-label={translate("generateUrl")}
                disabled={!hasSelectedProperties}
              >
                <SVG src={linkAddIcon} size={20} />
              </Button>
            ) : null}
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
                  type={
                    urlFeedback.type === "success"
                      ? "success"
                      : urlFeedback.type === "warning"
                        ? "warning"
                        : "error"
                  }
                  fullWidth
                  css={styles.alert}
                  text={urlFeedback.text}
                  role="status"
                />
                {urlFeedback.url ? (
                  <TextInput
                    value={urlFeedback.url}
                    readOnly
                    aria-label={translate("urlManualCopyLabel")}
                    css={styles.feedbackInput}
                    spellCheck={false}
                    onFocus={(event: React.FocusEvent<HTMLInputElement>) => {
                      event.target.select()
                    }}
                  />
                ) : null}
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
  )
}

const Widget = (props: AllWidgetProps<IMConfig>): React.ReactElement => {
  const styles = useWidgetStyles()
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages)
  return (
    <PropertyWidgetErrorBoundary styles={styles} translate={translate}>
      <WidgetContent {...props} />
    </PropertyWidgetErrorBoundary>
  )
}

export default Widget
