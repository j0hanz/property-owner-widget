import { React, hooks } from "jimu-core"
import { loadArcGISJSAPIModules } from "jimu-arcgis"
import type { EsriModules } from "../config/types"
import { ESRI_MODULES_TO_LOAD } from "../config/constants"

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
        const [SimpleFillSymbol, Graphic, GraphicsLayer] = loadedModules
        setModules({
          SimpleFillSymbol,
          Graphic,
          GraphicsLayer,
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

export const useAbortControllerPool = () => {
  const poolRef = React.useRef<AbortController[]>([])
  const activeControllersRef = React.useRef<Set<AbortController>>(new Set())

  const getController = hooks.useEventCallback(() => {
    const pooled = poolRef.current.pop()
    const controller = pooled || new AbortController()

    activeControllersRef.current.add(controller)
    return controller
  })

  const releaseController = hooks.useEventCallback(
    (controller: AbortController) => {
      activeControllersRef.current.delete(controller)
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
    (view: __esri.MapView | null | undefined) => {
      if (!modules || !view) return
      if (!graphicsLayerRef.current) {
        graphicsLayerRef.current = new modules.GraphicsLayer({
          id: `${widgetId}-property-highlight-layer`,
          listMode: "hide",
        })
        view.map.add(graphicsLayerRef.current)
      } else if (!view.map.findLayerById(graphicsLayerRef.current.id)) {
        view.map.add(graphicsLayerRef.current)
      }
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
        view.map?.remove(graphicsLayerRef.current)
        graphicsLayerRef.current.destroy()
        graphicsLayerRef.current = null
        graphicsMapRef.current.clear()
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
  const popupStatesRef = React.useRef<Map<__esri.MapView, boolean>>(new Map())

  const restorePopup = hooks.useEventCallback(
    (view: __esri.MapView | undefined) => {
      if (!view) return
      const popup = view.popup as
        | (__esri.Popup & { autoOpenEnabled?: boolean })
        | undefined
      const originalState = popupStatesRef.current.get(view)
      if (popup && originalState !== undefined) {
        popup.autoOpenEnabled = originalState
        popupStatesRef.current.delete(view)
      }
    }
  )

  const disablePopup = hooks.useEventCallback(
    (view: __esri.MapView | undefined) => {
      if (!view) return
      const popup = view.popup as
        | (__esri.Popup & { autoOpenEnabled?: boolean })
        | undefined
      if (popup && typeof popup.autoOpenEnabled === "boolean") {
        if (!popupStatesRef.current.has(view)) {
          popupStatesRef.current.set(view, popup.autoOpenEnabled)
        }
        popup.autoOpenEnabled = false
      }
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
    }
    mapClickHandleRef.current = view.on("click", onMapClick)
  })

  const cleanupPreviousView = hooks.useEventCallback(() => {
    const previousView = jimuMapViewRef.current?.view
    if (previousView) {
      restorePopup(previousView)
      destroyGraphicsLayer(previousView)
    }
  })

  const onActiveViewChange = hooks.useEventCallback((jimuMapView: any) => {
    if (!modules) return
    const view = jimuMapView?.view
    if (!view) return

    const previousView = jimuMapViewRef.current?.view
    if (previousView && previousView !== view) {
      cleanupPreviousView()
    }

    jimuMapViewRef.current = jimuMapView
    setupMapView(view)
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

  return {
    onActiveViewChange,
    getCurrentView: () => jimuMapViewRef.current?.view,
    cleanup,
  }
}
