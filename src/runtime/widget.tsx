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
  PropertyWidgetState,
  GridRowData,
  SelectionGraphicsParams,
  ExportFormat,
  OwnerAttributes,
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
import {
  queryPropertyByPoint,
  queryOwnerByFnr,
  clearQueryCache,
  queryOwnersByRelationship,
  validateDataSources,
  propertyQueryService,
} from "../shared/api"
import {
  formatOwnerInfo,
  formatPropertyWithShare,
  createRowId,
  extractFnr,
  isAbortError,
  normalizeFnrKey,
  calculatePropertyUpdates,
  validateMapClickPipeline,
  syncGraphicsWithState,
  cleanupRemovedGraphics,
  isValidationFailure,
  buildHighlightColor,
  computeWidgetsToClose,
  dataSourceHelpers,
  getValidatedOutlineWidth,
  processPropertyQueryResults,
  updateRawPropertyResults,
  logger,
  syncCursorGraphics,
  abortHelpers,
} from "../shared/utils"
import type { CursorGraphicsState } from "../shared/utils"
import { EXPORT_FORMATS, CURSOR_TOOLTIP_STYLE } from "../config/constants"
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

  const runtimeState = ReactRedux.useSelector(
    (state: IMState) => state.widgetsRuntimeInfo?.[id]?.state
  )
  const prevRuntimeState = hooks.usePrevious(runtimeState)

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
  } = useGraphicsLayer(modules, id)
  const { disablePopup, restorePopup } = usePopupManager()
  const { getController, releaseController, abortAll } =
    useAbortControllerPool()

  const dsManagerRef = React.useRef<DataSourceManager | null>(null)
  if (!dsManagerRef.current) {
    dsManagerRef.current = DataSourceManager.getInstance()
  }
  const requestIdRef = React.useRef(0)

  const [state, setState] = React.useState<PropertyWidgetState>({
    error: null,
    selectedProperties: [],
    isQueryInFlight: false,
    rawPropertyResults: null,
    rowSelectionIds: new Set(),
  })
  const isMountedRef = React.useRef(true)

  // Hover tooltip state
  const [hoverTooltipData, setHoverTooltipData] = React.useState<{
    fastighet: string
    bostadr: string
  } | null>(null)
  const [isHoverQueryActive, setIsHoverQueryActive] = React.useState(false)
  const hoverQueryAbortRef = React.useRef<AbortController | null>(null)

  const hasSelectedProperties = state.selectedProperties.length > 0
  const hasSelectedRows = state.rowSelectionIds.size > 0

  const renderConfiguredContent = () => {
    if (state.error) {
      return (
        <div css={styles.emptyState} role="alert" aria-live="assertive">
          <Alert type="error" withIcon text={state.error.message} />
          {state.error.details && <div>{state.error.details}</div>}
        </div>
      )
    }

    if (hasSelectedProperties) {
      return (
        <PropertyTable
          data={state.selectedProperties}
          columns={tableColumns}
          translate={translate}
          styles={styles}
          onSelectionChange={handleSelectionChange}
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
    setState((prev) => {
      if (prev.selectedProperties.length === 0) return prev

      trackFeatureUsage("pii_masking_toggled", piiMaskingEnabled)

      const reformattedProperties = prev.selectedProperties.map((row) => {
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

      return { ...prev, selectedProperties: reformattedProperties }
    })
  }, [piiMaskingEnabled, translate])

  hooks.useUpdateEffect(() => {
    setState((prev) => {
      if (prev.selectedProperties.length <= maxResults) return prev

      trackEvent({
        category: "Property",
        action: "max_results_trim",
        value: prev.selectedProperties.length - maxResults,
      })

      const trimmedProperties = prev.selectedProperties.slice(0, maxResults)
      const removedProperties = prev.selectedProperties.slice(maxResults)

      removedProperties.forEach((prop) => {
        const fnr = prop.FNR
        if (fnr != null) {
          removeGraphicsForFnr(fnr, normalizeFnrKey)
        }
      })

      return {
        ...prev,
        selectedProperties: trimmedProperties,
      }
    })
  }, [maxResults])

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

  const handleSelectionChange = hooks.useEventCallback(
    (selectedIds: Set<string>) => {
      setState((prev) => ({
        ...prev,
        rowSelectionIds: selectedIds,
      }))
    }
  )

  const handleClearAll = hooks.useEventCallback(() => {
    abortAll()
    clearQueryCache()
    clearGraphics()
    setState((prev) => {
      trackEvent({
        category: "Property",
        action: "clear_all",
        value: prev.selectedProperties.length,
      })

      return {
        ...prev,
        selectedProperties: [],
        error: null,
        isQueryInFlight: false,
        rawPropertyResults: null,
        rowSelectionIds: new Set(),
      }
    })
  })

  const closeOtherWidgets = hooks.useEventCallback(() => {
    const autoCloseSetting = config?.autoCloseOtherWidgets
    if (autoCloseSetting !== undefined && !autoCloseSetting) {
      return
    }
    try {
      const store = typeof getAppStore === "function" ? getAppStore() : null
      const state = store?.getState?.()
      const runtimeInfo = state?.widgetsRuntimeInfo as
        | {
            [id: string]:
              | { state?: WidgetState | string; isClassLoaded?: boolean }
              | undefined
          }
        | undefined
      const targets = computeWidgetsToClose(runtimeInfo, id)
      if (targets.length) {
        const safeTargets = targets.filter((targetId) => {
          const targetInfo = runtimeInfo?.[targetId]
          return Boolean(targetInfo?.isClassLoaded)
        })
        if (safeTargets.length) {
          trackEvent({
            category: "Widget",
            action: "close_other_widgets",
            value: safeTargets.length,
          })
          props.dispatch(appActions.closeWidgets(safeTargets))
        }
      }
    } catch (err) {
      // Silent fail - non-critical error
    }
  })

  const handleWidgetReset = hooks.useEventCallback(() => {
    abortAll()
    clearQueryCache()
    clearGraphics()
    setState((prev) => ({
      ...prev,
      selectedProperties: [],
      error: null,
      isQueryInFlight: false,
      rawPropertyResults: null,
      rowSelectionIds: new Set(),
    }))
  })

  const handleExport = hooks.useEventCallback((format: ExportFormat) => {
    if (!hasSelectedRows) {
      return
    }

    if (!state.rawPropertyResults || state.rawPropertyResults.size === 0) {
      return
    }

    const selectedRowData = state.selectedProperties.filter((row) =>
      state.rowSelectionIds.has(row.id)
    )

    const selectedRawData: any[] = []
    state.rowSelectionIds.forEach((id) => {
      const rawData = state.rawPropertyResults?.get(id)
      if (rawData) {
        selectedRawData.push(rawData)
      }
    })

    if (selectedRawData.length === 0) {
      return
    }

    const rowCount = selectedRowData.length
    const formatDefinition = EXPORT_FORMATS.find((item) => item.id === format)

    try {
      exportData(selectedRawData, selectedRowData, {
        format,
        filename: "property-export",
        rowCount,
        definition: formatDefinition,
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

  const setError = hooks.useEventCallback(
    (type: ErrorType, message: string, details?: string) => {
      if (!isMountedRef.current) {
        return
      }
      setState((prev) => ({
        ...prev,
        error: { type, message, details },
        isQueryInFlight: false,
      }))
    }
  )

  const handlePropertyDataSourceFailed = hooks.useEventCallback(() => {
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
  })

  const handleOwnerDataSourceFailed = hooks.useEventCallback(() => {
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
  })

  // Extracted from handleMapClick: Step 3 - Query properties
  const executePropertyQuery = hooks.useEventCallback(
    async (params: {
      mapPoint: __esri.Point
      propertyDsId: string
      manager: DataSourceManager
      signal: AbortSignal
    }) => {
      const { mapPoint, propertyDsId, manager, signal } = params
      const results = await queryPropertyByPoint(
        mapPoint,
        propertyDsId,
        manager,
        { signal }
      )

      if (!results.length) {
        logger.debug("No property results returned from query")
        trackEvent({
          category: "Query",
          action: "property_query",
          label: "no_results",
        })
        return { empty: true as const, results: [] }
      }

      logger.debug("Property results received", {
        count: results.length,
        firstFeatureCount: results[0]?.features?.length ?? 0,
        hasFirstGeometry: !!results[0]?.features?.[0]?.geometry,
      })

      return { empty: false as const, results }
    }
  )

  // Extracted from handleMapClick: Step 4 - Process results
  const processPropertyResults = hooks.useEventCallback(
    async (params: {
      propertyResults: Array<{ features: __esri.Graphic[]; sourceLayer: any }>
      config: {
        propertyDataSourceId: string
        ownerDataSourceId: string
        enablePIIMasking: boolean
        relationshipId: number
        enableBatchOwnerQuery: boolean
      }
      maxResults: number
      manager: DataSourceManager
      signal: AbortSignal
    }) => {
      const { propertyResults, config, maxResults, manager, signal } = params

      const { rowsToProcess, graphicsToAdd } =
        await processPropertyQueryResults({
          propertyResults,
          config: {
            propertyDataSourceId: config.propertyDataSourceId,
            ownerDataSourceId: config.ownerDataSourceId,
            enablePIIMasking: config.enablePIIMasking,
            relationshipId: config.relationshipId,
            enableBatchOwnerQuery: config.enableBatchOwnerQuery,
          },
          processingContext: {
            dsManager: manager,
            maxResults,
            signal,
            helpers: {
              extractFnr,
              queryOwnerByFnr,
              queryOwnersByRelationship,
              createRowId,
              formatPropertyWithShare,
              formatOwnerInfo,
              isAbortError,
            },
            messages: {
              unknownOwner: translate("unknownOwner"),
              errorOwnerQueryFailed: translate("errorOwnerQueryFailed"),
              errorNoDataAvailable: translate("errorNoDataAvailable"),
            },
          },
          services: {
            processBatch: propertyQueryService.processBatch,
            processIndividual: propertyQueryService.processIndividual,
          },
        })

      logger.debug("Processing complete", {
        rowsToProcessCount: rowsToProcess.length,
        graphicsToAddCount: graphicsToAdd.length,
        hasFirstGraphic: !!graphicsToAdd[0]?.graphic,
        firstGraphicGeometryType: graphicsToAdd[0]?.graphic?.geometry?.type,
      })

      return { rowsToProcess, graphicsToAdd }
    }
  )

  // Extracted from handleMapClick: Step 5 & 6 - Apply updates
  const applyPropertyUpdates = hooks.useEventCallback(
    (params: {
      rowsToProcess: GridRowData[]
      graphicsToAdd: Array<{ graphic: __esri.Graphic; fnr: string | number }>
      config: {
        highlightColor: string
        highlightOpacity: number
        outlineWidth: number
      }
      toggleEnabled: boolean
      maxResults: number
    }) => {
      const {
        rowsToProcess,
        graphicsToAdd,
        config,
        toggleEnabled,
        maxResults,
      } = params

      // Step 5: Calculate updates with toggle logic
      const { updatedRows, toRemove } = calculatePropertyUpdates(
        rowsToProcess,
        state.selectedProperties,
        toggleEnabled,
        maxResults
      )

      // Compute highlight values fresh from current config
      const currentHighlightColor = buildHighlightColor(
        config.highlightColor,
        config.highlightOpacity
      )
      const currentOutlineWidth = getValidatedOutlineWidth(config.outlineWidth)

      const syncParams: SelectionGraphicsParams = {
        graphicsToAdd,
        selectedRows: updatedRows,
        getCurrentView,
        helpers: {
          addGraphicsToMap,
          extractFnr,
          normalizeFnrKey,
        },
        highlightColor: currentHighlightColor,
        outlineWidth: currentOutlineWidth,
      }

      logger.debug("syncParams created before setState", {
        graphicsCount: syncParams.graphicsToAdd.length,
        selectedRowsCount: syncParams.selectedRows.length,
        highlightColor: currentHighlightColor,
        outlineWidth: currentOutlineWidth,
      })

      // Track toggle removals
      if (toRemove.size > 0) {
        const removedRows = state.selectedProperties.filter((row) =>
          toRemove.has(normalizeFnrKey(row.FNR))
        )
        if (removedRows.length > 0) {
          trackEvent({
            category: "Property",
            action: "toggle_remove",
            value: removedRows.length,
          })
        }
      }

      return { updatedRows, toRemove, syncParams }
    }
  )

  const handleMapClick = hooks.useEventCallback(
    async (event: __esri.ViewClickEvent) => {
      abortAll()
      const tracker = createPerformanceTracker("map_click_query")

      // Step 1: Validate inputs and data sources
      const validation = validateMapClickPipeline({
        event,
        modules,
        config,
        dsManager: dsManagerRef.current,
        translate,
      })

      if (isValidationFailure(validation)) {
        const { error, failureReason } = validation
        setError(error.type, error.message)
        tracker.failure(failureReason)
        trackError("map_click_validation", failureReason)
        return
      }
      const { mapPoint, manager } = validation.data

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const isStaleRequest = () => requestId !== requestIdRef.current

      setState((prev) => ({
        ...prev,
        error: null,
        isQueryInFlight: true,
      }))

      const controller = getController()

      try {
        // Step 3: Query properties
        const queryResult = await executePropertyQuery({
          mapPoint,
          propertyDsId: config.propertyDataSourceId,
          manager,
          signal: controller.signal,
        })

        const abortStatus = abortHelpers.checkAbortedOrStale(
          controller.signal,
          isStaleRequest
        )
        if (abortStatus === "stale") return
        if (abortStatus === "aborted") {
          tracker.failure("aborted")
          return
        }

        if (queryResult.empty) {
          if (isStaleRequest()) {
            releaseController(controller)
            return
          }
          tracker.success()
          releaseController(controller)
          return
        }

        // Step 4: Process results and enrich with owner data
        const { rowsToProcess, graphicsToAdd } = await processPropertyResults({
          propertyResults: queryResult.results,
          config: {
            propertyDataSourceId: config.propertyDataSourceId,
            ownerDataSourceId: config.ownerDataSourceId,
            enablePIIMasking: piiMaskingEnabled,
            relationshipId: config.relationshipId,
            enableBatchOwnerQuery: config.enableBatchOwnerQuery,
          },
          maxResults,
          manager,
          signal: controller.signal,
        })

        const abortStatus2 = abortHelpers.checkAbortedOrStale(
          controller.signal,
          isStaleRequest
        )
        if (abortStatus2 === "stale") {
          releaseController(controller)
          return
        }
        if (abortStatus2 === "aborted") {
          tracker.failure("aborted")
          releaseController(controller)
          return
        }

        // Step 5 & 6: Calculate updates and prepare sync
        const { updatedRows, toRemove, syncParams } = applyPropertyUpdates({
          rowsToProcess,
          graphicsToAdd,
          config: {
            highlightColor: config.highlightColor,
            highlightOpacity: config.highlightOpacity,
            outlineWidth: config.outlineWidth,
          },
          toggleEnabled,
          maxResults,
        })

        // Step 6: Update state
        setState((prev) => {
          // Check staleness atomically within setState
          if (isStaleRequest()) {
            return prev
          }

          const updatedRawResults = updateRawPropertyResults(
            prev.rawPropertyResults || new Map(),
            rowsToProcess,
            queryResult.results,
            toRemove,
            prev.selectedProperties,
            normalizeFnrKey
          )

          return {
            ...prev,
            selectedProperties: updatedRows,
            isQueryInFlight: false,
            rawPropertyResults: updatedRawResults,
          }
        })

        logger.debug("After setState - executing sync", {
          hasSyncParams: !!syncParams,
          graphicsCount: syncParams.graphicsToAdd.length,
        })

        // Cleanup removed graphics
        cleanupRemovedGraphics({
          toRemove,
          removeGraphicsForFnr,
          normalizeFnrKey,
        })

        // Sync graphics with map
        logger.debug("About to sync graphics", {
          graphicsCount: syncParams.graphicsToAdd.length,
          selectedRowsCount: syncParams.selectedRows.length,
          highlightColor: syncParams.highlightColor,
          outlineWidth: syncParams.outlineWidth,
          hasView: !!getCurrentView(),
        })
        syncSelectionGraphics(syncParams)

        tracker.success()
        trackEvent({
          category: "Query",
          action: "property_query",
          label: "success",
          value: rowsToProcess.length,
        })
        trackFeatureUsage("pii_masking", piiMaskingEnabled)
        trackFeatureUsage("toggle_removal", toggleEnabled)
      } catch (error) {
        if (isStaleRequest()) return

        if (isAbortError(error)) {
          tracker.failure("aborted")
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
      // Cancel any existing hover query
      if (hoverQueryAbortRef.current) {
        hoverQueryAbortRef.current.abort()
        hoverQueryAbortRef.current = null
      }

      // Create new abort controller for this hover query
      const controller = new AbortController()
      hoverQueryAbortRef.current = controller

      setIsHoverQueryActive(true)
      try {
        // Validate data sources
        const dsValidation = validateDataSources({
          propertyDsId: config.propertyDataSourceId,
          ownerDsId: config.ownerDataSourceId,
          dsManager: dsManagerRef.current,
          allowedHosts: config.allowedHosts,
          translate,
        })

        if (isValidationFailure(dsValidation)) {
          setIsHoverQueryActive(false)
          return
        }
        const { manager } = dsValidation.data

        // Query property at point
        const propertyResults = await queryPropertyByPoint(
          mapPoint,
          config.propertyDataSourceId,
          manager,
          { signal: controller.signal }
        )

        if (controller.signal.aborted || !isMountedRef.current) {
          return
        }

        // No property found at cursor
        if (!propertyResults.length || !propertyResults[0]?.features?.length) {
          setHoverTooltipData(null)
          setIsHoverQueryActive(false)
          return
        }

        const feature = propertyResults[0].features[0]
        const fnr = extractFnr(feature.attributes)
        const fastighet = feature.attributes?.FASTIGHET || ""

        if (!fnr || !fastighet) {
          setHoverTooltipData(null)
          setIsHoverQueryActive(false)
          return
        }

        // Query owner data for this property
        const ownerFeatures = await queryOwnerByFnr(
          fnr,
          config.ownerDataSourceId,
          manager,
          { signal: controller.signal }
        )

        if (controller.signal.aborted || !isMountedRef.current) {
          return
        }

        // Format owner info
        let bostadr = translate("unknownOwner")
        if (ownerFeatures.length > 0) {
          const ownerAttrs = ownerFeatures[0].attributes as OwnerAttributes
          bostadr = formatOwnerInfo(
            ownerAttrs,
            piiMaskingEnabled,
            translate("unknownOwner")
          )
        }

        // Update hover tooltip data
        setHoverTooltipData({ fastighet, bostadr })
        setIsHoverQueryActive(false)
      } catch (error) {
        if (isAbortError(error)) return

        logger.debug("Hover query failed", { error })
        setHoverTooltipData(null)
        setIsHoverQueryActive(false)
      }
    }
  )

  // Throttled version of hover query
  const throttledHoverQuery = useThrottle(queryPropertyAtPoint, 100)

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
        `${id}-property-highlight-layer`
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

          // Trigger throttled hover query (fires periodically during movement)
          throttledHoverQuery(mapPoint)
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
  }, [runtimeState, modules])

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

  // Sync selection graphics when highlight config changes
  const debouncedSyncGraphics = useDebounce(() => {
    if (state.selectedProperties.length === 0) {
      return
    }

    const graphicsToAdd = state.selectedProperties
      .map((row) =>
        row.graphic ? { graphic: row.graphic, fnr: row.FNR } : null
      )
      .filter(Boolean) as Array<{
      graphic: __esri.Graphic
      fnr: string | number
    }>

    if (graphicsToAdd.length === 0) {
      return
    }

    const currentHighlightColor = buildHighlightColor(
      highlightColorConfig,
      highlightOpacityConfig
    )
    const currentOutlineWidth = getValidatedOutlineWidth(outlineWidthConfig)

    syncSelectionGraphics({
      graphicsToAdd,
      selectedRows: state.selectedProperties,
      getCurrentView,
      helpers: {
        addGraphicsToMap,
        extractFnr,
        normalizeFnrKey,
      },
      highlightColor: currentHighlightColor,
      outlineWidth: currentOutlineWidth,
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
    isMountedRef.current = false
    abortAll()
    clearQueryCache()
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
            disabled={state.selectedProperties.length === 0}
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
              disabled={!hasSelectedRows}
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
        <div css={styles.col}>{state.selectedProperties.length}</div>
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
