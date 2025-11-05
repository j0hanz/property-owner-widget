System.register([], function (e) {
  return {
    execute: function () {
      e({
        configurationInstructions:
          "Konfigurera widgeten genom att ange lager-URL:er och visningsinställningar.",
        mapWidgetTitle: "Kartkonfiguration",
        mapWidgetDescription:
          "Välj en befintlig kartwidget för att aktivera fastighetssökning.",
        dataSourcesDescription:
          "Säkerställ att fastighets- och ägarlager delar FNR-fält.",
        propertyDataSourceLabel: "Fastighetslager",
        propertyDataSourceDescription:
          "Fastighetslager med geometri och FNR-värden.",
        ownerDataSourceLabel: "Ägarlager",
        ownerDataSourceDescription:
          "Ägarlager eller tabell med NAMN- och BOSTADR-fält.",
        displayOptionsTitle: "Visningsalternativ",
        panelDisplaySettings: "Visningsbeteende",
        advancedSettingsTitle: "Avancerade inställningar",
        panelHighlightSettings: "Markeringsstil",
        highlightColorLabelTooltip:
          "Välj färg för att markera valda fastigheter.",
        highlightOpacityLabelTooltip:
          "Ange fyllnadsopacitet för markerade fastigheter.",
        maxResultsLabel: "Maximalt antal resultat",
        maxResultsDescription:
          "Maximalt antal fastigheter som ska returneras per fråga.",
        resetMaxResults: "Återställ standardvärde",
        enableToggleRemovalLabel: "Växlingsborttagning",
        enableToggleRemovalDescription:
          "Tillåt ett nytt klick för att avmarkera fastigheten.",
        enablePIIMaskingLabel: "PII-maskning",
        enablePIIMaskingDescription: "Maskera namn och adresser i widgeten.",
        highlightOptionsDescription:
          "Styr hur markerade fastigheter visas på kartan.",
        highlightColorLabel: "Markeringsfärg",
        highlightOpacityLabel: "Fyllnadsopacitet",
        highlightOutlineWidthLabel: "Linjebredd",
        highlightOutlineWidthLabelTooltip:
          "Ange linjebredden för markerade fastigheter.",
        allowedHostsLabel: "Tillåtna värdar",
        allowedHostsDescription:
          "Tillåtna HTTPS-värdar som ska användas för tjänster.",
        allowedHostsPlaceholder: "lund.se",
        addAllowedHostLabel: "Lägg till tillåten värd",
        allowedHostsListLabel: "Tillåtna värdposter",
        allowedHostsEmptyHint: "Inga värdar tillåtna ännu.",
        removeAllowedHostLabel: "Ta bort tillåten värd",
        enableBatchOwnerQueryLabel: "Batch-ägarförfrågan",
        enableBatchOwnerQueryDescription:
          "Aktivera relation för att hämta alla ägare i en förfrågan.",
        relationshipIdLabel: "Relations-ID",
        relationshipIdDescription:
          "ID för relationen mellan fastigheter och ägare.",
        relationshipIdPlaceholder: "t.ex. 0, 1, 2",
        relationshipIdTooltip:
          "Öppna /MapServer/[layerId]?f=json för att se relations-ID.",
        errorInvalidUrl: "Ange en giltig ArcGIS REST-tjänst-URL.",
        errorInvalidNumber: "Ange ett heltal större än noll.",
        errorMaxResultsInvalid: "Max resultat måste vara mellan 1 och 1000.",
        errorRelationshipIdInvalid: "Relations-ID måste vara mellan 0 och 99.",
        runtimeStateQuerying: "Fråga pågår...",
        runtimeStateError: "Frågefel uppstod. Kontrollera widget för detaljer.",
        runtimeStateSelected: "{count} fastigheter valda för närvarande",
      });
    },
  };
});
