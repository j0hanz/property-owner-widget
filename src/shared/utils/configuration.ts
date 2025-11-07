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

export const normalizeHostList = (
  hosts: readonly string[] | undefined
): string[] => {
  if (!hosts || hosts.length === 0) return [];
  const normalized = hosts.map(normalizeHostValue).filter((h) => h.length > 0);
  return Array.from(new Set(normalized));
};
