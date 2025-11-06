import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  ColumnFiltersState,
  Row,
  SortingState,
  Table,
} from "@tanstack/react-table";
import { GRID_COLUMN_KEYS } from "../config/constants";
import type { GridRowData } from "../config/types";

const columnHelper = createColumnHelper<GridRowData>();

export const createPropertyTableColumns = (params: {
  translate: (key: string) => string;
}): Array<ColumnDef<GridRowData>> => {
  const { translate } = params;

  return [
    columnHelper.accessor("FASTIGHET", {
      id: GRID_COLUMN_KEYS.FASTIGHET,
      header: () => translate("columnFastighet"),
      cell: (info) => info.getValue(),
      enableSorting: true,
      enableColumnFilter: true,
      filterFn: "includesString",
    }),
    columnHelper.accessor("ADDRESS", {
      id: GRID_COLUMN_KEYS.ADDRESS,
      header: () => translate("columnAddress"),
      cell: (info) => info.getValue(),
      enableSorting: true,
      enableColumnFilter: true,
      filterFn: "includesString",
    }),
  ];
};

export const createTableConfig = () => ({
  enableSorting: true,
  enableColumnFilters: true,
  enableFilters: true,
  enableMultiSort: false,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
});

export const getDefaultSorting = (): SortingState => [];

export const getDefaultColumnFilters = (): ColumnFiltersState => [];

export const getRowId = (row: GridRowData): string => row.id;

export const getVisibleRows = (
  table: Table<GridRowData>
): Array<Row<GridRowData>> => {
  return table.getRowModel().rows;
};
