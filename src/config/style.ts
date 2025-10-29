import { css, type IMThemeVariables, type ImmutableObject } from "jimu-core"
import { useTheme } from "jimu-theme"
import type { TypographyStyle } from "jimu-theme"

// Internal helpers
const typo = (variant: ImmutableObject<TypographyStyle>) => ({
  fontFamily: variant?.fontFamily,
  fontWeight: variant?.fontWeight?.toString(),
  fontSize: variant?.fontSize,
  fontStyle: variant?.fontStyle,
  lineHeight: variant?.lineHeight,
  color: variant?.color,
})

const flex = (dir: "row" | "column", styles: { [key: string]: any } = {}) =>
  css({
    display: "flex",
    flexFlow: dir === "column" ? "column nowrap" : "row nowrap",
    ...styles,
  })

const flexAuto = (dir: "row" | "column", styles: { [key: string]: any } = {}) =>
  flex(dir, { flex: "0 0 auto", ...styles })

export const createWidgetStyles = (theme: IMThemeVariables) => {
  const spacing = theme.sys.spacing
  const colors = theme.sys.color
  const typography = theme.sys.typography

  return {
    parent: flex("column", {
      flex: "1 1 auto",
      overflowY: "auto",
      blockSize: "100%",
      gap: spacing?.(2),
      backgroundColor: colors?.surface?.paper,
    }),
    header: flexAuto("row", {
      alignItems: "center",
      justifyContent: "end",
      paddingInline: spacing?.(1),
    }),
    cols: flexAuto("row", {
      borderBlockStart: `1px solid ${colors?.surface?.backgroundHint}`,
      borderBlockEnd: `1px solid ${colors?.surface?.backgroundHint}`,
    }),
    col: css({
      flex: "1 1 0",
      display: "flex",
      justifyContent: "center",
      padding: spacing?.(1),
    }),
    body: flex("column", { flex: "1 1 0", overflow: "auto" }),
    emptyState: css({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      flex: "1 1 0",
      gap: spacing?.(4),
    }),
    svgState: css({
      opacity: 0.2,
    }),
    messageState: css({
      ...typo(typography?.label2),
      textAlign: "center",
      opacity: 0.8,
    }),
    loadingState: css({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      flex: "1 1 0",
      gap: spacing?.(4),
    }),
    listContainer: flex("column", {
      flex: "1 1 0",
      overflow: "auto",
      alignItems: "stretch",
    }),
    list: flexAuto("column"),
    row: flexAuto("row", {
      gap: spacing?.(2),
      padding: spacing?.(1),
      borderBlockEnd: `1px solid ${colors?.surface?.backgroundHint}`,
      alignItems: "center",
    }),
    column: css({ flex: "1 1 0", minWidth: 0 }),
    actions: flexAuto("row", { alignItems: "center" }),
    errorWrap: flex("column", {
      flex: "1 1 auto",
      gap: spacing?.(1),
      padding: spacing?.(2),
    }),
    errorHint: css({ color: colors?.surface?.backgroundHint }),
    buttons: flexAuto("row", { gap: spacing?.(2) }),
    footer: flexAuto("row", {
      borderBlockStart: `1px solid ${colors?.surface?.backgroundHint}`,
      ...typo(typography?.label2),
    }),
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
