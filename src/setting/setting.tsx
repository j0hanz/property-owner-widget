/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  React,
  hooks,
  jsx,
  type UseDataSource,
  type ImmutableObject,
  DataSourceTypes,
  Immutable,
} from "jimu-core"
import {
  Alert,
  Button,
  CollapsablePanel,
  NumericInput,
  Slider,
  Tooltip,
  Switch,
  TextInput,
  SVG,
  defaultMessages as jimuUIMessages,
} from "jimu-ui"
import { ColorPicker } from "jimu-ui/basic/color-picker"
import type { AllWidgetSettingProps } from "jimu-for-builder"
import {
  SettingSection,
  SettingRow,
  MapWidgetSelector,
} from "jimu-ui/advanced/setting-components"
import { DataSourceSelector } from "jimu-ui/advanced/data-source-selector"
import defaultMessages from "./translations/default"
import type { IMConfig } from "../config/types"
import { useSettingStyles } from "../config/style"
import {
  useBooleanConfigValue,
  useUpdateConfig,
  useDebounce,
  useSwitchConfigHandler,
  useSliderConfigHandler,
} from "../shared/hooks"
import {
  validateNumericRange,
  opacityHelpers,
  outlineWidthHelpers,
  normalizeHostValue,
  normalizeHostList,
} from "../shared/utils"
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_SYMBOL_ALPHA,
  OUTLINE_WIDTH,
} from "../config/constants"
import addIcon from "../assets/plus.svg"
import removeIcon from "../assets/close.svg"
import infoIcon from "../assets/info.svg"

interface FieldErrors {
  [key: string]: string | undefined
}

const Setting = (
  props: AllWidgetSettingProps<IMConfig>
): React.ReactElement => {
  const { config, id, onSettingChange, useMapWidgetIds } = props
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages)
  const styles = useSettingStyles()

  const renderLabelWithTooltip = (
    labelKey: string,
    descriptionKey: string
  ): React.ReactNode => {
    const labelText = translate(labelKey)
    const descriptionText = translate(descriptionKey)

    return (
      <div css={styles.labelWithTooltip}>
        <span>{labelText}</span>
        <Tooltip title={descriptionText} placement="top" showArrow>
          <Button
            type="tertiary"
            icon
            aria-label={descriptionText}
            css={styles.tooltipTrigger}
          >
            <SVG src={infoIcon} />
          </Button>
        </Tooltip>
      </div>
    )
  }

  const toMutableUseDataSource = (
    source: ImmutableObject<UseDataSource> | UseDataSource | null
  ): UseDataSource | null => {
    if (!source) {
      return null
    }
    const asMutable = (source as any).asMutable
    if (typeof asMutable === "function") {
      return asMutable.call(source, { deep: true }) as UseDataSource
    }
    return source as unknown as UseDataSource
  }

  const buildSelectorValue = (dataSourceId?: string) => {
    if (!dataSourceId || !props.useDataSources) {
      return Immutable([])
    }

    const collection = props.useDataSources as any
    const matches =
      typeof collection.filter === "function"
        ? collection.filter(
            (ds: UseDataSource) => ds?.dataSourceId === dataSourceId
          )
        : []

    const mutableMatches: UseDataSource[] =
      typeof matches?.asMutable === "function"
        ? matches.asMutable({ deep: true })
        : matches

    return Immutable(mutableMatches)
  }

  const getBooleanConfig = useBooleanConfigValue(config)
  const updateConfig = useUpdateConfig(id, config, onSettingChange)

  const [localMaxResults, setLocalMaxResults] = React.useState<string>(() =>
    String(config.maxResults || 50)
  )
  const [localToggleRemoval, setLocalToggleRemoval] = React.useState(() =>
    getBooleanConfig("enableToggleRemoval")
  )
  const [localPIIMasking, setLocalPIIMasking] = React.useState(() =>
    getBooleanConfig("enablePIIMasking")
  )
  const [localBatchOwnerQuery, setLocalBatchOwnerQuery] = React.useState(() =>
    getBooleanConfig("enableBatchOwnerQuery", false)
  )
  const [localRelationshipId, setLocalRelationshipId] = React.useState<string>(
    () => String(config.relationshipId ?? 0)
  )
  const [localAllowedHostInput, setLocalAllowedHostInput] = React.useState("")
  const [localAllowedHostsList, setLocalAllowedHostsList] = React.useState(() =>
    normalizeHostList(config.allowedHosts)
  )
  const [localHighlightColor, setLocalHighlightColor] = React.useState(
    config.highlightColor || DEFAULT_HIGHLIGHT_COLOR
  )
  const [localHighlightOpacity, setLocalHighlightOpacity] = React.useState(
    () => {
      const baseValue =
        typeof config.highlightOpacity === "number"
          ? config.highlightOpacity
          : HIGHLIGHT_SYMBOL_ALPHA
      return opacityHelpers.fromPercent(opacityHelpers.toPercent(baseValue))
    }
  )
  const [localOutlineWidth, setLocalOutlineWidth] = React.useState(() => {
    const baseValue =
      typeof config.outlineWidth === "number"
        ? config.outlineWidth
        : OUTLINE_WIDTH
    return outlineWidthHelpers.normalize(baseValue)
  })

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})

  const validateMaxResults = hooks.useEventCallback(
    (value: string): boolean => {
      const result = validateNumericRange({
        value,
        min: 1,
        max: 1000,
        errorMessage: translate("errorMaxResultsInvalid"),
      })

      if (!result.valid) {
        setFieldErrors((prev) => ({
          ...prev,
          maxResults: result.error,
        }))
        return false
      }
      setFieldErrors((prev) => ({ ...prev, maxResults: undefined }))
      return true
    }
  )

  const validateRelationshipId = hooks.useEventCallback(
    (value: string): boolean => {
      const result = validateNumericRange({
        value,
        min: 0,
        max: 99,
        errorMessage: translate("errorRelationshipIdInvalid"),
      })

      if (!result.valid) {
        setFieldErrors((prev) => ({
          ...prev,
          relationshipId: result.error,
        }))
        return false
      }
      setFieldErrors((prev) => ({ ...prev, relationshipId: undefined }))
      return true
    }
  )

  const debouncedMaxResultsValidation = useDebounce(validateMaxResults, 500)

  const handleMaxResultsChange = hooks.useEventCallback((value: number) => {
    setLocalMaxResults(String(value))
    debouncedMaxResultsValidation(String(value))
  })

  const handleMaxResultsBlur = hooks.useEventCallback(() => {
    debouncedMaxResultsValidation.cancel()
    const isValid = validateMaxResults(localMaxResults)
    if (isValid) {
      const num = parseInt(localMaxResults, 10)
      updateConfig("maxResults", num)
    }
  })

  const handleToggleRemovalChange = useSwitchConfigHandler(
    localToggleRemoval,
    setLocalToggleRemoval,
    updateConfig,
    "enableToggleRemoval"
  )

  const handlePIIMaskingChange = useSwitchConfigHandler(
    localPIIMasking,
    setLocalPIIMasking,
    updateConfig,
    "enablePIIMasking"
  )

  const handleBatchOwnerQueryChange = useSwitchConfigHandler(
    localBatchOwnerQuery,
    setLocalBatchOwnerQuery,
    updateConfig,
    "enableBatchOwnerQuery"
  )

  const handleRelationshipIdChange = hooks.useEventCallback((value: number) => {
    const clamped = Math.max(0, Math.min(99, Math.round(value)))
    setLocalRelationshipId(String(clamped))
  })

  const handleRelationshipIdBlur = hooks.useEventCallback(() => {
    const isValid = validateRelationshipId(localRelationshipId)
    if (isValid) {
      const num = parseInt(localRelationshipId, 10)
      updateConfig("relationshipId", num)
    }
  })

  const handleAllowedHostInputChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      setLocalAllowedHostInput(evt.target.value)
    }
  )

  const handleAddAllowedHost = hooks.useEventCallback(() => {
    const sanitized = normalizeHostValue(localAllowedHostInput)
    if (!sanitized) {
      setLocalAllowedHostInput("")
      return
    }
    if (localAllowedHostsList.includes(sanitized)) {
      return
    }
    const nextHosts = [...localAllowedHostsList, sanitized]
    setLocalAllowedHostsList(nextHosts)
    updateConfig("allowedHosts", nextHosts)
    setLocalAllowedHostInput("")
  })

  const handleRemoveAllowedHost = hooks.useEventCallback((host: string) => {
    const sanitized = normalizeHostValue(host)
    const nextHosts = localAllowedHostsList.filter((h) => h !== sanitized)
    if (nextHosts.length === localAllowedHostsList.length) {
      return
    }
    setLocalAllowedHostsList(nextHosts)
    updateConfig("allowedHosts", nextHosts)
  })

  const handleAllowedHostInputKeyDown = hooks.useEventCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return
      }
      event.preventDefault()
      if (!canAddAllowedHost) {
        return
      }
      handleAddAllowedHost()
    }
  )

  const handleHighlightColorChange = hooks.useEventCallback((color: string) => {
    const nextColor = color || DEFAULT_HIGHLIGHT_COLOR
    setLocalHighlightColor(nextColor)
    updateConfig("highlightColor", nextColor)
  })

  const handleHighlightOpacityChange = useSliderConfigHandler(
    localHighlightOpacity,
    setLocalHighlightOpacity,
    updateConfig,
    "highlightOpacity",
    opacityHelpers.fromPercent
  )

  const handleOutlineWidthChange = useSliderConfigHandler(
    localOutlineWidth,
    setLocalOutlineWidth,
    updateConfig,
    "outlineWidth",
    outlineWidthHelpers.normalize
  )

  const handlePropertyDataSourceChange = hooks.useEventCallback(
    (useDataSources: UseDataSource[]) => {
      const selectedDs = useDataSources?.[0] ?? null
      const propertyId = selectedDs?.dataSourceId ?? ""
      const ownerSource =
        ((props.useDataSources as any)?.find?.(
          (ds: UseDataSource) => ds?.dataSourceId === config.ownerDataSourceId
        ) as ImmutableObject<UseDataSource> | UseDataSource | undefined) ?? null
      const ownerMutable = toMutableUseDataSource(ownerSource)
      const shouldSyncOwner =
        (!!propertyId && !config.ownerDataSourceId) ||
        (!!propertyId &&
          config.ownerDataSourceId &&
          config.ownerDataSourceId === config.propertyDataSourceId)

      const updatedUseDataSources: UseDataSource[] = []
      if (selectedDs) {
        updatedUseDataSources.push(selectedDs)
      }
      if (
        ownerMutable &&
        ownerMutable.dataSourceId &&
        ownerMutable.dataSourceId !== propertyId &&
        !shouldSyncOwner
      ) {
        updatedUseDataSources.push(ownerMutable)
      }

      const nextConfig = shouldSyncOwner
        ? config
            .set("propertyDataSourceId", propertyId)
            .set("ownerDataSourceId", propertyId)
        : config.set("propertyDataSourceId", propertyId)

      onSettingChange({
        id,
        useDataSources: updatedUseDataSources,
        config: nextConfig,
      })
    }
  )

  const handleOwnerDataSourceChange = hooks.useEventCallback(
    (useDataSources: UseDataSource[]) => {
      const selectedOwner = useDataSources?.[0] ?? null
      const ownerId = selectedOwner?.dataSourceId ?? ""

      const propertySource =
        ((props.useDataSources as any)?.find?.(
          (ds: UseDataSource) =>
            ds?.dataSourceId === config.propertyDataSourceId
        ) as ImmutableObject<UseDataSource> | UseDataSource | undefined) ?? null

      let propertyMutable = toMutableUseDataSource(propertySource)
      if (!propertyMutable && config.propertyDataSourceId) {
        propertyMutable = {
          dataSourceId: config.propertyDataSourceId,
          mainDataSourceId: config.propertyDataSourceId,
          rootDataSourceId: config.propertyDataSourceId,
        } as UseDataSource
      }

      const updatedUseDataSources: UseDataSource[] = []
      if (propertyMutable) {
        updatedUseDataSources.push(propertyMutable)
      }
      if (
        selectedOwner &&
        (!propertyMutable ||
          propertyMutable.dataSourceId !== selectedOwner.dataSourceId)
      ) {
        updatedUseDataSources.push(selectedOwner)
      }

      const nextConfig = config.set("ownerDataSourceId", ownerId)

      onSettingChange({
        id,
        useDataSources: updatedUseDataSources,
        config: nextConfig,
      })
    }
  )

  const handleMapWidgetChange = hooks.useEventCallback(
    (useMapWidgetIds: string[]) => {
      onSettingChange({
        id,
        useMapWidgetIds,
      })
    }
  )

  hooks.useUpdateEffect(() => {
    setLocalMaxResults(String(config.maxResults || 50))
  }, [config.maxResults])

  hooks.useUpdateEffect(() => {
    setLocalToggleRemoval(getBooleanConfig("enableToggleRemoval"))
  }, [config.enableToggleRemoval])

  hooks.useUpdateEffect(() => {
    setLocalPIIMasking(getBooleanConfig("enablePIIMasking"))
  }, [config.enablePIIMasking])

  hooks.useUpdateEffect(() => {
    setLocalBatchOwnerQuery(getBooleanConfig("enableBatchOwnerQuery", false))
  }, [config.enableBatchOwnerQuery])

  hooks.useUpdateEffect(() => {
    setLocalRelationshipId(String(config.relationshipId ?? 0))
  }, [config.relationshipId])

  hooks.useUpdateEffect(() => {
    const uniqueHosts = normalizeHostList(config.allowedHosts)
    setLocalAllowedHostsList(uniqueHosts)
  }, [config.allowedHosts])

  hooks.useUpdateEffect(() => {
    setLocalHighlightColor(config.highlightColor || DEFAULT_HIGHLIGHT_COLOR)
  }, [config.highlightColor])

  hooks.useUpdateEffect(() => {
    const baseValue =
      typeof config.highlightOpacity === "number"
        ? config.highlightOpacity
        : HIGHLIGHT_SYMBOL_ALPHA
    setLocalHighlightOpacity(
      opacityHelpers.fromPercent(opacityHelpers.toPercent(baseValue))
    )
  }, [config.highlightOpacity])

  hooks.useUpdateEffect(() => {
    const baseValue =
      typeof config.outlineWidth === "number"
        ? config.outlineWidth
        : OUTLINE_WIDTH
    setLocalOutlineWidth(outlineWidthHelpers.normalize(baseValue))
  }, [config.outlineWidth])

  hooks.useEffectOnce(() => {
    if (useMapWidgetIds && useMapWidgetIds.length > 0) {
      console.log("Property Widget: Map configured on mount", useMapWidgetIds)
    }
  })

  const hasMapSelection =
    Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0
  const hasPropertyDataSource = Boolean(config.propertyDataSourceId)
  const hasOwnerDataSource = Boolean(config.ownerDataSourceId)
  const hasRequiredDataSources = hasPropertyDataSource && hasOwnerDataSource
  const canShowDisplayOptions = hasMapSelection && hasRequiredDataSources
  const canShowRelationshipSettings = hasMapSelection && hasRequiredDataSources
  const shouldDisableRelationshipSettings = !canShowRelationshipSettings

  hooks.useEffectWithPreviousValues(() => {
    if (!shouldDisableRelationshipSettings) {
      return
    }

    if (localBatchOwnerQuery) {
      setLocalBatchOwnerQuery(false)
    }

    if (config.enableBatchOwnerQuery) {
      updateConfig("enableBatchOwnerQuery", false)
    }

    if (config.relationshipId !== undefined) {
      updateConfig("relationshipId", undefined)
    }

    if (localRelationshipId !== "0") {
      setLocalRelationshipId("0")
    }

    setFieldErrors((prev) => ({ ...prev, relationshipId: undefined }))
  }, [
    shouldDisableRelationshipSettings,
    localBatchOwnerQuery,
    config.enableBatchOwnerQuery,
    config.relationshipId,
    localRelationshipId,
    updateConfig,
  ])

  const highlightOpacityPercent = opacityHelpers.toPercent(
    localHighlightOpacity
  )
  const highlightOpacityLabel = opacityHelpers.formatPercent(
    highlightOpacityPercent
  )
  const outlineWidthValue = outlineWidthHelpers.normalize(localOutlineWidth)
  const outlineWidthLabel = outlineWidthHelpers.formatDisplay(localOutlineWidth)
  const sanitizedAllowedHostInput = normalizeHostValue(localAllowedHostInput)
  const canAddAllowedHost =
    sanitizedAllowedHostInput.length > 0 &&
    !localAllowedHostsList.includes(sanitizedAllowedHostInput)

  const propertySelectorValue = buildSelectorValue(config.propertyDataSourceId)
  const ownerSelectorValue = buildSelectorValue(config.ownerDataSourceId)

  return (
    <>
      <SettingSection>
        <SettingRow
          flow="wrap"
          level={1}
          css={styles.row}
          label={renderLabelWithTooltip(
            "mapWidgetTitle",
            "mapWidgetDescription"
          )}
        >
          <MapWidgetSelector
            onSelect={handleMapWidgetChange}
            useMapWidgetIds={useMapWidgetIds}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection>
        {hasMapSelection && (
          <>
            <SettingRow
              flow="wrap"
              level={1}
              css={styles.row}
              label={renderLabelWithTooltip(
                "propertyDataSourceLabel",
                "propertyDataSourceDescription"
              )}
            >
              <DataSourceSelector
                types={Immutable([DataSourceTypes.FeatureLayer])}
                useDataSources={propertySelectorValue}
                mustUseDataSource
                onChange={handlePropertyDataSourceChange}
                widgetId={id}
                hideTypeDropdown
              />
            </SettingRow>

            <SettingRow
              flow="wrap"
              level={1}
              css={styles.row}
              label={renderLabelWithTooltip(
                "ownerDataSourceLabel",
                "ownerDataSourceDescription"
              )}
            >
              <DataSourceSelector
                types={Immutable([DataSourceTypes.FeatureLayer])}
                useDataSources={ownerSelectorValue}
                mustUseDataSource
                onChange={handleOwnerDataSourceChange}
                widgetId={id}
                hideTypeDropdown
              />
            </SettingRow>

            {!hasRequiredDataSources && (
              <SettingRow flow="wrap" level={1} css={styles.row}>
                <Alert
                  css={styles.fullWidth}
                  type="warning"
                  text={translate("dataSourcesDescription")}
                  closable={false}
                />
              </SettingRow>
            )}
          </>
        )}
      </SettingSection>

      {canShowDisplayOptions && (
        <>
          <SettingSection>
            <CollapsablePanel
              label={translate("panelDisplaySettings")}
              type="default"
              level={1}
              role="group"
              aria-label={translate("panelDisplaySettings")}
            >
              <SettingRow
                flow="wrap"
                level={1}
                css={styles.row}
                label={renderLabelWithTooltip(
                  "maxResultsLabel",
                  "maxResultsDescription"
                )}
              >
                <NumericInput
                  css={styles.fullWidth}
                  value={parseInt(localMaxResults, 10)}
                  min={1}
                  max={1000}
                  onChange={handleMaxResultsChange}
                  onBlur={handleMaxResultsBlur}
                  aria-label={translate("maxResultsLabel")}
                  aria-invalid={!!fieldErrors.maxResults}
                />
              </SettingRow>
              {fieldErrors.maxResults && (
                <SettingRow flow="wrap" level={1} css={styles.row}>
                  <Alert
                    css={styles.fullWidth}
                    type="error"
                    text={fieldErrors.maxResults}
                    closable={false}
                  />
                </SettingRow>
              )}

              <SettingRow
                flow="no-wrap"
                level={1}
                css={styles.row}
                label={renderLabelWithTooltip(
                  "enableToggleRemovalLabel",
                  "enableToggleRemovalDescription"
                )}
              >
                <Switch
                  checked={localToggleRemoval}
                  onChange={handleToggleRemovalChange}
                  aria-label={translate("enableToggleRemovalLabel")}
                />
              </SettingRow>

              <SettingRow
                flow="no-wrap"
                level={1}
                css={styles.row}
                label={renderLabelWithTooltip(
                  "enablePIIMaskingLabel",
                  "enablePIIMaskingDescription"
                )}
              >
                <Switch
                  checked={localPIIMasking}
                  onChange={handlePIIMaskingChange}
                  aria-label={translate("enablePIIMaskingLabel")}
                />
              </SettingRow>

              <SettingRow
                flow="wrap"
                level={1}
                css={styles.row}
                label={renderLabelWithTooltip(
                  "allowedHostsLabel",
                  "allowedHostsDescription"
                )}
              >
                <div css={styles.allowedHostInputRow}>
                  <TextInput
                    css={styles.allowedHostInput}
                    value={localAllowedHostInput}
                    onChange={handleAllowedHostInputChange}
                    onKeyDown={handleAllowedHostInputKeyDown}
                    placeholder={translate("allowedHostsPlaceholder")}
                    aria-label={translate("allowedHostsLabel")}
                    spellCheck={false}
                  />
                  <Button
                    type="default"
                    icon
                    onClick={handleAddAllowedHost}
                    title={translate("addAllowedHostLabel")}
                    aria-label={translate("addAllowedHostLabel")}
                    disabled={!canAddAllowedHost}
                    css={styles.addAllowedHostButton}
                  >
                    <SVG src={addIcon} size={16} />
                  </Button>
                </div>
              </SettingRow>

              <SettingRow flow="wrap" level={1} css={styles.row}>
                <div css={styles.allowedHostList}>
                  {localAllowedHostsList.length > 0 ? (
                    localAllowedHostsList.map((host) => (
                      <div css={styles.allowedHostListRow} key={host}>
                        <TextInput
                          css={styles.allowedHostListInput}
                          value={host}
                          readOnly
                          borderless
                          disabled
                          spellCheck={false}
                          aria-label={`${translate("allowedHostsListLabel")}: ${host}`}
                        />
                        <Button
                          type="tertiary"
                          icon
                          onClick={() => handleRemoveAllowedHost(host)}
                          title={translate("removeAllowedHostLabel")}
                          aria-label={translate("removeAllowedHostLabel")}
                        >
                          <SVG src={removeIcon} size={16} />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div
                      css={styles.description}
                      role="status"
                      aria-live="polite"
                    >
                      {translate("allowedHostsEmptyHint")}
                    </div>
                  )}
                </div>
              </SettingRow>
            </CollapsablePanel>
          </SettingSection>
          <SettingSection>
            <CollapsablePanel
              label={translate("panelHighlightSettings")}
              type="default"
              level={1}
              role="group"
              aria-label={translate("panelHighlightSettings")}
            >
              <SettingRow
                flow="wrap"
                level={1}
                css={styles.row}
                label={renderLabelWithTooltip(
                  "highlightColorLabel",
                  "highlightColorLabelTooltip"
                )}
              >
                <ColorPicker
                  css={styles.fullWidth}
                  color={localHighlightColor}
                  onChange={handleHighlightColorChange}
                  aria-label={translate("highlightColorLabel")}
                />
              </SettingRow>

              <SettingRow
                flow="wrap"
                level={1}
                css={styles.row}
                label={renderLabelWithTooltip(
                  "highlightOpacityLabel",
                  "highlightOpacityLabelTooltip"
                )}
              >
                <div css={styles.sliderWrap}>
                  <div css={styles.sliderTrack}>
                    <Slider
                      value={highlightOpacityPercent}
                      min={0}
                      max={100}
                      step={5}
                      tooltip
                      formatter={opacityHelpers.formatPercent}
                      aria-label={translate("highlightOpacityLabel")}
                      onChange={handleHighlightOpacityChange}
                      css={styles.sliderControl}
                    />
                    <div
                      css={styles.sliderValue}
                      role="status"
                      aria-live="polite"
                    >
                      {highlightOpacityLabel}
                    </div>
                  </div>
                </div>
              </SettingRow>

              <SettingRow
                flow="wrap"
                level={1}
                css={styles.row}
                label={renderLabelWithTooltip(
                  "highlightOutlineWidthLabel",
                  "highlightOutlineWidthLabelTooltip"
                )}
              >
                <div css={styles.sliderWrap}>
                  <div css={styles.sliderTrack}>
                    <Slider
                      value={outlineWidthValue}
                      min={0.5}
                      max={10}
                      step={0.5}
                      tooltip
                      formatter={outlineWidthHelpers.formatDisplay}
                      aria-label={translate("highlightOutlineWidthLabel")}
                      onChange={handleOutlineWidthChange}
                      css={styles.sliderControl}
                    />
                    <div
                      css={styles.sliderValue}
                      role="status"
                      aria-live="polite"
                    >
                      {outlineWidthLabel}
                    </div>
                  </div>
                </div>
              </SettingRow>
            </CollapsablePanel>
          </SettingSection>
        </>
      )}

      {canShowRelationshipSettings && (
        <>
          <SettingSection>
            <CollapsablePanel
              label={translate("advancedSettingsTitle")}
              type="default"
              level={1}
              role="group"
              aria-label={translate("advancedSettingsTitle")}
            >
              <SettingRow
                flow="no-wrap"
                level={1}
                css={styles.row}
                label={renderLabelWithTooltip(
                  "enableBatchOwnerQueryLabel",
                  "enableBatchOwnerQueryDescription"
                )}
              >
                <Switch
                  checked={localBatchOwnerQuery}
                  onChange={handleBatchOwnerQueryChange}
                  aria-label={translate("enableBatchOwnerQueryLabel")}
                />
              </SettingRow>

              {localBatchOwnerQuery && (
                <>
                  <SettingRow
                    flow="wrap"
                    level={1}
                    css={styles.row}
                    label={renderLabelWithTooltip(
                      "relationshipIdLabel",
                      "relationshipIdDescription"
                    )}
                  >
                    <NumericInput
                      css={styles.fullWidth}
                      value={parseInt(localRelationshipId, 10)}
                      min={0}
                      max={99}
                      onChange={handleRelationshipIdChange}
                      onBlur={handleRelationshipIdBlur}
                      aria-label={translate("relationshipIdLabel")}
                      title={translate("relationshipIdTooltip")}
                      aria-invalid={!!fieldErrors.relationshipId}
                    />
                  </SettingRow>
                  {fieldErrors.relationshipId && (
                    <SettingRow flow="wrap" level={1} css={styles.row}>
                      <Alert
                        css={styles.fullWidth}
                        type="error"
                        text={fieldErrors.relationshipId}
                        closable={false}
                      />
                    </SettingRow>
                  )}
                </>
              )}
            </CollapsablePanel>
          </SettingSection>
        </>
      )}
    </>
  )
}

export default Setting
