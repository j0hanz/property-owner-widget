import { css, type IMThemeVariables } from "jimu-core"
import { useTheme } from "jimu-theme"

const flex = (dir: "row" | "column", styles: { [key: string]: any } = {}) =>
  css({
    display: "flex",
    flexFlow: dir === "column" ? "column nowrap" : "row nowrap",
    ...styles,
  })

export const createWidgetStyles = (theme: IMThemeVariables) => {
  const spacing = theme.sys.spacing
  const colors = theme.sys.color
  const gap = spacing?.(2)
  const auto = "1 1 auto"

  return {
    parent: flex("column", { flex: auto, gap, padding: gap }),
    header: css({ flex: "0 0 auto" }),
    listContainer: flex("column", { flex: auto, overflow: "auto" }),
    list: flex("column", { flex: auto }),
    listItem: flex("row", {
      flex: "0 0 auto",
      gap: spacing?.(2),
      padding: spacing?.(1),
      borderBlockEnd: `1px solid ${colors?.divider?.secondary}`,
      alignItems: "center",
    }),
    column: css({ flex: "1 1 0", minWidth: 0 }),
    actions: flex("row", { flex: "0 0 auto", alignItems: "center" }),
    empty: flex("column", {
      flex: auto,
      placeContent: "center",
      alignItems: "center",
      color: colors?.surface?.backgroundHint,
    }),
    loading: css({ padding: spacing?.(1.5) }),
    error: css({ padding: spacing?.(1.5) }),
    errorBoundary: flex("column", {
      flex: auto,
      gap: spacing?.(1),
      padding: gap,
    }),
    errorDetails: css({
      color: colors?.surface?.backgroundHint,
    }),
    footer: flex("row", {
      flex: "0 0 auto",
      alignItems: "center",
      justifyContent: "space-between",
    }),
    footerActions: flex("row", { flex: "0 0 auto", gap: spacing?.(1) }),
  } as const
}

export type WidgetStyles = ReturnType<typeof createWidgetStyles>

export const useWidgetStyles = (): WidgetStyles => {
  const theme = useTheme()
  return createWidgetStyles(theme)
}

export const createSettingStyles = (theme: IMThemeVariables) => {
  const spacing = theme.sys.spacing
  const colors = theme.sys.color
  const typography = theme.sys.typography

  return {
    row: css({ inlineSize: "100%" }),
    description: css({
      fontSize: typography?.body1?.fontSize,
      color: colors?.surface?.backgroundHint,
      marginBlockStart: spacing?.(1),
    }),
  } as const
}

export type SettingStyles = ReturnType<typeof createSettingStyles>

export const useSettingStyles = (): SettingStyles => {
  const theme = useTheme()
  return createSettingStyles(theme)
}
