export default {
  configurationInstructions:
    "Configure the widget by providing layer URLs and display preferences.",
  mapWidgetTitle: "Map connection",
  mapWidgetDescription:
    "Select a map widget to enable property querying by clicking on the map. The widget will listen for map clicks and query property information at the clicked location.",
  dataSourcesTitle: "Data sources",
  dataSourcesDescription:
    "Select two feature layers: first for property parcels, second for ownership information. Both layers must use the FNR field to relate properties to owners.",
  propertyLayerLabel: "Property layer URL",
  propertyLayerTooltip:
    "Portal item or service URL that exposes property parcel features.",
  ownerLayerLabel: "Owner layer URL",
  ownerLayerTooltip:
    "Portal item or service URL that exposes property ownership attributes.",
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
}
