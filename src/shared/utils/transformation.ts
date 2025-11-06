import type { SortingState } from "@tanstack/react-table";
import type {
  GridRowData,
  SerializedQueryResult,
  SerializedQueryResultMap,
  ClipboardPayload,
} from "../../config/types";
import {
  applySortingToProperties,
  formatPropertiesForClipboard,
} from "./export";

export const isSerializedResultRecord = (
  value: unknown
): value is SerializedQueryResultMap => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return !(value instanceof Map);
};

export const buildResultsMap = (
  rawResults:
    | SerializedQueryResultMap
    | Map<string, SerializedQueryResult>
    | null
): Map<string, SerializedQueryResult> | null => {
  if (!rawResults) {
    return null;
  }

  if (rawResults instanceof Map) {
    return rawResults;
  }

  if (isSerializedResultRecord(rawResults)) {
    const resultsMap = new Map<string, SerializedQueryResult>();
    Object.keys(rawResults).forEach((key) => {
      const value = rawResults[key];
      if (value) {
        resultsMap.set(key, value);
      }
    });
    return resultsMap;
  }

  return null;
};

export const collectSelectedRawData = (
  rows: GridRowData[],
  resultsMap: Map<string, SerializedQueryResult>
): SerializedQueryResult[] => {
  const selectedRawData: SerializedQueryResult[] = [];
  rows.forEach((row) => {
    const rawData = resultsMap.get(row.id);
    if (rawData) {
      selectedRawData.push(rawData);
    }
  });
  return selectedRawData;
};

export const buildClipboardPayload = (
  selection: GridRowData[],
  sorting: SortingState,
  maskEnabled: boolean,
  translateFn: (key: string) => string
): ClipboardPayload | null => {
  if (!selection.length) {
    return null;
  }

  const sortedSelection = applySortingToProperties(selection, sorting);
  const formattedText = formatPropertiesForClipboard(
    sortedSelection,
    maskEnabled,
    translateFn("unknownOwner")
  );

  return {
    text: formattedText,
    count: selection.length,
    isSorted: sorting.length > 0,
  };
};

export const notifyCopyOutcome = (
  copySucceeded: boolean,
  payload: ClipboardPayload,
  translateFn: (key: string) => string,
  setUrlFeedback: (feedback: {
    type: "success" | "error";
    text: string;
  }) => void,
  trackEvent: (params: {
    category: string;
    action: string;
    label?: string;
    value?: number;
  }) => void
) => {
  if (copySucceeded) {
    const successTemplate = translateFn("copiedSuccess");
    const successMessage =
      typeof successTemplate === "string"
        ? successTemplate.replace("{count}", String(payload.count))
        : "";

    setUrlFeedback({
      type: "success",
      text:
        successMessage ||
        (typeof successTemplate === "string" ? successTemplate : ""),
    });

    trackEvent({
      category: "Copy",
      action: "copy_properties",
      label: payload.isSorted ? "sorted" : "unsorted",
      value: payload.count,
    });
    return;
  }

  setUrlFeedback({
    type: "error",
    text: translateFn("copyFailed"),
  });

  trackEvent({
    category: "Copy",
    action: "copy_properties",
    label: "failed",
    value: payload.count,
  });
};
