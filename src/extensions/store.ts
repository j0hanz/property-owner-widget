import type { extensionSpec, ImmutableObject } from "jimu-core";
import SeamlessImmutable from "seamless-immutable";
import { PROPERTY_ACTION_TYPES } from "../config/constants";
import { PropertyActionType } from "../config/enums";
import type {
  ErrorState,
  GridRowData,
  IMPropertyGlobalState,
  IMStateWithProperty,
  MutableAccessor,
  PropertyAction,
  PropertySubStateMap,
  PropertyWidgetState,
  SeamlessImmutableFactory,
  SerializedQueryResult,
  SerializedQueryResultMap,
} from "../config/types";

export const propertyActions = {
  setError: (error: ErrorState | null, widgetId: string): PropertyAction => ({
    type: PropertyActionType.SET_ERROR,
    error,
    widgetId,
  }),
  clearError: (widgetId: string): PropertyAction => ({
    type: PropertyActionType.CLEAR_ERROR,
    widgetId,
  }),
  setSelectedProperties: (
    properties: GridRowData[],
    widgetId: string
  ): PropertyAction => ({
    type: PropertyActionType.SET_SELECTED_PROPERTIES,
    properties,
    widgetId,
  }),
  clearAll: (widgetId: string): PropertyAction => ({
    type: PropertyActionType.CLEAR_ALL,
    widgetId,
  }),
  setQueryInFlight: (inFlight: boolean, widgetId: string): PropertyAction => ({
    type: PropertyActionType.SET_QUERY_IN_FLIGHT,
    inFlight,
    widgetId,
  }),
  setRawResults: (
    results: { [key: string]: SerializedQueryResult } | null,
    widgetId: string
  ): PropertyAction => ({
    type: PropertyActionType.SET_RAW_RESULTS,
    results,
    widgetId,
  }),
  removeWidgetState: (widgetId: string): PropertyAction => ({
    type: PropertyActionType.REMOVE_WIDGET_STATE,
    widgetId,
  }),
};

const resolveImmutableFactory = (): SeamlessImmutableFactory => {
  const loadCandidate = (): unknown => {
    if (typeof SeamlessImmutable !== "undefined") {
      return SeamlessImmutable as unknown;
    }

    try {
      return require("seamless-immutable");
    } catch (error) {
      console.error("Property Widget: Failed to load seamless-immutable", {
        error,
      });
    }

    return null;
  };

  const candidate = loadCandidate();

  if (typeof candidate === "function") {
    return candidate as SeamlessImmutableFactory;
  }

  if (
    candidate &&
    typeof (candidate as { default?: unknown }).default === "function"
  ) {
    return (candidate as { default: SeamlessImmutableFactory }).default;
  }

  if (
    candidate &&
    typeof (candidate as { Immutable?: unknown }).Immutable === "function"
  ) {
    return (candidate as { Immutable: SeamlessImmutableFactory }).Immutable;
  }

  throw new Error("SeamlessImmutable factory unavailable");
};

const Immutable = resolveImmutableFactory();

const hasAsMutable = <T>(value: unknown): value is MutableAccessor<T> => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { asMutable?: unknown };
  return typeof candidate.asMutable === "function";
};

const toUnknownArray = (value: unknown): unknown[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.slice();
  }

  if (hasAsMutable<unknown[]>(value)) {
    const mutable = value.asMutable?.({ deep: true });
    return Array.isArray(mutable) ? mutable.slice() : [];
  }

  return [];
};

const toGridRowArray = (value: unknown): GridRowData[] => {
  const items = toUnknownArray(value);
  return items.filter((item): item is GridRowData => {
    return !!item && typeof item === "object";
  });
};

const toSerializedResultMap = (
  value: unknown
): SerializedQueryResultMap | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (hasAsMutable<SerializedQueryResultMap>(value)) {
    const mutable = value.asMutable?.({ deep: true });
    return mutable && typeof mutable === "object" ? mutable : null;
  }

  return value as SerializedQueryResultMap;
};

const getSliceFactory = (widgetId: string) => {
  return (
    state: IMStateWithProperty
  ): ImmutableObject<PropertyWidgetState> | null =>
    state?.["property-state"]?.byId?.[widgetId] ?? null;
};

const createWidgetScopedSelector = <T>(
  getSlice: (
    state: IMStateWithProperty
  ) => ImmutableObject<PropertyWidgetState> | null,
  projector: (slice: ImmutableObject<PropertyWidgetState> | null) => {
    value: T;
    cacheKey?: unknown;
  }
) => {
  let lastSlice: ImmutableObject<PropertyWidgetState> | null = null;
  let lastCacheKey: unknown;
  let lastValue: T;
  let hasValue = false;

  return (state: IMStateWithProperty): T => {
    const slice = getSlice(state);
    const { value, cacheKey } = projector(slice);

    if (
      hasValue &&
      slice === lastSlice &&
      (typeof cacheKey === "undefined" || cacheKey === lastCacheKey)
    ) {
      return lastValue;
    }

    lastSlice = slice;
    lastCacheKey = cacheKey;
    lastValue = value;
    hasValue = true;
    return value;
  };
};

const initialPropertyState: PropertyWidgetState = {
  error: null,
  selectedProperties: [],
  isQueryInFlight: false,
  rawPropertyResults: null,
};

const createImmutableState = (): ImmutableObject<PropertyWidgetState> =>
  Immutable(initialPropertyState) as ImmutableObject<PropertyWidgetState>;

const initialGlobalState = Immutable({
  byId: {},
}) as unknown as IMPropertyGlobalState;

const toMutableById = (
  value: IMPropertyGlobalState["byId"] | undefined
): PropertySubStateMap => {
  if (!value || typeof value !== "object") {
    return {};
  }

  if (hasAsMutable<PropertySubStateMap>(value)) {
    const accessor: MutableAccessor<PropertySubStateMap> = value;
    const mutable = accessor.asMutable?.({ deep: false });
    return mutable && typeof mutable === "object" ? { ...mutable } : {};
  }

  return { ...(value as PropertySubStateMap) };
};

const ensureSubState = (
  global: IMPropertyGlobalState,
  widgetId: string
): ImmutableObject<PropertyWidgetState> => {
  const current = (global as { byId?: { [key: string]: unknown } }).byId?.[
    widgetId
  ];
  if (!current) {
    return createImmutableState();
  }

  if (
    current &&
    typeof current === "object" &&
    typeof (current as { set?: unknown }).set === "function"
  ) {
    return current as ImmutableObject<PropertyWidgetState>;
  }

  if (current && typeof current === "object") {
    return Immutable(
      current as PropertyWidgetState
    ) as ImmutableObject<PropertyWidgetState>;
  }

  return createImmutableState();
};

const setSubState = (
  global: IMPropertyGlobalState,
  widgetId: string,
  next: ImmutableObject<PropertyWidgetState>
): IMPropertyGlobalState => {
  const byId = toMutableById(global?.byId);
  byId[widgetId] = next;

  return Immutable({ byId }) as IMPropertyGlobalState;
};

const removeSubState = (
  global: IMPropertyGlobalState,
  widgetId: string
): IMPropertyGlobalState => {
  const byId = toMutableById(global?.byId);
  if (!(widgetId in byId)) {
    return global;
  }

  delete byId[widgetId];
  return Immutable({ byId }) as IMPropertyGlobalState;
};

const isPropertyAction = (action: unknown): action is PropertyAction => {
  if (!action || typeof action !== "object") {
    return false;
  }

  const candidate = action as { type?: unknown; widgetId?: unknown };
  return (
    typeof candidate.type === "string" &&
    PROPERTY_ACTION_TYPES.includes(candidate.type as PropertyActionType) &&
    typeof candidate.widgetId === "string"
  );
};

const reduceOne = (
  state: IMPropertyGlobalState,
  action: PropertyAction
): IMPropertyGlobalState => {
  if (action.type === PropertyActionType.REMOVE_WIDGET_STATE) {
    return removeSubState(state, action.widgetId);
  }

  const widgetId = action.widgetId;
  if (!widgetId) {
    return state;
  }

  const current = ensureSubState(state, widgetId);

  switch (action.type) {
    case PropertyActionType.SET_ERROR: {
      const next = current
        .set("error", action.error ?? null)
        .set("isQueryInFlight", false);
      return setSubState(state, widgetId, next);
    }
    case PropertyActionType.CLEAR_ERROR: {
      const next = current.set("error", null);
      return setSubState(state, widgetId, next);
    }
    case PropertyActionType.SET_SELECTED_PROPERTIES: {
      const next = current.set("selectedProperties", action.properties.slice());
      return setSubState(state, widgetId, next);
    }
    case PropertyActionType.CLEAR_ALL: {
      return setSubState(state, widgetId, createImmutableState());
    }
    case PropertyActionType.SET_QUERY_IN_FLIGHT: {
      const next = current.set("isQueryInFlight", action.inFlight);
      return setSubState(state, widgetId, next);
    }
    case PropertyActionType.SET_RAW_RESULTS: {
      const next = current.set(
        "rawPropertyResults",
        action.results ? { ...action.results } : null
      );
      return setSubState(state, widgetId, next);
    }
    default:
      return state;
  }
};

const propertyReducer = (
  state: IMPropertyGlobalState = initialGlobalState,
  action: unknown
): IMPropertyGlobalState => {
  if (!isPropertyAction(action)) {
    return state;
  }

  // Ensure state is immutable - defensive check for external state mutations
  if (!state || typeof state !== "object") {
    state = initialGlobalState;
  }

  // If state.byId exists but isn't immutable, wrap it
  if (state.byId && typeof state.byId === "object" && !hasAsMutable(state)) {
    state = Immutable(state) as IMPropertyGlobalState;
  }

  return reduceOne(state, action);
};

export const createPropertySelectors = (widgetId: string) => {
  const getSlice = getSliceFactory(widgetId);

  return {
    selectSlice: getSlice,
    selectError: createWidgetScopedSelector(getSlice, (slice) => ({
      value: slice?.error ?? null,
    })),
    selectSelectedProperties: createWidgetScopedSelector(getSlice, (slice) => {
      const source = slice?.selectedProperties;
      return {
        value: toGridRowArray(source),
        cacheKey: source,
      };
    }),
    selectIsQueryInFlight: createWidgetScopedSelector(getSlice, (slice) => ({
      value: slice?.isQueryInFlight ?? false,
    })),
    selectRawResults: createWidgetScopedSelector(getSlice, (slice) => {
      const source = slice?.rawPropertyResults;
      return {
        value: toSerializedResultMap(source),
        cacheKey: source,
      };
    }),
  };
};

export default class PropertyReduxStoreExtension
  implements extensionSpec.ReduxStoreExtension
{
  readonly id = "property-widget_store";

  getActions(): string[] {
    return [...PROPERTY_ACTION_TYPES];
  }

  getInitLocalState() {
    return initialGlobalState;
  }

  getReducer() {
    return propertyReducer;
  }

  getStoreKey() {
    return "property-state";
  }
}
