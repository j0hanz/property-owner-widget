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
  NumericInput,
  Switch,
  TextArea,
  Alert,
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
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_SYMBOL_ALPHA,
  OUTLINE_WIDTH,
} from "../config/constants"

interface FieldErrors {
  [key: string]: string | undefined
}

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
  const [localAllowedHosts, setLocalAllowedHosts] = React.useState(() =>
    (config.allowedHosts || []).join("\n")
  )
  const [localAutoZoom, setLocalAutoZoom] = React.useState(() =>
    getBooleanConfig("autoZoomOnSelection", false)
  )
  const [localHighlightColor, setLocalHighlightColor] = React.useState(
    config.highlightColor || DEFAULT_HIGHLIGHT_COLOR
  )
  const [localHighlightOpacity, setLocalHighlightOpacity] = React.useState(
    typeof config.highlightOpacity === "number"
      ? config.highlightOpacity
      : HIGHLIGHT_SYMBOL_ALPHA
  )
  const [localOutlineWidth, setLocalOutlineWidth] = React.useState(
    typeof config.outlineWidth === "number"
      ? config.outlineWidth
      : OUTLINE_WIDTH
  )

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

  const handleAllowedHostsChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalAllowedHosts(evt.target.value)
    }
  )

  const handleAllowedHostsBlur = hooks.useEventCallback(() => {
    const hosts = localAllowedHosts
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean)
    updateConfig("allowedHosts", hosts)
  })

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
    (value: number) => {
      const nextValue = Number.isFinite(value) ? value : HIGHLIGHT_SYMBOL_ALPHA
      const clamped = Math.min(Math.max(nextValue, 0), 1)
      setLocalHighlightOpacity(clamped)
      updateConfig("highlightOpacity", clamped)
    }
  )

  const handleOutlineWidthChange = hooks.useEventCallback((value: number) => {
    const nextValue = Number.isFinite(value) ? value : OUTLINE_WIDTH
    const clamped = Math.min(Math.max(nextValue, 0.5), 10)
    setLocalOutlineWidth(clamped)
    updateConfig("outlineWidth", clamped)
  })

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
    setLocalAllowedHosts((config.allowedHosts || []).join("\n"))
  }, [config.allowedHosts])

  hooks.useUpdateEffect(() => {
    setLocalAutoZoom(getBooleanConfig("autoZoomOnSelection", false))
  }, [config.autoZoomOnSelection])

  hooks.useUpdateEffect(() => {
    setLocalHighlightColor(config.highlightColor || DEFAULT_HIGHLIGHT_COLOR)
  }, [config.highlightColor])

  hooks.useUpdateEffect(() => {
    setLocalHighlightOpacity(
      typeof config.highlightOpacity === "number"
        ? config.highlightOpacity
        : HIGHLIGHT_SYMBOL_ALPHA
    )
  }, [config.highlightOpacity])

  hooks.useUpdateEffect(() => {
    setLocalOutlineWidth(
      typeof config.outlineWidth === "number"
        ? config.outlineWidth
        : OUTLINE_WIDTH
    )
  }, [config.outlineWidth])

  hooks.useEffectOnce(() => {
    if (useMapWidgetIds && useMapWidgetIds.length > 0) {
      console.log("Property Widget: Map configured on mount", useMapWidgetIds)
    }
  })

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

        <div css={styles.description}>
          {translate("dataSourcesDescription")}
        </div>
      </SettingSection>

      <SettingSection title={translate("displayOptionsTitle")}>
        <SettingRow flow="wrap" level={2} label={translate("maxResultsLabel")}>
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
          <NumericInput
            css={styles.fullWidth}
            value={localHighlightOpacity}
            min={0}
            max={1}
            step={0.05}
            onChange={handleHighlightOpacityChange}
            aria-label={translate("highlightOpacityLabel")}
          />
        </SettingRow>

        <SettingRow
          flow="wrap"
          level={2}
          label={translate("highlightOutlineWidthLabel")}
        >
          <NumericInput
            css={styles.fullWidth}
            value={localOutlineWidth}
            min={0.5}
            max={10}
            step={0.5}
            onChange={handleOutlineWidthChange}
            aria-label={translate("highlightOutlineWidthLabel")}
          />
        </SettingRow>

        <SettingRow
          flow="wrap"
          level={2}
          label={translate("allowedHostsLabel")}
        >
          <TextArea
            css={styles.fullWidth}
            value={localAllowedHosts}
            onChange={handleAllowedHostsChange}
            onBlur={handleAllowedHostsBlur}
            placeholder={translate("allowedHostsPlaceholder")}
            aria-label={translate("allowedHostsLabel")}
          />
        </SettingRow>
      </SettingSection>

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
    </>
  )
}

export default Setting
