/** @jsx jsx */
import { React, jsx } from "jimu-core"
import { Checkbox } from "jimu-ui"
import { useReactTable, flexRender } from "@tanstack/react-table"
import type {
  SortingState,
  ColumnFiltersState,
  RowSelectionState,
  ColumnDef,
} from "@tanstack/react-table"
import type { PropertyTableProps, GridRowData } from "../../config/types"
import {
  createTableConfig,
  createSelectColumn,
  getDefaultSorting,
  getDefaultColumnFilters,
  getDefaultRowSelection,
  getRowId,
  getVisibleRows,
} from "../../shared/config"

const IndeterminateCheckbox = (props: {
  checked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
}) => {
  return <Checkbox {...props} />
}

export const PropertyTable = (props: PropertyTableProps) => {
  const { data, columns, translate, styles } = props

  const [sorting, setSorting] =
    React.useState<SortingState>(getDefaultSorting())
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    getDefaultColumnFilters()
  )
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(
    getDefaultRowSelection()
  )

  const columnsWithSelectRef = React.useRef<Array<ColumnDef<GridRowData, any>>>(
    [createSelectColumn(IndeterminateCheckbox), ...columns]
  )

  React.useEffect(() => {
    columnsWithSelectRef.current = [
      createSelectColumn(IndeterminateCheckbox),
      ...columns,
    ]
  }, [columns])

  const columnsWithSelect = columnsWithSelectRef.current

  const table = useReactTable({
    data,
    columns: columnsWithSelect,
    getRowId,
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    ...createTableConfig(),
  })

  const visibleRows = getVisibleRows(table)

  const renderSortIndicator = (isSorted: false | "asc" | "desc") => {
    if (!isSorted) return null
    return (
      <span css={styles.sortIndicator} aria-hidden="true">
        {isSorted === "asc" ? "↑" : "↓"}
      </span>
    )
  }

  return (
    <div
      css={styles.tableContainer}
      role="region"
      aria-label={translate("widgetTitle")}
    >
      <table css={styles.table} role="table">
        <thead css={styles.thead}>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} css={styles.tr} role="row">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  css={styles.th}
                  onClick={header.column.getToggleSortingHandler()}
                  role="columnheader"
                  aria-sort={
                    header.column.getIsSorted()
                      ? header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      header.column.getToggleSortingHandler()?.(e as any)
                    }
                  }}
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                  {renderSortIndicator(header.column.getIsSorted())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody css={styles.tbody}>
          {visibleRows.map((row) => (
            <tr key={row.id} css={styles.tr} role="row">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} css={styles.td} role="cell">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
