import type {
  BootcampSessionNumber,
  CoachFallbackReasonId,
  CoachSuggestedQuestionId,
} from "../contracts/CoachApiContract";
import type { ApiErrorCode } from "../http/ApiError";
import type {
  CoachProviderId,
  CoachProviderErrorCategory,
  CoachProviderMode,
} from "../coach/providerTypes";
import type { CoachResponseValidationFailureCode } from "../coach/coachResponseValidator";
import type { CoachRuntimeSafetyFailureCode } from "../coach/coachRuntimeSafety";

export type CoachTelemetryResultCategory =
  | "success"
  | "validation_error"
  | "scope_reject"
  | "rate_limited"
  | "provider_guardrail_blocked"
  | "provider_usage_cap_blocked"
  | "provider_fallback"
  | "semantic_safety_fallback"
  | "server_failure";

export type CoachTelemetryEvent = {
  event: "coach_request_completed";
  requestId?: string;
  providerMode: CoachProviderMode;
  route: "/v1/coach/respond";
  sessionNumber?: BootcampSessionNumber;
  questionSource?: "suggested" | "free_text";
  suggestedQuestionId?: CoachSuggestedQuestionId;
  result: CoachTelemetryResultCategory;
  publicErrorType?: ApiErrorCode;
  fallbackReasonId?: CoachFallbackReasonId;
  elapsedMs: number;
  providerInvocationAttempted: boolean;
  providerUsageCapOutcome?: "allowed" | "blocked" | "unavailable";
  providerUsageCapLimit?: number;
  providerUsageCapRemaining?: number;
  providerLatencyMs?: number;
  providerInputTokens?: number;
  providerOutputTokens?: number;
  providerTotalTokens?: number;
  experimentId?: string;
  experimentVersion?: string;
  assignedProvider?: CoachProviderId;
  actualExternalProvider?: CoachProviderId;
  fallbackCategory?: "provider_fallback" | "semantic_safety_fallback";
  providerErrorCategory?: CoachProviderErrorCategory;
  providerHttpStatus?: number;
  responseValidationFailureCode?: CoachResponseValidationFailureCode;
  semanticSafetyFailureCode?: CoachRuntimeSafetyFailureCode;
};

export function emitCoachTelemetry(event: CoachTelemetryEvent): void {
  console.log(JSON.stringify(event));
}
