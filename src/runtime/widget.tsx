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
} from "../config/types"
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
  executeHoverQuery,
  shouldSkipHoverQuery,
  updateGraphicSymbol,
  createPropertyDispatcher,
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
            withIcon
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

  // Hover tooltip state
  const [hoverTooltipData, setHoverTooltipData] = React.useState<{
    fastighet: string
    bostadr: string
  } | null>(null)
  const [isHoverQueryActive, setIsHoverQueryActive] = React.useState(false)
  const hoverQueryAbortRef = React.useRef<AbortController | null>(null)
  const lastHoverQueryPointRef = React.useRef<{ x: number; y: number } | null>(
    null
  )
  const HOVER_QUERY_TOLERANCE_PX_VALUE = HOVER_QUERY_TOLERANCE_PX

  const renderConfiguredContent = () => {
    if (error) {
      return (
        <div css={styles.emptyState} role="alert" aria-live="assertive">
          <Alert type="error" withIcon text={error.message} />
          {error.details && <div>{error.details}</div>}
        </div>
      )
    }

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
    if (existingRaw && existingRaw.size > 0) {
      const nextRaw = new Map(existingRaw)
      removedProperties.forEach((prop) => {
        nextRaw.delete(prop.id)
      })
      propertyDispatchRef.current.setRawResults(nextRaw)
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
    if (!hasSelectedProperties || !rawPropertyResults?.size) return

    const selectedRawData: any[] = []
    selectedProperties.forEach((row) => {
      const rawData = rawPropertyResults?.get(row.id)
      if (rawData) selectedRawData.push(rawData)
    })

    if (selectedRawData.length === 0) return

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

  const handlePropertyDataSourceFailed = hooks.useEventCallback(() => {
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
  })

  const handleOwnerDataSourceFailed = hooks.useEventCallback(() => {
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
  })

  const handleMapClick = hooks.useEventCallback(
    async (event: __esri.ViewClickEvent) => {
      abortAll()
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
          const baseRawResults =
            prevRawResults instanceof Map
              ? prevRawResults
              : prevRawResults
                ? new Map(prevRawResults as ReadonlyMap<string, any>)
                : new Map<string, any>()

          const updatedRawResults = updateRawPropertyResults(
            baseRawResults,
            pipelineResult.rowsToProcess,
            pipelineResult.propertyResults,
            pipelineResult.toRemove,
            selectionForPipeline,
            normalizeFnrKey
          )

          propertyDispatchRef.current.setSelectedProperties(
            pipelineResult.updatedRows
          )
          propertyDispatchRef.current.setRawResults(updatedRawResults)
          propertyDispatchRef.current.setQueryInFlight(false)
        }

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

  // Hover query function - queries property at cursor position
  const queryPropertyAtPoint = hooks.useEventCallback(
    async (mapPoint: __esri.Point) => {
      if (hoverQueryAbortRef.current) {
        hoverQueryAbortRef.current.abort()
        hoverQueryAbortRef.current = null
      }

      const controller = new AbortController()
      hoverQueryAbortRef.current = controller

      setIsHoverQueryActive(true)
      try {
        const result = await executeHoverQuery({
          mapPoint,
          config: {
            propertyDataSourceId: config.propertyDataSourceId,
            ownerDataSourceId: config.ownerDataSourceId,
            allowedHosts: config.allowedHosts,
          },
          dsManager: dsManagerRef.current,
          signal: controller.signal,
          enablePIIMasking: piiMaskingEnabled,
          translate,
        })

        if (controller.signal.aborted) return

        setHoverTooltipData(result)
        setIsHoverQueryActive(false)
      } catch (error) {
        if (isAbortError(error)) return

        logger.debug("Hover query failed", { error })
        setHoverTooltipData(null)
        setIsHoverQueryActive(false)
      } finally {
        if (hoverQueryAbortRef.current === controller) {
          hoverQueryAbortRef.current = null
        }
      }
    }
  )

  // Throttled version of hover query with spatial tolerance
  const throttledHoverQuery = useThrottle(
    (mapPoint: __esri.Point, screenPoint: { x: number; y: number }) => {
      if (
        shouldSkipHoverQuery(
          screenPoint,
          lastHoverQueryPointRef.current,
          HOVER_QUERY_TOLERANCE_PX_VALUE
        )
      ) {
        return
      }
      lastHoverQueryPointRef.current = screenPoint
      queryPropertyAtPoint(mapPoint)
    },
    100
  )

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

    // Clean up existing handler
    if (pointerMoveHandleRef.current) {
      pointerMoveHandleRef.current.remove()
      pointerMoveHandleRef.current = null
      clearCursorGraphics()
    }

    if (pointerLeaveHandleRef.current) {
      pointerLeaveHandleRef.current.remove()
      pointerLeaveHandleRef.current = null
    }

    const canTrackCursor =
      isActive && !!modules?.TextSymbol && !!modules?.Graphic

    // Setup new handler if widget is active
    if (canTrackCursor) {
      // Cache layer reference to avoid repeated DOM queries
      ensureGraphicsLayer(view)
      cachedLayerRef.current = view.map.findLayerById(
        `property-${widgetId}-highlight-layer`
      ) as __esri.GraphicsLayer | null

      pointerMoveHandleRef.current = view.on("pointer-move", (event) => {
        const screenPoint = { x: event.x, y: event.y }
        const mapPoint = view.toMap(screenPoint)

        if (mapPoint) {
          lastCursorPointRef.current = mapPoint
          pendingMapPointRef.current = mapPoint

          // Use RAF to batch graphic updates at 60fps
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(() => {
              rafIdRef.current = null
              const point = pendingMapPointRef.current
              if (point) {
                updateCursorPoint(point)
              }
            })
          }

          // Trigger throttled hover query with spatial tolerance
          throttledHoverQuery(mapPoint, screenPoint)
        } else {
          lastCursorPointRef.current = null
          pendingMapPointRef.current = null
          updateCursorPoint(null)
          setHoverTooltipData(null)
          setIsHoverQueryActive(false)
        }
      })

      pointerLeaveHandleRef.current = view.on("pointer-leave", () => {
        lastCursorPointRef.current = null
        pendingMapPointRef.current = null
        lastHoverQueryPointRef.current = null
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = null
        }
        updateCursorPoint(null)
        setHoverTooltipData(null)
        setIsHoverQueryActive(false)
      })
    } else {
      lastCursorPointRef.current = null
      pendingMapPointRef.current = null
      cachedLayerRef.current = null
      clearCursorGraphics()
      setHoverTooltipData(null)
      setIsHoverQueryActive(false)
    }

    return () => {
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
      if (hoverQueryAbortRef.current) {
        hoverQueryAbortRef.current.abort()
        hoverQueryAbortRef.current = null
      }
      setHoverTooltipData(null)
      setIsHoverQueryActive(false)
      pendingMapPointRef.current = null
      cachedLayerRef.current = null
      if (!canTrackCursor) {
        lastCursorPointRef.current = null
      }
      clearCursorGraphics()
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
    if (hoverQueryAbortRef.current) {
      hoverQueryAbortRef.current.abort()
      hoverQueryAbortRef.current = null
    }
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
            width={125}
            height={125}
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
        <div css={styles.emptyState} role="alert" aria-live="assertive">
          <Alert
            type="error"
            withIcon
            text={translate("errorLoadingModules")}
          />
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
        <div css={styles.buttons}>
          <Button
            type="tertiary"
            icon
            onClick={handleClearAll}
            title={translate("clearAll")}
            disabled={!hasSelectedProperties}
          >
            <SVG src={clearIcon} size={20} />
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
