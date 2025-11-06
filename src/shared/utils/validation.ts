import type { DataSourceManager, FeatureLayerDataSource } from "jimu-core";
import type {
  ValidationResult,
  ValidationFailureResult,
  ErrorState,
  IMConfig,
  MapClickValidationParams,
  EsriModules,
} from "../../config/types";

export const checkValidationFailure = <T>(
  result: ValidationResult<T>
): result is ValidationFailureResult<T> => !result.valid;

export const createValidationError = (
  type: ErrorState["type"],
  message: string,
  failureReason: string
): ValidationResult<never> => ({
  valid: false,
  error: { type, message },
  failureReason,
});

export const getDataSourceUrl = (
  dataSource: FeatureLayerDataSource | null | undefined
): string | null => {
  if (!dataSource) {
    return null;
  }

  if (typeof (dataSource as { url?: string }).url === "string") {
    return (dataSource as { url?: string }).url ?? null;
  }

  const layerDefinition = dataSource.getLayerDefinition?.();
  if (layerDefinition && typeof layerDefinition === "object") {
    const candidate = (layerDefinition as { url?: string | null }).url;
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  const dsJson = dataSource.getDataSourceJson?.();
  if (dsJson && typeof dsJson === "object") {
    const candidate = (dsJson as { url?: string | null }).url;
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return null;
};

const isQueryableDataSource = (
  dataSource: FeatureLayerDataSource | null
): dataSource is FeatureLayerDataSource => {
  return Boolean(dataSource && typeof dataSource.query === "function");
};

const isPrivateHost = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }

  if (/^10\./u.test(normalized) || /^192\.168\./u.test(normalized)) {
    return true;
  }

  return /^172\.(1[6-9]|2\d|3[0-1])\./u.test(normalized);
};

const isValidHttpsUrl = (url: URL): boolean => {
  return url.protocol === "https:" && (url.port === "" || url.port === "443");
};

const isValidArcGISPath = (pathname: string): boolean => {
  return /\/(?:MapServer|FeatureServer)\/\d+(?:\/query)?$/iu.test(pathname);
};

const isHostAllowed = (
  hostname: string,
  allowedHosts?: readonly string[]
): boolean => {
  if (!allowedHosts || allowedHosts.length === 0) {
    return true;
  }

  const normalizedHostname = hostname.trim().toLowerCase();
  return allowedHosts.some((host) => {
    const normalizedAllowed = host.trim().toLowerCase();
    if (!normalizedAllowed) {
      return false;
    }

    return (
      normalizedHostname === normalizedAllowed ||
      normalizedHostname.endsWith(`.${normalizedAllowed}`)
    );
  });
};

export const isValidArcGISUrl = (
  url: string,
  allowedHosts?: readonly string[]
): boolean => {
  if (!url || typeof url !== "string") {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!isValidHttpsUrl(parsed)) {
      return false;
    }

    if (isPrivateHost(parsed.hostname)) {
      return false;
    }

    if (!isValidArcGISPath(parsed.pathname)) {
      return false;
    }

    return isHostAllowed(parsed.hostname, allowedHosts);
  } catch (_error) {
    return false;
  }
};

const validateSingleDataSource = (
  dataSource: FeatureLayerDataSource | null,
  role: "property" | "owner",
  translate: (key: string) => string
): ValidationResult<{ dataSource: FeatureLayerDataSource }> => {
  if (!isQueryableDataSource(dataSource)) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      `${role}_data_source_invalid`
    );
  }

  return { valid: true, data: { dataSource } };
};

const validateDataSourceUrl = (
  dataSource: FeatureLayerDataSource,
  role: "property" | "owner",
  allowedHosts: readonly string[] | undefined,
  translate: (key: string) => string
): ValidationResult<{ url: string }> => {
  const url = getDataSourceUrl(dataSource);
  if (!url || !isValidArcGISUrl(url, allowedHosts)) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorHostNotAllowed"),
      `${role}_disallowed_host`
    );
  }

  return { valid: true, data: { url } };
};

export const validateDataSourcesCore = (params: {
  propertyDsId: string | undefined;
  ownerDsId: string | undefined;
  dsManager: DataSourceManager | null;
  allowedHosts?: readonly string[];
  translate: (key: string) => string;
}): ValidationResult<{ manager: DataSourceManager }> => {
  const { propertyDsId, ownerDsId, dsManager, allowedHosts, translate } =
    params;

  if (!propertyDsId || !ownerDsId) {
    return createValidationError(
      "VALIDATION_ERROR",
      translate("errorNoDataAvailable"),
      "missing_data_sources"
    );
  }

  if (!dsManager) {
    return createValidationError(
      "QUERY_ERROR",
      translate("errorQueryFailed"),
      "missing_data_source_manager"
    );
  }

  const propertyDs = dsManager.getDataSource(
    propertyDsId
  ) as FeatureLayerDataSource | null;
  const ownerDs = dsManager.getDataSource(
    ownerDsId
  ) as FeatureLayerDataSource | null;

  const propertyValidation = validateSingleDataSource(
    propertyDs,
    "property",
    translate
  );
  if (!propertyValidation.valid) {
    return propertyValidation as ValidationResult<{
      manager: DataSourceManager;
    }>;
  }

  const ownerValidation = validateSingleDataSource(ownerDs, "owner", translate);
  if (!ownerValidation.valid) {
    return ownerValidation as ValidationResult<{ manager: DataSourceManager }>;
  }

  const propertyDataSource = propertyValidation.data.dataSource;
  const ownerDataSource = ownerValidation.data.dataSource;

  const propertyUrlValidation = validateDataSourceUrl(
    propertyDataSource,
    "property",
    allowedHosts,
    translate
  );
  if (!propertyUrlValidation.valid) {
    return propertyUrlValidation as ValidationResult<{
      manager: DataSourceManager;
    }>;
  }

  const ownerUrlValidation = validateDataSourceUrl(
    ownerDataSource,
    "owner",
    allowedHosts,
    translate
  );
  if (!ownerUrlValidation.valid) {
    return ownerUrlValidation as ValidationResult<{
      manager: DataSourceManager;
    }>;
  }

  return { valid: true, data: { manager: dsManager } };
};

export const createValidationPipeline = <TContext>(
  initialSteps: Array<(context: TContext) => ValidationResult<TContext>> = []
) => {
  const steps = initialSteps.slice();

  const run = (initialContext: TContext): ValidationResult<TContext> => {
    let current = initialContext;
    for (const step of steps) {
      const result = step(current);
      if (!result.valid) {
        return result;
      }
      current = result.data;
    }
    return { valid: true, data: current };
  };

  const executor = ((context: TContext) => run(context)) as ((
    context: TContext
  ) => ValidationResult<TContext>) & {
    addStep: (
      step: (context: TContext) => ValidationResult<TContext>
    ) => typeof executor;
    run: (context: TContext) => ValidationResult<TContext>;
  };

  executor.addStep = (step) => {
    steps.push(step);
    return executor;
  };

  executor.run = run;

  return executor;
};

export const validateMapClickInputs = (
  params: MapClickValidationParams
): ValidationResult<{ mapPoint: __esri.Point }> => {
  const { event, modules, translate } = params;
  if (!modules) {
    return {
      valid: false,
      error: {
        type: "VALIDATION_ERROR",
        message: translate("errorLoadingModules"),
      },
      failureReason: "modules_not_loaded",
    };
  }

  if (!event?.mapPoint) {
    return {
      valid: false,
      error: { type: "GEOMETRY_ERROR", message: translate("errorNoMapPoint") },
      failureReason: "no_map_point",
    };
  }

  return { valid: true, data: { mapPoint: event.mapPoint } };
};

export const validateMapClickPipeline = (params: {
  event: __esri.ViewClickEvent | null | undefined;
  modules: EsriModules | null;
  config: IMConfig;
  dsManager: DataSourceManager | null;
  translate: (key: string) => string;
}): ValidationResult<{
  mapPoint: __esri.Point;
  manager: DataSourceManager;
}> => {
  const { event, modules, config, dsManager, translate } = params;

  const mapValidation = validateMapClickInputs({
    event,
    modules,
    translate,
  });
  if (checkValidationFailure(mapValidation)) {
    return mapValidation as ValidationResult<{
      mapPoint: __esri.Point;
      manager: DataSourceManager;
    }>;
  }

  const dsValidation = validateDataSourcesCore({
    propertyDsId: config.propertyDataSourceId,
    ownerDsId: config.ownerDataSourceId,
    dsManager,
    allowedHosts: config.allowedHosts,
    translate,
  });
  if (checkValidationFailure(dsValidation)) {
    return dsValidation as ValidationResult<{
      mapPoint: __esri.Point;
      manager: DataSourceManager;
    }>;
  }

  const validatedMap = mapValidation as {
    valid: true;
    data: { mapPoint: __esri.Point };
  };
  const validatedDs = dsValidation as {
    valid: true;
    data: { manager: DataSourceManager };
  };

  return {
    valid: true,
    data: {
      mapPoint: validatedMap.data.mapPoint,
      manager: validatedDs.data.manager,
    },
  };
};

export const validateMapClickRequest = (params: {
  event: __esri.ViewClickEvent | null | undefined;
  modules: EsriModules | null;
  config: IMConfig;
  dsManager: DataSourceManager | null;
  translate: (key: string) => string;
}): ValidationResult<{
  mapPoint: __esri.Point;
  manager: DataSourceManager;
}> => {
  const validation = validateMapClickPipeline(params);
  if (checkValidationFailure(validation)) {
    return validation;
  }

  return {
    valid: true,
    data: {
      mapPoint: validation.data.mapPoint,
      manager: validation.data.manager,
    },
  };
};

export const validateNumericRange = (params: {
  value: string | number;
  min: number;
  max: number;
  errorMessage: string;
}): { valid: boolean; normalized?: number; error?: string } => {
  const { value, min, max, errorMessage } = params;
  const num = typeof value === "string" ? parseInt(value, 10) : value;

  if (Number.isNaN(num) || num < min || num > max) {
    return { valid: false, error: errorMessage };
  }

  return { valid: true, normalized: num };
};
