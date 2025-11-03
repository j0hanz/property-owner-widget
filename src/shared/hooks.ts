import { React, hooks } from "jimu-core"
import { loadArcGISJSAPIModules } from "jimu-arcgis"
import type {
  EsriModules,
  PropertyWidgetState,
  TelemetryEvent,
} from "../config/types"
import type { ErrorType } from "../config/enums"
import {
  ESRI_MODULES_TO_LOAD,
  ABORT_CONTROLLER_POOL_SIZE,
} from "../config/constants"
import { popupSuppressionManager, buildHighlightSymbolJSON } from "./utils"

export const useEsriModules = () => {
  const [modules, setModules] = React.useState<EsriModules | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<Error | null>(null)

  hooks.useEffectOnce(() => {
    const stubLoader = (globalThis as any)?.__ESRI_TEST_STUB__
    if (typeof stubLoader === "function") {
      ;(async () => {
        try {
          const stubModules = await Promise.resolve(
            stubLoader(ESRI_MODULES_TO_LOAD)
          )
          setModules(stubModules as EsriModules)
        } catch (err) {
          setError(err as Error)
        } finally {
          setLoading(false)
        }
      })()
      return
    }

    ;(async () => {
      try {
        const loadedModules = await loadArcGISJSAPIModules(
          ESRI_MODULES_TO_LOAD.slice()
        )
        const [
          SimpleFillSymbol,
          SimpleLineSymbol,
          SimpleMarkerSymbol,
          TextSymbol,
          Graphic,
          GraphicsLayer,
          Extent,
        ] = loadedModules
        setModules({
          SimpleFillSymbol,
          SimpleLineSymbol,
          SimpleMarkerSymbol,
          TextSymbol,
          Graphic,
          GraphicsLayer,
          Extent,
        } as EsriModules)
      } catch (err) {
        setError(err as Error)
      } finally {
        setLoading(false)
      }
    })()
  })

  return { modules, loading, error }
}

export const useDebouncedValue = <T>(value: T, delay: number) => {
  const [debouncedValue, setDebouncedValue] = React.useState(value)

  hooks.useEffectWithPreviousValues(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export const useAbortControllerPool = () => {
  const poolRef = React.useRef<AbortController[]>([])
  const activeControllersRef = React.useRef<Set<AbortController>>(new Set())

  const getController = hooks.useEventCallback(() => {
    let controller = poolRef.current.pop()
    while (controller && controller.signal.aborted) {
      controller = poolRef.current.pop()
    }

    const finalController = controller || new AbortController()

    activeControllersRef.current.add(finalController)
    return finalController
  })

  const releaseController = hooks.useEventCallback(
    (controller: AbortController) => {
      activeControllersRef.current.delete(controller)
      if (!controller.signal.aborted) {
        if (poolRef.current.length < ABORT_CONTROLLER_POOL_SIZE) {
          poolRef.current.push(controller)
        }
      }
    }
  )

  const abortAll = hooks.useEventCallback(() => {
    activeControllersRef.current.forEach((controller) => {
      if (!controller.signal.aborted) {
        controller.abort()
      }
    })
    activeControllersRef.current.clear()
    poolRef.current = []
  })

  hooks.useUnmount(() => {
    abortAll()
  })

  return { getController, releaseController, abortAll }
}

interface PropertySelectionParams {
  abortAll: () => void
  clearGraphics: () => void
  clearQueryCache: () => void
  trackEvent: (event: TelemetryEvent) => void
}

interface PropertySelectionApi {
  state: PropertyWidgetState
  updateState: (
    updater: (prev: PropertyWidgetState) => PropertyWidgetState
  ) => void
  setError: (type: ErrorType, message: string, details?: string) => void
  handleSelectionChange: (selectedIds: Set<string>) => void
  handleClearAll: () => void
  handleWidgetReset: () => void
}

const createInitialSelectionState = (): PropertyWidgetState => ({
  error: null,
  selectedProperties: [],
  isQueryInFlight: false,
  rawPropertyResults: null,
  rowSelectionIds: new Set(),
})

export const usePropertySelectionState = (
  params: PropertySelectionParams
): PropertySelectionApi => {
  const { abortAll, clearGraphics, clearQueryCache, trackEvent } = params

  const [state, internalSetState] = React.useState<PropertyWidgetState>(
    createInitialSelectionState()
  )

  const updateState = hooks.useEventCallback(
    (updater: (prev: PropertyWidgetState) => PropertyWidgetState) => {
      internalSetState((prev) => updater(prev))
    }
  )

  const setError = hooks.useEventCallback(
    (type: ErrorType, message: string, details?: string) => {
      internalSetState((prev) => ({
        ...prev,
        error: { type, message, details },
        isQueryInFlight: false,
      }))
    }
  )

  const handleSelectionChange = hooks.useEventCallback(
    (selectedIds: Set<string>) => {
      updateState((prev) => ({
        ...prev,
        rowSelectionIds: new Set(selectedIds),
      }))
    }
  )

  const resetState = hooks.useEventCallback((shouldTrackClear: boolean) => {
    abortAll()
    clearQueryCache()
    clearGraphics()

    updateState((prev) => {
      if (shouldTrackClear) {
        trackEvent({
          category: "Property",
          action: "clear_all",
          value: prev.selectedProperties.length,
        })
      }

      return createInitialSelectionState()
    })
  })

  const handleClearAll = hooks.useEventCallback(() => {
    resetState(true)
  })

  const handleWidgetReset = hooks.useEventCallback(() => {
    resetState(false)
  })

  hooks.useUnmount(() => {
    // State cleanup handled by abortAll in widget
  })

  return {
    state,
    updateState,
    setError,
    handleSelectionChange,
    handleClearAll,
    handleWidgetReset,
  }
}

export const useGraphicsLayer = (
  modules: EsriModules | null,
  widgetId: string
) => {
  const modulesRef = hooks.useLatest(modules)
  const graphicsLayerRef = React.useRef<__esri.GraphicsLayer | null>(null)
  const graphicsMapRef = React.useRef<Map<string | number, __esri.Graphic[]>>(
    new Map()
  )

  const ensureGraphicsLayer = hooks.useEventCallback(
    (view: __esri.MapView | null | undefined): boolean => {
      const currentModules = modulesRef.current
      if (!currentModules || !view) return false
      if (!graphicsLayerRef.current) {
        graphicsLayerRef.current = new currentModules.GraphicsLayer({
          id: `${widgetId}-property-highlight-layer`,
          listMode: "hide",
        })
        view.map.add(graphicsLayerRef.current)
        return true
      } else if (!view.map.findLayerById(graphicsLayerRef.current.id)) {
        view.map.add(graphicsLayerRef.current)
        return true
      }
      return false
    }
  )

  const clearGraphics = hooks.useEventCallback(() => {
    if (graphicsLayerRef.current) {
      graphicsLayerRef.current.removeAll()
    }
    graphicsMapRef.current.clear()
  })

  const removeGraphicsForFnr = hooks.useEventCallback(
    (fnr: string | number, normalizeFnrKey: (fnr: any) => string) => {
      const layer = graphicsLayerRef.current
      if (!layer || fnr == null) return
      const fnrKey = normalizeFnrKey(fnr)
      const graphics = graphicsMapRef.current.get(fnrKey)
      if (graphics && graphics.length > 0) {
        layer.removeMany(graphics)
        graphicsMapRef.current.delete(fnrKey)
      }
    }
  )

  const createHighlightSymbol = (
    graphic: __esri.Graphic | null | undefined,
    highlightColor: [number, number, number, number],
    outlineWidth: number
  ):
    | __esri.SimpleFillSymbol
    | __esri.SimpleLineSymbol
    | __esri.SimpleMarkerSymbol
    | null => {
    const currentModules = modulesRef.current
    if (!currentModules || !graphic) return null

    const geometry = graphic.geometry
    if (!geometry) return null

    const geometryType = geometry.type

    if (geometryType === "polygon" || geometryType === "extent") {
      const symbolJSON = buildHighlightSymbolJSON(
        highlightColor,
        outlineWidth,
        "polygon"
      )
      return new currentModules.SimpleFillSymbol(
        symbolJSON as __esri.SimpleFillSymbolProperties
      )
    }

    if (geometryType === "polyline") {
      const symbolJSON = buildHighlightSymbolJSON(
        highlightColor,
        outlineWidth,
        "polyline"
      )
      return new currentModules.SimpleLineSymbol(
        symbolJSON as __esri.SimpleLineSymbolProperties
      )
    }

    if (geometryType === "point" || geometryType === "multipoint") {
      const symbolJSON = buildHighlightSymbolJSON(
        highlightColor,
        outlineWidth,
        "point"
      )
      return new currentModules.SimpleMarkerSymbol(
        symbolJSON as __esri.SimpleMarkerSymbolProperties
      )
    }
    // Unsupported geometry type
    return null
  }

  const addGraphicsToMap = hooks.useEventCallback(
    (
      graphic: __esri.Graphic | null | undefined,
      view: __esri.MapView | null | undefined,
      extractFnr: (attrs: any) => string | number | null,
      normalizeFnrKey: (fnr: any) => string,
      highlightColor: [number, number, number, number],
      outlineWidth: number
    ) => {
      const currentModules = modulesRef.current
      if (!currentModules || !graphic || !view) return
      ensureGraphicsLayer(view)

      const layer = graphicsLayerRef.current
      if (!layer) return

      const fnr = extractFnr(graphic.attributes || null)
      const symbol = createHighlightSymbol(
        graphic,
        highlightColor,
        outlineWidth
      )
      if (!symbol) return

      // Create a new graphic with the highlight symbol
      const highlightGraphic = new currentModules.Graphic({
        geometry: graphic.geometry,
        symbol,
        attributes: graphic.attributes
          ? { ...graphic.attributes, FNR: fnr }
          : { FNR: fnr },
      })

      removeGraphicsForFnr(fnr, normalizeFnrKey)
      layer.add(highlightGraphic)

      if (!fnr) return

      const fnrKey = normalizeFnrKey(fnr)
      // Store reference for future removal
      const existing = graphicsMapRef.current.get(fnrKey)
      if (existing) {
        existing.push(highlightGraphic)
      } else {
        graphicsMapRef.current.set(fnrKey, [highlightGraphic])
      }
    }
  )

  const destroyGraphicsLayer = hooks.useEventCallback(
    (view: __esri.MapView | null | undefined) => {
      if (view && graphicsLayerRef.current) {
        const layer = graphicsLayerRef.current
        graphicsLayerRef.current = null
        graphicsMapRef.current.clear()
        view.map?.remove(layer)
        layer.destroy()
      }
    }
  )

  hooks.useUnmount(() => {
    if (graphicsLayerRef.current) {
      graphicsLayerRef.current.destroy?.()
      graphicsLayerRef.current = null
    }
    graphicsMapRef.current.clear()
  })

  return {
    graphicsLayerRef,
    graphicsMapRef,
    ensureGraphicsLayer,
    clearGraphics,
    removeGraphicsForFnr,
    addGraphicsToMap,
    destroyGraphicsLayer,
  }
}

export const usePopupManager = () => {
  const ownerIdRef = React.useRef(Symbol("property-widget-popup-owner"))

  const restorePopup = hooks.useEventCallback(
    (view: __esri.MapView | undefined) => {
      if (!view) return
      popupSuppressionManager.release(ownerIdRef.current, view)
    }
  )

  const disablePopup = hooks.useEventCallback(
    (view: __esri.MapView | undefined) => {
      if (!view) return
      popupSuppressionManager.acquire(ownerIdRef.current, view)
    }
  )

  const cleanup = hooks.useEventCallback((view: __esri.MapView | undefined) => {
    restorePopup(view)
  })

  return {
    disablePopup,
    restorePopup,
    cleanup,
  }
}

export const useMapViewLifecycle = (params: {
  modules: EsriModules | null
  ensureGraphicsLayer: (view: __esri.MapView) => void
  destroyGraphicsLayer: (view: __esri.MapView) => void
  disablePopup: (view: __esri.MapView | undefined) => void
  restorePopup: (view: __esri.MapView | undefined) => void
  onMapClick: (event: __esri.ViewClickEvent) => void
}) => {
  const {
    modules,
    ensureGraphicsLayer,
    destroyGraphicsLayer,
    disablePopup,
    restorePopup,
    onMapClick,
  } = params

  const jimuMapViewRef = React.useRef<any>(null)
  const mapClickHandleRef = React.useRef<__esri.Handle | null>(null)

  const setupMapView = hooks.useEventCallback((view: __esri.MapView) => {
    disablePopup(view)
    ensureGraphicsLayer(view)

    if (mapClickHandleRef.current) {
      mapClickHandleRef.current.remove()
      mapClickHandleRef.current = null
    }
    try {
      mapClickHandleRef.current = view.on("click", onMapClick)
    } catch (error) {
      console.error("Failed to register map click handler", error)
      mapClickHandleRef.current = null
    }
  })

  const cleanupPreviousView = hooks.useEventCallback(() => {
    const previousView = jimuMapViewRef.current?.view
    if (previousView) {
      restorePopup(previousView)
      destroyGraphicsLayer(previousView)

      if (mapClickHandleRef.current) {
        mapClickHandleRef.current.remove()
        mapClickHandleRef.current = null
      }
    }
  })

  const onActiveViewChange = hooks.useEventCallback((jimuMapView: any) => {
    const view = jimuMapView?.view
    if (!view) {
      return
    }

    const previousView = jimuMapViewRef.current?.view
    if (previousView && previousView !== view) {
      cleanupPreviousView()
    }

    jimuMapViewRef.current = jimuMapView

    // If modules are ready, setup immediately. Otherwise, wait for modules.
    if (modules) {
      setupMapView(view)
    }
  })

  const reactivateMapView = hooks.useEventCallback(() => {
    const currentView = jimuMapViewRef.current?.view
    if (currentView && modules) {
      disablePopup(currentView)
      if (mapClickHandleRef.current) {
        mapClickHandleRef.current.remove()
        mapClickHandleRef.current = null
      }
      try {
        mapClickHandleRef.current = currentView.on("click", onMapClick)
      } catch (error) {
        console.error("Failed to reactivate map click handler", error)
        mapClickHandleRef.current = null
      }
    }
  })

  const cleanup = hooks.useEventCallback(() => {
    const currentView = jimuMapViewRef.current?.view
    restorePopup(currentView)

    if (mapClickHandleRef.current) {
      mapClickHandleRef.current.remove()
      mapClickHandleRef.current = null
    }

    if (currentView) {
      destroyGraphicsLayer(currentView)
    }
  })

  hooks.useUnmount(() => {
    cleanup()
  })

  // Setup map view when modules become ready (if map view is already available)
  hooks.useUpdateEffect(() => {
    if (modules && jimuMapViewRef.current?.view && !mapClickHandleRef.current) {
      setupMapView(jimuMapViewRef.current.view)
    }
  }, [modules, setupMapView])

  return {
    onActiveViewChange,
    getCurrentView: () => jimuMapViewRef.current?.view,
    reactivateMapView,
    cleanup,
  }
}

export const useStringConfigValue = (config: { [key: string]: any }) => {
  const configRef = hooks.useLatest(config)
  return hooks.useEventCallback((key: string, defaultValue = ""): string => {
    const v = configRef.current?.[key]
    return typeof v === "string" ? v : defaultValue
  })
}

export const useBooleanConfigValue = (config: { [key: string]: any }) => {
  const configRef = hooks.useLatest(config)
  return hooks.useEventCallback(
    (key: string, defaultValue = false): boolean => {
      const v = configRef.current?.[key]
      return typeof v === "boolean" ? v : defaultValue
    }
  )
}

export const useNumberConfigValue = (config: { [key: string]: any }) => {
  const configRef = hooks.useLatest(config)
  return hooks.useEventCallback(
    (key: string, defaultValue?: number): number | undefined => {
      const v = configRef.current?.[key]
      if (typeof v === "number" && Number.isFinite(v)) return v
      return defaultValue
    }
  )
}

export const useUpdateConfig = (
  id: string,
  config: { [key: string]: any; set?: (key: string, value: any) => any },
  onSettingChange: (update: { id: string; config: any }) => void
) => {
  return hooks.useEventCallback((key: string, value: any) => {
    onSettingChange({
      id,
      config: config.set ? config.set(key, value) : { ...config, [key]: value },
    })
  })
}

export const useNumericConfigHandler = (
  localValue: string,
  setLocalValue: (val: string) => void,
  validate: (val: string) => boolean,
  updateConfig: (key: string, value: any) => void,
  configKey: string,
  debounce: (val: string) => void
) => {
  const handleChange = hooks.useEventCallback((value: number) => {
    setLocalValue(String(value))
    debounce(String(value))
  })

  const handleBlur = hooks.useEventCallback(() => {
    ;(debounce as any).cancel?.()
    const isValid = validate(localValue)
    if (isValid) {
      const num = parseInt(localValue, 10)
      updateConfig(configKey, num)
    }
  })

  return { handleChange, handleBlur }
}

export const useSwitchConfigHandler = (
  localValue: boolean,
  setLocalValue: (val: boolean) => void,
  updateConfig: (key: string, value: any) => void,
  configKey: string
) => {
  return hooks.useEventCallback((evt: React.ChangeEvent<HTMLInputElement>) => {
    const checked = evt.target.checked
    setLocalValue(checked)
    updateConfig(configKey, checked)
  })
}

export const useSliderConfigHandler = <T extends number>(
  localValue: T,
  setLocalValue: (val: T) => void,
  updateConfig: (key: string, value: any) => void,
  configKey: string,
  normalizer: (rawValue: number) => T
) => {
  return hooks.useEventCallback((evt: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = Number.parseFloat(evt?.target?.value ?? "")
    if (!Number.isFinite(rawValue)) {
      return
    }
    const nextValue = normalizer(rawValue)
    if (Math.abs(localValue - nextValue) < 0.0001) {
      return
    }
    setLocalValue(nextValue)
    updateConfig(configKey, nextValue)
  })
}

type DebouncedFn<T extends (...args: any[]) => void> = ((
  ...args: Parameters<T>
) => void) & {
  cancel: () => void
}

export const useNumericValidator = (
  fieldKey: string,
  min: number,
  max: number,
  errorMessage: string,
  setFieldErrors: (
    fn: (prev: { [key: string]: string | undefined }) => {
      [key: string]: string | undefined
    }
  ) => void
) => {
  return hooks.useEventCallback((value: string): boolean => {
    const { validateNumericRange } = require("./utils")
    const result = validateNumericRange({ value, min, max, errorMessage })
    setFieldErrors((prev) => ({
      ...prev,
      [fieldKey]: result.valid ? undefined : result.error,
    }))
    return result.valid
  })
}

export const useThrottle = <T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  const safeDelay = Number.isFinite(delay) && delay >= 0 ? delay : 0
  const lastCallTimeRef = React.useRef<number>(0)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingArgsRef = React.useRef<Parameters<T> | null>(null)
  const mountedRef = React.useRef(true)
  const callbackRef = hooks.useLatest(callback)

  const execute = hooks.useEventCallback((args: Parameters<T>) => {
    if (!mountedRef.current) return
    lastCallTimeRef.current = Date.now()
    pendingArgsRef.current = null
    try {
      callbackRef.current(...args)
    } catch (error) {
      console.error("Throttled function error:", error)
    }
  })

  const throttled = hooks.useEventCallback((...args: Parameters<T>) => {
    const now = Date.now()
    const timeSinceLastCall = now - lastCallTimeRef.current

    if (timeSinceLastCall >= safeDelay) {
      // Execute immediately if enough time has passed
      execute(args)
    } else {
      // Schedule execution for remaining time
      pendingArgsRef.current = args
      if (!timeoutRef.current) {
        const remainingTime = safeDelay - timeSinceLastCall
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null
          if (pendingArgsRef.current && mountedRef.current) {
            execute(pendingArgsRef.current)
          }
        }, remainingTime)
      }
    }
  })

  hooks.useEffectOnce(() => {
    return () => {
      mountedRef.current = false
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  })

  return throttled
}

export const useDebounce = <T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
  options?: { onPendingChange?: (pending: boolean) => void }
): DebouncedFn<T> => {
  const safeDelay = Number.isFinite(delay) && delay >= 0 ? delay : 0
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = React.useRef(false)
  const mountedRef = React.useRef(true)
  const callbackRef = hooks.useLatest(callback)
  const optionsRef = hooks.useLatest(options)

  const notifyPending = hooks.useEventCallback((next: boolean) => {
    if (pendingRef.current === next) return
    pendingRef.current = next
    const handler = optionsRef.current?.onPendingChange
    if (typeof handler === "function") {
      try {
        handler(next)
      } catch {}
    }
  })

  const cancel = hooks.useEventCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (pendingRef.current) {
      notifyPending(false)
    }
  })

  const run = hooks.useEventCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    notifyPending(true)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      if (!mountedRef.current) return
      try {
        callbackRef.current(...args)
      } finally {
        notifyPending(false)
      }
    }, safeDelay)
  })

  const debouncedRef = React.useRef<DebouncedFn<T> | null>(null)
  const runRef = hooks.useLatest(run)
  const cancelRef = hooks.useLatest(cancel)

  if (!debouncedRef.current) {
    const runner = ((...args: Parameters<T>) => {
      runRef.current(...args)
    }) as DebouncedFn<T>
    runner.cancel = () => cancelRef.current()
    debouncedRef.current = runner
  }

  hooks.useEffectOnce(() => {
    return () => {
      mountedRef.current = false
      cancelRef.current()
    }
  })

  return debouncedRef.current
}
