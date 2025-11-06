import type { ImmutableArray, UseDataSource } from "jimu-core";
import type { UseDataSourceCandidate } from "../../config/types";

const hasGetter = (
  value: unknown
): value is { get: (key: string) => unknown } => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { get?: unknown };
  return typeof candidate.get === "function";
};

const hasAsMutable = (
  value: unknown
): value is {
  asMutable: (options?: { deep?: boolean }) => UseDataSource | UseDataSource[];
} => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { asMutable?: unknown };
  return typeof candidate.asMutable === "function";
};

const isIndexedCollection = (
  collection: unknown
): collection is {
  readonly length?: number;
  readonly [index: number]: UseDataSourceCandidate;
} => {
  if (!collection || typeof collection !== "object") {
    return false;
  }

  const candidate = collection as { length?: unknown };
  return typeof candidate.length === "number";
};

export const dataSourceHelpers = {
  extractId: (useDataSource: UseDataSourceCandidate | null | undefined) => {
    if (!useDataSource || typeof useDataSource !== "object") {
      return null;
    }

    if (hasGetter(useDataSource)) {
      const value = useDataSource.get("dataSourceId");
      return typeof value === "string" ? value : null;
    }

    if ("dataSourceId" in useDataSource) {
      const value = (useDataSource as { dataSourceId?: unknown }).dataSourceId;
      return typeof value === "string" ? value : null;
    }

    return null;
  },

  findById: (
    useDataSources:
      | ImmutableArray<UseDataSource>
      | UseDataSource[]
      | UseDataSourceCandidate[]
      | null
      | undefined,
    dataSourceId?: string
  ): UseDataSourceCandidate | null => {
    if (!dataSourceId || !useDataSources) {
      return null;
    }

    const collection = useDataSources as {
      readonly find?: (
        predicate: (candidate: UseDataSourceCandidate) => boolean
      ) => UseDataSourceCandidate | undefined;
    };

    if (typeof collection.find === "function") {
      const match = collection.find((candidate) => {
        if (!candidate) {
          return false;
        }
        return dataSourceHelpers.extractId(candidate) === dataSourceId;
      });
      if (match) {
        return match;
      }
    }

    if (hasAsMutable(useDataSources)) {
      const mutable = useDataSources.asMutable({ deep: false });
      if (Array.isArray(mutable)) {
        return dataSourceHelpers.findById(mutable, dataSourceId);
      }
    }

    if (Array.isArray(useDataSources) || isIndexedCollection(useDataSources)) {
      const indexed = useDataSources as {
        readonly length?: number;
        readonly [index: number]: UseDataSourceCandidate;
      };

      const length = indexed.length ?? 0;
      for (let index = 0; index < length; index += 1) {
        const candidate = indexed[index];
        if (
          candidate &&
          dataSourceHelpers.extractId(candidate) === dataSourceId
        ) {
          return candidate;
        }
      }
    }

    return null;
  },
};
