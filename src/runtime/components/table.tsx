/** @jsx jsx */
import { React, jsx, hooks } from "jimu-core"
import { Button } from "jimu-ui"
import { useReactTable, flexRender } from "@tanstack/react-table"
import type { SortingState, ColumnFiltersState } from "@tanstack/react-table"
import type { PropertyTableProps } from "../../config/types"
import {
  createTableConfig,
  getDefaultSorting,
  getDefaultColumnFilters,
  getRowId,
  getVisibleRows,
} from "../../shared/config"

export const PropertyTable = (props: PropertyTableProps) => {
  const { data, columns, translate, styles } = props

  const [sorting, setSorting] =
    React.useState<SortingState>(getDefaultSorting())
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    getDefaultColumnFilters()
  )

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    ...createTableConfig(),
  })

  const visibleRows = getVisibleRows(table)

  const handleRemoveClick = hooks.useEventCallback((cellValue: any) => {
    if (
      cellValue &&
      typeof cellValue === "object" &&
      "onRemove" in cellValue &&
      typeof cellValue.onRemove === "function"
    ) {
      cellValue.onRemove(cellValue.fnr)
    }
  })

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
              {row.getVisibleCells().map((cell) => {
                const isActionCell = cell.column.id === "actions"
                const cellValue = flexRender(
                  cell.column.columnDef.cell,
                  cell.getContext()
                )

                return (
                  <td key={cell.id} css={styles.td} role="cell">
                    {isActionCell &&
                    typeof cellValue === "object" &&
                    cellValue !== null ? (
                      <div css={styles.actionCell}>
                        <Button
                          type="tertiary"
                          size="sm"
                          onClick={() => handleRemoveClick(cellValue as any)}
                          aria-label={`${translate("removeProperty")} ${(cellValue as any).fastighet}`}
                        >
                          {translate("removeProperty")}
                        </Button>
                      </div>
                    ) : (
                      cellValue
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
