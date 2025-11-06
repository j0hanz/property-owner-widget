import type { ImmutableArray, UseDataSource } from "jimu-core";
import type { UseDataSourceCandidate } from "../../config/types";
import {
  hasAsMutable,
  isIndexedCollection,
  hasFind,
  extractStringFromImmutable,
} from "./helpers";

export const dataSourceHelpers = {
  extractId: (useDataSource: UseDataSourceCandidate | null | undefined) => {
    return extractStringFromImmutable(useDataSource, "dataSourceId");
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

    if (hasFind<UseDataSourceCandidate>(useDataSources)) {
      const match = useDataSources.find((candidate) => {
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
