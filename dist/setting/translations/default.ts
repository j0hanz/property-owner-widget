export default {
  configurationInstructions:
    "Configure the widget by providing layer URLs and display preferences.",
  mapWidgetTitle: "Map connection",
  mapWidgetDescription: "Link the map widget that triggers parcel lookups.",
  dataSourcesDescription:
    "Ensure property and owner layers share matching FNR fields.",
  propertyDataSourceLabel: "Property layer",
  propertyDataSourceDescription:
    "Parcel layer containing geometry and FNR values.",
  ownerDataSourceLabel: "Owner layer",
  ownerDataSourceDescription:
    "Owner layer or table with NAMN and BOSTADR details.",
  displayOptionsTitle: "Display options",
  panelDisplaySettings: "Display behavior",
  advancedSettingsTitle: "Advanced settings",
  panelHighlightSettings: "Highlight styling",
  highlightColorLabelTooltip: "Set highlight color for parcels.",
  highlightOpacityLabelTooltip: "Set fill opacity for highlighted parcels.",
  maxResultsLabel: "Maximum results",
  maxResultsDescription: "Limit parcel queries to protect performance.",
  resetMaxResults: "Reset to default",
  enableToggleRemovalLabel: "Toggle removal",
  enableToggleRemovalDescription: "Let users click a parcel again to clear it.",
  enablePIIMaskingLabel: "PII masking",
  enablePIIMaskingDescription: "Mask names and addresses inside the widget.",
  highlightOptionsDescription: "Adjust how selected parcels appear on the map.",
  highlightColorLabel: "Highlight color",
  highlightOpacityLabel: "Fill opacity",
  highlightOutlineWidthLabel: "Outline width",
  highlightOutlineWidthLabelTooltip:
    "Set the outline width for highlighted parcels.",
  allowedHostsLabel: "Allowed hosts",
  allowedHostsDescription: "Whitelist HTTPS hosts that should pass URL checks.",
  allowedHostsPlaceholder: "lund.se",
  addAllowedHostLabel: "Add allowed host",
  allowedHostsListLabel: "Allowed host entries",
  allowedHostsEmptyHint: "No allowed hosts yet.",
  removeAllowedHostLabel: "Remove allowed host",
  enableBatchOwnerQueryLabel: "Batch owner queries",
  enableBatchOwnerQueryDescription:
    "Use a relationship to fetch all owners in one request.",
  relationshipIdLabel: "Relationship ID",
  relationshipIdDescription:
    "Relationship ID that links parcels to owner records.",
  relationshipIdPlaceholder: "e.g., 0, 1, 2",
  relationshipIdTooltip:
    "Open /MapServer/[layerId]?f=json to list relationship IDs.",
  errorInvalidUrl: "Enter a valid ArcGIS REST service URL.",
  errorInvalidNumber: "Enter a whole number greater than zero.",
  errorMaxResultsInvalid: "Max results must be between 1 and 1000.",
  errorRelationshipIdInvalid: "Relationship ID must be between 0 and 99.",
  runtimeStateQuerying: "Query in progress...",
  runtimeStateError: "Query error occurred. Check widget for details.",
  runtimeStateSelected: "{count} properties currently selected",
  cursorStyleLabel: "Active cursor style",
  cursorStyleDescription:
    "CSS cursor shown when widget is active. Supports standard values (crosshair, pointer, grab) and custom url() cursors.",
  cursorStyleTooltip:
    "Choose cursor style or enter custom CSS value (e.g., url(cursor.png), auto)",
  cursorStylePlaceholder: "Enter CSS cursor value...",
};
