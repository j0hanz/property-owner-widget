import type {
  NavigatorWithPrivacy,
  PerformanceMetric,
  TelemetryEvent,
  WindowWithPrivacy,
} from "../config/types";

export const isAllowedToTrack = (): boolean => {
  try {
    if (typeof window === "undefined") return false;

    // Check Global Privacy Control (GPC) signal first - always honored
    const nav =
      typeof navigator !== "undefined"
        ? (navigator as NavigatorWithPrivacy)
        : undefined;
    const gpc = nav?.globalPrivacyControl;
    if (gpc) return false;

    // Check Do Not Track signal - always honored
    const win = window as WindowWithPrivacy;
    const dt = nav?.doNotTrack ?? win.doNotTrack ?? nav?.msDoNotTrack;
    if (dt === "1" || dt === "yes") return false;

    // Check cookie opt-out with proper parsing to avoid cross-domain pollution
    const cookie = typeof document !== "undefined" ? document.cookie || "" : "";
    const cookiePairs = cookie.split(";").map((c) => c.trim());
    if (cookiePairs.some((pair) => pair === "esri_disallow_tracking=1")) {
      return false;
    }

    // Check localStorage opt-in/opt-out (cannot override GPC/DNT)
    const storage = window.localStorage
      ? window.localStorage.getItem("esri_allow_tracking")
      : null;
    if (storage === "false") return false;
    if (storage === "true") return true;

    // Default to NOT tracking (privacy-by-default)
    return false;
  } catch (e) {
    return false;
  }
};

export const trackEvent = (event: TelemetryEvent): void => {
  if (!isAllowedToTrack()) return;

  try {
    void event;
    // Event tracking implementation here (silent)
  } catch (error) {
    // Silent fail for telemetry
  }
};

export const trackPerformance = (metric: PerformanceMetric): void => {
  if (!isAllowedToTrack()) return;

  try {
    trackEvent({
      category: "Performance",
      action: metric.operation,
      label: metric.success ? "success" : "failure",
      value: Math.round(metric.duration),
    });

    if (metric.error) {
      trackEvent({
        category: "Error",
        action: metric.operation,
        label: metric.error,
      });
    }
  } catch (error) {
    // Silent fail for telemetry
  }
};

export const trackError = (
  operation: string,
  error: unknown,
  details?: string
): void => {
  if (!isAllowedToTrack()) return;

  try {
    const errorMessage = (() => {
      if (typeof error === "string") return error;
      if (error && typeof error === "object") {
        const withMessage = error as {
          message?: string;
          details?: { message?: string };
        };
        return (
          withMessage.message ?? withMessage.details?.message ?? "Unknown error"
        );
      }
      return "Unknown error";
    })();

    trackEvent({
      category: "Error",
      action: operation,
      label: details ? `${errorMessage}: ${details}` : errorMessage,
    });
  } catch (trackingError) {
    // Silent fail for telemetry
  }
};

export const createPerformanceTracker = (operation: string) => {
  const startTime = performance.now();

  return {
    success: () => {
      const duration = performance.now() - startTime;
      trackPerformance({
        operation,
        duration,
        success: true,
      });
    },
    failure: (error: string) => {
      const duration = performance.now() - startTime;
      trackPerformance({
        operation,
        duration,
        success: false,
        error,
      });
    },
  };
};

export const trackFeatureUsage = (feature: string, enabled: boolean): void => {
  if (!isAllowedToTrack()) return;

  trackEvent({
    category: "Feature",
    action: feature,
    label: enabled ? "enabled" : "disabled",
  });
};
