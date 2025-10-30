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
import type { AllWidgetSettingProps } from "jimu-for-builder"
import {
  SettingSection,
  SettingRow,
  MapWidgetSelector,
} from "jimu-ui/advanced/setting-components"
import { DataSourceSelector } from "jimu-ui/advanced/data-source-selector"
import { NumericInput, Switch, TextArea } from "jimu-ui"
import type { IMConfig } from "../config/types"
import { useSettingStyles } from "../config/style"

const Setting = (
  props: AllWidgetSettingProps<IMConfig>
): React.ReactElement => {
  const { config, id, onSettingChange } = props
  const translate = hooks.useTranslation()
  const styles = useSettingStyles()

  const updateConfigField = hooks.useEventCallback(
    <K extends keyof IMConfig>(field: K, value: IMConfig[K]) => {
      onSettingChange({
        id,
        config: config.set(field, value),
      })
    }
  )

  const handlePropertyDataSourceChange = hooks.useEventCallback(
    (useDataSources: UseDataSource[]) => {
      const propertyDs = useDataSources?.[0]
      if (!propertyDs?.dataSourceId) {
        return
      }

      const existingOwnerDs = props.useDataSources?.find(
        (ds) => ds.dataSourceId === config.ownerDataSourceId
      )

      const newUseDataSources = existingOwnerDs
        ? [propertyDs, existingOwnerDs]
        : [propertyDs]

      onSettingChange({
        id,
        useDataSources: newUseDataSources,
        config: config.set("propertyDataSourceId", propertyDs.dataSourceId),
      })
    }
  )

  const handleOwnerDataSourceChange = hooks.useEventCallback(
    (useDataSources: UseDataSource[]) => {
      const ownerDs = useDataSources?.[0]
      if (!ownerDs?.dataSourceId) {
        return
      }

      const existingPropertyDs = props.useDataSources?.find(
        (ds) => ds.dataSourceId === config.propertyDataSourceId
      )

      const newUseDataSources = existingPropertyDs
        ? [existingPropertyDs, ownerDs]
        : [ownerDs]

      onSettingChange({
        id,
        useDataSources: newUseDataSources,
        config: config.set("ownerDataSourceId", ownerDs.dataSourceId),
      })
    }
  )

  const handleMaxResultsChange = hooks.useEventCallback((value: number) => {
    const validValue = Math.max(1, Math.min(1000, Math.floor(value)))
    updateConfigField("maxResults", validValue)
  })

  const handleToggleRemovalChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      updateConfigField("enableToggleRemoval", evt.target.checked)
    }
  )

  const handlePIIMaskingChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      updateConfigField("enablePIIMasking", evt.target.checked)
    }
  )

  const handleAllowedHostsChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLTextAreaElement>) => {
      const hosts = evt.target.value
        .split("\n")
        .map((h) => h.trim())
        .filter(Boolean)
      updateConfigField("allowedHosts", hosts)
    }
  )

  const handleBatchOwnerQueryChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      updateConfigField("enableBatchOwnerQuery", evt.target.checked)
    }
  )

  const handleRelationshipIdChange = hooks.useEventCallback((value: number) => {
    const validValue = Math.max(0, Math.floor(value))
    updateConfigField("relationshipId", validValue)
  })

  const handleMapWidgetChange = hooks.useEventCallback(
    (useMapWidgetIds: string[]) => {
      onSettingChange({
        id,
        useMapWidgetIds,
      })
    }
  )

  return (
    <>
      <SettingSection title={translate("mapWidgetTitle")}>
        <SettingRow flow="wrap" level={2}>
          <MapWidgetSelector
            onSelect={handleMapWidgetChange}
            useMapWidgetIds={props.useMapWidgetIds}
          />
        </SettingRow>
        <div css={styles.description}>{translate("mapWidgetDescription")}</div>
      </SettingSection>

      <SettingSection title={translate("dataSourcesTitle")}>
        <SettingRow
          flow="wrap"
          level={2}
          label={translate("propertyLayerLabel")}
        >
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
            onChange={handlePropertyDataSourceChange}
            widgetId={id}
            hideTypeDropdown
          />
        </SettingRow>

        <SettingRow flow="wrap" level={2} label={translate("ownerLayerLabel")}>
          <DataSourceSelector
            types={Immutable([DataSourceTypes.FeatureLayer])}
            useDataSources={
              config.ownerDataSourceId && props.useDataSources
                ? Immutable(
                    props.useDataSources.filter(
                      (ds) => ds.dataSourceId === config.ownerDataSourceId
                    )
                  )
                : Immutable([])
            }
            mustUseDataSource
            onChange={handleOwnerDataSourceChange}
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
            value={config.maxResults}
            min={1}
            max={1000}
            onChange={handleMaxResultsChange}
            aria-label={translate("maxResultsLabel")}
          />
        </SettingRow>

        <SettingRow
          flow="no-wrap"
          level={2}
          label={translate("enableToggleRemovalLabel")}
        >
          <Switch
            checked={config.enableToggleRemoval}
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
            checked={config.enablePIIMasking}
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
            value={(config.allowedHosts || []).join("\n")}
            onChange={handleAllowedHostsChange}
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
            checked={config.enableBatchOwnerQuery ?? false}
            onChange={handleBatchOwnerQueryChange}
            aria-label={translate("enableBatchOwnerQueryLabel")}
          />
        </SettingRow>
        <div css={styles.description}>
          {translate("enableBatchOwnerQueryDescription")}
        </div>

        {config.enableBatchOwnerQuery && (
          <>
            <SettingRow
              flow="wrap"
              level={2}
              label={translate("relationshipIdLabel")}
            >
              <NumericInput
                value={config.relationshipId ?? 0}
                min={0}
                max={99}
                onChange={handleRelationshipIdChange}
                aria-label={translate("relationshipIdLabel")}
                title={translate("relationshipIdTooltip")}
              />
            </SettingRow>
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
