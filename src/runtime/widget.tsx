/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  React,
  jsx,
  hooks,
  type AllWidgetProps,
  DataSourceManager,
} from "jimu-core"
import { JimuMapViewComponent } from "jimu-arcgis"
import { Alert, Button, Loading, LoadingType, SVG } from "jimu-ui"
import { PropertyTable } from "./components/table"
import { createPropertyTableColumns } from "../shared/config"
import type {
  IMConfig,
  ErrorBoundaryProps,
  PropertyWidgetState,
  GridRowData,
  SelectionGraphicsParams,
} from "../config/types"
import { ErrorType } from "../config/enums"
import { useWidgetStyles } from "../config/style"
import {
  useEsriModules,
  useGraphicsLayer,
  usePopupManager,
  useMapViewLifecycle,
  useAbortControllerPool,
  useDebouncedMapClick,
} from "../shared/hooks"
import {
  queryPropertyByPoint,
  queryOwnerByFnr,
  clearQueryCache,
  queryExtentForProperties,
  queryOwnersByRelationship,
} from "../shared/api"
import {
  formatOwnerInfo,
  formatPropertyWithShare,
  createRowId,
  extractFnr,
  isAbortError,
  normalizeFnrKey,
  calculatePropertyUpdates,
  processPropertyResults,
  processPropertyResultsWithBatchQuery,
  validateMapClickInputs,
  syncGraphicsWithState,
  validateDataSources,
  cleanupRemovedGraphics,
  isValidationFailure,
} from "../shared/utils"
import { HIGHLIGHT_COLOR_RGBA, OUTLINE_WIDTH } from "../config/constants"
import {
  trackEvent,
  trackError,
  trackFeatureUsage,
  createPerformanceTracker,
} from "../shared/telemetry"
import clearIcon from "../assets/clear-selection-general.svg"
import zoomIcon from "../assets/zoom-in.svg"
import mapWrong from "../assets/map-wrong.svg"
import mapSelect from "../assets/map-select.svg"

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
  const translate = hooks.useTranslation()

  console.log("Property Widget Config:", {
    propertyDataSourceId: config.propertyDataSourceId,
    ownerDataSourceId: config.ownerDataSourceId,
    mapWidgetId: useMapWidgetIds?.[0],
    hasDataSources: !!(config.propertyDataSourceId && config.ownerDataSourceId),
  })

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
    loading: false,
    error: null,
    selectedProperties: [],
  })

  const maxResults = config.maxResults
  const toggleEnabled = config.enableToggleRemoval
  const piiMaskingEnabled = config.enablePIIMasking
  const mapWidgetId = useMapWidgetIds?.[0]

  const tableColumns = hooks.useEventCallback(() =>
    createPropertyTableColumns({
      translate,
      onRemove: handleRemoveProperty,
    })
  )

  const handleRemoveProperty = hooks.useEventCallback(
    (fnr: string | number) => {
      removeGraphicsForFnr(fnr, normalizeFnrKey)
      setState((prev) => {
        const removed: typeof prev.selectedProperties = []
        const updated: typeof prev.selectedProperties = []

        prev.selectedProperties.forEach((row) => {
          if (row.FNR === fnr) {
            removed.push(row)
            return
          }
          updated.push(row)
        })

        if (removed.length === 0) {
          return prev
        }

        trackEvent({
          category: "Property",
          action: "remove",
          value: removed.length,
        })

        return {
          ...prev,
          selectedProperties: updated,
        }
      })
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
      }
    })
  })

  const handleZoomToResults = hooks.useEventCallback(async () => {
    const view = getCurrentView()
    if (!view) {
      setError(ErrorType.VALIDATION_ERROR, translate("errorNoMapPoint"))
      return
    }

    const fnrs = state.selectedProperties.map((prop) => prop.FNR)
    if (fnrs.length === 0) {
      setError(ErrorType.VALIDATION_ERROR, translate("noPropertiesSelected"))
      return
    }

    if (!config.propertyDataSourceId || !dsManagerRef.current) {
      setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
      return
    }

    setState((prev) => ({ ...prev, loading: true, error: null }))

    const controller = getController()
    try {
      const extent = await queryExtentForProperties(
        fnrs,
        config.propertyDataSourceId,
        dsManagerRef.current,
        { signal: controller.signal }
      )

      if (controller.signal.aborted) {
        setState((prev) => ({ ...prev, loading: false }))
        return
      }

      if (!extent) {
        setError(ErrorType.VALIDATION_ERROR, translate("errorNoDataAvailable"))
        return
      }

      await view.goTo(extent.expand(1.2), { duration: 1000 })

      setState((prev) => ({ ...prev, loading: false }))

      trackEvent({
        category: "Navigation",
        action: "zoom_to_results",
        value: fnrs.length,
      })
    } catch (error) {
      if (isAbortError(error)) {
        setState((prev) => ({ ...prev, loading: false }))
        return
      }
      setError(ErrorType.QUERY_ERROR, translate("errorQueryFailed"))
      trackError("zoom_to_results", error)
    } finally {
      releaseController(controller)
    }
  })

  const setError = hooks.useEventCallback(
    (type: ErrorType, message: string, details?: string) => {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: { type, message, details },
      }))
    }
  )

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
        loading: true,
        error: null,
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
          setState((prev) => ({ ...prev, loading: false }))
          tracker.failure("aborted")
          return
        }

        if (!propertyResults.length) {
          if (isStaleRequest()) {
            return
          }
          setState((prev) => ({ ...prev, loading: false }))
          tracker.success()
          trackEvent({
            category: "Query",
            action: "property_query",
            label: "no_results",
          })
          return
        }

        // Step 4: Process results and enrich with owner data
        const useBatchQuery =
          config.enableBatchOwnerQuery &&
          config.relationshipId !== undefined &&
          config.propertyDataSourceId

        const { rowsToProcess, graphicsToAdd } = useBatchQuery
          ? await processPropertyResultsWithBatchQuery({
              propertyResults,
              config: {
                propertyDataSourceId: config.propertyDataSourceId,
                ownerDataSourceId: config.ownerDataSourceId,
                enablePIIMasking: piiMaskingEnabled,
                relationshipId: config.relationshipId,
              },
              dsManager: manager,
              maxResults,
              signal: controller.signal,
              helpers: {
                extractFnr,
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
            })
          : await processPropertyResults({
              propertyResults,
              config: {
                ownerDataSourceId: config.ownerDataSourceId,
                enablePIIMasking: piiMaskingEnabled,
              },
              dsManager: manager,
              maxResults,
              signal: controller.signal,
              helpers: {
                extractFnr,
                queryOwnerByFnr,
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
            })

        if (controller.signal.aborted || isStaleRequest()) {
          if (isStaleRequest()) {
            return
          }
          setState((prev) => ({ ...prev, loading: false }))
          tracker.failure("aborted")
          return
        }

        // Step 5: Calculate updates with toggle logic (use snapshot)
        let cleanupParams: {
          updatedRows: GridRowData[]
          previousRows: GridRowData[]
        } | null = null

        let syncParams: SelectionGraphicsParams | null = null

        // Capture requestId snapshot to prevent TOCTOU race condition
        const requestIdSnapshot = requestIdRef.current
        const isStaleRequestSnapshot = () => requestId !== requestIdSnapshot

        setState((prev) => {
          // Check staleness using snapshot (atomic check)
          if (isStaleRequestSnapshot()) {
            return prev
          }
          const { updatedRows, toRemove } = calculatePropertyUpdates(
            rowsToProcess,
            prev.selectedProperties,
            toggleEnabled,
            maxResults
          )

          cleanupParams = {
            updatedRows,
            previousRows: prev.selectedProperties,
          }

          syncParams = {
            graphicsToAdd,
            selectedRows: updatedRows,
            getCurrentView,
            helpers: {
              addGraphicsToMap,
              extractFnr,
              normalizeFnrKey,
            },
            highlightColor: HIGHLIGHT_COLOR_RGBA,
            outlineWidth: OUTLINE_WIDTH,
          }

          // Track toggle removals
          if (toRemove.size > 0) {
            const removedRows = prev.selectedProperties.filter((row) =>
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

          return {
            ...prev,
            loading: false,
            selectedProperties: updatedRows,
          }
        })

        // Revalidate staleness before executing side effects using snapshot
        if (isStaleRequestSnapshot()) {
          releaseController(controller)
          return
        }

        if (cleanupParams) {
          cleanupRemovedGraphics({
            updatedRows: cleanupParams.updatedRows,
            previousRows: cleanupParams.previousRows,
            removeGraphicsForFnr,
            normalizeFnrKey,
          })
        }

        if (syncParams) {
          syncSelectionGraphics(syncParams)
        }

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
          setState((prev) => ({ ...prev, loading: false }))
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
        releaseController(controller)
      }
    }
  )

  // Debounce map clicks to prevent rapid-fire queries
  const debouncedMapClick = useDebouncedMapClick(handleMapClick)

  const { onActiveViewChange, getCurrentView } = useMapViewLifecycle({
    modules,
    ensureGraphicsLayer,
    destroyGraphicsLayer,
    disablePopup,
    restorePopup,
    onMapClick: debouncedMapClick,
  })

  hooks.useUnmount(() => {
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
            width={100}
            height={100}
          />
          <div css={styles.messageState}>{translate("loadingModules")}</div>
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
      <div css={styles.header}>
        <div css={styles.buttons}>
          <Button
            type="tertiary"
            icon
            onClick={handleZoomToResults}
            title={translate("zoomToResults")}
            disabled={state.selectedProperties.length === 0 || state.loading}
            aria-label={translate("zoomToResults")}
          >
            <SVG src={zoomIcon} size={20} />
          </Button>
          <Button
            type="tertiary"
            icon
            onClick={handleClearAll}
            title={translate("clearAll")}
            disabled={state.selectedProperties.length === 0}
          >
            <SVG src={clearIcon} size={20} />
          </Button>
        </div>
      </div>

      <div css={styles.cols}>
        <div css={styles.col}>{translate("columnFastighet")}</div>
        <div css={styles.col}>{translate("columnOwner")}</div>
      </div>

      <div css={styles.body} role="main">
        {!isConfigured && (
          <div css={styles.emptyState} role="status" aria-live="polite">
            <SVG
              css={styles.svgState}
              src={mapWrong}
              width={100}
              height={100}
            />
            <div css={styles.messageState}>
              {translate("widgetNotConfigured")}
            </div>
          </div>
        )}

        {isConfigured && state.loading && (
          <div
            css={styles.emptyState}
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <Loading
              css={styles.loadingState}
              type={LoadingType.Donut}
              width={100}
              height={100}
            />
            <div css={styles.messageState}>{translate("loadingData")}</div>
          </div>
        )}

        {isConfigured && state.error && (
          <div css={styles.emptyState} role="alert" aria-live="assertive">
            <Alert type="error" withIcon text={state.error.message} />
            {state.error.details && <div>{state.error.details}</div>}
          </div>
        )}

        {isConfigured &&
          !state.loading &&
          !state.error &&
          state.selectedProperties.length === 0 && (
            <div css={styles.emptyState} role="status" aria-live="polite">
              <SVG
                css={styles.svgState}
                src={mapSelect}
                width={100}
                height={100}
              />
              <div css={styles.messageState}>{translate("readyToSelect")}</div>
            </div>
          )}

        {isConfigured &&
          !state.loading &&
          !state.error &&
          state.selectedProperties.length > 0 && (
            <PropertyTable
              data={state.selectedProperties}
              columns={tableColumns()}
              translate={translate}
              styles={styles}
            />
          )}
      </div>

      <div css={styles.footer}>
        <div css={styles.col}>{translate("propertySelected")}</div>
        <div css={styles.col}>{state.selectedProperties.length}</div>
      </div>

      {mapWidgetId && (
        <JimuMapViewComponent
          useMapWidgetId={mapWidgetId}
          onActiveViewChange={onActiveViewChange}
        />
      )}
    </div>
  )
}

const Widget = (props: AllWidgetProps<IMConfig>): React.ReactElement => {
  const styles = useWidgetStyles()
  const translate = hooks.useTranslation()
  return (
    <PropertyWidgetErrorBoundary styles={styles} translate={translate}>
      <WidgetContent {...props} />
    </PropertyWidgetErrorBoundary>
  )
}

export default Widget
