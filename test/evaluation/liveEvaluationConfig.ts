import type { CoachProviderId } from "../../src/coach/providerTypes";

export function isLiveEvaluationEnabled(
  environment: Record<string, string | undefined>,
  provider: CoachProviderId
): boolean {
  if (environment.COACH_LIVE_EVALUATION !== "true") {
    return false;
  }

  const selectedProvider = environment.COACH_LIVE_EVALUATION_PROVIDER;

  if (provider === "openai") {
    return selectedProvider === undefined || selectedProvider === "openai";
  }

  return selectedProvider === provider;
}
