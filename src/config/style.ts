import { css, type IMThemeVariables } from "jimu-core"
import { useTheme } from "jimu-theme"

// Helper for flex layouts
const flex = (dir: "row" | "column", styles: { [key: string]: any } = {}) =>
  css({
    display: "flex",
    flexFlow: dir === "column" ? "column nowrap" : "row nowrap",
    ...styles,
  })

// Widget styles factory
export const createWidgetStyles = (theme: IMThemeVariables) => {
  const spacing = theme.sys.spacing
  const colors = theme.sys.color

  return {
    parent: flex("column", {
      backgroundColor: colors?.surface?.paper,
      flex: "1 1 auto",
      padding: spacing?.(2),
      gap: spacing?.(2),
    }),
    header: css({ flex: "0 0 auto" }),
    gridContainer: flex("column", {
      flex: "1 1 auto",
      overflow: "auto",
    }),
    footer: css({ flex: "0 0 auto" }),
    loading: css({ padding: spacing?.(1.5) }),
    error: css({ padding: spacing?.(1.5) }),
    table: css({
      width: "100%",
      borderCollapse: "separate",
      borderSpacing: 0,
      border: `1px solid ${colors?.divider?.secondary}`,
      borderRadius: "0.375rem",
      overflow: "hidden",
    }),
    tableHead: css({
      backgroundColor: colors?.surface?.paper,
    }),
    tableCell: css({
      padding: spacing?.(1),
      borderBottom: `1px solid ${colors?.divider?.secondary}`,
      textAlign: "left",
      verticalAlign: "top",
    }),
    tableHeaderCell: css({
      fontWeight: 600,
      backgroundColor: colors?.surface?.paper,
    }),
    tableDataCell: css({
      backgroundColor: colors?.surface?.background,
    }),
    tableLastRow: css({
      "& td": {
        borderBottom: "none",
      },
    }),
    tableActions: flex("row", {
      alignItems: "center",
      justifyContent: "flex-end",
      gap: spacing?.(0.5),
    }),
    tableEmpty: css({
      textAlign: "center",
      color: colors?.surface?.backgroundHint,
    }),
    errorBoundary: flex("column", {
      padding: spacing?.(2),
      gap: spacing?.(1),
    }),
    errorDetails: css({
      fontSize: "0.75rem",
      color: colors?.surface?.backgroundHint,
    }),
    heading: css({
      margin: 0,
      fontSize: "inherit",
      fontWeight: "inherit",
    }),
  } as const
}

export type WidgetStyles = ReturnType<typeof createWidgetStyles>

export const useWidgetStyles = (): WidgetStyles => {
  const theme = useTheme()
  return createWidgetStyles(theme)
}

// Settings styles factory
export const createSettingStyles = (theme: IMThemeVariables) => {
  const spacing = theme.sys.spacing
  const colors = theme.sys.color

  return {
    row: css({ width: "100%" }),
    description: css({
      fontSize: "0.875rem",
      color: colors?.surface?.backgroundHint,
      marginTop: spacing?.(1),
      lineHeight: 1.5,
    }),
  } as const
}

export type SettingStyles = ReturnType<typeof createSettingStyles>

export const useSettingStyles = (): SettingStyles => {
  const theme = useTheme()
  return createSettingStyles(theme)
}
