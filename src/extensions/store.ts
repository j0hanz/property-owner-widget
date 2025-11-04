import * as SeamlessImmutableNs from "seamless-immutable";
import type { extensionSpec, ImmutableObject } from "jimu-core";
import type {
  ErrorState,
  GridRowData,
  IMPropertyGlobalState,
  IMStateWithProperty,
  PropertyWidgetState,
  SerializedQueryResult,
  SerializedQueryResultMap,
  PropertyAction,
  SeamlessImmutableFactory,
} from "../config/types";
import { PropertyActionType } from "../config/enums";

export const PROPERTY_ACTION_TYPES = Object.values(PropertyActionType);

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
  const candidate = SeamlessImmutableNs as {
    default?: SeamlessImmutableFactory;
    Immutable?: SeamlessImmutableFactory;
  };

  if (typeof candidate.default === "function") {
    return candidate.default;
  }

  if (typeof candidate.Immutable === "function") {
    return candidate.Immutable;
  }

  return <T>(input: T) => input as SeamlessImmutableNs.Immutable<T>;
};

const Immutable = resolveImmutableFactory();

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

const ensureSubState = (
  global: IMPropertyGlobalState,
  widgetId: string
): ImmutableObject<PropertyWidgetState> => {
  const current = global.byId?.[widgetId];
  return current ?? createImmutableState();
};

const setSubState = (
  global: IMPropertyGlobalState,
  widgetId: string,
  next: ImmutableObject<PropertyWidgetState>
): IMPropertyGlobalState => {
  const byId = {
    ...global.byId,
    [widgetId]: next,
  };
  return Immutable({ byId }) as unknown as IMPropertyGlobalState;
};

const reduceOne = (
  state: ImmutableObject<PropertyWidgetState>,
  action: PropertyAction
): ImmutableObject<PropertyWidgetState> => {
  switch (action.type) {
    case PropertyActionType.SET_ERROR:
      return state.set("error", action.error).set("isQueryInFlight", false);
    case PropertyActionType.CLEAR_ERROR:
      return state.set("error", null);
    case PropertyActionType.SET_SELECTED_PROPERTIES:
      return state.set("selectedProperties", action.properties);
    case PropertyActionType.CLEAR_ALL:
      return createImmutableState();
    case PropertyActionType.SET_QUERY_IN_FLIGHT:
      return state.set("isQueryInFlight", action.inFlight);
    case PropertyActionType.SET_RAW_RESULTS:
      return state.set("rawPropertyResults", action.results);
    default:
      return state;
  }
};

const isPropertyAction = (candidate: unknown): candidate is PropertyAction => {
  if (!candidate || typeof candidate !== "object") return false;
  const action = candidate as { type?: unknown; widgetId?: unknown };
  if (typeof action.type !== "string") return false;
  if (!PROPERTY_ACTION_TYPES.includes(action.type as PropertyActionType)) {
    return false;
  }
  return typeof action.widgetId === "string";
};

const propertyReducer = (
  state: IMPropertyGlobalState = initialGlobalState,
  action: unknown
): IMPropertyGlobalState => {
  if (!isPropertyAction(action)) return state;

  if (action.type === PropertyActionType.REMOVE_WIDGET_STATE) {
    const byId = { ...state.byId };
    if (!(action.widgetId in byId)) return state;
    delete byId[action.widgetId];
    return Immutable({ byId }) as unknown as IMPropertyGlobalState;
  }

  const widgetId = action.widgetId;
  if (!widgetId) return state;

  const prevSub = ensureSubState(state, widgetId);
  const nextSub = reduceOne(prevSub, action);
  if (nextSub === prevSub) return state;
  return setSubState(state, widgetId, nextSub);
};

export const createPropertySelectors = (widgetId: string) => {
  interface MutableAccessor {
    asMutable?: (options?: { deep?: boolean }) => unknown;
  }

  const hasAsMutable = (value: unknown): value is MutableAccessor => {
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

    if (hasAsMutable(value)) {
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

    if (hasAsMutable(value)) {
      const mutable = value.asMutable?.({ deep: true });
      return mutable && typeof mutable === "object"
        ? (mutable as SerializedQueryResultMap)
        : null;
    }

    return value as SerializedQueryResultMap;
  };

  const getSlice = (
    state: IMStateWithProperty
  ): ImmutableObject<PropertyWidgetState> | null => {
    const slice = state?.["property-state"]?.byId?.[widgetId];
    return slice ?? null;
  };

  return {
    selectSlice: getSlice,
    selectError: (state: IMStateWithProperty) => getSlice(state)?.error ?? null,
    selectSelectedProperties: (state: IMStateWithProperty) =>
      toGridRowArray(getSlice(state)?.selectedProperties),
    selectIsQueryInFlight: (state: IMStateWithProperty) =>
      getSlice(state)?.isQueryInFlight ?? false,
    selectRawResults: (state: IMStateWithProperty) =>
      toSerializedResultMap(getSlice(state)?.rawPropertyResults),
  };
};

export default class PropertyReduxStoreExtension
  implements extensionSpec.ReduxStoreExtension
{
  readonly id = "property-widget_store";

  getActions(): string[] {
    return [...PROPERTY_ACTION_TYPES];
  }

  getInitLocalState(): { byId: { [id: string]: PropertyWidgetState } } {
    return { byId: {} };
  }

  getReducer() {
    return propertyReducer;
  }

  getStoreKey() {
    return "property-state";
  }
}
