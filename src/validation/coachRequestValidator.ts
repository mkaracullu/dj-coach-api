import {
  bootcampSessionNumberValues,
  coachApiContractVersion,
  coachApiLimits,
  CoachApiContextV1,
  CoachApiLearnerProfileV1,
  CoachApiLessonContextV1,
  CoachApiProgressContextV1,
  CoachApiQuestionV1,
  CoachApiRequestV1,
  CoachApiSession7AttemptV1,
  CoachApiSession7ContextV1,
  coachLessonPhaseValues,
  coachSuggestedQuestionIdValues,
  controllerBrandValues,
  controllerStatusValues,
  interactionTypeValues,
  isValidCoachRequestId,
  mentorIdValues,
  preferredGenreValues,
  session7LandingResultValues,
  session7NextFocusIdValues,
  skillLevelValues,
  userGoalValues,
} from "../contracts/CoachApiContract";
import { apiError } from "../http/json";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[]
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function hasRequiredKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[]
): boolean {
  return requiredKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function isOneOf<T extends string | number>(
  value: unknown,
  allowedValues: readonly T[]
): value is T {
  return allowedValues.includes(value as T);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function validateRequestId(value: unknown): string {
  if (!isValidCoachRequestId(value)) {
    throw apiError("invalid_request", "Request ID is invalid.", 400);
  }

  return value;
}

function validateLocale(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > coachApiLimits.localeMaxChars ||
    !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)
  ) {
    throw apiError("invalid_request", "Locale is invalid.", 400);
  }

  return value;
}

function validateQuestion(value: unknown): CoachApiQuestionV1 {
  if (!isPlainObject(value)) {
    throw apiError("invalid_request", "Question is invalid.", 400);
  }

  if (value.source === "suggested") {
    if (
      !hasOnlyKeys(value, ["source", "suggestedQuestionId"]) ||
      !hasRequiredKeys(value, ["source", "suggestedQuestionId"]) ||
      !isOneOf(value.suggestedQuestionId, coachSuggestedQuestionIdValues)
    ) {
      throw apiError("invalid_request", "Suggested question is invalid.", 400);
    }

    return {
      source: "suggested",
      suggestedQuestionId: value.suggestedQuestionId,
    };
  }

  if (value.source === "free_text") {
    if (
      !hasOnlyKeys(value, ["source", "question"]) ||
      !hasRequiredKeys(value, ["source", "question"]) ||
      typeof value.question !== "string"
    ) {
      throw apiError("invalid_request", "Free-text question is invalid.", 400);
    }

    const question = normalizeText(value.question);

    if (
      question.length === 0 ||
      question.length > coachApiLimits.freeTextQuestionMaxChars
    ) {
      throw apiError("invalid_request", "Free-text question is invalid.", 400);
    }

    return {
      source: "free_text",
      question,
    };
  }

  throw apiError("invalid_request", "Question source is invalid.", 400);
}

function validateLearnerProfile(
  value: unknown
): CoachApiLearnerProfileV1 | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw apiError("invalid_request", "Learner profile is invalid.", 400);
  }

  if (
    !hasOnlyKeys(value, [
      "mentorId",
      "skillLevel",
      "controllerStatus",
      "controllerBrand",
      "preferredGenre",
      "goal",
    ])
  ) {
    throw apiError(
      "invalid_request",
      "Learner profile contains unsupported fields.",
      400
    );
  }

  const profile: CoachApiLearnerProfileV1 = {};

  if (value.mentorId !== undefined) {
    if (!isOneOf(value.mentorId, mentorIdValues)) {
      throw apiError("invalid_request", "Mentor ID is invalid.", 400);
    }

    profile.mentorId = value.mentorId;
  }

  if (value.skillLevel !== undefined) {
    if (!isOneOf(value.skillLevel, skillLevelValues)) {
      throw apiError("invalid_request", "Skill level is invalid.", 400);
    }

    profile.skillLevel = value.skillLevel;
  }

  if (value.controllerStatus !== undefined) {
    if (!isOneOf(value.controllerStatus, controllerStatusValues)) {
      throw apiError("invalid_request", "Controller status is invalid.", 400);
    }

    profile.controllerStatus = value.controllerStatus;
  }

  if (value.controllerBrand !== undefined) {
    if (!isOneOf(value.controllerBrand, controllerBrandValues)) {
      throw apiError("invalid_request", "Controller brand is invalid.", 400);
    }

    if (value.controllerStatus !== "yes") {
      throw apiError(
        "invalid_request",
        "Controller brand may only be sent when controller status is yes.",
        400
      );
    }

    profile.controllerBrand = value.controllerBrand;
  }

  if (value.preferredGenre !== undefined) {
    if (!isOneOf(value.preferredGenre, preferredGenreValues)) {
      throw apiError("invalid_request", "Preferred genre is invalid.", 400);
    }

    profile.preferredGenre = value.preferredGenre;
  }

  if (value.goal !== undefined) {
    if (!isOneOf(value.goal, userGoalValues)) {
      throw apiError("invalid_request", "User goal is invalid.", 400);
    }

    profile.goal = value.goal;
  }

  return profile;
}

function validateLesson(value: unknown): CoachApiLessonContextV1 | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw apiError("invalid_request", "Lesson context is invalid.", 400);
  }

  if (
    !hasOnlyKeys(value, [
      "sessionNumber",
      "lessonId",
      "lessonPhase",
      "activityType",
    ])
  ) {
    throw apiError(
      "invalid_request",
      "Lesson context contains unsupported fields.",
      400
    );
  }

  const lesson: CoachApiLessonContextV1 = {};

  if (value.sessionNumber !== undefined) {
    if (!isOneOf(value.sessionNumber, bootcampSessionNumberValues)) {
      throw apiError("invalid_request", "Session number is invalid.", 400);
    }

    lesson.sessionNumber = value.sessionNumber;
  }

  if (value.lessonId !== undefined) {
    if (
      typeof value.lessonId !== "string" ||
      value.lessonId.length === 0 ||
      value.lessonId.length > 120 ||
      !/^[A-Za-z0-9_-]+$/.test(value.lessonId)
    ) {
      throw apiError("invalid_request", "Lesson ID is invalid.", 400);
    }

    lesson.lessonId = value.lessonId;
  }

  if (value.lessonPhase !== undefined) {
    if (!isOneOf(value.lessonPhase, coachLessonPhaseValues)) {
      throw apiError("invalid_request", "Lesson phase is invalid.", 400);
    }

    lesson.lessonPhase = value.lessonPhase;
  }

  if (value.activityType !== undefined) {
    if (!isOneOf(value.activityType, interactionTypeValues)) {
      throw apiError("invalid_request", "Activity type is invalid.", 400);
    }

    lesson.activityType = value.activityType;
  }

  return lesson;
}

function validateProgress(value: unknown): CoachApiProgressContextV1 {
  if (!isPlainObject(value)) {
    throw apiError("invalid_request", "Progress context is invalid.", 400);
  }

  if (
    !hasOnlyKeys(value, ["completedSessionNumbers"]) ||
    !hasRequiredKeys(value, ["completedSessionNumbers"]) ||
    !Array.isArray(value.completedSessionNumbers) ||
    value.completedSessionNumbers.length > bootcampSessionNumberValues.length
  ) {
    throw apiError("invalid_request", "Completed sessions are invalid.", 400);
  }

  const completedSessionNumbers = value.completedSessionNumbers.map(
    (sessionNumber) => {
      if (!isOneOf(sessionNumber, bootcampSessionNumberValues)) {
        throw apiError("invalid_request", "Completed session number is invalid.", 400);
      }

      return sessionNumber;
    }
  );

  return {
    completedSessionNumbers: [...new Set(completedSessionNumbers)],
  };
}

function validateSession7Attempt(
  value: unknown,
  label: string
): CoachApiSession7AttemptV1 | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw apiError("invalid_request", `${label} is invalid.`, 400);
  }

  if (
    !hasOnlyKeys(value, [
      "landingResult",
      "landingOffsetMs",
      "landingTimingScore",
      "nextFocusId",
    ]) ||
    !hasRequiredKeys(value, [
      "landingResult",
      "landingOffsetMs",
      "landingTimingScore",
      "nextFocusId",
    ])
  ) {
    throw apiError("invalid_request", `${label} shape is invalid.`, 400);
  }

  if (!isOneOf(value.landingResult, session7LandingResultValues)) {
    throw apiError("invalid_request", `${label} landing result is invalid.`, 400);
  }

  if (
    typeof value.landingOffsetMs !== "number" ||
    !Number.isFinite(value.landingOffsetMs) ||
    Math.abs(value.landingOffsetMs) > 10_000
  ) {
    throw apiError("invalid_request", `${label} landing offset is invalid.`, 400);
  }

  if (
    typeof value.landingTimingScore !== "number" ||
    !Number.isFinite(value.landingTimingScore) ||
    value.landingTimingScore < 0 ||
    value.landingTimingScore > 50
  ) {
    throw apiError("invalid_request", `${label} timing score is invalid.`, 400);
  }

  if (!isOneOf(value.nextFocusId, session7NextFocusIdValues)) {
    throw apiError("invalid_request", `${label} next focus is invalid.`, 400);
  }

  return {
    landingResult: value.landingResult,
    landingOffsetMs: value.landingOffsetMs,
    landingTimingScore: value.landingTimingScore,
    nextFocusId: value.nextFocusId,
  };
}

function validateSession7(
  value: unknown
): CoachApiSession7ContextV1 | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw apiError("invalid_request", "Session 7 context is invalid.", 400);
  }

  if (
    !hasOnlyKeys(value, [
      "latestAttempt",
      "bestAttempt",
      "currentNextFocusId",
    ])
  ) {
    throw apiError(
      "invalid_request",
      "Session 7 context contains unsupported fields.",
      400
    );
  }

  const session7: CoachApiSession7ContextV1 = {};
  const latestAttempt = validateSession7Attempt(
    value.latestAttempt,
    "Latest Session 7 attempt"
  );
  const bestAttempt = validateSession7Attempt(
    value.bestAttempt,
    "Best Session 7 attempt"
  );

  if (latestAttempt) {
    session7.latestAttempt = latestAttempt;
  }

  if (bestAttempt) {
    session7.bestAttempt = bestAttempt;
  }

  if (value.currentNextFocusId !== undefined) {
    if (!isOneOf(value.currentNextFocusId, session7NextFocusIdValues)) {
      throw apiError("invalid_request", "Current next focus is invalid.", 400);
    }

    session7.currentNextFocusId = value.currentNextFocusId;
  }

  return session7;
}

function validateContext(value: unknown): CoachApiContextV1 {
  if (!isPlainObject(value)) {
    throw apiError("invalid_request", "Coach context is invalid.", 400);
  }

  if (
    !hasOnlyKeys(value, ["learnerProfile", "lesson", "progress", "session7"]) ||
    !hasRequiredKeys(value, ["progress"])
  ) {
    throw apiError("invalid_request", "Coach context shape is invalid.", 400);
  }

  const learnerProfile = validateLearnerProfile(value.learnerProfile);
  const lesson = validateLesson(value.lesson);
  const progress = validateProgress(value.progress);
  const session7 = validateSession7(value.session7);

  return {
    ...(learnerProfile ? { learnerProfile } : {}),
    ...(lesson ? { lesson } : {}),
    progress,
    ...(session7 ? { session7 } : {}),
  };
}

export function validateCoachApiRequest(value: unknown): CoachApiRequestV1 {
  if (!isPlainObject(value)) {
    throw apiError("invalid_request", "Coach request must be an object.", 400);
  }

  if (
    !hasOnlyKeys(value, [
      "contractVersion",
      "requestId",
      "question",
      "context",
      "locale",
    ]) ||
    !hasRequiredKeys(value, [
      "contractVersion",
      "requestId",
      "question",
      "context",
      "locale",
    ])
  ) {
    throw apiError("invalid_request", "Coach request shape is invalid.", 400);
  }

  if (value.contractVersion !== coachApiContractVersion) {
    throw apiError(
      "invalid_request",
      "Coach request contract version is unsupported.",
      400
    );
  }

  return {
    contractVersion: coachApiContractVersion,
    requestId: validateRequestId(value.requestId),
    question: validateQuestion(value.question),
    context: validateContext(value.context),
    locale: validateLocale(value.locale),
  };
}
