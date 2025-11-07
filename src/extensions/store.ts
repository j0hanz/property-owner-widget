import type { extensionSpec, ImmutableObject, IMState } from "jimu-core";
import SeamlessImmutable from "seamless-immutable";
import { createSelector } from "reselect";
import { PROPERTY_ACTION_TYPES } from "../config/constants";
import { PropertyActionType } from "../config/enums";
import type {
  ErrorState,
  GridRowData,
  IMPropertyGlobalState,
  IMPropertyWidgetState,
  PropertyAction,
  PropertySelectors,
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

const createImmutableState = (): ImmutableObject<PropertyWidgetState> =>
  SeamlessImmutable(initialPropertyState);

const initialGlobalState: IMPropertyGlobalState = SeamlessImmutable({
  byId: {} as { [key: string]: IMPropertyWidgetState },
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
  const widgetStatePath = ["byId", widgetId];

  // Helper to ensure the widget-specific state exists before modification
  const ensureWidgetState = (
    s: IMPropertyGlobalState
  ): IMPropertyGlobalState => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sAny = s as any;
    if (sAny.getIn(widgetStatePath)) {
      return s;
    }
    return sAny.setIn(widgetStatePath, createImmutableState());
  };

  switch (action.type) {
    case PropertyActionType.SET_ERROR: {
      const withState = ensureWidgetState(state);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (withState as any)
        .setIn([...widgetStatePath, "error"], action.error ?? null)
        .setIn([...widgetStatePath, "isQueryInFlight"], false);
    }
    case PropertyActionType.CLEAR_ERROR: {
      const withState = ensureWidgetState(state);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (withState as any).setIn([...widgetStatePath, "error"], null);
    }
    case PropertyActionType.SET_SELECTED_PROPERTIES: {
      const withState = ensureWidgetState(state);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (withState as any).setIn(
        [...widgetStatePath, "selectedProperties"],
        action.properties
      );
    }
    case PropertyActionType.CLEAR_ALL: {
      const withState = ensureWidgetState(state);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (withState as any).setIn(widgetStatePath, createImmutableState());
    }
    case PropertyActionType.SET_QUERY_IN_FLIGHT: {
      const withState = ensureWidgetState(state);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (withState as any).setIn(
        [...widgetStatePath, "isQueryInFlight"],
        action.inFlight
      );
    }
    case PropertyActionType.SET_RAW_RESULTS: {
      const withState = ensureWidgetState(state);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (withState as any).setIn(
        [...widgetStatePath, "rawPropertyResults"],
        action.results
      );
    }
    case PropertyActionType.REMOVE_WIDGET_STATE: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byId = (state as any).byId.without(widgetId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (state as any).set("byId", byId);
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
  const getWidgetState = (
    state: IMState
  ): IMPropertyWidgetState | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extensionsState = (state as any).extensionsState as {
      [key: string]: unknown;
    };
    const propertyState = extensionsState?.[
      getStoreId()
    ] as IMPropertyGlobalState;
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
