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
          "Välj ett objektlager som innehåller fastighets- och ägarinformation. Lagret måste ha FNR-fält för att identifiera fastigheter och ägarattribut (NAMN, BOSTADR, etc.).",
        dataSourceLabel: "Objektlager",
        dataSourceTooltip:
          "Portal- eller tjänst-URL som innehåller fastighets- och ägarinformation.",
        displayOptionsTitle: "Visningsalternativ",
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
        allowedHostsLabel: "Tillåtna värdar",
        allowedHostsDescription:
          "Lista över tillåtna värdnamn för URL-validering (en per rad). Lämna tomt för att tillåta alla HTTPS ArcGIS-tjänster.",
        allowedHostsPlaceholder: "lund.se\narcgis.com\nesri.com",
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
      })
    },
  }
})
