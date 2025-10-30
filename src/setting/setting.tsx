/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  React,
  hooks,
  jsx,
  type UseDataSource,
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

interface FieldErrors {
  [key: string]: string | undefined
}

const Setting = (
  props: AllWidgetSettingProps<IMConfig>
): React.ReactElement => {
  const { config, id, onSettingChange, useMapWidgetIds } = props
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages)
  const styles = useSettingStyles()

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

  const handleDataSourceChange = hooks.useEventCallback(
    (useDataSources: UseDataSource[]) => {
      const selectedDs = useDataSources?.[0]
      if (!selectedDs?.dataSourceId) {
        return
      }

      onSettingChange({
        id,
        useDataSources: [selectedDs],
        config: config
          .set("propertyDataSourceId", selectedDs.dataSourceId)
          .set("ownerDataSourceId", selectedDs.dataSourceId),
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

  hooks.useEffectOnce(() => {
    if (useMapWidgetIds && useMapWidgetIds.length > 0) {
      console.log("Property Widget: Map configured on mount", useMapWidgetIds)
    }
  })

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
        <SettingRow flow="wrap" level={2} label={translate("dataSourceLabel")}>
          <DataSourceSelector
            types={Immutable([DataSourceTypes.FeatureLayer])}
            useDataSources={
              config.propertyDataSourceId && props.useDataSources
                ? Immutable(
                    props.useDataSources.filter(
                      (ds) => ds.dataSourceId === config.propertyDataSourceId
                    )
                  )
                : Immutable([])
            }
            mustUseDataSource
            onChange={handleDataSourceChange}
            widgetId={id}
            hideTypeDropdown
          />
        </SettingRow>

        <div css={styles.description}>
          {translate("dataSourcesDescription")}
        </div>
      </SettingSection>

      <SettingSection title={translate("displayOptionsTitle")}>
        <SettingRow flow="wrap" level={2} label={translate("maxResultsLabel")}>
          <NumericInput
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
            checked={localPIIMasking}
            onChange={handlePIIMaskingChange}
            aria-label={translate("enablePIIMaskingLabel")}
          />
        </SettingRow>

        <SettingRow
          flow="wrap"
          level={2}
          label={translate("allowedHostsLabel")}
        >
          <TextArea
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
