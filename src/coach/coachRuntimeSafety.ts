import type {
  CoachApiRequestV1,
  CoachApiSuccessResponseV1,
  Session7LandingResult,
} from "../contracts/CoachApiContract";

export type CoachRuntimeSafetyFailureCode =
  | "app_state_mutation_claim"
  | "unavailable_capability_claim"
  | "hidden_instruction_exposure"
  | "prompt_injection_compliance"
  | "piracy_guidance"
  | "session7_ambiguous_timing_direction"
  | "session7_attempt_feedback_required"
  | "session7_contradictory_timing_direction"
  | "session7_internal_attempt_field_exposure"
  | "session7_counting_speed_change_instruction"
  | "session7_unobserved_controller_action_claim"
  | "session7_unsafe_controller_procedure";

export type Session7AttemptTextSafetyFailureCode = Exclude<
  CoachRuntimeSafetyFailureCode,
  | "app_state_mutation_claim"
  | "unavailable_capability_claim"
  | "hidden_instruction_exposure"
  | "prompt_injection_compliance"
  | "piracy_guidance"
  | "session7_attempt_feedback_required"
>;

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

const session7AmbiguousTimingDirectionPatterns = [
  /\bearly\s*\/\s*late\b/i,
  /\blate\s*\/\s*early\b/i,
  /\bearly\s+or\s+late\b/i,
  /\blate\s+or\s+early\b/i,
  /\bearly\s+and\s+late\b/i,
  /\blate\s+and\s+early\b/i,
  /(?<![\p{L}\p{N}_])erken\s*\/\s*geç(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])geç\s*\/\s*erken(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])erken\s+veya\s+geç(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])geç\s+veya\s+erken(?![\p{L}\p{N}_])/iu,
] as const;

const session7InternalAttemptFieldPatterns = [
  /\btimingScore\b/i,
  /\blandingTimingScore\b/i,
  /\blandingOffsetMs\b/i,
  /\boffsetMs\b/i,
  /\bnextFocus\b/i,
  /\bnextFocusId\b/i,
] as const;

const session7CountingSpeedChangePatterns = [
  /\bcount(?:\s+the\s+beats?)?\s+(?:more\s+)?(?:slowly|faster|quicker)\b/i,
  /\b(?:slow|speed)\s+up\s+(?:your\s+|the\s+)?count(?:ing)?\b/i,
  /\bslow\s+(?:your\s+|the\s+)?count(?:ing)?\b/i,
  /\bspeed\s+(?:your\s+|the\s+)?count(?:ing)?\b/i,
  /(?<![\p{L}\p{N}_])daha\s+(?:yavaş|hızlı)\s+say(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])sayımı\s+(?:yavaşlat|hızlandır)(?![\p{L}\p{N}_])/iu,
] as const;

const session7NegatedCountingSpeedChangePatterns = [
  /\b(?:do\s+not|don['’]t|never)\s+count(?:\s+the\s+beats?)?\s+(?:more\s+)?(?:slowly|faster|quicker)\b/gi,
  /\b(?:do\s+not|don['’]t|never)\s+(?:(?:slow|speed)\s+up|slow|speed)\s+(?:your\s+|the\s+)?count(?:ing)?\b/gi,
  /(?<![\p{L}\p{N}_])daha\s+(?:yavaş|hızlı)\s+sayma(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])sayımı\s+(?:yavaşlatma|hızlandırma)(?![\p{L}\p{N}_])/giu,
] as const;

const session7UnobservedPastControllerActionPatterns = [
  /\byou\s+(?:pressed|hit|tapped|released|moved|set|touched|used)\s+(?:the\s+)?(?:play|cue|deck\s+cue|headphone\s+cue|pfl|fader|crossfader|eq|knob|controller)\b/i,
  /\byou\s+(?:pressed|hit|tapped|released)\s+(?:play|cue)\b/i,
  /(?<![\p{L}\p{N}_])(?:play|cue)(?:['’](?:e|a|ye|ya))?.{0,40}(?:bastın|dokundun|bıraktın)(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])(?:fader|crossfader|eq|ekolayzır|düğme|knob)(?:['’](?:ı|i|u|ü|yı|yi|yu|yü))?.{0,40}(?:hareket\s+ettirdin|oynattın|çevirdin|ayarladın|dokundun|kullandın)(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])kontrolcü(?:deki|de|yü|ye)?.{0,50}(?:hareket\s+ettirdin|oynattın|çevirdin|ayarladın|dokundun|kullandın)(?![\p{L}\p{N}_])/iu,
] as const;

const session7UnsafeControllerProcedurePatterns = [
  /\b(?:press|release|hit|tap|move|set|touch|use)\s+(?:the\s+)?(?:play|cue|deck\s+cue|headphone\s+cue|pfl|fader|crossfader|eq|knob|controller)\b/i,
  /\bpress\s+(?:the\s+)?cue\b[^.!?\n]{0,80}\b(?:press|release|hit|tap)\s+(?:the\s+)?play\b/i,
  /\b(?:press|release|hit|tap)\s+(?:the\s+)?play\b[^.!?\n]{0,80}\bpress\s+(?:the\s+)?cue\b/i,
  /(?<![\p{L}\p{N}_])(?:play|cue)(?:(?:['’](?:e|a|ye|ya))|\s+(?:tuşuna|düğmesine|butonuna))?\s+(?:basmalısınız|basmalısın|basın|basıp|basarak|bas)(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])(?:fader|crossfader|eq|ekolayzır|düğme|knob)(?:['’](?:ı|i|u|ü|yı|yi|yu|yü))?\s+(?:hareket\s+ettir|oynat|çevir|ayarla|dokun|kullan)(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])kontrolcü(?:deki|de)?.{0,50}(?:hareket\s+ettir|oynat|çevir|ayarla|dokun|kullan)(?![\p{L}\p{N}_])/iu,
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

function removeMatches(
  text: string,
  patterns: readonly RegExp[]
): string {
  return patterns.reduce(
    (remaining, pattern) => remaining.replace(pattern, ""),
    text
  );
}

function withoutNegatedDirection(
  clause: string,
  direction: "early" | "late"
): string {
  const englishDirection = direction === "early" ? "early" : "late";
  const turkishDirection = direction === "early" ? "erken" : "geç";

  return removeMatches(clause, [
    new RegExp(
      `\\b(?:not|never)\\s+(?:too\\s+|a\\s+bit\\s+|slightly\\s+)?${englishDirection}\\b`,
      "gi"
    ),
    new RegExp(
      `\\b(?:wasn['’]t|weren['’]t|isn['’]t|aren['’]t)\\s+(?:too\\s+|a\\s+bit\\s+|slightly\\s+)?${englishDirection}\\b`,
      "gi"
    ),
    new RegExp(
      `(?<![\\p{L}\\p{N}_])${turkishDirection}\\s+(?:kalmad(?:ım|ın|ı|ık|ınız|ılar)|başlamad(?:ım|ın|ı|ık|ınız|ılar)|girmed(?:im|in|i|ik|iniz|iler)|değild(?:im|in|i|ik|iniz|iler))(?![\\p{L}\\p{N}_])`,
      "giu"
    ),
  ]);
}

function sentenceClaimsDirection(
  sentence: string,
  direction: "early" | "late"
): boolean {
  const unnegatedSentence = withoutNegatedDirection(sentence, direction);
  const directionPattern =
    direction === "early"
      ? /(?<![\p{L}\p{N}_])(?:early|erken)(?![\p{L}\p{N}_])/iu
      : /(?<![\p{L}\p{N}_])(?:late|geç)(?![\p{L}\p{N}_])/iu;

  return (
    directionPattern.test(unnegatedSentence) &&
    hasMatch(unnegatedSentence, [
      /\b(?:you|track\s*b|b)\b.{0,60}\b(?:were|was|landed|started|came\s+in|arrived)\b/i,
      /\b(?:landed|started|came\s+in|arrived)\b.{0,60}\b(?:you|track\s*b|b)\b/i,
      /\b(?:timing|landing|result|start)\b.{0,60}\b(?:was|is|looks|felt|sounds|came\s+in|landed|started)\b/i,
      /\b(?:was|is)\s+(?:a\s+bit\s+|slightly\s+|too\s+)?(?:early|late)\b/i,
      /(?<![\p{L}\p{N}_])(?:sen|track\s*b)(?![\p{L}\p{N}_]).{0,80}(?:başlattın|başladın|girdin|kaldın|geldin)(?![\p{L}\p{N}_])/iu,
      /(?<![\p{L}\p{N}_])(?:zamanlaman|başlangıcın|sonucun)(?![\p{L}\p{N}_]).{0,60}(?:erken|geç)(?![\p{L}\p{N}_])/iu,
      /(?<![\p{L}\p{N}_])(?:erken|geç)\s+(?:başlattın|başladın|girdin|kaldın|geldin)(?![\p{L}\p{N}_])/iu,
    ])
  );
}

function hasCountingSpeedChangeInstruction(text: string): boolean {
  return text.split(/[.!?;\n]+/).some((clause) => {
    const unnegatedClause = removeMatches(
      clause,
      session7NegatedCountingSpeedChangePatterns
    );

    return hasMatch(
      unnegatedClause,
      session7CountingSpeedChangePatterns
    );
  });
}

function hasContradictoryTimingDirection(
  text: string,
  landingResult: Session7LandingResult
): boolean {
  const sentences = text.split(/[.!?;\n]+/);

  if (landingResult === "early") {
    return sentences.some((sentence) =>
      sentenceClaimsDirection(sentence, "late")
    );
  }

  if (landingResult === "late") {
    return sentences.some((sentence) =>
      sentenceClaimsDirection(sentence, "early")
    );
  }

  if (landingResult === "close" || landingResult === "great") {
    return sentences.some(
      (sentence) =>
        sentenceClaimsDirection(sentence, "early") ||
        sentenceClaimsDirection(sentence, "late")
    );
  }

  return false;
}

export function findSession7AttemptTextSafetyFailures(
  publicText: string,
  landingResult: Session7LandingResult
): Session7AttemptTextSafetyFailureCode[] {
  const failures: Session7AttemptTextSafetyFailureCode[] = [];

  if (hasMatch(publicText, session7AmbiguousTimingDirectionPatterns)) {
    failures.push("session7_ambiguous_timing_direction");
  }

  if (hasContradictoryTimingDirection(publicText, landingResult)) {
    failures.push("session7_contradictory_timing_direction");
  }

  if (hasMatch(publicText, session7InternalAttemptFieldPatterns)) {
    failures.push("session7_internal_attempt_field_exposure");
  }

  if (hasCountingSpeedChangeInstruction(publicText)) {
    failures.push("session7_counting_speed_change_instruction");
  }

  if (hasMatch(publicText, session7UnobservedPastControllerActionPatterns)) {
    failures.push("session7_unobserved_controller_action_claim");
  }

  if (hasMatch(publicText, session7UnsafeControllerProcedurePatterns)) {
    failures.push("session7_unsafe_controller_procedure");
  }

  return failures;
}

function validateSession7AttemptFeedbackSafety(
  response: CoachApiSuccessResponseV1,
  request: CoachApiRequestV1,
  publicText: string
): void {
  const attempt = request.context.session7?.latestAttempt;

  if (
    attempt === undefined ||
    request.context.lesson?.sessionNumber !== 7
  ) {
    return;
  }

  if (response.response.responseType !== "attempt_feedback") {
    throw new UnsafeCoachResponseError(
      "session7_attempt_feedback_required"
    );
  }

  const [failure] = findSession7AttemptTextSafetyFailures(
    publicText,
    attempt.landingResult
  );

  if (failure !== undefined) {
    throw new UnsafeCoachResponseError(failure);
  }
}

export function validateCoachRuntimeSemanticSafety(
  response: CoachApiSuccessResponseV1,
  request: CoachApiRequestV1
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

  validateSession7AttemptFeedbackSafety(response, request, publicText);

  return response;
}
