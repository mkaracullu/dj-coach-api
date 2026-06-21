import { coachApiLimits } from "../contracts/CoachApiContract";
import type { CoachProviderMode } from "./providerTypes";

export type CoachProviderEnvironment = {
  COACH_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_MAX_OUTPUT_TOKENS?: string;
};

export type OpenAiCoachConfig = {
  provider: "openai";
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
};

export type CoachProviderConfig =
  | { provider: "mock" }
  | OpenAiCoachConfig;

export function isExternalCoachProvider(
  provider: CoachProviderMode
): provider is Exclude<CoachProviderMode, "mock"> {
  return provider !== "mock";
}

const defaultOpenAiMaxOutputTokens = 600;
const maximumOpenAiMaxOutputTokens = 800;

export function resolveOpenAiMaxOutputTokens(
  value: string | undefined
): number {
  if (value === undefined) {
    return defaultOpenAiMaxOutputTokens;
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 100 ||
    parsed > maximumOpenAiMaxOutputTokens
  ) {
    return defaultOpenAiMaxOutputTokens;
  }

  return parsed;
}

export function resolveCoachProviderConfig(
  env: CoachProviderEnvironment
): CoachProviderConfig {
  if (
    env.COACH_PROVIDER !== "openai" ||
    !env.OPENAI_API_KEY ||
    !env.OPENAI_MODEL
  ) {
    return { provider: "mock" };
  }

  return {
    provider: "openai",
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    timeoutMs: coachApiLimits.backendProviderTimeoutMs,
    maxOutputTokens: resolveOpenAiMaxOutputTokens(
      env.OPENAI_MAX_OUTPUT_TOKENS
    ),
  };
}
