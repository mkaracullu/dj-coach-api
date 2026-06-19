import type { CoachApiSuccessResponseV1 } from "../contracts/CoachApiContract";

export type CoachRuntimeSafetyFailureCode =
  | "app_state_mutation_claim"
  | "unavailable_capability_claim"
  | "hidden_instruction_exposure"
  | "prompt_injection_compliance"
  | "piracy_guidance";

export class UnsafeCoachResponseError extends Error {
  constructor(readonly code: CoachRuntimeSafetyFailureCode) {
    super("Coach response failed runtime semantic safety validation.");
    this.name = "UnsafeCoachResponseError";
  }
}

const appStateMutationPatterns = [
  /\b(?:i|we)(?:\s+have|['’]ve)?\s+(?:completed|finished|marked|changed|updated)\s+(?:the\s+|your\s+)?(?:lesson|session|practice|progress)\b/i,
  /\b(?:i|we)(?:\s+have|['’]ve)?\s+(?:navigated|moved|sent|took)\s+you\s+(?:to|back|forward)\b/i,
  /\b(?:i|we)(?:\s+have|['’]ve)?\s+(?:started|triggered)\s+(?:the\s+|your\s+)?retry\b/i,
] as const;

const unavailableCapabilityPatterns = [
  /\b(?:i|we)(?:\s+have|['’]ve)?\s+(?:started|stopped|played|paused|controlled)\s+(?:the\s+|your\s+)?(?:audio|playback|track|recording)\b/i,
  /\b(?:i|we)(?:\s+have|['’]ve)?\s+(?:recorded(?:\s+and\s+analy[sz]ed)?|heard|listened\s+to|analy[sz]ed)\s+(?:the\s+|your\s+)?(?:room|audio|recording|mix|transition)\b/i,
  /\b(?:i|we)(?:\s+have|['’]ve)?\s+(?:used|enabled|activated|turned\s+on)\s+(?:the\s+|your\s+)?(?:microphone|camera)\b/i,
  /\b(?:i|we)(?:\s+have|['’]ve)?\s+(?:inspected|checked|saw)\s+(?:the\s+|your\s+)?(?:controller|camera)\b/i,
  /\b(?:i|we)(?:\s+have|['’]ve)?\s+(?:pressed|controlled|moved|set)\s+(?:the\s+|your\s+)?(?:cue|play|eq|fader|controller)\b/i,
] as const;

const hiddenInstructionPatterns = [
  /\b(?:system|developer|hidden)\s+(?:prompt|instructions?)\s*(?::|is|are)\s*/i,
  /\bhere\s+(?:is|are)\s+(?:the\s+)?(?:system|developer|hidden)\s+(?:prompt|instructions?)\b/i,
] as const;

const promptInjectionCompliancePatterns = [
  /\b(?:i\s+(?:will|can)|i['’]ll|please|now)\s+ignore\s+(?:all\s+|the\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|prompt)\b/i,
  /\b(?:i|we)(?:\s+have|['’]ve)?\s+(?:ignored|overrode|bypassed)\s+(?:the\s+|your\s+)?(?:previous|prior|system|developer)?\s*(?:instructions?|prompt|rules)\b/i,
] as const;

const piracyPatterns = [
  /\b(?:download|get|find|use)\b[^.!?\n]{0,80}\b(?:pirated|cracked|torrent)\b/i,
  /\b(?:use|visit)\s+(?:a\s+)?torrent\b/i,
  /\b(?:bypass|circumvent|remove)\b[^.!?\n]{0,50}\b(?:copyright|licen[cs]e|payment|drm)\b/i,
] as const;

const denialPattern =
  /\b(?:cannot|can['’]t|won['’]t|will\s+not|do\s+not|don['’]t|unable\s+to|not\s+able\s+to)\b/i;

function hasMatch(
  text: string,
  patterns: readonly RegExp[]
): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function containsPiracyGuidance(text: string): boolean {
  return text
    .split(/[.!?\n]+/)
    .some(
      (sentence) =>
        hasMatch(sentence, piracyPatterns) && !denialPattern.test(sentence)
    );
}

export function validateCoachRuntimeSemanticSafety(
  response: CoachApiSuccessResponseV1
): CoachApiSuccessResponseV1 {
  const publicText = [
    response.response.message,
    response.response.nextActionLabel ?? "",
  ].join("\n");

  if (hasMatch(publicText, appStateMutationPatterns)) {
    throw new UnsafeCoachResponseError("app_state_mutation_claim");
  }

  if (hasMatch(publicText, unavailableCapabilityPatterns)) {
    throw new UnsafeCoachResponseError("unavailable_capability_claim");
  }

  if (hasMatch(publicText, hiddenInstructionPatterns)) {
    throw new UnsafeCoachResponseError("hidden_instruction_exposure");
  }

  if (hasMatch(publicText, promptInjectionCompliancePatterns)) {
    throw new UnsafeCoachResponseError("prompt_injection_compliance");
  }

  if (containsPiracyGuidance(publicText)) {
    throw new UnsafeCoachResponseError("piracy_guidance");
  }

  return response;
}
