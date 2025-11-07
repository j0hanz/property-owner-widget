import type {
  DispatchFn,
  ErrorState,
  GridRowData,
  PropertyAction,
  SerializedQueryResult,
} from "../../config/types";
import { propertyActions } from "../../extensions/store";

const safeDispatch = (
  dispatch: DispatchFn,
  widgetId: string,
  action: PropertyAction
) => {
  if (!widgetId || typeof dispatch !== "function") return;
  dispatch(action);
};

export const createPropertyDispatcher = (
  dispatch: DispatchFn,
  widgetId: string
) => {
  return {
    setError: (error: ErrorState | null) => {
      safeDispatch(
        dispatch,
        widgetId,
        propertyActions.setError(error, widgetId)
      );
    },
    clearError: () => {
      safeDispatch(dispatch, widgetId, propertyActions.clearError(widgetId));
    },
    setSelectedProperties: (properties: Iterable<GridRowData>) => {
      safeDispatch(
        dispatch,
        widgetId,
        propertyActions.setSelectedProperties(Array.from(properties), widgetId)
      );
    },
    clearAll: () => {
      safeDispatch(dispatch, widgetId, propertyActions.clearAll(widgetId));
    },
    setQueryInFlight: (inFlight: boolean) => {
      safeDispatch(
        dispatch,
        widgetId,
        propertyActions.setQueryInFlight(inFlight, widgetId)
      );
    },
    setRawResults: (
      results: { [key: string]: SerializedQueryResult } | null
    ) => {
      safeDispatch(
        dispatch,
        widgetId,
        propertyActions.setRawResults(results, widgetId)
      );
    },
    removeWidgetState: () => {
      safeDispatch(
        dispatch,
        widgetId,
        propertyActions.removeWidgetState(widgetId)
      );
    },
  };
};
