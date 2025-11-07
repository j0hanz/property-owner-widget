System.register([], function (e) {
  return {
    execute: function () {
      e({
        configurationInstructions:
          "Konfigurera datakällor och visningsinställningar.",
        mapWidgetTitle: "Kartwidget",
        mapWidgetDescription:
          "Välj den kartwidget som ska användas för fastighetssökningar.",
        dataSourcesDescription:
          "Fastighets- och ägarlager måste ha ett matchande FNR-fält.",
        propertyDataSourceLabel: "Fastighetslager",
        propertyDataSourceDescription:
          "Lager med fastighetsgeometri och FNR-värden.",
        ownerDataSourceLabel: "Ägarlager",
        ownerDataSourceDescription:
          "Lager eller tabell med ägarnamn och adressuppgifter.",
        displayOptionsTitle: "Visningsalternativ",
        panelDisplaySettings: "Visningsbeteende",
        advancedSettingsTitle: "Avancerade inställningar",
        panelHighlightSettings: "Markeringsstil",
        highlightColorLabelTooltip:
          "Ange markeringsfärg för valda fastigheter.",
        highlightOpacityLabelTooltip:
          "Ange fyllnadsopacitet för valda fastigheter.",
        maxResultsLabel: "Max resultat",
        maxResultsDescription:
          "Begränsa antalet fastigheter som returneras per fråga.",
        resetMaxResults: "Återställ standard",
        enableToggleRemovalLabel: "Växla borttagning",
        enableToggleRemovalDescription:
          "Klicka på en vald fastighet igen för att avmarkera den.",
        enablePIIMaskingLabel: "PII-maskering",
        enablePIIMaskingDescription:
          "Maskera ägarnamn och adresser i widgeten.",
        highlightOptionsDescription:
          "Anpassa hur valda fastigheter visas på kartan.",
        highlightColorLabel: "Markeringsfärg",
        highlightOpacityLabel: "Fyllnadsopacitet",
        highlightOutlineWidthLabel: "Linjebredd",
        highlightOutlineWidthLabelTooltip:
          "Ange linjebredd för valda fastigheter.",
        allowedHostsLabel: "Tillåtna värdar",
        allowedHostsDescription:
          "Vitlista betrodda HTTPS-värdar för datakällor.",
        allowedHostsPlaceholder: "example.com",
        addAllowedHostLabel: "Lägg till värd",
        allowedHostsListLabel: "Tillåtna värdar",
        allowedHostsEmptyHint: "Inga värdar har lagts till.",
        removeAllowedHostLabel: "Ta bort värd",
        enableBatchOwnerQueryLabel: "Batch-ägarfrågor",
        enableBatchOwnerQueryDescription:
          "Använd en relation för att hämta alla ägare i en enda begäran.",
        relationshipIdLabel: "Relations-ID",
        relationshipIdDescription:
          "ID för relationen som länkar fastigheter till ägare.",
        relationshipIdPlaceholder: "t.ex. 0",
        relationshipIdTooltip:
          "Hitta ID:t på lagrets REST-tjänstsida (t.ex. /MapServer/0).",
        errorInvalidUrl: "Ange en giltig ArcGIS REST-tjänst-URL.",
        errorInvalidNumber: "Ange ett heltal större än noll.",
        errorMaxResultsInvalid: "Max resultat måste vara mellan 1 och 1000.",
        errorRelationshipIdInvalid: "Relations-ID måste vara mellan 0 och 99.",
        runtimeStateQuerying: "Sökning pågår…",
        runtimeStateError: "Frågefel. Se widgeten för detaljer.",
        runtimeStateSelected: "{count} fastigheter valda.",
      });
    },
  };
});
