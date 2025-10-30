System.register([], function (e) {
  return {
    execute: function () {
      e({
        configurationInstructions:
          "Konfigurera widgeten genom att ange lager-URL:er och visningsinställningar.",
        mapWidgetTitle: "Kartkoppling",
        mapWidgetDescription:
          "Välj en kartwidget för att aktivera fastighetsfrågor genom att klicka på kartan. Widgeten kommer att lyssna efter kartklick och hämta fastighetsinformation vid den klickade platsen.",
        dataSourcesTitle: "Datakällor",
        dataSourcesDescription:
          "Kontrollera att både fastighets- och ägarlager delar FNR-värden och nödvändiga attribut innan widgeten publiceras.",
        propertyDataSourceLabel: "Fastighetslager",
        propertyDataSourceDescription:
          "Objektlager som innehåller fastighetsgeometrier och FNR som används för urval och highlighting.",
        ownerDataSourceLabel: "Ägarlager",
        ownerDataSourceDescription:
          "Objektlager eller tabell som innehåller ägaruppgifter (NAMN, BOSTADR, ORGNR, etc.). Kan vara samma lager som fastighetskällan när attributen är sammanslagna.",
        displayOptionsTitle: "Visningsalternativ",
        panelDisplaySettings: "Visningsbeteende",
        panelHighlightSettings: "Markeringsstil",
        maxResultsLabel: "Maximalt antal resultat",
        maxResultsDescription:
          "Begränsar hur många objekt som hämtas per sökning för att skydda prestandan.",
        resetMaxResults: "Återställ standardvärde",
        enableToggleRemovalLabel: "Aktivera växlingsborttagning",
        enableToggleRemovalDescription:
          "Tillåt användare att avmarkera fastigheter genom att klicka på dem igen i kartan.",
        enablePIIMaskingLabel: "Aktivera PII-maskning",
        enablePIIMaskingDescription:
          "Maskera personligt identifierbar information (namn, adresser) för integritetsskydd.",
        autoZoomOnSelectionLabel: "Zooma automatiskt till resultat",
        autoZoomOnSelectionDescription:
          "Zooma automatiskt kartan till omfånget för den aktuella markeringen efter varje lyckad sökning.",
        highlightOptionsDescription:
          "Anpassa hur markerade fastigheter visas på kartan.",
        highlightColorLabel: "Markeringsfärg",
        highlightOpacityLabel: "Fyllnadsopacitet",
        highlightOutlineWidthLabel: "Linjebredd",
        allowedHostsLabel: "Tillåtna värdar",
        allowedHostsDescription:
          "Lägg till värdnamn som ska tillåtas vid URL-validering. Lämna tomt för att tillåta alla HTTPS ArcGIS-tjänster.",
        allowedHostsPlaceholder: "lund.se",
        addAllowedHostLabel: "Lägg till tillåten värd",
        allowedHostsListLabel: "Tillåtna värdposter",
        allowedHostsEmptyHint: "Inga värdar har lagts till ännu.",
        removeAllowedHostLabel: "Ta bort tillåten värd",
        relationshipTitle: "Relationskonfiguration",
        enableBatchOwnerQueryLabel: "Aktivera batch-ägarsökningar",
        enableBatchOwnerQueryDescription:
          "Använd relationsklass för att hämta alla ägare i en enda fråga istället för enskilda förfrågningar. Kräver relationskonfiguration i ArcGIS-lager.",
        relationshipIdLabel: "Relations-ID",
        relationshipIdDescription:
          "Relationsklassens ID som länkar fastighetsskiften till ägaruppgifter. Hitta detta i ditt lagers REST API-slutpunkt under 'relationships'-arrayen.",
        relationshipIdPlaceholder: "t.ex. 0, 1, 2",
        relationshipIdTooltip:
          "Kontrollera /MapServer/[layerId]?f=json i din fastighetslager-URL för att hitta tillgängliga relationer.",
        errorInvalidUrl: "Ange en giltig ArcGIS REST-tjänst-URL.",
        errorInvalidNumber: "Ange ett heltal större än noll.",
        errorMaxResultsInvalid: "Max resultat måste vara mellan 1 och 1000.",
        errorRelationshipIdInvalid: "Relations-ID måste vara mellan 0 och 99.",
      })
    },
  }
})
