import type { DataSourceManager, FeatureLayerDataSource } from "jimu-core";
import type {
  ValidationResult,
  ValidationFailureResult,
  ErrorState,
  IMConfig,
  MapClickValidationParams,
  EsriModules,
  ValidationPipelineExecutor,
} from "../../config/types";
import { LOCALHOST_PATTERNS, PRIVATE_IP_REGEX } from "../../config/constants";
import { validateNumericRange } from "./helpers";

export { validateNumericRange };

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

const extractUrlFromObject = (obj: unknown): string | null => {
  if (!obj || typeof obj !== "object") {
    return null;
  }
  const candidate = (obj as { url?: string | null }).url;
  return typeof candidate === "string" && candidate ? candidate : null;
};

const urlRetrievalStrategies = [
  (ds: FeatureLayerDataSource) => extractUrlFromObject(ds),
  (ds: FeatureLayerDataSource) =>
    extractUrlFromObject(ds.getLayerDefinition?.()),
  (ds: FeatureLayerDataSource) =>
    extractUrlFromObject(ds.getDataSourceJson?.()),
];

export const getDataSourceUrl = (
  dataSource: FeatureLayerDataSource | null | undefined
): string | null => {
  if (!dataSource) {
    return null;
  }

  for (const strategy of urlRetrievalStrategies) {
    const url = strategy(dataSource);
    if (url) {
      return url;
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
  return (
    LOCALHOST_PATTERNS.includes(normalized) || PRIVATE_IP_REGEX.test(normalized)
  );
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

const validateDataSourcePair = (
  dsManager: DataSourceManager,
  dsId: string,
  role: "property" | "owner",
  allowedHosts: readonly string[] | undefined,
  translate: (key: string) => string
): ValidationResult<FeatureLayerDataSource> => {
  const dataSource = dsManager.getDataSource(
    dsId
  ) as FeatureLayerDataSource | null;

  const sourceValidation = validateSingleDataSource(
    dataSource,
    role,
    translate
  );
  if (!sourceValidation.valid) {
    return sourceValidation as ValidationResult<FeatureLayerDataSource>;
  }

  const urlValidation = validateDataSourceUrl(
    sourceValidation.data.dataSource,
    role,
    allowedHosts,
    translate
  );
  if (!urlValidation.valid) {
    return urlValidation as ValidationResult<FeatureLayerDataSource>;
  }

  return { valid: true, data: sourceValidation.data.dataSource };
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

  const propertyValidation = validateDataSourcePair(
    dsManager,
    propertyDsId,
    "property",
    allowedHosts,
    translate
  );
  if (!propertyValidation.valid) {
    return propertyValidation as ValidationResult<{
      manager: DataSourceManager;
    }>;
  }

  const ownerValidation = validateDataSourcePair(
    dsManager,
    ownerDsId,
    "owner",
    allowedHosts,
    translate
  );
  if (!ownerValidation.valid) {
    return ownerValidation as ValidationResult<{ manager: DataSourceManager }>;
  }

  return { valid: true, data: { manager: dsManager } };
};

type ValidationStep<TContext> = (
  context: TContext
) => ValidationResult<TContext>;

export const createValidationPipeline = <TContext>(
  initialSteps: Array<ValidationStep<TContext>> = []
): ValidationPipelineExecutor<TContext> => {
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

  const executor = ((context: TContext) =>
    run(context)) as ValidationPipelineExecutor<TContext>;

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

  return {
    valid: true,
    data: {
      mapPoint: (
        mapValidation as { valid: true; data: { mapPoint: __esri.Point } }
      ).data.mapPoint,
      manager: (
        dsValidation as { valid: true; data: { manager: DataSourceManager } }
      ).data.manager,
    },
  };
};
