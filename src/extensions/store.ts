import type { extensionSpec, IMState } from "jimu-core";
import SeamlessImmutable from "seamless-immutable";
import { createSelector } from "reselect";
import { PROPERTY_ACTION_TYPES } from "../config/constants";
import { PropertyActionType } from "../config/enums";
import type {
  ErrorState,
  GridRowData,
  IMPropertyGlobalState,
  IMPropertyWidgetState,
  IMStateWithProperty,
  PropertyAction,
  PropertySelectors,
  PropertySubStateMap,
  PropertyWidgetState,
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
    results: SerializedQueryResultMap | null,
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

const initialPropertyState: PropertyWidgetState = {
  error: null,
  selectedProperties: [],
  isQueryInFlight: false,
  rawPropertyResults: null,
};

const createImmutableState = (): IMPropertyWidgetState =>
  SeamlessImmutable(initialPropertyState);

const emptyWidgetStateMap = SeamlessImmutable({}) as PropertySubStateMap;

const initialGlobalState: IMPropertyGlobalState = SeamlessImmutable({
  byId: emptyWidgetStateMap,
});

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

const propertyReducer = (
  state: IMPropertyGlobalState = initialGlobalState,
  action: PropertyAction
): IMPropertyGlobalState => {
  if (!isPropertyAction(action)) {
    return state;
  }

  const { widgetId } = action;
  const widgetStatePath: [string, string] = ["byId", widgetId];

  const ensureWidgetState = (
    s: IMPropertyGlobalState
  ): IMPropertyGlobalState => {
    if (s.getIn(widgetStatePath)) {
      return s;
    }
    return s.setIn(widgetStatePath, createImmutableState());
  };

  switch (action.type) {
    case PropertyActionType.SET_ERROR: {
      const withState = ensureWidgetState(state);
      const updatedError = withState.setIn(
        [...widgetStatePath, "error"],
        action.error ?? null
      );
      return updatedError.setIn([...widgetStatePath, "isQueryInFlight"], false);
    }
    case PropertyActionType.CLEAR_ERROR: {
      const withState = ensureWidgetState(state);
      return withState.setIn([...widgetStatePath, "error"], null);
    }
    case PropertyActionType.SET_SELECTED_PROPERTIES: {
      const withState = ensureWidgetState(state);
      return withState.setIn(
        [...widgetStatePath, "selectedProperties"],
        action.properties
      );
    }
    case PropertyActionType.CLEAR_ALL: {
      const withState = ensureWidgetState(state);
      return withState.setIn(widgetStatePath, createImmutableState());
    }
    case PropertyActionType.SET_QUERY_IN_FLIGHT: {
      const withState = ensureWidgetState(state);
      return withState.setIn(
        [...widgetStatePath, "isQueryInFlight"],
        action.inFlight
      );
    }
    case PropertyActionType.SET_RAW_RESULTS: {
      const withState = ensureWidgetState(state);
      return withState.setIn(
        [...widgetStatePath, "rawPropertyResults"],
        action.results
      );
    }
    case PropertyActionType.REMOVE_WIDGET_STATE: {
      const updatedById = state.byId.without(widgetId);
      return state.set("byId", updatedById);
    }
    default:
      return state;
  }
};

/**
 * Returns the key for the property widget's state in the Redux store.
 * @returns The store key.
 */
export const getStoreId = (): string => "property-state";

/**
 * Creates a set of memoized selectors for a given widget ID.
 * @param widgetId - The ID of the widget.
 * @returns A set of selectors scoped to the widget's state.
 */
export const createPropertySelectors = (
  widgetId: string
): PropertySelectors => {
  const isObjectRecord = (
    value: unknown
  ): value is { [key: string]: unknown } => {
    return typeof value === "object" && value !== null;
  };

  const getExtensionsState = (
    state: IMState
  ): { [key: string]: unknown } | undefined => {
    if (!isObjectRecord(state) || !("extensionsState" in state)) {
      return undefined;
    }
    const candidate = (state as { extensionsState?: unknown }).extensionsState;
    return isObjectRecord(candidate) ? candidate : undefined;
  };

  const getWidgetState = (
    state: IMState
  ): IMPropertyWidgetState | undefined => {
    const extensionsState = getExtensionsState(state);

    const fromExtensions = extensionsState?.[getStoreId()] as
      | IMPropertyGlobalState
      | undefined;

    const legacyState = (state as IMStateWithProperty)["property-state"];

    const propertyState = fromExtensions ?? legacyState;
    return propertyState?.byId?.[widgetId];
  };

  const selectError = createSelector(
    getWidgetState,
    (widgetState: IMPropertyWidgetState): ErrorState | null => {
      const error = widgetState?.error;
      return error ? error.asMutable({ deep: true }) : null;
    }
  );

  const selectSelectedProperties = createSelector(
    getWidgetState,
    (widgetState: IMPropertyWidgetState): GridRowData[] => {
      const props = widgetState?.selectedProperties;
      return props ? props.asMutable({ deep: true }) : [];
    }
  );

  const selectIsQueryInFlight = createSelector(
    getWidgetState,
    (widgetState: IMPropertyWidgetState): boolean => {
      return widgetState?.isQueryInFlight ?? false;
    }
  );

  const selectRawPropertyResults = createSelector(
    getWidgetState,
    (widgetState: IMPropertyWidgetState): SerializedQueryResultMap | null => {
      const results = widgetState?.rawPropertyResults;
      return results ? results.asMutable({ deep: true }) : null;
    }
  );

  return {
    selectError,
    selectSelectedProperties,
    selectIsQueryInFlight,
    selectRawPropertyResults,
  };
};

export default class PropertyReduxStoreExtension
  implements extensionSpec.ReduxStoreExtension
{
  id = "property-widget_store";

  getActions(): string[] {
    return [...PROPERTY_ACTION_TYPES];
  }

  getInitLocalState(): IMPropertyGlobalState {
    return initialGlobalState;
  }

  getReducer() {
    return propertyReducer;
  }

  getStoreKey(): string {
    return "property-state";
  }
}
