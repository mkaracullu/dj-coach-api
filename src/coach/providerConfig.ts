import { coachApiLimits } from "../contracts/CoachApiContract";
import type { CoachProviderMode } from "./providerTypes";

export type CoachProviderEnvironment = {
  COACH_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_MAX_OUTPUT_TOKENS?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_MAX_OUTPUT_TOKENS?: string;
};

export type OpenAiCoachConfig = {
  provider: "openai";
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
};

export type AnthropicCoachConfig = {
  provider: "anthropic";
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
};

export type CoachProviderConfig =
  | { provider: "mock" }
  | OpenAiCoachConfig
  | AnthropicCoachConfig;

export function isExternalCoachProvider(
  provider: CoachProviderMode
): provider is Exclude<CoachProviderMode, "mock"> {
  return provider !== "mock";
}

const defaultOpenAiMaxOutputTokens = 600;
const maximumOpenAiMaxOutputTokens = 800;
const defaultAnthropicMaxOutputTokens = 600;
const maximumAnthropicMaxOutputTokens = 800;

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

export function resolveAnthropicMaxOutputTokens(
  value: string | undefined
): number {
  if (value === undefined) {
    return defaultAnthropicMaxOutputTokens;
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 100 ||
    parsed > maximumAnthropicMaxOutputTokens
  ) {
    return defaultAnthropicMaxOutputTokens;
  }

  return parsed;
}

export function resolveCoachProviderConfig(
  env: CoachProviderEnvironment
): CoachProviderConfig {
  if (env.COACH_PROVIDER === "openai") {
    if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) {
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

  if (env.COACH_PROVIDER === "anthropic") {
    if (!env.ANTHROPIC_API_KEY || !env.ANTHROPIC_MODEL) {
      return { provider: "mock" };
    }

    return {
      provider: "anthropic",
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      timeoutMs: coachApiLimits.backendProviderTimeoutMs,
      maxOutputTokens: resolveAnthropicMaxOutputTokens(
        env.ANTHROPIC_MAX_OUTPUT_TOKENS
      ),
    };
  }

  return { provider: "mock" };
}
