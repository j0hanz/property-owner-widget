import { hooks, React, type DataSourceManager } from "jimu-core";
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
  batchGraphicsRenderer,
  createSymbolCache,
  isAbortError,
  logger,
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

export const useDebouncedValue = <T>(value: T, delay: number) => {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  hooks.useEffectWithPreviousValues(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

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

export const useGraphicsLayer = (
  modules: EsriModules | null,
  widgetId: string
) => {
  const modulesRef = hooks.useLatest(modules);
  const widgetIdRef = hooks.useLatest(widgetId);
  const graphicsLayerRef = React.useRef<__esri.GraphicsLayer | null>(null);
  const graphicsMapRef = React.useRef<Map<string | number, __esri.Graphic[]>>(
    new Map()
  );
  const symbolCacheRef = React.useRef(createSymbolCache());

  const ensureGraphicsLayer = hooks.useEventCallback(
    (view: __esri.MapView | null | undefined): boolean => {
      const currentModules = modulesRef.current;
      const currentWidgetId = widgetIdRef.current;
      if (!currentModules || !view || !currentWidgetId) return false;

      const desiredLayerId = `property-${currentWidgetId}-highlight-layer`;
      const existingLayer = graphicsLayerRef.current;

      if (existingLayer && existingLayer.id !== desiredLayerId) {
        view.map?.remove(existingLayer);
        existingLayer.destroy();
        graphicsLayerRef.current = null;
      }

      if (!graphicsLayerRef.current) {
        // Check if layer already exists in map (from previous widget instance)
        const existingLayerInMap = view.map.findLayerById(
          desiredLayerId
        ) as __esri.GraphicsLayer | null;
        if (existingLayerInMap) {
          graphicsLayerRef.current = existingLayerInMap;
          return true;
        }

        // Only create if truly missing
        const shortId =
          currentWidgetId.length > 16
            ? `${currentWidgetId.substring(0, 16)}...`
            : currentWidgetId;
        const layer = new currentModules.GraphicsLayer({
          id: desiredLayerId,
          listMode: "hide",
          title: `Property Highlights (${shortId})`,
        });
        view.map.add(layer);
        graphicsLayerRef.current = layer;
        return true;
      }

      if (!view.map.findLayerById(graphicsLayerRef.current.id)) {
        view.map.add(graphicsLayerRef.current);
        return true;
      }

      return false;
    }
  );

  const clearGraphics = hooks.useEventCallback(() => {
    if (graphicsLayerRef.current) {
      graphicsLayerRef.current.removeAll();
    }
    graphicsMapRef.current.clear();
    symbolCacheRef.current.clear();
  });

  const removeGraphicsForFnr = hooks.useEventCallback(
    (
      fnr: FnrValue | null | undefined,
      normalizeFnrKey: (fnr: FnrValue | null | undefined) => string
    ) => {
      const layer = graphicsLayerRef.current;
      if (!layer || fnr == null) return;
      const fnrKey = normalizeFnrKey(fnr);
      const graphics = graphicsMapRef.current.get(fnrKey);
      if (graphics && graphics.length > 0) {
        layer.removeMany(graphics);
        graphicsMapRef.current.delete(fnrKey);
      }
    }
  );

  const addGraphicsToMap = hooks.useEventCallback(
    (
      graphic: __esri.Graphic | null | undefined,
      view: __esri.MapView | null | undefined,
      extractFnr: (attrs: AttributeMap | null | undefined) => FnrValue | null,
      normalizeFnrKey: (fnr: FnrValue | null | undefined) => string,
      highlightColor: [number, number, number, number],
      outlineWidth: number
    ) => {
      const currentModules = modulesRef.current;
      if (!currentModules || !graphic || !view) return;
      ensureGraphicsLayer(view);

      const layer = graphicsLayerRef.current;
      if (!layer) return;

      const attributes = (graphic.attributes ?? null) as AttributeMap | null;
      const fnr = extractFnr(attributes);
      const symbol = symbolCacheRef.current.getSymbolForGraphic({
        modules: currentModules,
        graphic,
        highlightColor,
        outlineWidth,
      });
      if (!symbol) return;

      // Create a new graphic with the highlight symbol
      const highlightGraphic = new currentModules.Graphic({
        geometry: graphic.geometry,
        symbol,
        attributes: graphic.attributes
          ? { ...graphic.attributes, FNR: fnr }
          : { FNR: fnr },
      });

      removeGraphicsForFnr(fnr, normalizeFnrKey);
      layer.add(highlightGraphic);

      if (!fnr) return;

      const fnrKey = normalizeFnrKey(fnr);
      // Store reference for future removal
      const existing = graphicsMapRef.current.get(fnrKey);
      if (existing) {
        existing.push(highlightGraphic);
      } else {
        graphicsMapRef.current.set(fnrKey, [highlightGraphic]);
      }
    }
  );

  const addManyGraphicsToMap = hooks.useEventCallback(
    (
      graphics: Array<{
        graphic: __esri.Graphic;
        fnr: FnrValue | null | undefined;
      }>,
      view: __esri.MapView | null | undefined,
      extractFnr: (attrs: AttributeMap | null | undefined) => FnrValue | null,
      normalizeFnrKey: (fnr: FnrValue | null | undefined) => string,
      highlightColor: [number, number, number, number],
      outlineWidth: number
    ) => {
      const currentModules = modulesRef.current;
      if (!currentModules || !graphics.length || !view) return;
      ensureGraphicsLayer(view);

      const layer = graphicsLayerRef.current;
      if (!layer) return;

      const highlightGraphics: __esri.Graphic[] = [];

      graphics.forEach(({ graphic, fnr }) => {
        const attributes = (graphic.attributes ?? null) as AttributeMap | null;
        const resolvedFnr = fnr ?? extractFnr(attributes);
        if (resolvedFnr === null || resolvedFnr === undefined) {
          return;
        }

        const symbol = symbolCacheRef.current.getSymbolForGraphic({
          modules: currentModules,
          graphic,
          highlightColor,
          outlineWidth,
        });
        if (!symbol) return;

        const highlightGraphic = new currentModules.Graphic({
          geometry: graphic.geometry,
          symbol,
          attributes: graphic.attributes
            ? { ...graphic.attributes, FNR: resolvedFnr }
            : { FNR: resolvedFnr },
        });

        removeGraphicsForFnr(resolvedFnr, normalizeFnrKey);
        highlightGraphics.push(highlightGraphic);

        const fnrKey = normalizeFnrKey(resolvedFnr);
        const existing = graphicsMapRef.current.get(fnrKey);
        if (existing) {
          existing.push(highlightGraphic);
        } else {
          graphicsMapRef.current.set(fnrKey, [highlightGraphic]);
        }
      });

      if (highlightGraphics.length > 0) {
        batchGraphicsRenderer({
          layer,
          graphics: highlightGraphics,
          chunkSize: 10,
        });
      }
    }
  );

  const destroyGraphicsLayer = hooks.useEventCallback(
    (view: __esri.MapView | null | undefined) => {
      if (!graphicsLayerRef.current) return;
      const layer = graphicsLayerRef.current;
      graphicsLayerRef.current = null;
      graphicsMapRef.current.clear();
      if (view) {
        view.map?.remove(layer);
      }
      layer.destroy();
    }
  );

  hooks.useUnmount(() => {
    if (graphicsLayerRef.current) {
      graphicsLayerRef.current.destroy?.();
      graphicsLayerRef.current = null;
    }
    graphicsMapRef.current.clear();
    symbolCacheRef.current.clear();
  });

  return {
    graphicsLayerRef,
    graphicsMapRef,
    ensureGraphicsLayer,
    clearGraphics,
    removeGraphicsForFnr,
    addGraphicsToMap,
    addManyGraphicsToMap,
    destroyGraphicsLayer,
  };
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
  ensureGraphicsLayer: (view: __esri.MapView) => void;
  destroyGraphicsLayer: (view: __esri.MapView) => void;
  disablePopup: (view: __esri.MapView | undefined) => void;
  restorePopup: (view: __esri.MapView | undefined) => void;
  onMapClick: (event: __esri.ViewClickEvent) => void;
}) => {
  const {
    modules,
    ensureGraphicsLayer,
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
    ensureGraphicsLayer(view);

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

  // Setup map view when modules become ready (if map view is already available)
  hooks.useUpdateEffect(() => {
    const storedView = getStoredMapView();
    if (modules && storedView && !mapClickHandleRef.current) {
      setupMapView(storedView);
    }
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
      logger.debug("Undebounced function error:", { error });
    }
  });

  const undebouncedWithCancel = React.useMemo(() => {
    const fn = undebounced as DebouncedFn<T>;
    fn.cancel = () => {
      // No-op cancel for instant execution
    };
    return fn;
  }, [undebounced]);

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
        logger.debug("onPendingChange callback failed", { error });
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

  return safeDelay === 0 ? undebouncedWithCancel : debouncedRef.current;
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
          logger.error("hover_query_error", error);
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
