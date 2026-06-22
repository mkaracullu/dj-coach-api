import {
  BootcampSessionNumber,
  coachApiContractVersion,
  CoachFallbackReasonId,
  CoachSuggestedQuestionId,
} from "./contracts/CoachApiContract";
import {
  type CoachService,
  type CoachServiceFallbackResult,
  type CoachProviderExecutionObserver,
  createCoachServiceFromConfig,
  getCoachApiResponse,
} from "./coach/coachService";
import {
  CoachProviderEnvironment,
  isExternalCoachProvider,
  resolveCoachProviderConfig,
} from "./coach/providerConfig";
import {
  assignCoachExperimentProvider,
  readCoachExperimentCohort,
  resolveCoachExperimentConfig,
} from "./coach/providerExperiment";
import type {
  CoachProviderExecutionMetadata,
  CoachProviderId,
  CoachProviderMode,
} from "./coach/providerTypes";
import { ApiError } from "./http/ApiError";
import {
  apiError,
  emptyCorsResponse,
  errorResponse,
  getSafeRequestIdHeader,
  jsonResponse,
  readJsonBody,
} from "./http/json";
import {
  enforceProviderCallGuard,
  enforceRequestRateLimit,
  RequestLimiterUnavailableError,
} from "./rateLimit";
import {
  CoachTelemetryResultCategory,
  emitCoachTelemetry,
} from "./observability/coachTelemetry";
import {
  createCloudflareProviderUsageCapPort,
  ProviderUsageCap,
  type CloudflareProviderUsageCapEnvironment,
} from "./infrastructure/cloudflare/providerUsageCap";
import {
  consumeDailyProviderAllowance,
  ProviderUsageCapReachedError,
  ProviderUsageCapUnavailableError,
  type ProviderUsageCapAllowedOutcome,
  type ProviderUsageCapPort,
} from "./usageCap/providerUsageCap";
import { validateCoachProductScope } from "./validation/coachProductScopeValidator";
import { validateCoachApiRequest } from "./validation/coachRequestValidator";

export type Env = CoachProviderEnvironment &
  CloudflareProviderUsageCapEnvironment & {
  ENVIRONMENT?: string;
  COACH_RATE_LIMITER?: RateLimit;
  COACH_PROVIDER_RATE_LIMITER?: RateLimit;
};

export type CoachWorker = {
  fetch(
    request: Request,
    env: Env,
    context?: ExecutionContext
  ): Promise<Response>;
};

export type ProviderUsageCapPortFactory = (
  env: Env
) => ProviderUsageCapPort | undefined;

async function handleCoachRespond(
  request: Request,
  env: Env,
  coachService?: CoachService,
  createProviderUsageCapPort: ProviderUsageCapPortFactory =
    createCloudflareProviderUsageCapPort
): Promise<Response> {
  const startedAt = Date.now();
  const headerRequestId = getSafeRequestIdHeader(request);
  let requestId = headerRequestId;
  let providerMode: CoachProviderMode = "mock";
  let sessionNumber: BootcampSessionNumber | undefined;
  let questionSource: "suggested" | "free_text" | undefined;
  let suggestedQuestionId: CoachSuggestedQuestionId | undefined;
  let result: CoachTelemetryResultCategory = "server_failure";
  let publicErrorType: ApiError["code"] | undefined;
  let fallbackReasonId: CoachFallbackReasonId | undefined;
  let providerInvocationAttempted = false;
  let experimentId: string | undefined;
  let experimentVersion: string | undefined;
  let assignedProvider: CoachProviderId | undefined;
  let actualExternalProvider: CoachProviderId | undefined;
  let providerUsageCapOutcome:
    | ProviderUsageCapAllowedOutcome["outcome"]
    | "blocked"
    | "unavailable"
    | undefined;
  let providerUsageCapLimit: number | undefined;
  let providerUsageCapRemaining: number | undefined;
  let providerExecutionMetadata:
    | CoachProviderExecutionMetadata
    | undefined;
  let fallbackResult: CoachServiceFallbackResult | undefined;
  let stage: "method" | "validation" | "scope" | "guardrail" | "service" =
    "method";

  try {
    if (request.method !== "POST") {
      throw apiError("method_not_allowed", "Method not allowed.", 405);
    }

    stage = "validation";
    const rawBody = await readJsonBody(request);
    const coachRequest = validateCoachApiRequest(rawBody);
    requestId = coachRequest.requestId;
    sessionNumber = coachRequest.context.lesson?.sessionNumber;
    questionSource = coachRequest.question.source;
    suggestedQuestionId =
      coachRequest.question.source === "suggested"
        ? coachRequest.question.suggestedQuestionId
        : undefined;

    stage = "scope";
    validateCoachProductScope(coachRequest);

    stage = "guardrail";
    await enforceRequestRateLimit(request, env);

    let providerConfig = resolveCoachProviderConfig(env);

    if (env.COACH_PROVIDER === "experiment") {
      providerMode = "experiment";
      const experimentConfig = resolveCoachExperimentConfig(env);
      const cohortId = readCoachExperimentCohort(request);

      if (experimentConfig && cohortId) {
        const assignment = await assignCoachExperimentProvider(
          experimentConfig,
          cohortId
        );
        experimentId = assignment.experimentId;
        experimentVersion = assignment.experimentVersion;
        assignedProvider = assignment.assignedProvider;
        providerConfig = assignment.providerConfig;
      } else {
        providerConfig = { provider: "mock" };
      }
    } else {
      providerMode = providerConfig.provider;
    }

    const observeProviderExecution: CoachProviderExecutionObserver = (
      metadata
    ) => {
      providerExecutionMetadata = metadata;
    };
    const service =
      coachService ??
      createCoachServiceFromConfig(
        providerConfig,
        fetch,
        (fallback) => {
          fallbackResult = fallback;
        },
        observeProviderExecution
      );

    if (isExternalCoachProvider(providerConfig.provider)) {
      await enforceProviderCallGuard(request, env, providerConfig.provider);
      providerUsageCapOutcome = "unavailable";

      try {
        const capResult = await consumeDailyProviderAllowance(
          createProviderUsageCapPort(env),
          env.COACH_PROVIDER_DAILY_CALL_LIMIT
        );
        providerUsageCapOutcome = capResult.outcome;
        providerUsageCapLimit = capResult.limit;
        providerUsageCapRemaining = capResult.remaining;
      } catch (error) {
        if (error instanceof ProviderUsageCapReachedError) {
          providerUsageCapOutcome = "blocked";
          providerUsageCapLimit = error.limit;
          providerUsageCapRemaining = error.remaining;
        }

        if (error instanceof ProviderUsageCapUnavailableError) {
          throw apiError(
            "provider_guardrail_blocked",
            "Coach service is temporarily unavailable.",
            503
          );
        }

        if (error instanceof ProviderUsageCapReachedError) {
          throw apiError(
            "rate_limited",
            "Coach service is temporarily unavailable.",
            429,
            error.retryAfterSeconds
          );
        }

        throw error;
      }
    }

    stage = "service";
    if (isExternalCoachProvider(providerConfig.provider)) {
      providerInvocationAttempted = true;
      actualExternalProvider = providerConfig.provider;
    }
    const coachResponse = await getCoachApiResponse(coachRequest, service);
    fallbackReasonId = coachResponse.response.fallbackReasonId ?? undefined;
    result = fallbackResult?.category ?? "success";
    return jsonResponse(coachResponse);
  } catch (error) {
    if (error instanceof ApiError) {
      publicErrorType = error.code;

      if (error instanceof RequestLimiterUnavailableError) {
        result = "request_limiter_unavailable";
      } else if (providerUsageCapOutcome === "blocked") {
        result = "provider_usage_cap_blocked";
      } else if (error.code === "rate_limited") {
        result = "rate_limited";
      } else if (error.code === "provider_guardrail_blocked") {
        result = "provider_guardrail_blocked";
      } else if (stage === "scope") {
        result = "scope_reject";
      } else {
        result = "validation_error";
      }
    } else {
      result = "server_failure";
    }

    throw error;
  } finally {
    emitCoachTelemetry({
      event: "coach_request_completed",
      ...(requestId ? { requestId } : {}),
      providerMode,
      route: "/v1/coach/respond",
      ...(sessionNumber !== undefined ? { sessionNumber } : {}),
      ...(questionSource ? { questionSource } : {}),
      ...(suggestedQuestionId ? { suggestedQuestionId } : {}),
      result,
      ...(publicErrorType ? { publicErrorType } : {}),
      ...(fallbackReasonId ? { fallbackReasonId } : {}),
      elapsedMs: Math.max(0, Date.now() - startedAt),
      providerInvocationAttempted,
      ...(providerUsageCapOutcome
        ? { providerUsageCapOutcome }
        : {}),
      ...(providerUsageCapLimit !== undefined
        ? { providerUsageCapLimit }
        : {}),
      ...(providerUsageCapRemaining !== undefined
        ? { providerUsageCapRemaining }
        : {}),
      ...(providerExecutionMetadata
        ? {
            providerLatencyMs:
              providerExecutionMetadata.latencyMs,
            ...(providerExecutionMetadata.usage
              ? {
                  providerInputTokens:
                    providerExecutionMetadata.usage.inputTokens,
                  providerOutputTokens:
                    providerExecutionMetadata.usage.outputTokens,
                  providerTotalTokens:
                    providerExecutionMetadata.usage.totalTokens,
                }
              : {}),
          }
        : {}),
      ...(experimentId ? { experimentId } : {}),
      ...(experimentVersion ? { experimentVersion } : {}),
      ...(assignedProvider ? { assignedProvider } : {}),
      ...(actualExternalProvider ? { actualExternalProvider } : {}),
      ...(fallbackResult
        ? {
            fallbackCategory: fallbackResult.category,
            ...(fallbackResult.providerErrorCategory
              ? {
                  providerErrorCategory:
                    fallbackResult.providerErrorCategory,
                }
              : {}),
            ...(fallbackResult.providerHttpStatus !== undefined
              ? {
                  providerHttpStatus:
                    fallbackResult.providerHttpStatus,
                }
              : {}),
            ...(fallbackResult.responseValidationFailureCode
              ? {
                  responseValidationFailureCode:
                    fallbackResult.responseValidationFailureCode,
                }
              : {}),
            ...(fallbackResult.semanticSafetyFailureCode
              ? {
                  semanticSafetyFailureCode:
                    fallbackResult.semanticSafetyFailureCode,
                }
              : {}),
          }
        : {}),
    });
  }
}

export { ProviderUsageCap };

function handleHealth(): Response {
  return jsonResponse({
    ok: true,
    service: "dj-coach-api",
    contractVersion: coachApiContractVersion,
  });
}

async function route(
  request: Request,
  env: Env,
  coachService?: CoachService,
  createProviderUsageCapPort?: ProviderUsageCapPortFactory
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return emptyCorsResponse();
  }

  const url = new URL(request.url);

  if (url.pathname === "/health") {
    if (request.method !== "GET") {
      throw apiError("method_not_allowed", "Method not allowed.", 405);
    }

    return handleHealth();
  }

  if (url.pathname === "/v1/coach/respond") {
    return handleCoachRespond(
      request,
      env,
      coachService,
      createProviderUsageCapPort
    );
  }

  throw apiError("not_found", "Route not found.", 404);
}

export function createWorker(
  coachService?: CoachService,
  createProviderUsageCapPort?: ProviderUsageCapPortFactory
): CoachWorker {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const requestId = getSafeRequestIdHeader(request);

      try {
        return await route(
          request,
          env,
          coachService,
          createProviderUsageCapPort
        );
      } catch (error) {
        if (error instanceof ApiError) {
          return errorResponse(error, requestId);
        }

        return errorResponse(
          apiError(
            "server_failure",
            "Coach service is temporarily unavailable.",
            500
          ),
          requestId
        );
      }
    },
  };
}

export default createWorker() satisfies ExportedHandler<Env>;
