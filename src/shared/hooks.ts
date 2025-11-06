import { type DataSourceManager, hooks, React } from "jimu-core";
import { loadArcGISJSAPIModules } from "jimu-arcgis";
import type { JimuMapView } from "jimu-arcgis";
import {
  ABORT_CONTROLLER_POOL_SIZE,
  ESRI_MODULES_TO_LOAD,
} from "../config/constants";
import type {
  AttributeMap,
  ConfigDictionary,
  ConfigUpdater,
  ConfigWithSet,
  DebouncedFn,
  EsriModules,
  EsriStubGlobal,
  FnrValue,
} from "../config/types";
import { queryPropertyByPoint } from "./api";
import {
  isAbortError,
  popupSuppressionManager,
  validateNumericRange,
} from "./utils/index";

const isConfigDictionary = (value: unknown): value is ConfigDictionary => {
  return typeof value === "object" && value !== null;
};

const hasConfigSet = <T>(value: unknown): value is ConfigWithSet<T> => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { set?: unknown };
  return typeof candidate.set === "function";
};

const isConstructor = (
  value: unknown
): value is new (...args: never[]) => unknown => typeof value === "function";

const isEsriModules = (candidate: unknown): candidate is EsriModules => {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const modules = candidate as Partial<EsriModules>;
  return (
    isConstructor(modules.SimpleFillSymbol) &&
    isConstructor(modules.SimpleLineSymbol) &&
    isConstructor(modules.SimpleMarkerSymbol) &&
    isConstructor(modules.TextSymbol) &&
    isConstructor(modules.Graphic) &&
    isConstructor(modules.GraphicsLayer) &&
    isConstructor(modules.Extent)
  );
};

const isMapView = (
  view: __esri.MapView | __esri.SceneView | undefined
): view is __esri.MapView => view?.type === "2d";

export const useEsriModules = () => {
  const [modules, setModules] = React.useState<EsriModules | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  hooks.useEffectOnce(() => {
    const stubLoader = (globalThis as EsriStubGlobal).__ESRI_TEST_STUB__;
    if (typeof stubLoader === "function") {
      (async () => {
        try {
          const stubModules = await Promise.resolve(
            stubLoader(ESRI_MODULES_TO_LOAD)
          );
          if (!isEsriModules(stubModules)) {
            throw new Error("Invalid Esri module stub");
          }
          setModules(stubModules);
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    (async () => {
      try {
        const loadedModules = await loadArcGISJSAPIModules(
          ESRI_MODULES_TO_LOAD.slice()
        );
        const [
          SimpleFillSymbol,
          SimpleLineSymbol,
          SimpleMarkerSymbol,
          TextSymbol,
          Graphic,
          GraphicsLayer,
          Extent,
        ] = loadedModules as [
          EsriModules["SimpleFillSymbol"],
          EsriModules["SimpleLineSymbol"],
          EsriModules["SimpleMarkerSymbol"],
          EsriModules["TextSymbol"],
          EsriModules["Graphic"],
          EsriModules["GraphicsLayer"],
          EsriModules["Extent"],
        ];
        const modulesBundle: EsriModules = {
          SimpleFillSymbol,
          SimpleLineSymbol,
          SimpleMarkerSymbol,
          TextSymbol,
          Graphic,
          GraphicsLayer,
          Extent,
        };
        setModules(modulesBundle);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    })();
  });

  return { modules, loading, error };
};

export const useDebouncedValue = <T>(value: T, delay: number): T => {
  const safeDelay = Number.isFinite(delay) && delay >= 0 ? delay : 0;
  const [debouncedValue, setDebouncedValue] = React.useState<T>(value);
  const mountedRef = React.useRef(true);

  // No debouncing needed for delay=0
  hooks.useUpdateEffect(() => {
    if (safeDelay === 0) {
      setDebouncedValue(value);
      return undefined;
    }

    const handler = setTimeout(() => {
      if (mountedRef.current) {
        setDebouncedValue(value);
      }
    }, safeDelay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, safeDelay]);

  hooks.useEffectOnce(() => {
    return () => {
      mountedRef.current = false;
    };
  });

  return debouncedValue;
};

export const useAbortControllerPool = () => {
  const poolRef = React.useRef<AbortController[]>([]);
  const activeControllersRef = React.useRef<Set<AbortController>>(new Set());

  const getController = hooks.useEventCallback(() => {
    let controller = poolRef.current.pop();
    while (controller && controller.signal.aborted) {
      controller = poolRef.current.pop();
    }

    const finalController = controller || new AbortController();

    activeControllersRef.current.add(finalController);
    return finalController;
  });

  const releaseController = hooks.useEventCallback(
    (controller: AbortController) => {
      activeControllersRef.current.delete(controller);
      if (!controller.signal.aborted) {
        if (poolRef.current.length < ABORT_CONTROLLER_POOL_SIZE) {
          poolRef.current.push(controller);
        }
      }
    }
  );

  const abortAll = hooks.useEventCallback(() => {
    activeControllersRef.current.forEach((controller) => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    });
    activeControllersRef.current.clear();
    poolRef.current = [];
  });

  hooks.useUnmount(() => {
    abortAll();
  });

  return { getController, releaseController, abortAll };
};

export const useGraphicsLayer = (params: {
  widgetId: string;
  propertyDataSourceId?: string;
  dsManagerRef: React.MutableRefObject<DataSourceManager | null>;
  modules: EsriModules | null;
}) => {
  const { widgetId, modules } = params;
  const widgetIdRef = hooks.useLatest(widgetId);

  const propertyLayerRef = React.useRef<__esri.FeatureLayer | null>(null);
  const highlightLayerRef = React.useRef<__esri.GraphicsLayer | null>(null);
  const activeViewRef = React.useRef<__esri.MapView | null>(null);
  const highlightGraphicsMapRef = React.useRef<Map<string, __esri.Graphic>>(
    new Map()
  );

  const ensureHighlightLayer = hooks.useEventCallback(
    (view: __esri.MapView | null | undefined): __esri.GraphicsLayer | null => {
      if (!view || !modules) {
        return null;
      }

      if (highlightLayerRef.current && !highlightLayerRef.current.destroyed) {
        return highlightLayerRef.current;
      }

      const layer = new modules.GraphicsLayer({
        listMode: "hide",
        title: `Property Highlights - ${widgetId}`,
      });

      view.map.add(layer);
      highlightLayerRef.current = layer;
      console.log("Created highlight GraphicsLayer", {
        widgetId: widgetIdRef.current,
        layerId: layer.id,
      });
      return layer;
    }
  );

  const removeHighlightForKey = hooks.useEventCallback((key: string) => {
    const graphic = highlightGraphicsMapRef.current.get(key);
    if (!graphic) {
      return;
    }
    const layer = highlightLayerRef.current;
    if (layer && !layer.destroyed) {
      try {
        layer.remove(graphic);
      } catch (error) {
        console.log("Failed to remove highlight graphic", {
          error,
          widgetId: widgetIdRef.current,
        });
      }
    }
    highlightGraphicsMapRef.current.delete(key);
  });

  const clearHighlights = hooks.useEventCallback(() => {
    const layer = highlightLayerRef.current;
    if (layer && !layer.destroyed) {
      try {
        layer.removeAll();
      } catch (error) {
        console.log("Failed to clear highlight graphics", {
          error,
          widgetId: widgetIdRef.current,
        });
      }
    }
    highlightGraphicsMapRef.current.clear();
  });

  const createHighlightSymbol = hooks.useEventCallback(
    (
      geometry: __esri.Geometry,
      highlightColor: [number, number, number, number],
      outlineWidth: number
    ): __esri.Symbol | null => {
      if (!modules) {
        return null;
      }

      const [r, g, b, a] = highlightColor;

      if (geometry.type === "polygon") {
        return new modules.SimpleFillSymbol({
          style: "solid",
          color: [r, g, b, a],
          outline: {
            style: "solid",
            color: [r, g, b, 1],
            width: outlineWidth,
          },
        });
      }

      if (geometry.type === "polyline") {
        return new modules.SimpleLineSymbol({
          style: "solid",
          color: [r, g, b, a],
          width: outlineWidth,
        });
      }

      if (geometry.type === "point") {
        return new modules.SimpleMarkerSymbol({
          style: "cross",
          color: [r, g, b, a],
          size: 12,
          outline: {
            style: "solid",
            color: [r, g, b, 1],
            width: outlineWidth,
          },
        });
      }

      return null;
    }
  );

  const highlightGraphics = hooks.useEventCallback(
    (params: {
      entries: Array<{
        graphic: __esri.Graphic;
        fnr: FnrValue | null | undefined;
      }>;
      view: __esri.MapView | null | undefined;
      extractFnr: (attrs: AttributeMap | null | undefined) => FnrValue | null;
      normalizeFnrKey: (fnr: FnrValue | null | undefined) => string;
      highlightColor: [number, number, number, number];
      outlineWidth: number;
    }) => {
      const {
        entries,
        view,
        extractFnr,
        normalizeFnrKey,
        highlightColor,
        outlineWidth,
      } = params;

      if (!view || entries.length === 0 || !modules) {
        return;
      }

      const layer = ensureHighlightLayer(view);
      if (!layer) {
        console.log("highlightGraphics: Could not create highlight layer", {
          widgetId: widgetIdRef.current,
        });
        return;
      }

      const processedKeys = new Set<string>();

      entries.forEach(({ graphic, fnr }) => {
        const attributes = (graphic.attributes ?? null) as AttributeMap | null;
        const resolvedFnr = fnr ?? extractFnr(attributes);

        if (resolvedFnr === null || resolvedFnr === undefined) {
          return;
        }

        const key = normalizeFnrKey(resolvedFnr);
        if (processedKeys.has(key)) {
          return;
        }

        processedKeys.add(key);
        removeHighlightForKey(key);
        try {
          const geometry = graphic.geometry;
          if (!geometry) {
            console.log("highlightGraphics: Graphic has no geometry", {
              widgetId: widgetIdRef.current,
              fnr: resolvedFnr,
            });
            return;
          }

          const symbol = createHighlightSymbol(
            geometry,
            highlightColor,
            outlineWidth
          );

          if (!symbol) {
            console.log("highlightGraphics: Could not create symbol", {
              widgetId: widgetIdRef.current,
              geometryType: geometry.type,
            });
            return;
          }

          const highlightGraphic = new modules.Graphic({
            geometry,
            symbol,
            attributes: { fnr: resolvedFnr },
          });

          layer.add(highlightGraphic);
          highlightGraphicsMapRef.current.set(key, highlightGraphic);

          console.log("highlightGraphics: Added highlight", {
            widgetId: widgetIdRef.current,
            fnr: resolvedFnr,
            geometryType: geometry.type,
          });
        } catch (error) {
          console.log("Failed to highlight property feature", {
            error,
            widgetId: widgetIdRef.current,
          });
        }
      });
    }
  );

  const removeHighlightForFnr = hooks.useEventCallback(
    (
      fnr: FnrValue | null | undefined,
      normalizeFnrKey: (fnr: FnrValue | null | undefined) => string
    ) => {
      if (fnr === null || fnr === undefined) {
        return;
      }
      const key =
        typeof fnr === "string" ? fnr : normalizeFnrKey(fnr as FnrValue);
      removeHighlightForKey(key);
    }
  );

  const destroyGraphicsLayer = hooks.useEventCallback(
    (view: __esri.MapView | null | undefined) => {
      if (view && activeViewRef.current === view) {
        activeViewRef.current = null;
      }
      clearHighlights();

      const layer = highlightLayerRef.current;
      if (layer && !layer.destroyed) {
        try {
          if (view?.map) {
            view.map.remove(layer);
          }
          layer.destroy();
        } catch (error) {
          console.log("Failed to destroy highlight layer", {
            error,
            widgetId: widgetIdRef.current,
          });
        }
      }

      propertyLayerRef.current = null;
      highlightLayerRef.current = null;
    }
  );

  hooks.useUnmount(() => {
    clearHighlights();

    const layer = highlightLayerRef.current;
    if (layer && !layer.destroyed) {
      try {
        layer.destroy();
      } catch (error) {
        console.log("Failed to destroy highlight layer on unmount", {
          error,
          widgetId: widgetIdRef.current,
        });
      }
    }

    propertyLayerRef.current = null;
    highlightLayerRef.current = null;
    activeViewRef.current = null;
  });

  return {
    clearHighlights,
    removeHighlightForFnr,
    highlightGraphics,
    destroyGraphicsLayer,
  } as const;
};

export const usePopupManager = (widgetId: string) => {
  const [initialOwner] = React.useState(() =>
    Symbol(`property-popup-${widgetId}`)
  );
  const ownerIdRef = React.useRef(initialOwner);
  const lastViewRef = React.useRef<__esri.MapView | undefined>(undefined);
  const previousWidgetId = hooks.usePrevious(widgetId);

  hooks.useUpdateEffect(() => {
    if (previousWidgetId && previousWidgetId !== widgetId) {
      const lastView = lastViewRef.current;
      if (lastView) {
        popupSuppressionManager.release(ownerIdRef.current, lastView);
      }
      ownerIdRef.current = Symbol(`property-popup-${widgetId}`);
    }
  }, [widgetId, previousWidgetId]);

  const restorePopup = hooks.useEventCallback(
    (view: __esri.MapView | undefined) => {
      const targetView = view ?? lastViewRef.current;
      if (!targetView) return;
      popupSuppressionManager.release(ownerIdRef.current, targetView);
      if (targetView === lastViewRef.current) {
        lastViewRef.current = undefined;
      }
    }
  );

  const disablePopup = hooks.useEventCallback(
    (view: __esri.MapView | undefined) => {
      if (!view) return;
      lastViewRef.current = view;
      popupSuppressionManager.acquire(ownerIdRef.current, view);
    }
  );

  const cleanup = hooks.useEventCallback((view: __esri.MapView | undefined) => {
    restorePopup(view);
  });

  hooks.useUnmount(() => {
    const lastView = lastViewRef.current;
    if (lastView) {
      popupSuppressionManager.release(ownerIdRef.current, lastView);
      lastViewRef.current = undefined;
    }
  });

  return {
    disablePopup,
    restorePopup,
    cleanup,
  };
};

export const useMapViewLifecycle = (params: {
  modules: EsriModules | null;
  destroyGraphicsLayer: (view: __esri.MapView) => void;
  disablePopup: (view: __esri.MapView | undefined) => void;
  restorePopup: (view: __esri.MapView | undefined) => void;
  onMapClick: (event: __esri.ViewClickEvent) => void;
}) => {
  const {
    modules,
    destroyGraphicsLayer,
    disablePopup,
    restorePopup,
    onMapClick,
  } = params;

  const jimuMapViewRef = React.useRef<JimuMapView | null>(null);
  const mapClickHandleRef = React.useRef<__esri.Handle | null>(null);

  const getStoredMapView = (): __esri.MapView | null => {
    const candidateView = jimuMapViewRef.current?.view;
    return isMapView(candidateView) ? candidateView : null;
  };

  const setupMapView = hooks.useEventCallback((view: __esri.MapView) => {
    disablePopup(view);

    if (mapClickHandleRef.current) {
      mapClickHandleRef.current.remove();
      mapClickHandleRef.current = null;
    }

    try {
      mapClickHandleRef.current = view.on("click", onMapClick);
    } catch (error) {
      console.error("Failed to register map click handler", error);
      mapClickHandleRef.current = null;
    }
  });

  const cleanupPreviousView = hooks.useEventCallback(() => {
    const previousView = getStoredMapView();
    if (previousView) {
      restorePopup(previousView);
      destroyGraphicsLayer(previousView);

      if (mapClickHandleRef.current) {
        mapClickHandleRef.current.remove();
        mapClickHandleRef.current = null;
      }
    }
  });

  const onActiveViewChange = hooks.useEventCallback(
    (jimuMapView: JimuMapView | null | undefined) => {
      const viewCandidate = jimuMapView?.view;
      if (!isMapView(viewCandidate)) {
        return;
      }

      const view = viewCandidate;

      const previousView = getStoredMapView();
      if (previousView && previousView !== view) {
        cleanupPreviousView();
      }

      jimuMapViewRef.current = jimuMapView ?? null;

      // If modules are ready, setup immediately. Otherwise, wait for modules.
      if (modules) {
        setupMapView(view);
      }
    }
  );

  const reactivateMapView = hooks.useEventCallback(() => {
    const currentView = getStoredMapView();
    if (currentView && modules) {
      disablePopup(currentView);
      if (mapClickHandleRef.current) {
        mapClickHandleRef.current.remove();
        mapClickHandleRef.current = null;
      }
      try {
        mapClickHandleRef.current = currentView.on("click", onMapClick);
      } catch (error) {
        console.error("Failed to reactivate map click handler", error);
        mapClickHandleRef.current = null;
      }
    }
  });

  const cleanup = hooks.useEventCallback(() => {
    const currentView = getStoredMapView();
    restorePopup(currentView ?? undefined);

    if (mapClickHandleRef.current) {
      mapClickHandleRef.current.remove();
      mapClickHandleRef.current = null;
    }

    if (currentView) {
      destroyGraphicsLayer(currentView);
    }
  });

  hooks.useUnmount(() => {
    cleanup();
  });

  // Setup or teardown map click handler when modules or activation state changes
  hooks.useUpdateEffect(() => {
    const storedView = getStoredMapView();
    if (!modules || !storedView) {
      if (mapClickHandleRef.current) {
        mapClickHandleRef.current.remove();
        mapClickHandleRef.current = null;
      }
      return;
    }

    setupMapView(storedView);
  }, [modules, setupMapView]);

  return {
    onActiveViewChange,
    getCurrentView: getStoredMapView,
    reactivateMapView,
    cleanup,
  };
};

export const useBooleanConfigValue = (config: unknown) => {
  const configRef = hooks.useLatest(config);
  return hooks.useEventCallback((key: string, defaultValue = false) => {
    const current = configRef.current;
    if (current && isConfigDictionary(current)) {
      const value = current[key];
      if (typeof value === "boolean") {
        return value;
      }
    }
    return defaultValue;
  });
};

export const useNumberConfigValue = (config: unknown) => {
  const configRef = hooks.useLatest(config);
  return hooks.useEventCallback(
    (key: string, defaultValue?: number): number | undefined => {
      const current = configRef.current;
      if (current && isConfigDictionary(current)) {
        const value = current[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          return value;
        }
      }
      return defaultValue;
    }
  );
};

export const useUpdateConfig = <TConfig>(
  id: string,
  config: TConfig,
  onSettingChange: (update: { id: string; config: TConfig }) => void
) => {
  const configRef = hooks.useLatest(config);
  return hooks.useEventCallback((key: string, value: unknown) => {
    const current = configRef.current as unknown;
    let nextConfig: TConfig;

    if (hasConfigSet<TConfig>(current)) {
      nextConfig = current.set(key, value);
    } else if (isConfigDictionary(current)) {
      nextConfig = {
        ...current,
        [key]: value,
      } as TConfig;
    } else {
      nextConfig = { [key]: value } as unknown as TConfig;
    }

    onSettingChange({
      id,
      config: nextConfig,
    });
  });
};

export const useNumericConfigHandler = (
  localValue: string,
  setLocalValue: (val: string) => void,
  validate: (val: string) => boolean,
  updateConfig: ConfigUpdater,
  configKey: string,
  debounce: DebouncedFn<(val: string) => void>
) => {
  const handleChange = hooks.useEventCallback((value: number) => {
    setLocalValue(String(value));
    debounce(String(value));
  });

  const handleBlur = hooks.useEventCallback(() => {
    debounce.cancel();
    const isValid = validate(localValue);
    if (isValid) {
      const num = parseInt(localValue, 10);
      updateConfig(configKey, num);
    }
  });

  return { handleChange, handleBlur };
};

export const useSwitchConfigHandler = (
  localValue: boolean,
  setLocalValue: (val: boolean) => void,
  updateConfig: ConfigUpdater,
  configKey: string
) => {
  const localValueRef = hooks.useLatest(localValue);
  return hooks.useEventCallback((evt: React.ChangeEvent<HTMLInputElement>) => {
    const checked = evt.target.checked;
    if (checked === localValueRef.current) {
      return;
    }
    setLocalValue(checked);
    updateConfig(configKey, checked);
  });
};

export const useSliderConfigHandler = <T extends number>(
  localValue: T,
  setLocalValue: (val: T) => void,
  updateConfig: ConfigUpdater,
  configKey: string,
  normalizer: (rawValue: number) => T
) => {
  return hooks.useEventCallback((evt: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = Number.parseFloat(evt?.target?.value ?? "");
    if (!Number.isFinite(rawValue)) {
      return;
    }
    const nextValue = normalizer(rawValue);
    if (Math.abs(localValue - nextValue) < 0.0001) {
      return;
    }
    setLocalValue(nextValue);
    updateConfig(configKey, nextValue);
  });
};

export const useValidatedNumericHandler = (params: {
  localValue: string;
  setLocalValue: (value: string) => void;
  validate: (value: string) => boolean;
  updateConfig: (field: string, value: number) => void;
  configField: string;
  clamp?: { min: number; max: number };
  debounce?: number;
}) => {
  const {
    localValue,
    setLocalValue,
    validate,
    updateConfig,
    configField,
    clamp,
    debounce: debounceMs,
  } = params;

  const debouncedValidation = useDebounce(validate, debounceMs ?? 0);
  const updateConfigLatest = hooks.useLatest(updateConfig);

  const handleChange = hooks.useEventCallback((value: number) => {
    const normalized = clamp
      ? Math.max(clamp.min, Math.min(clamp.max, Math.round(value)))
      : Math.round(value);
    setLocalValue(String(normalized));
    if (debounceMs) {
      debouncedValidation(String(normalized));
    }
  });

  const handleBlur = hooks.useEventCallback(() => {
    if (debounceMs) {
      debouncedValidation.cancel();
    }
    const isValid = validate(localValue);
    if (isValid) {
      const num = parseInt(localValue, 10);
      updateConfigLatest.current(configField, num);
    }
  });

  return { handleChange, handleBlur };
};

export const useNumericValidator = (
  fieldKey: string,
  min: number,
  max: number,
  errorMessage: string,
  setFieldErrors: (
    fn: (prev: { [key: string]: string | undefined }) => {
      [key: string]: string | undefined;
    }
  ) => void
) => {
  return hooks.useEventCallback((value: string): boolean => {
    const result = validateNumericRange({ value, min, max, errorMessage });
    setFieldErrors((prev) => ({
      ...prev,
      [fieldKey]: result.valid ? undefined : result.error,
    }));
    return result.valid;
  });
};

export const useThrottle = <T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  const safeDelay = Number.isFinite(delay) && delay >= 0 ? delay : 0;
  const callbackRef = hooks.useLatest(callback);

  // If delay is 0, return unthrottled callback for instant execution
  const unthrottled = hooks.useEventCallback((...args: Parameters<T>) => {
    try {
      callbackRef.current(...args);
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("Unthrottled function error:", error);
      }
    }
  });

  const lastCallTimeRef = React.useRef<number>(0);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = React.useRef<Parameters<T> | null>(null);
  const mountedRef = React.useRef(true);

  const execute = hooks.useEventCallback((args: Parameters<T>) => {
    if (!mountedRef.current) return;
    lastCallTimeRef.current = Date.now();
    pendingArgsRef.current = null;
    try {
      callbackRef.current(...args);
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("Throttled function error:", error);
      }
    }
  });

  const throttled = hooks.useEventCallback((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTimeRef.current;

    if (timeSinceLastCall >= safeDelay) {
      // Execute immediately if enough time has passed
      execute(args);
    } else {
      // Schedule execution for remaining time
      pendingArgsRef.current = args;
      if (!timeoutRef.current) {
        const remainingTime = safeDelay - timeSinceLastCall;
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null;
          if (pendingArgsRef.current && mountedRef.current) {
            execute(pendingArgsRef.current);
          }
        }, remainingTime);
      }
    }
  });

  hooks.useEffectOnce(() => {
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  });

  return safeDelay === 0 ? unthrottled : throttled;
};

export const useDebounce = <T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number,
  options?: { onPendingChange?: (pending: boolean) => void }
): DebouncedFn<T> => {
  const safeDelay = Number.isFinite(delay) && delay >= 0 ? delay : 0;
  const callbackRef = hooks.useLatest(callback);

  // If delay is 0, return undebounced callback for instant execution
  const undebounced = hooks.useEventCallback((...args: Parameters<T>) => {
    try {
      callbackRef.current(...args);
    } catch (error) {
      console.log("Undebounced function error:", { error });
    }
  });

  const undebouncedWithCancelRef = React.useRef<DebouncedFn<T> | null>(null);
  if (!undebouncedWithCancelRef.current) {
    const fn = undebounced as DebouncedFn<T>;
    fn.cancel = () => {
      // No-op cancel for instant execution
    };
    undebouncedWithCancelRef.current = fn;
  }

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const optionsRef = hooks.useLatest(options);

  const notifyPending = hooks.useEventCallback((next: boolean) => {
    if (pendingRef.current === next) return;
    pendingRef.current = next;
    const handler = optionsRef.current?.onPendingChange;
    if (typeof handler === "function") {
      try {
        handler(next);
      } catch (error) {
        // Silently ignore callback errors to prevent breaking debounce mechanism
        console.log("onPendingChange callback failed", { error });
      }
    }
  });

  const cancel = hooks.useEventCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (pendingRef.current) {
      notifyPending(false);
    }
  });

  const run = hooks.useEventCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    notifyPending(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      if (!mountedRef.current) return;
      try {
        callbackRef.current(...args);
      } finally {
        notifyPending(false);
      }
    }, safeDelay);
  });

  const debouncedRef = React.useRef<DebouncedFn<T> | null>(null);
  const runRef = hooks.useLatest(run);
  const cancelRef = hooks.useLatest(cancel);

  if (!debouncedRef.current) {
    const runner = ((...args: Parameters<T>) => {
      runRef.current(...args);
    }) as DebouncedFn<T>;
    runner.cancel = () => cancelRef.current();
    debouncedRef.current = runner;
  }

  hooks.useEffectOnce(() => {
    return () => {
      mountedRef.current = false;
      cancelRef.current();
    };
  });

  return safeDelay === 0
    ? undebouncedWithCancelRef.current
    : debouncedRef.current;
};

export const useWidgetStartup = (params: {
  modulesLoading: boolean;
  startupDelay: number;
  minSpinnerDisplay: number;
}) => {
  const { modulesLoading, startupDelay, minSpinnerDisplay } = params;

  const [isInitializing, setIsInitializing] = React.useState(true);
  const [spinnerVisible, setSpinnerVisible] = React.useState(false);
  const spinnerStartTimeRef = React.useRef<number | null>(null);
  const mountedRef = React.useRef(true);

  // Debounce the loading state to prevent flicker
  const debouncedLoading = useDebouncedValue(modulesLoading, startupDelay);

  // Show spinner after delay if still loading
  hooks.useUpdateEffect(() => {
    if (debouncedLoading && !spinnerVisible) {
      setSpinnerVisible(true);
      spinnerStartTimeRef.current = performance.now();
    }
  }, [debouncedLoading, spinnerVisible]);

  // Handle module load completion with minimum spinner display time
  hooks.useUpdateEffect(() => {
    if (!modulesLoading && spinnerVisible) {
      const elapsed = spinnerStartTimeRef.current
        ? performance.now() - spinnerStartTimeRef.current
        : minSpinnerDisplay;

      if (elapsed >= minSpinnerDisplay) {
        // Spinner has been visible long enough, hide immediately
        setSpinnerVisible(false);
        setIsInitializing(false);
      } else {
        // Keep spinner visible for minimum duration
        const remainingTime = minSpinnerDisplay - elapsed;
        const timer = setTimeout(() => {
          if (mountedRef.current) {
            setSpinnerVisible(false);
            setIsInitializing(false);
          }
        }, remainingTime);

        return () => {
          clearTimeout(timer);
        };
      }
    } else if (!modulesLoading && !spinnerVisible) {
      // Fast load completed, no spinner was shown
      setIsInitializing(false);
    }

    return undefined;
  }, [modulesLoading, spinnerVisible, minSpinnerDisplay]);

  hooks.useEffectOnce(() => {
    return () => {
      mountedRef.current = false;
    };
  });

  return {
    shouldShowLoading: spinnerVisible,
    isInitializing,
    modulesReady: !modulesLoading && !isInitializing,
  };
};

/**
 * Hook for hover query functionality using point-buffer spatial queries.
 * Queries property data when user hovers over the map.
 */
export const useHitTestHover = (params: {
  dataSourceId: string | undefined;
  dsManagerRef: React.MutableRefObject<DataSourceManager | null>;
  viewRef: React.MutableRefObject<__esri.MapView | null>;
  enablePIIMasking: boolean;
  translate: (key: string, fallback?: string) => string;
}) => {
  const [hoverTooltipData, setHoverTooltipData] = React.useState<{
    fastighet: string;
    bostadr: string;
  } | null>(null);

  const [hasCompletedFirstHitTest, setHasCompletedFirstHitTest] =
    React.useState(false);

  const [isQuerying, setIsQuerying] = React.useState(false);

  const abortControllerRef = React.useRef<AbortController | null>(null);
  const lastHoverQueryPointRef = React.useRef<{ x: number; y: number } | null>(
    null
  );

  const performHitTest = hooks.useEventCallback(
    async (event: __esri.ViewPointerMoveEvent) => {
      // Abort previous query
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const view = params.viewRef.current;
      const dsManager = params.dsManagerRef.current;
      const dataSourceId = params.dataSourceId;

      if (!view || !dsManager || !dataSourceId) {
        setHoverTooltipData(null);
        setIsQuerying(false);
        return;
      }

      const mapPoint = view.toMap({ x: event.x, y: event.y });
      if (!mapPoint) {
        setHoverTooltipData(null);
        setIsQuerying(false);
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      lastHoverQueryPointRef.current = { x: event.x, y: event.y };
      setIsQuerying(true);

      try {
        // Query properties at the point location
        const results = await queryPropertyByPoint(
          mapPoint,
          dataSourceId,
          dsManager,
          { signal: controller.signal }
        );

        // Check if query was aborted
        if (controller.signal.aborted) {
          return;
        }

        setIsQuerying(false);

        if (results && results.length > 0) {
          const result = results[0];
          const feature = result.features[0];
          if (feature?.attributes) {
            const fastighet = String(feature.attributes.FASTIGHET || "");
            const bostadr = String(feature.attributes.BOSTADR || "");
            setHoverTooltipData({ fastighet, bostadr });
          } else {
            setHoverTooltipData(null);
          }
        } else {
          setHoverTooltipData(null);
        }

        if (!hasCompletedFirstHitTest) {
          setHasCompletedFirstHitTest(true);
        }
      } catch (error) {
        setIsQuerying(false);
        if (!isAbortError(error)) {
          console.log("hover_query_error", error);
        }
        // Don't clear hoverTooltipData on error - keep previous value
      }
    }
  );

  const cleanup = hooks.useEventCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setHoverTooltipData(null);
    setIsQuerying(false);
    lastHoverQueryPointRef.current = null;
  });

  hooks.useUnmount(() => {
    cleanup();
  });

  return {
    hoverTooltipData,
    isQuerying,
    performHitTest,
    lastHoverQueryPointRef,
    cleanup,
    hasCompletedFirstHitTest,
  };
};
