import { coachApiContractVersion } from "./contracts/CoachApiContract";
import { buildMockCoachResponse } from "./coach/mockCoach";
import { ApiError } from "./http/ApiError";
import {
  apiError,
  emptyCorsResponse,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from "./http/json";
import { enforceRateLimit } from "./rateLimit";
import { validateCoachApiRequest } from "./validation/coachRequestValidator";

export type Env = {
  ENVIRONMENT?: string;
  COACH_RATE_LIMITER?: RateLimit;
};

function getRequestIdFromUnknownBody(value: unknown): string | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { requestId?: unknown }).requestId === "string"
  ) {
    return (value as { requestId: string }).requestId;
  }

  return undefined;
}

async function handleCoachRespond(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "POST") {
    throw apiError("method_not_allowed", "Method not allowed.", 405);
  }

  await enforceRateLimit(request, env);

  const rawBody = await readJsonBody(request);
  const requestId = getRequestIdFromUnknownBody(rawBody);
  const coachRequest = validateCoachApiRequest(rawBody);
  const mockResponse = buildMockCoachResponse(coachRequest);

  return jsonResponse({
    contractVersion: coachApiContractVersion,
    requestId: coachRequest.requestId,
    response: mockResponse,
  });
}

function handleHealth(): Response {
  return jsonResponse({
    ok: true,
    service: "dj-lingo-coach-api",
    contractVersion: coachApiContractVersion,
  });
}

async function route(request: Request, env: Env): Promise<Response> {
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
    return handleCoachRespond(request, env);
  }

  throw apiError("not_found", "Route not found.", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let requestId: string | undefined;

    try {
      requestId = request.headers.get("X-DJ-Lingo-Request-Id") ?? undefined;
      return await route(request, env);
    } catch (error) {
      if (error instanceof ApiError) {
        return errorResponse(error, requestId);
      }

      console.error("Unhandled coach API error", error);

      return errorResponse(
        apiError("server_failure", "Coach service is temporarily unavailable.", 500),
        requestId
      );
    }
  },
} satisfies ExportedHandler<Env>;
