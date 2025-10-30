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
  const borderColor = color?.surface?.background
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
      borderInlineEnd: border,
      "&:last-child": {
        borderInlineEnd: "none",
      },
      padding: spacing?.(1),
    }),
    body: createFlex("column", {
      flex: "1 1 0",
      overflow: "auto",
      position: "relative",
    }),
    tableContainer: createFlex("column", {
      flex: "1 1 0",
      overflow: "hidden",
    }),
    table: css({
      width: "100%",
      borderCollapse: "collapse",
      tableLayout: "auto",
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
        backgroundColor: color?.surface?.background,
      },
    }),
    tbody: css({}),
    tr: css({
      "&:hover": {
        backgroundColor: color?.surface?.background,
      },
    }),
    td: css({
      padding: spacing?.(1),
      borderBlockEnd: border,
      overflow: "hidden",
      fontFamily: typography?.label2?.fontFamily,
      fontSize: typography?.label2?.fontSize,
      fontWeight: typography?.label2?.fontWeight,
    }),
    sortIndicator: css({
      marginInlineStart: spacing?.(1),
      display: "inline-block",
    }),
    emptyState: css({
      ...centeredFlex,
      gap: spacing?.(4),
    }),
    svgState: css({
      opacity: 0.1,
    }),
    messageState: css({
      fontFamily: typography?.label2?.fontFamily,
      fontSize: typography?.label2?.fontSize,
      fontWeight: typography?.label2?.fontWeight,
      textAlign: "center",
      opacity: 0.7,
    }),
    loadingInline: css({
      marginBlockStart: spacing?.(2),
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing?.(1),
    }),
    loadingMessage: css({
      fontFamily: typography?.body1?.fontFamily,
      fontSize: typography?.body1?.fontSize,
    }),
    loadingState: css({
      ...centeredFlex,
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
    row: css({ width: "100%" }),
    fullWidth: createFlex("column", {
      inlineSize: "100%",
      flex: "1 1 auto",
      minInlineSize: 0,
    }),
    labelWithTooltip: createFlex("row", {
      alignItems: "center",
      gap: spacing?.(1),
    }),
    tooltipTrigger: css({
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      marginInlineStart: spacing?.(1),
      inlineSize: spacing?.(4),
      blockSize: spacing?.(4),
      minInlineSize: spacing?.(3),
      minBlockSize: spacing?.(3),
      padding: 0,
    }),
    description: css({
      fontSize: typography?.body2?.fontSize,
      marginBlockStart: spacing?.(1),
    }),
    sliderWrap: createFlex("column", {
      inlineSize: "100%",
      gap: spacing?.(1),
    }),
    sliderTrack: createFlex("row", {
      alignItems: "center",
      inlineSize: "100%",
      gap: spacing?.(2),
    }),
    sliderControl: css({
      flex: "1 1 auto",
      inlineSize: "100%",
    }),
    sliderValue: css({
      minInlineSize: spacing?.(6),
      textAlign: "right",
      fontSize: typography?.label2?.fontSize,
      color: colors?.surface?.backgroundHint,
    }),
    allowedHostInputRow: createFlex("row", {
      inlineSize: "100%",
      alignItems: "center",
    }),
    allowedHostInput: css({
      flex: "1 1 auto",
      inlineSize: "100%",
      minInlineSize: 0,
    }),
    allowedHostList: createFlex("column", {
      inlineSize: "100%",
    }),
    allowedHostListRow: createFlex("row", {
      inlineSize: "100%",
      alignItems: "center",
    }),
    allowedHostListInput: css({
      flex: "1 1 auto",
      inlineSize: "100%",
      minInlineSize: 0,
    }),
  } as const
}

export type SettingStyles = ReturnType<typeof createSettingStyles>

export const useSettingStyles = (): SettingStyles => {
  const theme = useTheme()
  return createSettingStyles(theme)
}
