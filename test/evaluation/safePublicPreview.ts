import type { CoachApiSuccessResponseV1 } from "../../src/contracts/CoachApiContract";
import type { CoachEvaluationReport } from "./coachEvaluator";

export function isSafePublicTextPreviewEnabled(
  value: string | undefined
): boolean {
  return value === "true";
}

export function addSafePublicTextPreview(
  report: CoachEvaluationReport,
  response: CoachApiSuccessResponseV1,
  enabled: boolean
): CoachEvaluationReport & {
  publicResponse?: CoachApiSuccessResponseV1["response"];
} {
  if (!enabled) {
    return report;
  }

  return {
    ...report,
    publicResponse: {
      message: response.response.message,
      nextActionLabel: response.response.nextActionLabel,
      responseType: response.response.responseType,
      fallbackReasonId: response.response.fallbackReasonId,
    },
  };
}
