import {
  CoachApiRequestV1,
  CoachApiResponsePayloadV1,
} from "../contracts/CoachApiContract";

function buildGoalFrame(goal: string | undefined): string {
  switch (goal) {
    case "understand_basics":
      return "Focus on the foundation first.";
    case "learn_controller":
      return "This connects later to Play, Cue, EQ and fader timing.";
    case "first_transition":
      return "This is one building block for starting Track B cleanly.";
    case "record_mini_mix":
      return "A short practice mix is this same timing habit repeated.";
    case "play_small_party":
      return "Big DJ goals start with small timing habits.";
    default:
      return "Keep the next step small and practical.";
  }
}

function buildSession7Message(request: CoachApiRequestV1): CoachApiResponsePayloadV1 {
  const latestAttempt = request.context.session7?.latestAttempt;

  if (!latestAttempt) {
    return {
      message:
        "Your mini attempt result is not available yet. Finish the attempt first, then I can explain the timing feedback.",
      nextActionLabel: "Complete the mini attempt.",
      responseType: "capability_limit",
      fallbackReasonId: "unavailable_analysis",
    };
  }

  switch (latestAttempt.landingResult) {
    case "great":
      return {
        message:
          "Great landing. Track B started very close to the strong 1, so the transition should feel controlled.",
        nextActionLabel: "Try to repeat the same timing.",
        responseType: "attempt_feedback",
        fallbackReasonId: null,
      };
    case "close":
      return {
        message:
          "That was close. Keep counting and aim to start Track B right on the next strong 1.",
        nextActionLabel: "Retry and keep the count steady.",
        responseType: "attempt_feedback",
        fallbackReasonId: null,
      };
    case "early":
      return {
        message:
          "Track B landed a little early. Wait slightly longer before starting it on the next strong 1.",
        nextActionLabel: "Retry and wait slightly longer.",
        responseType: "attempt_feedback",
        fallbackReasonId: null,
      };
    case "late":
      return {
        message:
          "Track B landed a little late. Keep counting steadily and start Track B a little sooner on the next strong 1.",
        nextActionLabel: "Retry and prepare earlier.",
        responseType: "attempt_feedback",
        fallbackReasonId: null,
      };
  }
}

export function buildMockCoachResponse(
  request: CoachApiRequestV1
): CoachApiResponsePayloadV1 {
  if (request.context.lesson?.sessionNumber === 7) {
    return buildSession7Message(request);
  }

  if (request.question.source === "free_text") {
    return {
      message:
        "I can help with this lesson, but this mock coach is not connected to an AI provider yet.",
      nextActionLabel: "Use one suggested question for now.",
      responseType: "capability_limit",
      fallbackReasonId: "capability_limit",
    };
  }

  const goalFrame = buildGoalFrame(request.context.learnerProfile?.goal);

  switch (request.question.suggestedQuestionId) {
    case "explain_more_simply":
      return {
        message:
          "Keep your taps evenly spaced. Do not rush. A steady pulse is the base of every clean mix.",
        nextActionLabel: "Try one steady tap round.",
        responseType: "concept_clarification",
        fallbackReasonId: null,
      };
    case "why_this_matters":
      return {
        message: `${goalFrame} Steady timing helps every transition feel calmer and more controlled.`,
        nextActionLabel: "Practice the pulse again.",
        responseType: "lesson_explanation",
        fallbackReasonId: null,
      };
    case "how_on_controller":
      return {
        message:
          "On a controller, this timing helps you press Play or Cue at the right moment. I cannot inspect your exact controller yet.",
        nextActionLabel: "Connect the count to Play timing.",
        responseType: "setup_guidance",
        fallbackReasonId: null,
      };
    case "what_should_i_do_next":
      return {
        message:
          "Do one more short practice round. Focus on even spacing before worrying about speed.",
        nextActionLabel: "Repeat the practice round.",
        responseType: "next_action",
        fallbackReasonId: null,
      };
    case "what_should_i_listen_for":
    case "what_should_i_focus_on":
    default:
      return {
        message:
          "Focus on steady spacing between taps. The goal is not speed; it is control.",
        nextActionLabel: "Tap with steady spacing.",
        responseType: "lesson_explanation",
        fallbackReasonId: null,
      };
  }
}
