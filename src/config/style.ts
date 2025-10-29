import { css, type IMThemeVariables } from "jimu-core"
import { useTheme } from "jimu-theme"
import type { FlexDirection, StyleObject } from "./types"

const createFlex = (
  direction: FlexDirection,
  additionalStyles: StyleObject = {}
) =>
  css({
    display: "flex",
    flexFlow: `${direction} nowrap`,
    ...additionalStyles,
  })

const createFlexAuto = (
  direction: FlexDirection,
  additionalStyles: StyleObject = {}
) => createFlex(direction, { flex: "0 0 auto", ...additionalStyles })

const createBorder = (color?: string) => `1px solid ${color}`

export const createWidgetStyles = (theme: IMThemeVariables) => {
  const { spacing, color, typography } = theme.sys
  const borderColor = color?.surface?.backgroundHint
  const border = createBorder(borderColor)

  const centeredFlex = {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    flex: "1 1 0",
  }

  return {
    parent: createFlex("column", {
      flex: "1 1 auto",
      overflowY: "auto",
      blockSize: "100%",
      gap: spacing?.(2),
      backgroundColor: color?.surface?.paper,
    }),
    header: createFlexAuto("row", {
      alignItems: "center",
      justifyContent: "end",
      paddingInline: spacing?.(1),
    }),
    cols: createFlexAuto("row", {
      borderBlockStart: border,
      borderBlockEnd: border,
    }),
    col: css({
      flex: "1 1 0",
      display: "flex",
      justifyContent: "center",
      padding: spacing?.(1),
    }),
    body: createFlex("column", { flex: "1 1 0", overflow: "auto" }),
    tableContainer: createFlex("column", {
      flex: "1 1 0",
      overflow: "hidden",
    }),
    table: css({
      width: "100%",
      borderCollapse: "collapse",
      tableLayout: "fixed",
    }),
    thead: css({
      position: "sticky",
      top: 0,
      backgroundColor: color?.surface?.paper,
      zIndex: 1,
    }),
    th: css({
      padding: spacing?.(1),
      textAlign: "left",
      borderBlockEnd: border,
      fontWeight: 600,
      cursor: "pointer",
      userSelect: "none",
      "&:hover": {
        backgroundColor: borderColor,
      },
    }),
    tbody: css({
      display: "block",
      overflowY: "auto",
      flex: "1 1 0",
    }),
    tr: css({
      display: "table",
      width: "100%",
      tableLayout: "fixed",
      "&:hover": {
        backgroundColor: borderColor,
      },
    }),
    td: css({
      padding: spacing?.(1),
      borderBlockEnd: border,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }),
    sortIndicator: css({
      marginInlineStart: spacing?.(1),
      display: "inline-block",
    }),
    actionCell: css({
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "center",
    }),
    emptyState: css({
      ...centeredFlex,
      gap: spacing?.(4),
    }),
    svgState: css({
      opacity: 0.2,
    }),
    messageState: css({
      fontFamily: typography?.label2?.fontFamily,
      fontSize: typography?.label2?.fontSize,
      fontWeight: typography?.label2?.fontWeight,
      lineHeight: typography?.label2?.lineHeight,
      textAlign: "center",
      opacity: 0.8,
    }),
    loadingState: css({
      ...centeredFlex,
      gap: spacing?.(4),
    }),
    errorWrap: createFlex("column", {
      flex: "1 1 auto",
      gap: spacing?.(1),
      padding: spacing?.(2),
    }),
    errorHint: css({ color: borderColor }),
    buttons: createFlexAuto("row", { gap: spacing?.(2) }),
    footer: createFlexAuto("row", {
      borderBlockStart: border,
      fontFamily: typography?.label2?.fontFamily,
      fontSize: typography?.label2?.fontSize,
      fontWeight: typography?.label2?.fontWeight,
      lineHeight: typography?.label2?.lineHeight,
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
