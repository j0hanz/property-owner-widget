export default {
  configurationInstructions:
    "Configure the widget by providing layer URLs and display preferences.",
  mapWidgetTitle: "Map connection",
  mapWidgetDescription:
    "Select a map widget to enable property querying by clicking on the map. The widget will listen for map clicks and query property information at the clicked location.",
  dataSourcesTitle: "Data sources",
  dataSourcesDescription:
    "Validate that both property and owner layers expose matching FNR values and required attributes before publishing the widget.",
  propertyDataSourceLabel: "Property layer",
  propertyDataSourceDescription:
    "Feature layer that stores parcel geometries and FNR identifiers used for selection and highlighting.",
  ownerDataSourceLabel: "Owner layer",
  ownerDataSourceDescription:
    "Feature layer or table containing ownership details (NAMN, BOSTADR, ORGNR, etc.). Can be the same layer as the property source when attributes are combined.",
  displayOptionsTitle: "Display options",
  maxResultsLabel: "Maximum results",
  maxResultsDescription:
    "Limits the number of features requested per lookup to protect performance.",
  resetMaxResults: "Reset to default",
  enableToggleRemovalLabel: "Enable toggle removal",
  enableToggleRemovalDescription:
    "Allow users to deselect properties by clicking them again on the map.",
  enablePIIMaskingLabel: "Enable PII masking",
  enablePIIMaskingDescription:
    "Mask personally identifiable information (names, addresses) for privacy protection.",
  autoZoomOnSelectionLabel: "Auto zoom to results",
  autoZoomOnSelectionDescription:
    "Automatically zoom the map to the extent of the current selection after each successful query.",
  highlightOptionsDescription:
    "Customize how selected properties are emphasized on the map.",
  highlightColorLabel: "Highlight color",
  highlightOpacityLabel: "Fill opacity",
  highlightOutlineWidthLabel: "Outline width",
  allowedHostsLabel: "Allowed hosts",
  allowedHostsDescription:
    "List of allowed hostnames for URL validation (one per line). Leave empty to allow all HTTPS ArcGIS services.",
  allowedHostsPlaceholder: "lund.se\narcgis.com\nesri.com",
  relationshipTitle: "Relationship configuration",
  enableBatchOwnerQueryLabel: "Enable batch owner queries",
  enableBatchOwnerQueryDescription:
    "Use relationship class to fetch all owners in a single query instead of individual requests. Requires relationship configuration in ArcGIS layer.",
  relationshipIdLabel: "Relationship ID",
  relationshipIdDescription:
    "The relationship class ID that links property parcels to ownership records. Find this in your layer's REST API endpoint under 'relationships' array.",
  relationshipIdPlaceholder: "e.g., 0, 1, 2",
  relationshipIdTooltip:
    "Check /MapServer/[layerId]?f=json in your property layer URL to find available relationships.",
  errorInvalidUrl: "Enter a valid ArcGIS REST service URL.",
  errorInvalidNumber: "Enter a whole number greater than zero.",
  errorMaxResultsInvalid: "Max results must be between 1 and 1000.",
  errorRelationshipIdInvalid: "Relationship ID must be between 0 and 99.",
}
