import type { CoachApiSuccessResponseV1 } from "../contracts/CoachApiContract";
import type { CoachResponseValidationFailureCode } from "./coachResponseValidator";
import type { CoachRuntimeSafetyFailureCode } from "./coachRuntimeSafety";

export const coachProviderIdValues = ["openai", "anthropic"] as const;

export type CoachProviderId = (typeof coachProviderIdValues)[number];
export type CoachProviderMode = "mock" | "experiment" | CoachProviderId;

export type CoachProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CoachProviderErrorCategory =
  | "timeout"
  | "http_error"
  | "invalid_response"
  | "invalid_structured_output";

export type CoachProviderSafeDiagnostics = {
  providerHttpStatus: number | null;
  providerErrorCategory: CoachProviderErrorCategory;
  jsonParseFailed: boolean;
  schemaExtractionFailed: boolean;
  responseValidatorFailed: boolean;
  responseValidationFailureCode: CoachResponseValidationFailureCode | null;
  missingPublicFields: string[];
  unknownPublicFields: string[];
  invalidResponseType: boolean;
  invalidFallbackReasonCombination: boolean;
  messageCharacterLimitExceeded: boolean;
  responseWordLimitExceeded: boolean;
  responseByteLimitExceeded: boolean;
  nextActionLabelLimitExceeded: boolean;
  semanticSafetyFailed: boolean;
  semanticSafetyFailureCode: CoachRuntimeSafetyFailureCode | null;
  deterministicFallbackUsed: boolean;
};

export type CoachProviderResult<
  ProviderId extends CoachProviderId = CoachProviderId,
> = {
  response: CoachApiSuccessResponseV1;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  usage: CoachProviderUsage | null;
  estimatedCostUsd: number | null;
};

export function buildCoachProviderSafeDiagnostics(
  providerErrorCategory: CoachProviderErrorCategory,
  overrides: Partial<CoachProviderSafeDiagnostics> = {}
): CoachProviderSafeDiagnostics {
  return {
    providerHttpStatus: null,
    providerErrorCategory,
    jsonParseFailed: false,
    schemaExtractionFailed: false,
    responseValidatorFailed: false,
    responseValidationFailureCode: null,
    missingPublicFields: [],
    unknownPublicFields: [],
    invalidResponseType: false,
    invalidFallbackReasonCombination: false,
    messageCharacterLimitExceeded: false,
    responseWordLimitExceeded: false,
    responseByteLimitExceeded: false,
    nextActionLabelLimitExceeded: false,
    semanticSafetyFailed: false,
    semanticSafetyFailureCode: null,
    deterministicFallbackUsed: false,
    ...overrides,
  };
}

export class CoachProviderError extends Error {
  constructor(
    readonly provider: CoachProviderId,
    readonly errorType: CoachProviderErrorCategory,
    message: string,
    readonly diagnostics: CoachProviderSafeDiagnostics =
      buildCoachProviderSafeDiagnostics(errorType)
  ) {
    super(message);
    this.name = "CoachProviderError";
  }
}
