import { coachApiContractVersion } from "./contracts/CoachApiContract";
import {
  CoachService,
  createConfiguredCoachService,
  getCoachApiResponse,
} from "./coach/coachService";
import type { CoachProviderEnvironment } from "./coach/providerConfig";
import { ApiError } from "./http/ApiError";
import {
  apiError,
  emptyCorsResponse,
  errorResponse,
  getSafeRequestIdHeader,
  jsonResponse,
  readJsonBody,
} from "./http/json";
import { enforceRateLimit } from "./rateLimit";
import { validateCoachProductScope } from "./validation/coachProductScopeValidator";
import { validateCoachApiRequest } from "./validation/coachRequestValidator";

export type Env = CoachProviderEnvironment & {
  ENVIRONMENT?: string;
  COACH_RATE_LIMITER?: RateLimit;
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
  coachService: CoachService
): Promise<Response> {
  if (request.method !== "POST") {
    throw apiError("method_not_allowed", "Method not allowed.", 405);
  }

  await enforceRateLimit(request, env);

  const rawBody = await readJsonBody(request);
  const coachRequest = validateCoachApiRequest(rawBody);
  validateCoachProductScope(coachRequest);
  const coachResponse = await getCoachApiResponse(coachRequest, coachService);
  return jsonResponse(coachResponse);
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
  coachService: CoachService
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
        return await route(
          request,
          env,
          coachService ?? createConfiguredCoachService(env)
        );
      } catch (error) {
        if (error instanceof ApiError) {
          return errorResponse(error, requestId);
        }

        console.error("Unhandled coach API error", error);

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
