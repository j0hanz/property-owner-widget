import { React, hooks } from "jimu-core"
import { loadArcGISJSAPIModules } from "jimu-arcgis"
import type { EsriModules } from "../config/types"
import {
  ESRI_MODULES_TO_LOAD,
  ABORT_CONTROLLER_POOL_SIZE,
} from "../config/constants"
import { popupSuppressionManager } from "./utils"

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
        const [SimpleFillSymbol, Graphic, GraphicsLayer, Extent] = loadedModules
        setModules({
          SimpleFillSymbol,
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

export const useGraphicsLayer = (
  modules: EsriModules | null,
  widgetId: string
) => {
  const graphicsLayerRef = React.useRef<__esri.GraphicsLayer | null>(null)
  const graphicsMapRef = React.useRef<Map<string | number, __esri.Graphic[]>>(
    new Map()
  )

  const ensureGraphicsLayer = hooks.useEventCallback(
    (view: __esri.MapView | null | undefined): boolean => {
      if (!modules || !view) return false
      if (!graphicsLayerRef.current) {
        graphicsLayerRef.current = new modules.GraphicsLayer({
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
      if (!layer) return
      const fnrKey = normalizeFnrKey(fnr)
      const graphics = graphicsMapRef.current.get(fnrKey)
      if (graphics && graphics.length > 0) {
        layer.removeMany(graphics)
        graphicsMapRef.current.delete(fnrKey)
      }
    }
  )

  const createHighlightSymbol = (
    highlightColor: [number, number, number, number],
    outlineWidth: number
  ): __esri.SimpleFillSymbol | null => {
    if (!modules) return null
    return new modules.SimpleFillSymbol({
      color: highlightColor,
      outline: {
        color: [highlightColor[0], highlightColor[1], highlightColor[2], 1],
        width: outlineWidth,
      },
    })
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
      if (!modules || !graphic || !view) return
      ensureGraphicsLayer(view)

      const layer = graphicsLayerRef.current
      if (!layer) return

      const fnr = extractFnr(graphic.attributes || null)
      const symbol = createHighlightSymbol(highlightColor, outlineWidth)
      if (!symbol) return

      const highlightGraphic = graphic.clone()
      highlightGraphic.symbol = symbol
      highlightGraphic.attributes = {
        ...(highlightGraphic.attributes || {}),
        FNR: fnr,
      }

      removeGraphicsForFnr(fnr, normalizeFnrKey)
      layer.add(highlightGraphic)

      if (!fnr) return

      const fnrKey = normalizeFnrKey(fnr)
      const existing = graphicsMapRef.current.get(fnrKey) || []
      graphicsMapRef.current.set(fnrKey, [...existing, highlightGraphic])
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
    console.log("Property Widget: Setting up map view with click handler")
    disablePopup(view)
    ensureGraphicsLayer(view)

    if (mapClickHandleRef.current) {
      mapClickHandleRef.current.remove()
      mapClickHandleRef.current = null
    }
    try {
      mapClickHandleRef.current = view.on("click", onMapClick)
    } catch (error) {
      console.error("Failed to register click handler", error)
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
      console.log("Property Widget: No view in jimuMapView")
      return
    }

    const previousView = jimuMapViewRef.current?.view
    if (previousView && previousView !== view) {
      console.log("Property Widget: Cleaning up previous view")
      cleanupPreviousView()
    }

    console.log("Property Widget: Storing jimuMapView reference")
    jimuMapViewRef.current = jimuMapView

    // If modules are ready, setup immediately. Otherwise, wait for modules.
    if (modules) {
      setupMapView(view)
    } else {
      console.log("Property Widget: Map view ready, waiting for modules")
    }
  })

  const reactivateMapView = hooks.useEventCallback(() => {
    const currentView = jimuMapViewRef.current?.view
    if (currentView && modules) {
      console.log("Property Widget: Reactivating existing map view")
      disablePopup(currentView)
      if (mapClickHandleRef.current) {
        mapClickHandleRef.current.remove()
        mapClickHandleRef.current = null
      }
      try {
        mapClickHandleRef.current = currentView.on("click", onMapClick)
      } catch (error) {
        console.error("Failed to reactivate click handler", error)
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
      console.log(
        "Property Widget: Modules loaded, setting up deferred map view"
      )
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

type DebouncedFn<T extends (...args: any[]) => void> = ((
  ...args: Parameters<T>
) => void) & {
  cancel: () => void
  flush: () => void
}

export const useDebounce = <T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
  options?: { onPendingChange?: (pending: boolean) => void }
): DebouncedFn<T> => {
  const safeDelay = Number.isFinite(delay) && delay >= 0 ? delay : 0
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = React.useRef(false)
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
    const noop = () => undefined
    const runner = ((...args: Parameters<T>) => {
      runRef.current(...args)
    }) as DebouncedFn<T>
    runner.cancel = () => cancelRef.current()
    runner.flush = noop
    debouncedRef.current = runner
  }

  hooks.useEffectOnce(() => {
    return () => {
      cancelRef.current()
    }
  })

  return debouncedRef.current
}
