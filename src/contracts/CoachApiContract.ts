export const coachApiContractVersion = 1 as const;

export const coachApiLimits = {
  requestBodyMaxBytes: 16 * 1024,
  responseBodyMaxBytes: 32 * 1024,
  freeTextQuestionMaxChars: 240,
  requestIdMaxChars: 80,
  localeMaxChars: 35,
  messageMaxChars: 700,
  responseTargetMaxWords: 80,
  responseHardMaxWords: 100,
  nextActionLabelMaxChars: 160,
  mobileTimeoutMs: 15_000,
  backendProviderTimeoutMs: 12_000,
} as const;

export const coachServerPolicy = {
  anonymousIpMaxRequestsPerTenMinutes: 10,
  anonymousIpMaxRequestsPerDay: 50,
  environmentMaxRequestsPerDay: 500,
  backendProviderMaxRetryCount: 1,
  clientAutomaticRetryCount: 0,
} as const;

export const coachSuggestedQuestionIdValues = [
  "what_should_i_listen_for",
  "what_should_i_focus_on",
  "explain_more_simply",
  "why_this_matters",
  "what_should_i_do_next",
  "why_was_timing_early",
  "explain_timing_result",
  "how_on_controller",
  "what_focus_on_retry",
] as const;

export type CoachSuggestedQuestionId =
  (typeof coachSuggestedQuestionIdValues)[number];

export const coachResponseTypeValues = [
  "lesson_explanation",
  "next_action",
  "concept_clarification",
  "setup_guidance",
  "attempt_feedback",
  "scope_redirect",
  "capability_limit",
  "error_fallback",
] as const;

export type CoachResponseType = (typeof coachResponseTypeValues)[number];

export const coachFallbackReasonIdValues = [
  "capability_limit",
  "off_topic",
  "unavailable_analysis",
  "prompt_injection",
  "malformed_response",
  "response_too_long",
  "service_failure",
] as const;

export type CoachFallbackReasonId =
  (typeof coachFallbackReasonIdValues)[number];

export const skillLevelValues = [
  "complete_beginner",
  "knows_basics",
  "tried_mixing",
  "simple_transitions",
] as const;

export type SkillLevel = (typeof skillLevelValues)[number];

export const controllerStatusValues = ["yes", "no", "planning"] as const;

export type ControllerStatus = (typeof controllerStatusValues)[number];

export const controllerBrandValues = [
  "pioneer_alphatheta",
  "hercules",
  "numark",
  "native_instruments",
  "denon",
  "other",
  "not_sure",
] as const;

export type ControllerBrand = (typeof controllerBrandValues)[number];

export const preferredGenreValues = [
  "house",
  "techno",
  "melodic_house",
  "afro_house",
  "open_format",
  "not_sure",
] as const;

export type PreferredGenre = (typeof preferredGenreValues)[number];

export const userGoalValues = [
  "understand_basics",
  "learn_controller",
  "first_transition",
  "record_mini_mix",
  "play_small_party",
] as const;

export type UserGoal = (typeof userGoalValues)[number];

export const mentorIdValues = ["nova", "aria", "kade"] as const;

export type MentorId = (typeof mentorIdValues)[number];

export const bootcampSessionNumberValues = [1, 2, 3, 4, 5, 6, 7] as const;

export type BootcampSessionNumber =
  (typeof bootcampSessionNumberValues)[number];

export const session7LandingResultValues = [
  "great",
  "close",
  "early",
  "late",
] as const;

export type Session7LandingResult =
  (typeof session7LandingResultValues)[number];

export const session7NextFocusIdValues = [
  "making_space",
  "finding_the_one",
  "timing",
] as const;

export type Session7NextFocusId =
  (typeof session7NextFocusIdValues)[number];

export const interactionTypeValues = [
  "read",
  "mentorCue",
  "countInPlayback",
  "tapPulse",
  "findTheOneQuiz",
  "phrasePrediction",
  "abListening",
  "transitionSimulation",
  "miniAttempt",
  "uploadReview",
] as const;

export type InteractionType = (typeof interactionTypeValues)[number];

export const coachLessonPhaseValues = [
  "learn",
  "practice",
  "quick_check",
  "result",
  "finish",
] as const;

export type CoachLessonPhase = (typeof coachLessonPhaseValues)[number];

export type CoachApiQuestionV1 =
  | {
      source: "suggested";
      suggestedQuestionId: CoachSuggestedQuestionId;
    }
  | {
      source: "free_text";
      question: string;
    };

export type CoachApiLearnerProfileV1 = {
  mentorId?: MentorId;
  skillLevel?: SkillLevel;
  controllerStatus?: ControllerStatus;
  controllerBrand?: ControllerBrand;
  preferredGenre?: PreferredGenre;
  goal?: UserGoal;
};

export type CoachApiLessonContextV1 = {
  sessionNumber?: BootcampSessionNumber;
  lessonId?: string;
  lessonPhase?: CoachLessonPhase;
  activityType?: InteractionType;
};

export type CoachApiProgressContextV1 = {
  completedSessionNumbers: BootcampSessionNumber[];
};

export type CoachApiSession7AttemptV1 = {
  completedAt: string;
  landingResult: Session7LandingResult;
  landingOffsetMs: number;
  landingTimingScore: number;
  nextFocusId: Session7NextFocusId;
};

export type CoachApiSession7ContextV1 = {
  latestAttempt?: CoachApiSession7AttemptV1;
  bestAttempt?: CoachApiSession7AttemptV1;
  currentNextFocusId?: Session7NextFocusId;
};

export type CoachApiContextV1 = {
  learnerProfile?: CoachApiLearnerProfileV1;
  lesson?: CoachApiLessonContextV1;
  progress: CoachApiProgressContextV1;
  session7?: CoachApiSession7ContextV1;
};

export type CoachApiRequestV1 = {
  contractVersion: typeof coachApiContractVersion;
  requestId: string;
  question: CoachApiQuestionV1;
  context: CoachApiContextV1;
  locale: string | null;
};

export type CoachApiResponsePayloadV1 = {
  message: string;
  nextActionLabel: string | null;
  responseType: CoachResponseType;
  fallbackReasonId: CoachFallbackReasonId | null;
};

export type CoachApiSuccessResponseV1 = {
  contractVersion: typeof coachApiContractVersion;
  requestId: string;
  response: CoachApiResponsePayloadV1;
};
