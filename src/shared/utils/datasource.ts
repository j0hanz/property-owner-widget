import type { ImmutableArray, ImmutableObject, UseDataSource } from "jimu-core";
import Immutable from "seamless-immutable";

const findById = (
  dataSources: ImmutableArray<UseDataSource>,
  id: string
): ImmutableObject<UseDataSource> | null => {
  if (!id || !dataSources) {
    return null;
  }
  const ds = dataSources.find((d) => d.dataSourceId === id);
  // The find method on an ImmutableArray returns a plain object.
  // We must convert it back to an ImmutableObject to match the function's return type.
  return ds ? Immutable(ds) : null;
};

export const dataSourceHelpers = {
  findById,
};
