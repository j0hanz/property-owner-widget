import type { ImmutableArray } from "jimu-core";
import type { IMConfig } from "../../config/types";
import { normalizeHostValue } from "./helpers";

const resolveCollectionLength = (collection: unknown): number => {
  if (!collection) return 0;
  if (typeof (collection as { size?: unknown }).size === "number") {
    return (collection as { size: number }).size;
  }
  if (typeof (collection as { length?: unknown }).length === "number") {
    return (collection as { length: number }).length;
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

export const resetDependentFields = (
  props: {
    shouldDisable: boolean;
    isBatchOwnerQueryEnabled: boolean;
    relationshipId: number | undefined;
  },
  prevProps: {
    shouldDisable: boolean;
    isBatchOwnerQueryEnabled: boolean;
    relationshipId: number | undefined;
  },
  actions: {
    updateBatchOwnerQuery: (value: boolean) => void;
    updateRelationshipId: (value: number | undefined) => void;
    clearRelationshipError: () => void;
  }
): void => {
  // If the section is being disabled, reset all dependent fields.
  if (props.shouldDisable && !prevProps.shouldDisable) {
    if (props.isBatchOwnerQueryEnabled) {
      actions.updateBatchOwnerQuery(false);
    }
    if (typeof props.relationshipId !== "undefined") {
      actions.updateRelationshipId(undefined);
    }
    actions.clearRelationshipError();
  }
};

export const normalizeHostList = (
  hosts: readonly string[] | undefined
): string[] => {
  if (!hosts || hosts.length === 0) return [];
  const normalized = hosts.map(normalizeHostValue).filter((h) => h.length > 0);
  return Array.from(new Set(normalized));
};
