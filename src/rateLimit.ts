import { apiError } from "./http/json";

export type CoachRateLimitEnv = {
  COACH_RATE_LIMITER?: RateLimit;
};

function getRateLimitKey(request: Request): string {
  const installationId = request.headers.get("X-DJ-Lingo-Install-Id")?.trim();

  if (installationId && /^[A-Za-z0-9_-]{8,120}$/.test(installationId)) {
    return `install:${installationId}`;
  }

  const ipAddress = request.headers.get("CF-Connecting-IP")?.trim();

  if (ipAddress) {
    return `ip:${ipAddress}`;
  }

  return "anonymous";
}

export async function enforceRateLimit(
  request: Request,
  env: CoachRateLimitEnv
): Promise<void> {
  if (!env.COACH_RATE_LIMITER) {
    return;
  }

  const key = getRateLimitKey(request);
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
