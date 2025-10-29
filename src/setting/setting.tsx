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
import { SettingSection, SettingRow } from "jimu-ui/advanced/setting-components"
import { DataSourceSelector } from "jimu-ui/advanced/data-source-selector"
import { NumericInput, Switch, TextArea } from "jimu-ui"
import type { IMConfig } from "../config/types"
import { useSettingStyles } from "../config/style"

const Setting = (
  props: AllWidgetSettingProps<IMConfig>
): React.ReactElement => {
  const { config, id, onSettingChange, useDataSources } = props
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

  const handleDataSourceChange = hooks.useEventCallback(
    (useDataSources: UseDataSource[]) => {
      if (!useDataSources || useDataSources.length < 2) {
        console.log("Both property and owner data sources are required")
        return
      }

      const propertyDs = useDataSources[0]
      const ownerDs = useDataSources[1]

      if (!propertyDs?.dataSourceId || !ownerDs?.dataSourceId) {
        console.log("Invalid data source selection - both must have IDs")
        return
      }

      onSettingChange({
        id,
        useDataSources,
        config: config
          .set("propertyDataSourceId", propertyDs?.dataSourceId)
          .set("ownerDataSourceId", ownerDs?.dataSourceId),
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

  return (
    <>
      <SettingSection title={translate("dataSourcesTitle")}>
        <SettingRow flow="wrap" level={2}>
          <DataSourceSelector
            types={Immutable([DataSourceTypes.FeatureLayer])}
            useDataSources={useDataSources}
            mustUseDataSource
            onChange={handleDataSourceChange}
            widgetId={id}
            isMultiple
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
    </>
  )
}

export default Setting
