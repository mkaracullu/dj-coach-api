import type {
  BootcampSessionNumber,
  CoachFallbackReasonId,
  CoachSuggestedQuestionId,
} from "../contracts/CoachApiContract";
import type { ApiErrorCode } from "../http/ApiError";
import type { CoachProviderMode } from "../coach/providerTypes";

export type CoachTelemetryResultCategory =
  | "success"
  | "validation_error"
  | "scope_reject"
  | "rate_limited"
  | "provider_guardrail_blocked"
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
};

export function emitCoachTelemetry(event: CoachTelemetryEvent): void {
  console.log(JSON.stringify(event));
}
