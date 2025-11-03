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

const createBorder = (color?: string) => `2px solid ${color}`

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
    header: createFlex("column", {
      alignItems: "stretch",
      gap: spacing?.(1),
      paddingInline: spacing?.(1),
    }),
    headerActions: createFlexAuto("row", {
      alignItems: "center",
      justifyContent: "end",
      gap: spacing?.(2),
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
      zIndex: 1,
    }),
    th: css({
      padding: spacing?.(1),
      textAlign: "left",
      borderBlockEnd: border,
      borderInlineEnd: border,
      "&:last-child": {
        borderInlineEnd: "none",
      },
      fontWeight: 500,
      cursor: "pointer",
      userSelect: "none",
    }),
    tbody: css({}),
    tr: css({
      "&:hover": {
        backgroundColor: color?.surface?.background,
      },
    }),
    td: css({
      padding: spacing?.(1),
      borderInlineEnd: border,
      "&:last-child": {
        borderInlineEnd: "none",
      },
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
    buttons: createFlexAuto("row", { gap: spacing?.(1) }),
    feedback: css({
      inlineSize: "100%",
    }),
    feedbackInput: css({
      inlineSize: "100%",
      marginBlockStart: spacing?.(1),
    }),
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
  const typography = theme.sys.typography

  return {
    row: css({ width: "100%", margin: "16px 0 !important" }),
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
      margin: "0 !important",
      padding: "0 !important",
      opacity: 0.6,
      "&:hover": {
        opacity: 1,
      },
    }),
    description: css({
      fontSize: typography?.body2?.fontSize,
      marginBlockStart: spacing?.(1),
    }),
    sliderWrap: createFlex("column", {
      inlineSize: "100%",
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
      textAlign: "right",
      fontSize: typography?.label2?.fontSize,
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
      ".input-wrapper": {
        background: "transparent !important",
        borderColor: "rgb(106, 106, 106) !important",
      },
      "&.disabled .input-wrapper, &.readonly .input-wrapper": {
        background: "transparent !important",
        borderColor: "rgb(106, 106, 106) !important",
        opacity: 1,
        color: "rgb(168, 168, 168)",
        WebkitTextFillColor: "rgb(168, 168, 168)",
      },
    }),
    addAllowedHostButton: css({
      border: "none !important",
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
