import type {
  CoachApiRequestV1,
  CoachSuggestedQuestionId,
} from "../contracts/CoachApiContract";
import { apiError } from "../http/json";

const allowedSuggestedQuestionsBySession = {
  2: new Set<CoachSuggestedQuestionId>([
    "what_should_i_focus_on",
    "explain_more_simply",
    "why_this_matters",
    "how_on_controller",
  ]),
  7: new Set<CoachSuggestedQuestionId>([
    "what_should_i_listen_for",
    "why_this_matters",
    "what_should_i_do_next",
    "how_on_controller",
    "explain_more_simply",
    "explain_timing_result",
    "what_focus_on_retry",
  ]),
} as const;

function productScopeError() {
  return apiError(
    "invalid_request",
    "Coach request is outside the supported product scope.",
    400
  );
}

export function validateCoachProductScope(
  request: CoachApiRequestV1
): CoachApiRequestV1 {
  if (request.question.source !== "suggested") {
    throw productScopeError();
  }

  const sessionNumber = request.context.lesson?.sessionNumber;

  if (sessionNumber !== 2 && sessionNumber !== 7) {
    throw productScopeError();
  }

  if (
    !allowedSuggestedQuestionsBySession[sessionNumber].has(
      request.question.suggestedQuestionId
    )
  ) {
    throw productScopeError();
  }

  return request;
}
