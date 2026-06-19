import {
  BootcampSessionNumber,
  coachApiContractVersion,
  CoachFallbackReasonId,
  CoachSuggestedQuestionId,
} from "./contracts/CoachApiContract";
import {
  CoachService,
  CoachServiceFallbackResult,
  createConfiguredCoachService,
  getCoachApiResponse,
} from "./coach/coachService";
import {
  CoachProviderEnvironment,
  resolveCoachProviderConfig,
} from "./coach/providerConfig";
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
} from "./rateLimit";
import {
  CoachTelemetryResultCategory,
  emitCoachTelemetry,
} from "./observability/coachTelemetry";
import { validateCoachProductScope } from "./validation/coachProductScopeValidator";
import { validateCoachApiRequest } from "./validation/coachRequestValidator";

export type Env = CoachProviderEnvironment & {
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

async function handleCoachRespond(
  request: Request,
  env: Env,
  coachService?: CoachService
): Promise<Response> {
  const startedAt = Date.now();
  const headerRequestId = getSafeRequestIdHeader(request);
  let requestId = headerRequestId;
  let providerMode: "mock" | "openai" = "mock";
  let sessionNumber: BootcampSessionNumber | undefined;
  let questionSource: "suggested" | "free_text" | undefined;
  let suggestedQuestionId: CoachSuggestedQuestionId | undefined;
  let result: CoachTelemetryResultCategory = "server_failure";
  let publicErrorType: ApiError["code"] | undefined;
  let fallbackReasonId: CoachFallbackReasonId | undefined;
  let providerInvocationAttempted = false;
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
    const providerConfig = resolveCoachProviderConfig(env);
    providerMode = providerConfig.provider;
    await enforceRequestRateLimit(request, env);

    if (providerConfig.provider === "openai") {
      await enforceProviderCallGuard(request, env, providerConfig.provider);
    }

    let fallbackResult: CoachServiceFallbackResult | undefined;
    const service =
      coachService ??
      createConfiguredCoachService(env, fetch, (fallback) => {
        fallbackResult = fallback;
      });

    stage = "service";
    providerInvocationAttempted = providerMode === "openai";
    const coachResponse = await getCoachApiResponse(coachRequest, service);
    fallbackReasonId = coachResponse.response.fallbackReasonId ?? undefined;
    result = fallbackResult ?? "success";
    return jsonResponse(coachResponse);
  } catch (error) {
    if (error instanceof ApiError) {
      publicErrorType = error.code;

      if (error.code === "rate_limited") {
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
    });
  }
}

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
  coachService?: CoachService
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
    return handleCoachRespond(request, env, coachService);
  }

  throw apiError("not_found", "Route not found.", 404);
}

export function createWorker(
  coachService?: CoachService
): CoachWorker {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const requestId = getSafeRequestIdHeader(request);

      try {
        return await route(request, env, coachService);
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
