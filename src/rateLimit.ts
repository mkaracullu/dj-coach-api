import { apiError } from "./http/json";
import type { CoachProviderId } from "./coach/providerTypes";

export type CoachRateLimitEnv = {
  COACH_RATE_LIMITER?: RateLimit;
  COACH_PROVIDER_RATE_LIMITER?: RateLimit;
};

function getRateLimitIdentity(request: Request): string {
  const ipAddress = request.headers.get("CF-Connecting-IP")?.trim();

  if (ipAddress) {
    return `ip:${ipAddress}`;
  }

  return "anonymous";
}

function providerGuardrailError() {
  return apiError(
    "provider_guardrail_blocked",
    "Coach service is temporarily unavailable.",
    503
  );
}

function isRateLimitOutcome(
  value: unknown
): value is { success: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "success") === "boolean"
  );
}

export async function enforceRequestRateLimit(
  request: Request,
  env: CoachRateLimitEnv
): Promise<void> {
  if (!env.COACH_RATE_LIMITER) {
    return;
  }

  const key = getRateLimitIdentity(request);
  const result = await env.COACH_RATE_LIMITER.limit({ key: `coach:${key}` });

  if (!result.success) {
    throw apiError(
      "rate_limited",
      "Coach request rate limit was reached.",
      429,
      60
    );
  }
}

export async function enforceProviderCallGuard(
  request: Request,
  env: CoachRateLimitEnv,
  provider: CoachProviderId
): Promise<void> {
  if (!env.COACH_PROVIDER_RATE_LIMITER) {
    throw providerGuardrailError();
  }

  let providerCallAllowed: boolean;

  try {
    const result: unknown = await env.COACH_PROVIDER_RATE_LIMITER.limit({
      key: `coach-provider:${provider}:${getRateLimitIdentity(request)}`,
    });

    if (!isRateLimitOutcome(result)) {
      throw new Error("Invalid provider rate-limit outcome.");
    }

    providerCallAllowed = result.success;
  } catch {
    throw providerGuardrailError();
  }

  if (!providerCallAllowed) {
    throw apiError(
      "rate_limited",
      "Coach request rate limit was reached.",
      429,
      60
    );
  }
}
