/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  DataSourceTypes,
  hooks,
  jsx,
  React,
  ReactRedux,
  type UseDataSource,
} from "jimu-core";
import { DataSourceSelector } from "jimu-ui/advanced/data-source-selector";
import {
  MapWidgetSelector,
  SettingRow,
  SettingSection,
} from "jimu-ui/advanced/setting-components";
import { ColorPicker } from "jimu-ui/basic/color-picker";
import {
  Alert,
  Button,
  CollapsablePanel,
  defaultMessages as jimuUIMessages,
  NumericInput,
  Select,
  Slider,
  SVG,
  Switch,
  TextInput,
  Tooltip,
} from "jimu-ui";
import type { AllWidgetSettingProps } from "jimu-for-builder";
import Immutable from "seamless-immutable";
import { CURSOR_STYLES, DEFAULT_ACTIVE_CURSOR } from "../config/constants";
import { useSettingStyles } from "../config/style";
import type { FieldErrors, IMConfig } from "../config/types";
import { createPropertySelectors } from "../extensions/store";
import {
  useBooleanConfigValue,
  useNumericValidator,
  useSliderConfigHandler,
  useSwitchConfigHandler,
  useUpdateConfig,
  useValidatedNumericHandler,
} from "../shared/hooks";
import {
  computeSettingsVisibility,
  dataSourceHelpers,
  normalizeHostList,
  normalizeHostValue,
  opacityHelpers,
  outlineWidthHelpers,
  resetDependentFields,
} from "../shared/utils/index";
import defaultMessages from "./translations/default";
import removeIcon from "../assets/close.svg";
import infoIcon from "../assets/info.svg";
import addIcon from "../assets/plus.svg";

const Setting = (
  props: AllWidgetSettingProps<IMConfig>
): React.ReactElement => {
  const { config, id, onSettingChange, useMapWidgetIds } = props;
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages);
  const styles = useSettingStyles();

  // Redux integration for runtime state visibility
  const selectorsRef = React.useRef(createPropertySelectors(id));
  const selectors = selectorsRef.current;
  const selectedProperties = ReactRedux.useSelector(
    selectors.selectSelectedProperties
  );
  const isQueryInFlight = ReactRedux.useSelector(
    selectors.selectIsQueryInFlight
  );
  const hasError = ReactRedux.useSelector(selectors.selectError) !== null;
  const selectedCount = Array.isArray(selectedProperties)
    ? selectedProperties.length
    : 0;

  const renderLabelWithTooltip = (
    labelKey: string,
    descriptionKey: string
  ): React.ReactNode => {
    const labelText = translate(labelKey);
    const descriptionText = translate(descriptionKey);

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
    );
  };

  const propertyUseDataSource = dataSourceHelpers.findById(
    props.useDataSources,
    config.propertyDataSourceId
  );
  const propertySelectorValue = propertyUseDataSource
    ? Immutable([propertyUseDataSource])
    : Immutable([]);

  const ownerUseDataSource = dataSourceHelpers.findById(
    props.useDataSources,
    config.ownerDataSourceId
  );
  const ownerSelectorValue = ownerUseDataSource
    ? Immutable([ownerUseDataSource])
    : Immutable([]);

  const getBooleanConfig = useBooleanConfigValue(config);
  const updateConfig = useUpdateConfig(id, config, onSettingChange);

  const [localMaxResults, setLocalMaxResults] = React.useState<string>(() =>
    String(config.maxResults || 50)
  );
  const [localToggleRemoval, setLocalToggleRemoval] = React.useState(() =>
    getBooleanConfig("enableToggleRemoval")
  );
  const [localPIIMasking, setLocalPIIMasking] = React.useState(() =>
    getBooleanConfig("enablePIIMasking")
  );
  const [localBatchOwnerQuery, setLocalBatchOwnerQuery] = React.useState(() =>
    getBooleanConfig("enableBatchOwnerQuery", false)
  );
  const [localRelationshipId, setLocalRelationshipId] = React.useState<string>(
    () => String(config.relationshipId ?? 0)
  );
  const [localAllowedHostInput, setLocalAllowedHostInput] = React.useState("");
  const [localAllowedHostsList, setLocalAllowedHostsList] = React.useState(() =>
    normalizeHostList(config.allowedHosts)
  );
  const [localHighlightColor, setLocalHighlightColor] = React.useState(
    config.highlightColor
  );
  const [localActiveCursor, setLocalActiveCursor] = React.useState(
    config.activeCursor || DEFAULT_ACTIVE_CURSOR
  );
  const [localHighlightOpacity, setLocalHighlightOpacity] = React.useState(
    () => {
      const baseValue =
        typeof config.highlightOpacity === "number"
          ? config.highlightOpacity
          : 0.4;
      return opacityHelpers.fromPercent(opacityHelpers.toPercent(baseValue));
    }
  );
  const [localOutlineWidth, setLocalOutlineWidth] = React.useState(() => {
    const value = config.outlineWidth;
    return typeof value === "number" && Number.isFinite(value) ? value : 1;
  });
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  const validateMaxResults = useNumericValidator(
    "maxResults",
    1,
    1000,
    translate("errorMaxResultsInvalid"),
    setFieldErrors
  );

  const validateRelationshipId = useNumericValidator(
    "relationshipId",
    0,
    99,
    translate("errorRelationshipIdInvalid"),
    setFieldErrors
  );

  const {
    handleChange: handleMaxResultsChange,
    handleBlur: handleMaxResultsBlur,
  } = useValidatedNumericHandler({
    localValue: localMaxResults,
    setLocalValue: setLocalMaxResults,
    validate: validateMaxResults,
    updateConfig,
    configField: "maxResults",
    debounce: 500,
  });

  const {
    handleChange: handleRelationshipIdChange,
    handleBlur: handleRelationshipIdBlur,
  } = useValidatedNumericHandler({
    localValue: localRelationshipId,
    setLocalValue: setLocalRelationshipId,
    validate: validateRelationshipId,
    updateConfig,
    configField: "relationshipId",
    clamp: { min: 0, max: 99 },
  });

  const handleToggleRemovalChange = useSwitchConfigHandler(
    localToggleRemoval,
    setLocalToggleRemoval,
    updateConfig,
    "enableToggleRemoval"
  );

  const handlePIIMaskingChange = useSwitchConfigHandler(
    localPIIMasking,
    setLocalPIIMasking,
    updateConfig,
    "enablePIIMasking"
  );

  const handleBatchOwnerQueryChange = useSwitchConfigHandler(
    localBatchOwnerQuery,
    setLocalBatchOwnerQuery,
    updateConfig,
    "enableBatchOwnerQuery"
  );

  const handleAllowedHostInputChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      setLocalAllowedHostInput(evt.target.value);
    }
  );

  const handleAddAllowedHost = hooks.useEventCallback(() => {
    const sanitized = normalizeHostValue(localAllowedHostInput);
    if (!sanitized) {
      setLocalAllowedHostInput("");
      return;
    }
    if (localAllowedHostsList.includes(sanitized)) {
      return;
    }
    const nextHosts = [...localAllowedHostsList, sanitized];
    setLocalAllowedHostsList(nextHosts);
    updateConfig("allowedHosts", nextHosts);
    setLocalAllowedHostInput("");
  });

  const handleRemoveAllowedHost = hooks.useEventCallback((host: string) => {
    const sanitized = normalizeHostValue(host);
    const nextHosts = localAllowedHostsList.filter((h) => h !== sanitized);
    if (nextHosts.length === localAllowedHostsList.length) {
      return;
    }
    setLocalAllowedHostsList(nextHosts);
    updateConfig("allowedHosts", nextHosts);
  });

  const handleAllowedHostInputKeyDown = hooks.useEventCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      if (!canAddAllowedHost) {
        return;
      }
      handleAddAllowedHost();
    }
  );

  const handleHighlightColorChange = hooks.useEventCallback((color: string) => {
    const nextColor = color || config.highlightColor;
    setLocalHighlightColor(nextColor);
    updateConfig("highlightColor", nextColor);
  });

  const handleActiveCursorChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLSelectElement>) => {
      const nextCursor = evt.target.value || DEFAULT_ACTIVE_CURSOR;
      setLocalActiveCursor(nextCursor);
      updateConfig("activeCursor", nextCursor);
    }
  );

  const handleHighlightOpacityChange = useSliderConfigHandler(
    localHighlightOpacity,
    setLocalHighlightOpacity,
    updateConfig,
    "highlightOpacity",
    opacityHelpers.fromPercent
  );

  const handleOutlineWidthChange = useSliderConfigHandler(
    localOutlineWidth,
    setLocalOutlineWidth,
    updateConfig,
    "outlineWidth",
    outlineWidthHelpers.normalize
  );

  const handlePropertyDataSourceChange = hooks.useEventCallback(
    (useDataSources: UseDataSource[]) => {
      const selectedDs = useDataSources?.[0] ?? null;
      updateConfig("propertyDataSourceId", selectedDs?.dataSourceId ?? "");
    }
  );

  const handleOwnerDataSourceChange = hooks.useEventCallback(
    (useDataSources: UseDataSource[]) => {
      const selectedOwner = useDataSources?.[0] ?? null;
      updateConfig("ownerDataSourceId", selectedOwner?.dataSourceId ?? "");
    }
  );

  const handleMapWidgetChange = hooks.useEventCallback(
    (useMapWidgetIds: string[]) => {
      onSettingChange({
        id,
        useMapWidgetIds,
      });
    }
  );

  hooks.useUpdateEffect(() => {
    setLocalMaxResults(String(config.maxResults || 50));
  }, [config.maxResults]);

  hooks.useUpdateEffect(() => {
    setLocalToggleRemoval(getBooleanConfig("enableToggleRemoval"));
  }, [config.enableToggleRemoval]);

  hooks.useUpdateEffect(() => {
    setLocalPIIMasking(getBooleanConfig("enablePIIMasking"));
  }, [config.enablePIIMasking]);

  hooks.useUpdateEffect(() => {
    setLocalBatchOwnerQuery(getBooleanConfig("enableBatchOwnerQuery", false));
  }, [config.enableBatchOwnerQuery]);

  hooks.useUpdateEffect(() => {
    setLocalRelationshipId(String(config.relationshipId ?? 0));
  }, [config.relationshipId]);

  hooks.useUpdateEffect(() => {
    const uniqueHosts = normalizeHostList(config.allowedHosts);
    setLocalAllowedHostsList(uniqueHosts);
  }, [config.allowedHosts]);

  hooks.useUpdateEffect(() => {
    setLocalHighlightColor(config.highlightColor);
  }, [config.highlightColor]);

  hooks.useUpdateEffect(() => {
    const baseValue =
      typeof config.highlightOpacity === "number"
        ? config.highlightOpacity
        : 0.4;
    setLocalHighlightOpacity(
      opacityHelpers.fromPercent(opacityHelpers.toPercent(baseValue))
    );
  }, [config.highlightOpacity]);

  hooks.useUpdateEffect(() => {
    const baseValue =
      typeof config.outlineWidth === "number" ? config.outlineWidth : 1;
    setLocalOutlineWidth(outlineWidthHelpers.normalize(baseValue));
  }, [config.outlineWidth]);

  hooks.useEffectOnce(() => {
    // Settings panel mounted
  });

  const visibility = computeSettingsVisibility({
    useMapWidgetIds,
    config,
  });
  const {
    hasMapSelection,
    hasRequiredDataSources,
    canShowDisplayOptions,
    canShowRelationshipSettings,
    shouldDisableRelationshipSettings,
  } = visibility;

  hooks.useEffectWithPreviousValues(() => {
    resetDependentFields({
      shouldDisable: shouldDisableRelationshipSettings,
      localBatchOwnerQuery,
      setLocalBatchOwnerQuery,
      isBatchOwnerQueryEnabled: Boolean(config.enableBatchOwnerQuery),
      updateBatchOwnerQuery: (value) =>
        updateConfig("enableBatchOwnerQuery", value),
      relationshipId: config.relationshipId,
      updateRelationshipId: (value) => updateConfig("relationshipId", value),
      localRelationshipId,
      setLocalRelationshipId,
      clearRelationshipError: () => {
        setFieldErrors((prev) => ({ ...prev, relationshipId: undefined }));
      },
    });
  }, [
    shouldDisableRelationshipSettings,
    localBatchOwnerQuery,
    config.enableBatchOwnerQuery,
    config.relationshipId,
    localRelationshipId,
    updateConfig,
  ]);

  const highlightOpacityPercent = opacityHelpers.toPercent(
    localHighlightOpacity
  );
  const highlightOpacityLabel = opacityHelpers.formatPercent(
    highlightOpacityPercent
  );
  const outlineWidthValue = outlineWidthHelpers.normalize(localOutlineWidth);
  const outlineWidthLabel =
    outlineWidthHelpers.formatDisplay(localOutlineWidth);
  const sanitizedAllowedHostInput = normalizeHostValue(localAllowedHostInput);
  const canAddAllowedHost =
    sanitizedAllowedHostInput.length > 0 &&
    !localAllowedHostsList.includes(sanitizedAllowedHostInput);

  return (
    <>
      {(selectedCount > 0 || isQueryInFlight || hasError) && (
        <SettingSection>
          <SettingRow flow="wrap" level={1} css={styles.row}>
            <Alert
              fullWidth
              css={styles.fullWidth}
              type={isQueryInFlight ? "info" : hasError ? "warning" : "success"}
              text={
                isQueryInFlight
                  ? translate("runtimeStateQuerying")
                  : hasError
                    ? translate("runtimeStateError")
                    : translate("runtimeStateSelected").replace(
                        "{count}",
                        String(selectedCount)
                      )
              }
              closable={false}
            />
          </SettingRow>
        </SettingSection>
      )}
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
                  fullWidth
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
                    fullWidth
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
                          aria-label={`${translate(
                            "allowedHostsListLabel"
                          )}: ${host}`}
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

              <SettingRow
                flow="wrap"
                level={1}
                css={styles.row}
                label={renderLabelWithTooltip(
                  "cursorStyleLabel",
                  "cursorStyleTooltip"
                )}
              >
                <Select
                  value={localActiveCursor}
                  onChange={handleActiveCursorChange}
                  aria-label={translate("cursorStyleLabel")}
                  css={styles.fullWidth}
                >
                  {CURSOR_STYLES.map((cursor) => (
                    <option key={cursor} value={cursor}>
                      {cursor}
                    </option>
                  ))}
                </Select>
                <div css={styles.description} role="note">
                  {translate("cursorStyleDescription")}
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
                        fullWidth
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
  );
};

export default Setting;
