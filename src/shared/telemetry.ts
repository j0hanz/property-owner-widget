import type { TelemetryEvent, PerformanceMetric } from "../config/types"

export const isAllowedToTrack = (): boolean => {
  try {
    if (typeof window === "undefined") return false

    // Check Global Privacy Control (GPC) signal first
    const gpc = (navigator as any)?.globalPrivacyControl
    if (gpc === true) return false

    const dt =
      (navigator as any)?.doNotTrack ||
      (window as any)?.doNotTrack ||
      (navigator as any)?.msDoNotTrack
    if (dt === "1" || dt === "yes") return false

    const cookie = typeof document !== "undefined" ? document.cookie || "" : ""
    if (cookie.includes("esri_disallow_tracking=1")) return false

    // Allow opt-in via localStorage key 'esri_allow_tracking' set to 'true'
    const storage = window.localStorage
      ? window.localStorage.getItem("esri_allow_tracking")
      : null
    if (storage === "true") return true
    if (storage === "false") return false

    // Default to allowing tracking
    return false
  } catch (e) {
    return false
  }
}

export const trackEvent = (event: TelemetryEvent): void => {
  if (!isAllowedToTrack()) return

  try {
    console.log("[Property Widget Telemetry]", event)
  } catch (error) {
    console.log("Telemetry tracking failed", error)
  }
}

export const trackPerformance = (metric: PerformanceMetric): void => {
  if (!isAllowedToTrack()) return

  try {
    trackEvent({
      category: "Performance",
      action: metric.operation,
      label: metric.success ? "success" : "failure",
      value: Math.round(metric.duration),
    })

    if (metric.error) {
      trackEvent({
        category: "Error",
        action: metric.operation,
        label: metric.error,
      })
    }
  } catch (error) {
    console.log("Performance tracking failed", error)
  }
}

export const trackError = (
  operation: string,
  error: any,
  details?: string
): void => {
  if (!isAllowedToTrack()) return

  try {
    const errorMessage =
      typeof error === "string"
        ? error
        : error?.message || error?.details?.message || "Unknown error"

    trackEvent({
      category: "Error",
      action: operation,
      label: details ? `${errorMessage}: ${details}` : errorMessage,
    })
  } catch (trackingError) {
    console.log("Error tracking failed", trackingError)
  }
}

export const createPerformanceTracker = (operation: string) => {
  const startTime = performance.now()

  return {
    success: () => {
      const duration = performance.now() - startTime
      trackPerformance({
        operation,
        duration,
        success: true,
      })
    },
    failure: (error: string) => {
      const duration = performance.now() - startTime
      trackPerformance({
        operation,
        duration,
        success: false,
        error,
      })
    },
  }
}

export const trackFeatureUsage = (feature: string, enabled: boolean): void => {
  if (!isAllowedToTrack()) return

  trackEvent({
    category: "Feature",
    action: feature,
    label: enabled ? "enabled" : "disabled",
  })
}
