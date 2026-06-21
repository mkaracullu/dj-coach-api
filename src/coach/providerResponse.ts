import {
  coachApiContractVersion,
  coachApiLimits,
  coachFallbackReasonIdValues,
  type CoachApiSuccessResponseV1,
  coachResponseTypeValues,
} from "../contracts/CoachApiContract";
import {
  InvalidCoachResponseError,
  validateCoachApiSuccessResponse,
  type CoachResponseValidationFailureCode,
} from "./coachResponseValidator";
import {
  UnsafeCoachResponseError,
  validateCoachRuntimeSemanticSafety,
} from "./coachRuntimeSafety";
import {
  buildCoachProviderSafeDiagnostics,
  type CoachProviderErrorCategory,
  type CoachProviderSafeDiagnostics,
} from "./providerTypes";

export const coachResponsePayloadSchema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description:
        "Short beginner-safe coaching message. The backend enforces final text limits.",
    },
    nextActionLabel: {
      anyOf: [
        {
          type: "string",
          description: "One short optional lesson-scoped next step.",
        },
        { type: "null" },
      ],
    },
    responseType: {
      type: "string",
      enum: coachResponseTypeValues,
      description:
        "Semantic response category selected according to the server instructions.",
    },
    fallbackReasonId: {
      anyOf: [
        {
          type: "string",
          enum: coachFallbackReasonIdValues,
        },
        { type: "null" },
      ],
    },
  },
  required: [
    "message",
    "nextActionLabel",
    "responseType",
    "fallbackReasonId",
  ],
  additionalProperties: false,
} as const;

export type ProviderErrorFactory = (
  errorType: CoachProviderErrorCategory,
  message: string,
  diagnostics?: CoachProviderSafeDiagnostics
) => Error;

const publicResponseFields = [
  "message",
  "nextActionLabel",
  "responseType",
  "fallbackReasonId",
] as const;

export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countWords(value: string): number {
  const normalized = value.trim();
  return normalized.length === 0 ? 0 : normalized.split(/\s+/).length;
}

function sanitizeUnknownPublicField(field: string): string {
  if (
    field.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(field) ||
    /(?:raw|prompt|instruction|provider|metadata|token|usage|api.?key|secret|request.?body)/i.test(
      field
    )
  ) {
    return "<redacted_unknown_field>";
  }

  return field;
}

function inspectStructuredPayload(
  payload: unknown,
  validationFailureCode: CoachResponseValidationFailureCode,
  requestId: string
): Partial<CoachProviderSafeDiagnostics> {
  const payloadObject = isPlainObject(payload) ? payload : null;
  const keys = payloadObject ? Object.keys(payloadObject) : [];
  const message = payloadObject?.message;
  const nextActionLabel = payloadObject?.nextActionLabel;
  const serializedEnvelope = JSON.stringify({
    contractVersion: coachApiContractVersion,
    requestId,
    response: payload,
  });

  return {
    responseValidatorFailed: true,
    responseValidationFailureCode: validationFailureCode,
    missingPublicFields: publicResponseFields.filter(
      (field) => !payloadObject || !Object.hasOwn(payloadObject, field)
    ),
    unknownPublicFields: [
      ...new Set(
        keys
          .filter((key) => !publicResponseFields.includes(key as never))
          .map(sanitizeUnknownPublicField)
      ),
    ],
    invalidResponseType:
      payloadObject !== null &&
      Object.hasOwn(payloadObject, "responseType") &&
      !coachResponseTypeValues.includes(
        payloadObject.responseType as (typeof coachResponseTypeValues)[number]
      ),
    invalidFallbackReasonCombination:
      validationFailureCode === "invalid_fallback_reason_combination",
    messageCharacterLimitExceeded:
      typeof message === "string" &&
      message.length > coachApiLimits.messageMaxChars,
    responseWordLimitExceeded:
      (typeof message === "string" ? countWords(message) : 0) +
        (typeof nextActionLabel === "string"
          ? countWords(nextActionLabel)
          : 0) >
      coachApiLimits.responseHardMaxWords,
    responseByteLimitExceeded:
      new TextEncoder().encode(serializedEnvelope).byteLength >
      coachApiLimits.responseBodyMaxBytes,
    nextActionLabelLimitExceeded:
      typeof nextActionLabel === "string" &&
      nextActionLabel.length > coachApiLimits.nextActionLabelMaxChars,
  };
}

export function validateProviderPayload(
  payload: unknown,
  requestId: string,
  providerHttpStatus: number,
  createError: ProviderErrorFactory
): CoachApiSuccessResponseV1 {
  let validatedResponse: CoachApiSuccessResponseV1;

  try {
    validatedResponse = validateCoachApiSuccessResponse(
      {
        contractVersion: coachApiContractVersion,
        requestId,
        response: payload,
      },
      requestId
    );
  } catch (error) {
    const validationFailureCode =
      error instanceof InvalidCoachResponseError
        ? error.code
        : "invalid_payload_shape";

    throw createError(
      "invalid_structured_output",
      "Provider structured output failed backend validation.",
      buildCoachProviderSafeDiagnostics("invalid_structured_output", {
        providerHttpStatus,
        ...inspectStructuredPayload(
          payload,
          validationFailureCode,
          requestId
        ),
      })
    );
  }

  try {
    return validateCoachRuntimeSemanticSafety(validatedResponse);
  } catch (error) {
    throw createError(
      "invalid_structured_output",
      "Provider structured output failed runtime safety validation.",
      buildCoachProviderSafeDiagnostics("invalid_structured_output", {
        providerHttpStatus,
        semanticSafetyFailed: true,
        semanticSafetyFailureCode:
          error instanceof UnsafeCoachResponseError ? error.code : null,
      })
    );
  }
}
