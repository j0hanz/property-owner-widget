import type { ImmutableArray } from "jimu-core";
import type { IMConfig } from "../../config/types";
import { stripHtml } from "./privacy";
import { isRecord } from "./helpers";

const resolveCollectionLength = (values: unknown): number => {
  if (!values) {
    return 0;
  }
  const candidate = values as { length?: number };
  if (typeof candidate.length === "number") {
    return candidate.length;
  }
  return 0;
};

export const computeSettingsVisibility = (params: {
  useMapWidgetIds?: ImmutableArray<string> | string[] | null;
  config: IMConfig;
}): {
  hasMapSelection: boolean;
  hasRequiredDataSources: boolean;
  canShowDisplayOptions: boolean;
  canShowRelationshipSettings: boolean;
  shouldDisableRelationshipSettings: boolean;
} => {
  const { useMapWidgetIds, config } = params;
  const hasMapSelection = resolveCollectionLength(useMapWidgetIds) > 0;
  const hasPropertyDataSource = Boolean(config.propertyDataSourceId);
  const hasOwnerDataSource = Boolean(config.ownerDataSourceId);
  const hasRequiredDataSources = hasPropertyDataSource && hasOwnerDataSource;
  const canShowDisplayOptions = hasMapSelection && hasRequiredDataSources;
  const canShowRelationshipSettings = canShowDisplayOptions;

  return {
    hasMapSelection,
    hasRequiredDataSources,
    canShowDisplayOptions,
    canShowRelationshipSettings,
    shouldDisableRelationshipSettings: !canShowRelationshipSettings,
  } as const;
};

export const resetDependentFields = (params: {
  shouldDisable: boolean;
  localBatchOwnerQuery: boolean;
  setLocalBatchOwnerQuery: (value: boolean) => void;
  isBatchOwnerQueryEnabled: boolean;
  updateBatchOwnerQuery: (value: boolean) => void;
  relationshipId: number | undefined;
  updateRelationshipId: (value: number | undefined) => void;
  localRelationshipId: string;
  setLocalRelationshipId: (value: string) => void;
  clearRelationshipError: () => void;
}): void => {
  if (!params.shouldDisable) {
    return;
  }

  if (params.localBatchOwnerQuery) {
    params.setLocalBatchOwnerQuery(false);
  }

  if (params.isBatchOwnerQueryEnabled) {
    params.updateBatchOwnerQuery(false);
  }

  if (typeof params.relationshipId !== "undefined") {
    params.updateRelationshipId(undefined);
  }

  if (params.localRelationshipId !== "0") {
    params.setLocalRelationshipId("0");
  }

  params.clearRelationshipError();
};

const hasGetMethod = (
  value: unknown
): value is { get: (key: string) => unknown } => {
  return isRecord(value) && typeof value.get === "function";
};

const resolveEntry = (collection: unknown, key: string): unknown => {
  if (!collection) return undefined;
  if (hasGetMethod(collection)) {
    return collection.get(key);
  }
  if (isRecord(collection)) {
    return collection[key];
  }
  return undefined;
};

const readString = (source: unknown, key: string): string => {
  if (!source) return "";
  if (hasGetMethod(source)) {
    const value = source.get(key);
    return typeof value === "string" ? value : "";
  }
  if (isRecord(source)) {
    const value = source[key];
    return typeof value === "string" ? value : "";
  }
  return "";
};

const hasPropertyKeyword = (value: string): boolean => {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized.includes("property") || normalized.includes("fastighet");
};

const isPropertyWidget = (targetId: string, widgets: unknown): boolean => {
  const entry = resolveEntry(widgets, targetId);
  if (!entry) return false;

  const manifest = resolveEntry(entry, "manifest");
  const values: string[] = [
    readString(entry, "name"),
    readString(entry, "label"),
    readString(entry, "manifestLabel"),
    readString(entry, "uri"),
    readString(entry, "widgetName"),
    readString(manifest, "name"),
    readString(manifest, "label"),
    readString(manifest, "uri"),
  ];

  return values.some(hasPropertyKeyword);
};

export const computeWidgetsToClose = (
  runtimeInfo:
    | {
        [id: string]: { state?: unknown; isClassLoaded?: boolean } | undefined;
      }
    | null
    | undefined,
  currentWidgetId: string,
  widgets?: unknown
): string[] => {
  if (!runtimeInfo) return [];

  const ids: string[] = [];

  for (const [id, info] of Object.entries(runtimeInfo)) {
    if (id === currentWidgetId || !info) continue;
    const stateRaw = info.state;
    if (!stateRaw) continue;
    const normalizedSource =
      typeof stateRaw === "string"
        ? stateRaw
        : typeof stateRaw === "number"
          ? String(stateRaw)
          : null;

    if (!normalizedSource) {
      continue;
    }

    const normalized = normalizedSource.toUpperCase();

    if (normalized === "CLOSED" || normalized === "HIDDEN") {
      continue;
    }

    if (info.isClassLoaded && isPropertyWidget(id, widgets)) {
      ids.push(id);
    }
  }

  return ids;
};

export const normalizeHostValue = (value: string): string =>
  stripHtml(value || "").trim();

export const normalizeHostList = (
  hosts: readonly string[] | undefined
): string[] => {
  if (!hosts || hosts.length === 0) return [];
  const normalized = hosts.map(normalizeHostValue).filter((h) => h.length > 0);
  return Array.from(new Set(normalized));
};
