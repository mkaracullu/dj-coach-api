import {
  coachApiContractVersion,
  coachApiLimits,
  CoachApiSuccessResponseV1,
  CoachFallbackReasonId,
  coachFallbackReasonIdValues,
  CoachResponseType,
  coachResponseTypeValues,
  isValidCoachRequestId,
} from "../contracts/CoachApiContract";

const allowedFallbackReasons: Record<
  CoachResponseType,
  readonly (CoachFallbackReasonId | null)[]
> = {
  lesson_explanation: [null],
  next_action: [null],
  concept_clarification: [null],
  setup_guidance: [null],
  attempt_feedback: [null],
  scope_redirect: ["off_topic", "prompt_injection"],
  capability_limit: ["capability_limit", "unavailable_analysis"],
  error_fallback: [
    "malformed_response",
    "response_too_long",
    "service_failure",
  ],
};

export class InvalidCoachResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCoachResponseError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => expectedKeys.includes(key))
  );
}

function isOneOf<T extends string>(
  value: unknown,
  allowedValues: readonly T[]
): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}

function countWords(value: string): number {
  const normalized = value.trim();
  return normalized.length === 0 ? 0 : normalized.split(/\s+/).length;
}

function fail(message: string): never {
  throw new InvalidCoachResponseError(message);
}

export function validateCoachApiSuccessResponse(
  value: unknown,
  expectedRequestId: string
): CoachApiSuccessResponseV1 {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["contractVersion", "requestId", "response"])
  ) {
    fail("Coach response envelope is invalid.");
  }

  if (value.contractVersion !== coachApiContractVersion) {
    fail("Coach response contract version is unsupported.");
  }

  if (
    !isValidCoachRequestId(value.requestId) ||
    value.requestId !== expectedRequestId
  ) {
    fail("Coach response request ID does not match.");
  }

  if (
    !isPlainObject(value.response) ||
    !hasExactKeys(value.response, [
      "message",
      "nextActionLabel",
      "responseType",
      "fallbackReasonId",
    ])
  ) {
    fail("Coach response payload is invalid.");
  }

  const { message, nextActionLabel, responseType, fallbackReasonId } =
    value.response;

  if (
    typeof message !== "string" ||
    message.trim().length === 0 ||
    message.length > coachApiLimits.messageMaxChars
  ) {
    fail("Coach response message is invalid.");
  }

  if (
    nextActionLabel !== null &&
    (typeof nextActionLabel !== "string" ||
      nextActionLabel.trim().length === 0 ||
      nextActionLabel.length > coachApiLimits.nextActionLabelMaxChars)
  ) {
    fail("Coach response next action is invalid.");
  }

  if (!isOneOf(responseType, coachResponseTypeValues)) {
    fail("Coach response type is invalid.");
  }

  if (
    fallbackReasonId !== null &&
    !isOneOf(fallbackReasonId, coachFallbackReasonIdValues)
  ) {
    fail("Coach response fallback reason is invalid.");
  }

  if (!allowedFallbackReasons[responseType].includes(fallbackReasonId)) {
    fail("Coach response fallback reason does not match its response type.");
  }

  const totalWords =
    countWords(message) +
    (typeof nextActionLabel === "string" ? countWords(nextActionLabel) : 0);

  if (totalWords > coachApiLimits.responseHardMaxWords) {
    fail("Coach response text is too long.");
  }

  let serializedResponse: string;

  try {
    serializedResponse = JSON.stringify(value);
  } catch {
    fail("Coach response cannot be serialized.");
  }

  if (
    new TextEncoder().encode(serializedResponse).byteLength >
    coachApiLimits.responseBodyMaxBytes
  ) {
    fail("Coach response body is too large.");
  }

  return {
    contractVersion: coachApiContractVersion,
    requestId: value.requestId,
    response: {
      message,
      nextActionLabel,
      responseType,
      fallbackReasonId,
    },
  };
}
