/** @jsx jsx */
import { jsx, React } from "jimu-core";
import { Scrollable, SVG } from "jimu-ui";
import { flexRender, useReactTable } from "@tanstack/react-table";
import type { ColumnFiltersState } from "@tanstack/react-table";
import type { PropertyTableProps } from "../../config/types";
import {
  createTableConfig,
  getDefaultColumnFilters,
  getRowId,
  getVisibleRows,
} from "../../shared/config";
import arrowDownIcon from "../../assets/arrow-down.svg";
import arrowUpIcon from "../../assets/arrow-up.svg";

export const PropertyTable = (props: PropertyTableProps) => {
  const { data, columns, translate, styles, sorting, onSortingChange } = props;

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    getDefaultColumnFilters()
  );

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange,
    onColumnFiltersChange: setColumnFilters,
    ...createTableConfig(),
  });

  const visibleRows = getVisibleRows(table);

  const renderSortIndicator = (isSorted: false | "asc" | "desc") => {
    if (!isSorted) return null;
    return (
      <span css={styles.sortIndicator} aria-hidden="true">
        <SVG src={isSorted === "asc" ? arrowUpIcon : arrowDownIcon} size={12} />
      </span>
    );
  };

  return (
    <Scrollable horizontal={false} duration={300}>
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
                        e.preventDefault();
                        const toggleHandler =
                          header.column.getToggleSortingHandler();
                        if (toggleHandler) toggleHandler(e.nativeEvent);
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
    </Scrollable>
  );
};
