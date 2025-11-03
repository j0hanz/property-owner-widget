import * as SeamlessImmutableNs from "seamless-immutable"
import type { extensionSpec, ImmutableObject } from "jimu-core"
import type {
  ErrorState,
  GridRowData,
  IMPropertyGlobalState,
  IMStateWithProperty,
  PropertyWidgetState,
  SerializedQueryResult,
} from "../config/types"

export enum PropertyActionType {
  SET_ERROR = "PROPERTY_WIDGET/SET_ERROR",
  CLEAR_ERROR = "PROPERTY_WIDGET/CLEAR_ERROR",
  SET_SELECTED_PROPERTIES = "PROPERTY_WIDGET/SET_SELECTED_PROPERTIES",
  CLEAR_ALL = "PROPERTY_WIDGET/CLEAR_ALL",
  SET_QUERY_IN_FLIGHT = "PROPERTY_WIDGET/SET_QUERY_IN_FLIGHT",
  SET_RAW_RESULTS = "PROPERTY_WIDGET/SET_RAW_RESULTS",
  REMOVE_WIDGET_STATE = "PROPERTY_WIDGET/REMOVE_WIDGET_STATE",
}

export const PROPERTY_ACTION_TYPES = Object.values(PropertyActionType)

export type PropertyAction =
  | {
      type: PropertyActionType.SET_ERROR
      error: ErrorState | null
      widgetId: string
    }
  | {
      type: PropertyActionType.CLEAR_ERROR
      widgetId: string
    }
  | {
      type: PropertyActionType.SET_SELECTED_PROPERTIES
      properties: GridRowData[]
      widgetId: string
    }
  | {
      type: PropertyActionType.CLEAR_ALL
      widgetId: string
    }
  | {
      type: PropertyActionType.SET_QUERY_IN_FLIGHT
      inFlight: boolean
      widgetId: string
    }
  | {
      type: PropertyActionType.SET_RAW_RESULTS
      results: Map<string, SerializedQueryResult> | null
      widgetId: string
    }
  | {
      type: PropertyActionType.REMOVE_WIDGET_STATE
      widgetId: string
    }

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
    results: Map<string, SerializedQueryResult> | null,
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
}

const resolveImmutableFactory = () => {
  const candidate = SeamlessImmutableNs as unknown

  if (typeof candidate === "function") {
    return candidate as (input: any) => any
  }

  const candidateObj = candidate as {
    default?: (input: any) => any
    Immutable?: (input: any) => any
  }

  if (candidateObj && typeof candidateObj.default === "function") {
    return candidateObj.default
  }

  if (candidateObj && typeof candidateObj.Immutable === "function") {
    return candidateObj.Immutable
  }

  return <T>(input: T): T => input
}

const Immutable = resolveImmutableFactory()

const initialPropertyState: PropertyWidgetState = {
  error: null,
  selectedProperties: [],
  isQueryInFlight: false,
  rawPropertyResults: null,
}

const createImmutableState = (): ImmutableObject<PropertyWidgetState> =>
  Immutable(initialPropertyState) as ImmutableObject<PropertyWidgetState>

const initialGlobalState = Immutable({
  byId: {},
}) as unknown as IMPropertyGlobalState

const ensureSubState = (
  global: IMPropertyGlobalState,
  widgetId: string
): ImmutableObject<PropertyWidgetState> => {
  const current = (global as any).byId?.[widgetId] as
    | ImmutableObject<PropertyWidgetState>
    | undefined
  return current ?? createImmutableState()
}

const setSubState = (
  global: IMPropertyGlobalState,
  widgetId: string,
  next: ImmutableObject<PropertyWidgetState>
): IMPropertyGlobalState => {
  const byId = { ...((global as any).byId || {}) }
  byId[widgetId] = next
  return Immutable({ byId }) as unknown as IMPropertyGlobalState
}

const reduceOne = (
  state: ImmutableObject<PropertyWidgetState>,
  action: PropertyAction
): ImmutableObject<PropertyWidgetState> => {
  switch (action.type) {
    case PropertyActionType.SET_ERROR:
      return state.set("error", action.error).set("isQueryInFlight", false)
    case PropertyActionType.CLEAR_ERROR:
      return state.set("error", null)
    case PropertyActionType.SET_SELECTED_PROPERTIES:
      return state.set("selectedProperties", action.properties)
    case PropertyActionType.CLEAR_ALL:
      return createImmutableState()
    case PropertyActionType.SET_QUERY_IN_FLIGHT:
      return state.set("isQueryInFlight", action.inFlight)
    case PropertyActionType.SET_RAW_RESULTS:
      return state.set("rawPropertyResults", action.results)
    default:
      return state
  }
}

const isPropertyAction = (candidate: unknown): candidate is PropertyAction => {
  if (!candidate || typeof candidate !== "object") return false
  const action = candidate as { type?: unknown; widgetId?: unknown }
  if (typeof action.type !== "string") return false
  if (!PROPERTY_ACTION_TYPES.includes(action.type as PropertyActionType)) {
    return false
  }
  return typeof action.widgetId === "string"
}

const propertyReducer = (
  state: IMPropertyGlobalState = initialGlobalState,
  action: unknown
): IMPropertyGlobalState => {
  if (!isPropertyAction(action)) return state

  if (action.type === PropertyActionType.REMOVE_WIDGET_STATE) {
    const currentById = (state as any)?.byId
    if (!currentById || typeof currentById !== "object") return state
    const byId = { ...currentById }
    if (!(action.widgetId in byId)) return state
    delete byId[action.widgetId]
    return Immutable({ byId }) as unknown as IMPropertyGlobalState
  }

  const widgetId = action.widgetId
  if (!widgetId) return state

  const prevSub = ensureSubState(state, widgetId)
  const nextSub = reduceOne(prevSub, action)
  if (nextSub === prevSub) return state
  return setSubState(state, widgetId, nextSub)
}

export const createPropertySelectors = (widgetId: string) => {
  const getSlice = (
    state: IMStateWithProperty
  ): ImmutableObject<PropertyWidgetState> | null => {
    const slice = state?.["property-state"]?.byId?.[widgetId]
    return slice ?? null
  }

  return {
    selectSlice: getSlice,
    selectError: (state: IMStateWithProperty) => getSlice(state)?.error ?? null,
    selectSelectedProperties: (state: IMStateWithProperty) =>
      getSlice(state)?.selectedProperties ?? [],
    selectIsQueryInFlight: (state: IMStateWithProperty) =>
      getSlice(state)?.isQueryInFlight ?? false,
    selectRawResults: (state: IMStateWithProperty) =>
      getSlice(state)?.rawPropertyResults ?? null,
  }
}

export default class PropertyReduxStoreExtension
  implements extensionSpec.ReduxStoreExtension
{
  readonly id = "property-widget_store"

  getActions(): string[] {
    return [...PROPERTY_ACTION_TYPES]
  }

  getInitLocalState(): { byId: { [id: string]: PropertyWidgetState } } {
    return { byId: {} }
  }

  getReducer() {
    return propertyReducer
  }

  getStoreKey() {
    return "property-state"
  }
}
