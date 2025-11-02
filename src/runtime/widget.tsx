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
} from "../config/types"
import { ErrorType } from "../config/enums"
import { useWidgetStyles } from "../config/style"
import {
  useEsriModules,
  useGraphicsLayer,
  usePopupManager,
  useMapViewLifecycle,
  useAbortControllerPool,
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
  validateMapClickInputs,
  syncGraphicsWithState,
  cleanupRemovedGraphics,
  isValidationFailure,
  buildHighlightColor,
  computeWidgetsToClose,
  dataSourceHelpers,
  getValidatedOutlineWidth,
} from "../shared/utils"
import { EXPORT_FORMATS } from "../config/constants"
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
    console.log(
      "syncSelectionGraphics: no active view, deferring graphics sync"
    )
    return
  }

  const success = syncGraphicsWithState({
    graphicsToAdd,
    selectedRows,
    view,
    helpers,
    highlightColor,
    outlineWidth,
  })

  if (!success) {
    console.log("syncSelectionGraphics: failed to sync graphics with state")
  }
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
    console.log(
      this.props.translate("errorBoundaryConsoleLog"),
      error,
      errorInfo
    )
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
    console.log("Property Widget: Initial mount", {
      propertyDataSourceId: config.propertyDataSourceId,
      ownerDataSourceId: config.ownerDataSourceId,
      mapWidgetId: useMapWidgetIds?.[0],
      hasDataSources: !!(
        config.propertyDataSourceId && config.ownerDataSourceId
      ),
      runtimeState,
    })
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
  })
  const isMountedRef = React.useRef(true)

  const hasSelectedProperties = state.selectedProperties.length > 0

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
        />
      )
    }

    return (
      <div css={styles.emptyState} role="status" aria-live="polite">
        <SVG css={styles.svgState} src={mapSelect} width={100} height={100} />
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

      console.log(
        "PII masking toggled:",
        piiMaskingEnabled,
        "- reformatting existing data"
      )
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
  }, [piiMaskingEnabled])

  hooks.useUpdateEffect(() => {
    setState((prev) => {
      if (prev.selectedProperties.length <= maxResults) return prev

      console.log(
        `Max results changed to ${maxResults}, trimming from ${prev.selectedProperties.length} properties`
      )
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
    console.log("Toggle removal mode changed:", toggleEnabled)
    trackFeatureUsage("toggle_removal_changed", toggleEnabled)
  }, [toggleEnabled])

  hooks.useUpdateEffect(() => {
    console.log(
      "Batch owner query mode changed:",
      config.enableBatchOwnerQuery,
      "relationshipId:",
      config.relationshipId
    )
    trackFeatureUsage(
      "batch_owner_query_changed",
      config.enableBatchOwnerQuery ?? false
    )
  }, [config.enableBatchOwnerQuery, config.relationshipId])

  const tableColumnsRef = React.useRef<Array<ColumnDef<GridRowData, any>>>(
    createPropertyTableColumns({ translate })
  )
  const tableColumns = tableColumnsRef.current

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
          console.log(
            `Property Widget: Closing ${safeTargets.length} other widget(s)`,
            safeTargets
          )
          trackEvent({
            category: "Widget",
            action: "close_other_widgets",
            value: safeTargets.length,
          })
          props.dispatch(appActions.closeWidgets(safeTargets))
        }
      }
    } catch (err) {
      if (!isAbortError(err)) {
        console.error("closeOtherWidgets error", err)
      }
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
    }))
  })

  const handleExport = hooks.useEventCallback((format: ExportFormat) => {
    if (state.selectedProperties.length === 0) {
      console.log("Export skipped: no selected properties")
      return
    }

    if (!state.rawPropertyResults || state.rawPropertyResults.length === 0) {
      console.log("Export skipped: no raw property data available")
      return
    }

    const rowCount = state.selectedProperties.length
    const formatDefinition = EXPORT_FORMATS.find((item) => item.id === format)

    try {
      exportData(state.rawPropertyResults, state.selectedProperties, {
        format,
        filename: "property-export",
        rowCount,
        definition: formatDefinition,
      })
    } catch (error) {
      console.error(`Export ${format} failed`, error)
    }
  })

  const handleExportFormatSelect = hooks.useEventCallback(
    (format: ExportFormat) => {
      if (!["json", "csv", "geojson"].includes(format)) {
        console.error("Invalid export format:", format)
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
    console.error("Property data source creation failed")
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
  })

  const handleOwnerDataSourceFailed = hooks.useEventCallback(() => {
    console.error("Owner data source creation failed")
    setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
  })

  const handleMapClick = hooks.useEventCallback(
    async (event: __esri.ViewClickEvent) => {
      abortAll()
      const tracker = createPerformanceTracker("map_click_query")

      // Step 1: Validate inputs
      const validation = validateMapClickInputs(
        event,
        modules,
        config,
        translate
      )
      if (isValidationFailure(validation)) {
        const { error } = validation
        setError(error.type, error.message)
        tracker.failure(error.type)
        trackError("map_click_validation", error.type, error.message)
        return
      }
      const { mapPoint } = validation.data

      // Step 2: Validate data sources
      const dsValidation = validateDataSources({
        propertyDsId: config.propertyDataSourceId,
        ownerDsId: config.ownerDataSourceId,
        dsManager: dsManagerRef.current,
        allowedHosts: config.allowedHosts,
        translate,
      })

      if (isValidationFailure(dsValidation)) {
        const { error, failureReason } = dsValidation
        setError(error.type, error.message)
        tracker.failure(failureReason)
        trackError("map_click", failureReason)
        return
      }
      const { manager } = dsValidation.data

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
        const propertyResults = await queryPropertyByPoint(
          mapPoint,
          config.propertyDataSourceId,
          manager,
          { signal: controller.signal }
        )

        if (controller.signal.aborted || isStaleRequest()) {
          if (isStaleRequest()) {
            return
          }
          tracker.failure("aborted")
          return
        }

        if (!propertyResults.length) {
          if (isStaleRequest()) {
            releaseController(controller)
            return
          }
          console.log("No property results returned from query")
          tracker.success()
          trackEvent({
            category: "Query",
            action: "property_query",
            label: "no_results",
          })
          releaseController(controller)
          return
        }

        console.log("Property results received:", {
          count: propertyResults.length,
          firstResult: propertyResults[0],
          firstResultStructure: propertyResults[0]
            ? {
                hasFeatures: !!propertyResults[0].features,
                featuresLength: propertyResults[0].features?.length,
                firstFeature: propertyResults[0].features?.[0],
                firstFeatureAttrs: propertyResults[0].features?.[0]?.attributes,
                firstFeatureGeometry:
                  !!propertyResults[0].features?.[0]?.geometry,
              }
            : null,
        })

        console.log("=== FULL JSON RESPONSE ===")
        console.log(JSON.stringify(propertyResults, null, 2))
        console.log("=== END JSON RESPONSE ===")

        const rawResultsForExport = propertyResults

        // Step 4: Process results and enrich with owner data
        const useBatchQuery =
          config.enableBatchOwnerQuery &&
          config.relationshipId !== undefined &&
          config.propertyDataSourceId

        const processingContext = {
          dsManager: manager,
          maxResults,
          signal: controller.signal,
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
        }

        const { rowsToProcess, graphicsToAdd } =
          useBatchQuery && config.relationshipId !== undefined
            ? await propertyQueryService.processBatch({
                propertyResults,
                config: {
                  propertyDataSourceId: config.propertyDataSourceId,
                  ownerDataSourceId: config.ownerDataSourceId,
                  enablePIIMasking: piiMaskingEnabled,
                  relationshipId: config.relationshipId,
                },
                context: processingContext,
              })
            : await propertyQueryService.processIndividual({
                propertyResults,
                config: {
                  ownerDataSourceId: config.ownerDataSourceId,
                  enablePIIMasking: piiMaskingEnabled,
                },
                context: processingContext,
              })

        console.log("Processing complete:", {
          rowsToProcessCount: rowsToProcess.length,
          graphicsToAddCount: graphicsToAdd.length,
          firstRow: rowsToProcess[0],
          firstGraphic: graphicsToAdd[0],
          firstGraphicHasGeometry: !!graphicsToAdd[0]?.graphic?.geometry,
          firstGraphicGeometryType: graphicsToAdd[0]?.graphic?.geometry?.type,
        })
        console.log("First row details:", {
          FASTIGHET: rowsToProcess[0]?.FASTIGHET,
          BOSTADR: rowsToProcess[0]?.BOSTADR,
          FNR: rowsToProcess[0]?.FNR,
          hasGraphic: !!rowsToProcess[0]?.graphic,
        })

        if (controller.signal.aborted || isStaleRequest()) {
          if (isStaleRequest()) {
            releaseController(controller)
            return
          }
          tracker.failure("aborted")
          releaseController(controller)
          return
        }

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
        const currentOutlineWidth = getValidatedOutlineWidth(
          config.outlineWidth
        )

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

        console.log("syncParams created before setState:", {
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

        // Update state
        setState((prev) => {
          // Check staleness atomically within setState
          if (isStaleRequest()) {
            return prev
          }

          return {
            ...prev,
            selectedProperties: updatedRows,
            isQueryInFlight: false,
            rawPropertyResults: rawResultsForExport,
          }
        })

        console.log("After setState - executing sync:", {
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
        console.log("About to sync graphics:", {
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
        if (isStaleRequest()) {
          return
        }
        if (isAbortError(error)) {
          tracker.failure("aborted")
          return
        }
        console.error("Property query error:", error)
        console.error("Error details:", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          propertyDsId: config.propertyDataSourceId,
          ownerDsId: config.ownerDataSourceId,
        })
        setError(ErrorType.QUERY_ERROR, translate("errorQueryFailed"))
        tracker.failure("query_error")
        trackError("property_query", error)
      } finally {
        if (isMountedRef.current && !isStaleRequest()) {
          setState((prev) => ({
            ...prev,
            isQueryInFlight: false,
          }))
        }
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

  hooks.useUpdateEffect(() => {
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
  }, [highlightColorConfig, highlightOpacityConfig, outlineWidthConfig])

  hooks.useUpdateEffect(() => {
    const isOpening =
      (runtimeState === WidgetState.Opened ||
        runtimeState === WidgetState.Active) &&
      (prevRuntimeState === WidgetState.Closed ||
        prevRuntimeState === WidgetState.Hidden ||
        typeof prevRuntimeState === "undefined")

    if (isOpening && modules) {
      console.log("Property Widget: Reactivating on open from controller")
      const currentView = getCurrentView()
      if (currentView) {
        reactivateMapView()
        trackEvent({
          category: "Property",
          action: "widget_reopened",
          label: "from_controller",
        })
      } else {
        console.log(
          "Property Widget: Map view not ready yet, will activate on next view change"
        )
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
              disabled={state.selectedProperties.length === 0}
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
