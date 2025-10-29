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
import { Alert, Button, Loading, LoadingType } from "jimu-ui"
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
} from "../shared/hooks"
import {
  queryPropertyByPoint,
  queryOwnerByFnr,
  clearQueryCache,
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
  validateMapClickInputs,
  syncGraphicsWithState,
  validateDataSources,
  cleanupRemovedGraphics,
} from "../shared/utils"
import {
  GRID_COLUMN_KEYS,
  HIGHLIGHT_COLOR_RGBA,
  OUTLINE_WIDTH,
  MAX_UNDO_HISTORY,
} from "../config/constants"
import {
  trackEvent,
  trackError,
  trackFeatureUsage,
  createPerformanceTracker,
} from "../shared/telemetry"
import defaultMessages from "./translations/default"

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

const isMapClickValidationFailure = (
  result: ReturnType<typeof validateMapClickInputs>
): result is { valid: false; error: { type: any; message: string } } => {
  return !result.valid
}

const isDataSourceValidationFailure = (
  result: ReturnType<typeof validateDataSources>
): result is {
  valid: false
  error: { type: any; message: string }
  failureReason: string
} => {
  return !result.valid
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
  const translate = hooks.useTranslation(defaultMessages)

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
    undoHistory: [],
  })

  const maxResults = config.maxResults
  const toggleEnabled = config.enableToggleRemoval
  const piiMaskingEnabled = config.enablePIIMasking
  const mapWidgetId = useMapWidgetIds?.[0]

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

        const newUndoHistory = [
          {
            type: "remove" as const,
            timestamp: Date.now(),
            data: removed,
          },
          ...prev.undoHistory,
        ].slice(0, MAX_UNDO_HISTORY)

        trackEvent({
          category: "Property",
          action: "remove",
          value: removed.length,
        })

        return {
          ...prev,
          selectedProperties: updated,
          undoHistory: newUndoHistory,
        }
      })
    }
  )

  const handleClearAll = hooks.useEventCallback(() => {
    abortAll()
    clearQueryCache()
    clearGraphics()
    setState((prev) => {
      const newUndoHistory = [
        {
          type: "clear" as const,
          timestamp: Date.now(),
          data: prev.selectedProperties,
        },
        ...prev.undoHistory,
      ].slice(0, MAX_UNDO_HISTORY)

      trackEvent({
        category: "Property",
        action: "clear_all",
        value: prev.selectedProperties.length,
      })

      return {
        ...prev,
        selectedProperties: [],
        error: null,
        undoHistory: newUndoHistory,
      }
    })
  })

  const handleUndo = hooks.useEventCallback(() => {
    if (state.undoHistory.length === 0) return

    const [lastOperation, ...remainingHistory] = state.undoHistory

    setState((prev) => {
      let restoredProperties = [...prev.selectedProperties]

      if (lastOperation.type === "remove") {
        restoredProperties = [...prev.selectedProperties, ...lastOperation.data]
      } else if (lastOperation.type === "clear") {
        restoredProperties = lastOperation.data
      }

      if (lastOperation.data.length > 0) {
        syncSelectionGraphics({
          graphicsToAdd: lastOperation.data.map((row) => ({
            graphic: row.graphic,
            fnr: row.FNR,
          })),
          selectedRows: restoredProperties,
          getCurrentView,
          helpers: {
            addGraphicsToMap,
            extractFnr,
            normalizeFnrKey,
          },
          highlightColor: HIGHLIGHT_COLOR_RGBA,
          outlineWidth: OUTLINE_WIDTH,
        })
      }

      trackEvent({
        category: "Property",
        action: "undo",
        label: lastOperation.type,
      })

      return {
        ...prev,
        selectedProperties: restoredProperties,
        undoHistory: remainingHistory,
      }
    })
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
      if (isMapClickValidationFailure(validation)) {
        const { error } = validation
        setError(error.type, error.message)
        tracker.failure(error.type)
        trackError("map_click_validation", error.type, error.message)
        return
      }
      const { mapPoint } = validation

      // Step 2: Validate data sources
      const dsValidation = validateDataSources({
        propertyDsId: config.propertyDataSourceId,
        ownerDsId: config.ownerDataSourceId,
        dsManager: dsManagerRef.current,
        allowedHosts: config.allowedHosts,
        translate,
      })

      if (isDataSourceValidationFailure(dsValidation)) {
        const { error, failureReason } = dsValidation
        setError(error.type, error.message)
        tracker.failure(failureReason)
        trackError("map_click", failureReason)
        return
      }
      const { manager } = dsValidation

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
        const { rowsToProcess, graphicsToAdd } = await processPropertyResults({
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

        // Capture stale check result BEFORE setState to ensure consistency
        const wasStaleBeforeUpdate = isStaleRequest()

        if (wasStaleBeforeUpdate) {
          return
        }

        setState((prev) => {
          // Recheck staleness inside setState to catch concurrent updates
          if (isStaleRequest()) {
            return prev
          }
          const { updatedRows } = calculatePropertyUpdates(
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

          return {
            ...prev,
            loading: false,
            selectedProperties: updatedRows,
          }
        })

        // Remove post-setState stale check - cleanup/sync must happen if setState executed

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

        if (isStaleRequest()) {
          return
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
        setError(ErrorType.QUERY_ERROR, translate("errorQueryFailed"))
        tracker.failure("query_error")
        trackError("property_query", error)
      } finally {
        releaseController(controller)
      }
    }
  )

  const { onActiveViewChange, getCurrentView } = useMapViewLifecycle({
    modules,
    ensureGraphicsLayer,
    destroyGraphicsLayer,
    disablePopup,
    restorePopup,
    onMapClick: handleMapClick,
  })

  hooks.useUnmount(() => {
    abortAll()
    clearQueryCache()
  })

  if (modulesLoading) {
    return (
      <div
        css={styles.parent}
        role="region"
        aria-label={translate("widgetTitle")}
      >
        <div
          css={styles.loading}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Loading type={LoadingType.Donut} />
          <div>{translate("loadingModules")}</div>
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
        <div css={styles.error} role="alert" aria-live="assertive">
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
          {state.undoHistory.length > 0 && (
            <Button
              size="sm"
              type="tertiary"
              onClick={handleUndo}
              aria-label={translate("undoLastAction")}
            >
              {translate("undo")}
            </Button>
          )}
          {state.selectedProperties.length > 0 && (
            <Button size="sm" type="secondary" onClick={handleClearAll}>
              {translate("clearAll")}
            </Button>
          )}
        </div>
      </div>

      <div css={styles.cols}>
        <div css={styles.col}>{translate("columnFastighet")}</div>
        <div css={styles.col}>{translate("columnOwner")}</div>
      </div>

      <div css={styles.body} role="main">
        {state.loading && (
          <div
            css={styles.loading}
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <Loading type={LoadingType.Donut} />
            <div>{translate("loadingData")}</div>
          </div>
        )}

        {state.error && (
          <div css={styles.error} role="alert" aria-live="assertive">
            <Alert type="error" withIcon text={state.error.message} />
            {state.error.details && <div>{state.error.details}</div>}
          </div>
        )}

        {!state.loading &&
          !state.error &&
          state.selectedProperties.length > 0 && (
            <div
              css={styles.list}
              role="list"
              aria-label={translate("widgetTitle")}
            >
              {state.selectedProperties.map((row) => (
                <div css={styles.row} role="listitem" key={row.id}>
                  <div
                    css={styles.column}
                    data-column={GRID_COLUMN_KEYS.FASTIGHET}
                  >
                    {row.FASTIGHET}
                  </div>
                  <div
                    css={styles.column}
                    data-column={GRID_COLUMN_KEYS.BOSTADR}
                  >
                    {row.BOSTADR}
                  </div>
                  <div css={styles.actions}>
                    <Button
                      type="tertiary"
                      size="sm"
                      onClick={() => handleRemoveProperty(row.FNR)}
                      aria-label={`${translate("removeProperty")} ${row.FASTIGHET}`}
                    >
                      {translate("removeProperty")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
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
  const translate = hooks.useTranslation(defaultMessages)
  return (
    <PropertyWidgetErrorBoundary styles={styles} translate={translate}>
      <WidgetContent {...props} />
    </PropertyWidgetErrorBoundary>
  )
}

export default Widget
