import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table"
import type {
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  RowSelectionState,
  Table,
  Row,
} from "@tanstack/react-table"
import type { GridRowData } from "../config/types"
import { GRID_COLUMN_KEYS } from "../config/constants"

const columnHelper = createColumnHelper<GridRowData>()

let selectColumnCache: ColumnDef<GridRowData, any> | null = null

export const createSelectColumn = (
  CheckboxComponent: any
): ColumnDef<GridRowData, any> => {
  if (selectColumnCache) {
    return selectColumnCache
  }
  selectColumnCache = {
    id: GRID_COLUMN_KEYS.SELECT,
    header: ({ table }) => {
      return CheckboxComponent({
        checked: table.getIsAllRowsSelected(),
        indeterminate: table.getIsSomeRowsSelected(),
        onChange: table.getToggleAllRowsSelectedHandler(),
      })
    },
    cell: ({ row }) => {
      return CheckboxComponent({
        checked: row.getIsSelected(),
        disabled: !row.getCanSelect(),
        onChange: row.getToggleSelectedHandler(),
      })
    },
    enableSorting: false,
    enableColumnFilter: false,
  }
  return selectColumnCache
}

export const createPropertyTableColumns = (params: {
  translate: (key: string) => string
}): Array<ColumnDef<GridRowData, any>> => {
  const { translate } = params

  return [
    columnHelper.accessor("FASTIGHET", {
      id: GRID_COLUMN_KEYS.FASTIGHET,
      header: () => translate("columnFastighet"),
      cell: (info) => info.getValue(),
      enableSorting: true,
      enableColumnFilter: true,
      filterFn: "includesString",
    }),
    columnHelper.accessor("BOSTADR", {
      id: GRID_COLUMN_KEYS.BOSTADR,
      header: () => translate("columnAddress"),
      cell: (info) => info.getValue(),
      enableSorting: true,
      enableColumnFilter: true,
      filterFn: "includesString",
    }),
  ]
}

export const createTableConfig = () => ({
  enableSorting: true,
  enableColumnFilters: true,
  enableFilters: true,
  enableMultiSort: false,
  enableRowSelection: true,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
})

export const getDefaultSorting = (): SortingState => []

export const getDefaultColumnFilters = (): ColumnFiltersState => []

export const getDefaultRowSelection = (): RowSelectionState => ({})

export const getRowId = (row: GridRowData): string => row.id

export const isRowSelected = (
  table: Table<GridRowData>,
  rowId: string
): boolean => {
  return table.getRow(rowId)?.getIsSelected() ?? false
}

export const getVisibleRows = (
  table: Table<GridRowData>
): Array<Row<GridRowData>> => {
  return table.getRowModel().rows
}

export const getTotalRowCount = (table: Table<GridRowData>): number => {
  return table.getRowModel().rows.length
}
