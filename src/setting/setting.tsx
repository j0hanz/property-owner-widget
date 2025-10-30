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
} from "../shared/hooks"
import { stripHtml } from "../shared/utils"
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_SYMBOL_ALPHA,
  OUTLINE_WIDTH,
} from "../config/constants"
import addIcon from "../assets/plus.svg"
import removeIcon from "../assets/close.svg"

interface FieldErrors {
  [key: string]: string | undefined
}

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min
  }
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

const toOpacityPercent = (value: number): number =>
  Math.round(clampNumber(value, 0, 1) * 100)

const fromOpacityPercent = (percent: number): number =>
  clampNumber(percent, 0, 100) / 100

const formatOpacityPercent = (percent: number): string => {
  const normalized = clampNumber(Math.round(percent), 0, 100)
  return `${normalized}%`
}

const normalizeOutlineWidth = (value: number): number => {
  const clamped = clampNumber(value, 0.5, 10)
  return Math.round(clamped * 2) / 2
}

const formatOutlineWidthDisplay = (value: number): string => {
  const normalized = normalizeOutlineWidth(value)
  const rounded = Math.round(normalized)
  if (Math.abs(normalized - rounded) < 0.0001) {
    return String(rounded)
  }
  return normalized.toFixed(1)
}

const sanitizeHostValue = (value: string): string =>
  stripHtml(value || "").trim()

const Setting = (
  props: AllWidgetSettingProps<IMConfig>
): React.ReactElement => {
  const { config, id, onSettingChange, useMapWidgetIds } = props
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages)
  const styles = useSettingStyles()

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
    Array.from(
      new Set(
        (config.allowedHosts || [])
          .map((host) => sanitizeHostValue(host))
          .filter(Boolean)
      )
    )
  )
  const [localAutoZoom, setLocalAutoZoom] = React.useState(() =>
    getBooleanConfig("autoZoomOnSelection", false)
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
      return clampNumber(baseValue, 0, 1)
    }
  )
  const [localOutlineWidth, setLocalOutlineWidth] = React.useState(() => {
    const baseValue =
      typeof config.outlineWidth === "number"
        ? config.outlineWidth
        : OUTLINE_WIDTH
    return normalizeOutlineWidth(baseValue)
  })

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})

  const validateMaxResults = hooks.useEventCallback(
    (value: string): boolean => {
      const num = parseInt(value, 10)
      if (isNaN(num) || num < 1 || num > 1000) {
        setFieldErrors((prev) => ({
          ...prev,
          maxResults: translate("errorMaxResultsInvalid"),
        }))
        return false
      }
      setFieldErrors((prev) => ({ ...prev, maxResults: undefined }))
      return true
    }
  )

  const validateRelationshipId = hooks.useEventCallback(
    (value: string): boolean => {
      const num = parseInt(value, 10)
      if (isNaN(num) || num < 0 || num > 99) {
        setFieldErrors((prev) => ({
          ...prev,
          relationshipId: translate("errorRelationshipIdInvalid"),
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

  const handleToggleRemovalChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const checked = evt.target.checked
      setLocalToggleRemoval(checked)
      updateConfig("enableToggleRemoval", checked)
    }
  )

  const handlePIIMaskingChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const checked = evt.target.checked
      setLocalPIIMasking(checked)
      updateConfig("enablePIIMasking", checked)
    }
  )

  const handleBatchOwnerQueryChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const checked = evt.target.checked
      setLocalBatchOwnerQuery(checked)
      updateConfig("enableBatchOwnerQuery", checked)
    }
  )

  const handleRelationshipIdChange = hooks.useEventCallback((value: number) => {
    setLocalRelationshipId(String(value))
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
    const sanitized = sanitizeHostValue(localAllowedHostInput)
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
    const sanitized = sanitizeHostValue(host)
    const nextHosts = localAllowedHostsList.filter(
      (value) => value !== sanitized
    )
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

  const handleAutoZoomChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const checked = evt.target.checked
      setLocalAutoZoom(checked)
      updateConfig("autoZoomOnSelection", checked)
    }
  )

  const handleHighlightColorChange = hooks.useEventCallback((color: string) => {
    const nextColor = color || DEFAULT_HIGHLIGHT_COLOR
    setLocalHighlightColor(nextColor)
    updateConfig("highlightColor", nextColor)
  })

  const handleHighlightOpacityChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = Number.parseFloat(evt?.target?.value ?? "")
      if (!Number.isFinite(rawValue)) {
        return
      }
      const normalizedPercent = clampNumber(Math.round(rawValue), 0, 100)
      const nextOpacity = fromOpacityPercent(normalizedPercent)
      if (Math.abs(localHighlightOpacity - nextOpacity) < 0.0001) {
        return
      }
      setLocalHighlightOpacity(nextOpacity)
      updateConfig("highlightOpacity", nextOpacity)
    }
  )

  const handleOutlineWidthChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = Number.parseFloat(evt?.target?.value ?? "")
      if (!Number.isFinite(rawValue)) {
        return
      }
      const nextWidth = normalizeOutlineWidth(rawValue)
      if (Math.abs(localOutlineWidth - nextWidth) < 0.0001) {
        return
      }
      setLocalOutlineWidth(nextWidth)
      updateConfig("outlineWidth", nextWidth)
    }
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
    const normalizedHosts = (config.allowedHosts || [])
      .map((host) => sanitizeHostValue(host))
      .filter(Boolean)
    const uniqueHosts = Array.from(new Set(normalizedHosts))
    setLocalAllowedHostsList(uniqueHosts)
  }, [config.allowedHosts])

  hooks.useUpdateEffect(() => {
    setLocalAutoZoom(getBooleanConfig("autoZoomOnSelection", false))
  }, [config.autoZoomOnSelection])

  hooks.useUpdateEffect(() => {
    setLocalHighlightColor(config.highlightColor || DEFAULT_HIGHLIGHT_COLOR)
  }, [config.highlightColor])

  hooks.useUpdateEffect(() => {
    const baseValue =
      typeof config.highlightOpacity === "number"
        ? config.highlightOpacity
        : HIGHLIGHT_SYMBOL_ALPHA
    setLocalHighlightOpacity(clampNumber(baseValue, 0, 1))
  }, [config.highlightOpacity])

  hooks.useUpdateEffect(() => {
    const baseValue =
      typeof config.outlineWidth === "number"
        ? config.outlineWidth
        : OUTLINE_WIDTH
    setLocalOutlineWidth(normalizeOutlineWidth(baseValue))
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

  const highlightOpacityPercent = toOpacityPercent(localHighlightOpacity)
  const highlightOpacityLabel = formatOpacityPercent(highlightOpacityPercent)
  const outlineWidthValue = normalizeOutlineWidth(localOutlineWidth)
  const outlineWidthLabel = formatOutlineWidthDisplay(localOutlineWidth)
  const sanitizedAllowedHostInput = sanitizeHostValue(localAllowedHostInput)
  const canAddAllowedHost =
    sanitizedAllowedHostInput.length > 0 &&
    !localAllowedHostsList.includes(sanitizedAllowedHostInput)

  const propertySelectorValue = buildSelectorValue(config.propertyDataSourceId)
  const ownerSelectorValue = buildSelectorValue(config.ownerDataSourceId)

  return (
    <>
      <SettingSection title={translate("mapWidgetTitle")}>
        <SettingRow flow="wrap" level={2}>
          <MapWidgetSelector
            onSelect={handleMapWidgetChange}
            useMapWidgetIds={useMapWidgetIds}
          />
        </SettingRow>
        <div css={styles.description}>{translate("mapWidgetDescription")}</div>
      </SettingSection>

      {hasMapSelection && (
        <SettingSection title={translate("dataSourcesTitle")}>
          <SettingRow
            flow="wrap"
            level={2}
            label={translate("propertyDataSourceLabel")}
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

          <div css={styles.description}>
            {translate("propertyDataSourceDescription")}
          </div>

          <SettingRow
            flow="wrap"
            level={2}
            label={translate("ownerDataSourceLabel")}
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

          <div css={styles.description}>
            {translate("ownerDataSourceDescription")}
          </div>

          {hasRequiredDataSources ? (
            <div css={styles.description}>
              {translate("dataSourcesDescription")}
            </div>
          ) : (
            <SettingRow flow="wrap" level={2}>
              <Alert
                css={styles.fullWidth}
                type="warning"
                text={translate("dataSourcesDescription")}
                closable={false}
              />
            </SettingRow>
          )}
        </SettingSection>
      )}

      {canShowDisplayOptions && (
        <SettingSection title={translate("displayOptionsTitle")}>
          <CollapsablePanel
            label={translate("panelDisplaySettings")}
            type="default"
            level={1}
            role="group"
            aria-label={translate("panelDisplaySettings")}
          >
            <SettingRow
              flow="wrap"
              level={2}
              label={translate("maxResultsLabel")}
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
              <SettingRow flow="wrap" level={2}>
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
              level={2}
              label={translate("enableToggleRemovalLabel")}
            >
              <Switch
                css={styles.fullWidth}
                checked={localToggleRemoval}
                onChange={handleToggleRemovalChange}
                aria-label={translate("enableToggleRemovalLabel")}
              />
            </SettingRow>

            <SettingRow
              flow="no-wrap"
              level={2}
              label={translate("enablePIIMaskingLabel")}
            >
              <Switch
                css={styles.fullWidth}
                checked={localPIIMasking}
                onChange={handlePIIMaskingChange}
                aria-label={translate("enablePIIMaskingLabel")}
              />
            </SettingRow>

            <SettingRow
              flow="no-wrap"
              level={2}
              label={translate("autoZoomOnSelectionLabel")}
            >
              <Switch
                css={styles.fullWidth}
                checked={localAutoZoom}
                onChange={handleAutoZoomChange}
                aria-label={translate("autoZoomOnSelectionLabel")}
              />
            </SettingRow>
            <div css={styles.description}>
              {translate("autoZoomOnSelectionDescription")}
            </div>

            <div css={styles.description}>
              {translate("allowedHostsDescription")}
            </div>

            <SettingRow
              flow="wrap"
              level={2}
              label={translate("allowedHostsLabel")}
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
                  type="tertiary"
                  icon
                  onClick={handleAddAllowedHost}
                  title={translate("addAllowedHostLabel")}
                  aria-label={translate("addAllowedHostLabel")}
                  disabled={!canAddAllowedHost}
                >
                  <SVG src={addIcon} size={16} />
                </Button>
              </div>
            </SettingRow>

            <SettingRow
              flow="wrap"
              level={2}
              label={translate("allowedHostsListLabel")}
            >
              <div css={styles.allowedHostList}>
                {localAllowedHostsList.length > 0 ? (
                  localAllowedHostsList.map((host) => (
                    <div css={styles.allowedHostListRow} key={host}>
                      <TextInput
                        css={styles.allowedHostListInput}
                        value={host}
                        readOnly
                        borderless
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

          <CollapsablePanel
            label={translate("panelHighlightSettings")}
            type="default"
            level={1}
            role="group"
            aria-label={translate("panelHighlightSettings")}
          >
            <div css={styles.description}>
              {translate("highlightOptionsDescription")}
            </div>

            <SettingRow
              flow="wrap"
              level={2}
              label={translate("highlightColorLabel")}
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
              level={2}
              label={translate("highlightOpacityLabel")}
            >
              <div css={styles.sliderWrap}>
                <div css={styles.sliderTrack}>
                  <Slider
                    value={highlightOpacityPercent}
                    min={0}
                    max={100}
                    step={5}
                    tooltip
                    formatter={formatOpacityPercent}
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
              level={2}
              label={translate("highlightOutlineWidthLabel")}
            >
              <div css={styles.sliderWrap}>
                <div css={styles.sliderTrack}>
                  <Slider
                    value={outlineWidthValue}
                    min={0.5}
                    max={10}
                    step={0.5}
                    tooltip
                    formatter={formatOutlineWidthDisplay}
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
      )}

      {canShowRelationshipSettings && (
        <SettingSection title={translate("relationshipTitle")}>
          <SettingRow
            flow="no-wrap"
            level={2}
            label={translate("enableBatchOwnerQueryLabel")}
          >
            <Switch
              css={styles.fullWidth}
              checked={localBatchOwnerQuery}
              onChange={handleBatchOwnerQueryChange}
              aria-label={translate("enableBatchOwnerQueryLabel")}
            />
          </SettingRow>
          <div css={styles.description}>
            {translate("enableBatchOwnerQueryDescription")}
          </div>

          {localBatchOwnerQuery && (
            <>
              <SettingRow
                flow="wrap"
                level={2}
                label={translate("relationshipIdLabel")}
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
                <SettingRow flow="wrap" level={2}>
                  <Alert
                    css={styles.fullWidth}
                    type="error"
                    text={fieldErrors.relationshipId}
                    closable={false}
                  />
                </SettingRow>
              )}
              <div css={styles.description}>
                {translate("relationshipIdDescription")}
              </div>
            </>
          )}
        </SettingSection>
      )}
    </>
  )
}

export default Setting
