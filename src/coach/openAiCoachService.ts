import {
  coachApiContractVersion,
  coachApiLimits,
  coachFallbackReasonIdValues,
  CoachApiRequestV1,
  CoachApiSuccessResponseV1,
  coachResponseTypeValues,
} from "../contracts/CoachApiContract";
import type { CoachService } from "./coachService";
import type { CoachResponseValidationFailureCode } from "./coachResponseValidator";
import {
  InvalidCoachResponseError,
  validateCoachApiSuccessResponse,
} from "./coachResponseValidator";
import {
  CoachRuntimeSafetyFailureCode,
  UnsafeCoachResponseError,
  validateCoachRuntimeSemanticSafety,
} from "./coachRuntimeSafety";
import { buildOpenAiCoachPrompt } from "./coachPrompt";
import type { OpenAiCoachConfig } from "./providerConfig";

const openAiResponsesEndpoint = "https://api.openai.com/v1/responses";
const maximumProviderResponseBytes = 64 * 1024;

export type OpenAiProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type OpenAiCoachResult = {
  response: CoachApiSuccessResponseV1;
  provider: "openai";
  model: string;
  latencyMs: number;
  usage: OpenAiProviderUsage | null;
};

export type OpenAiProviderErrorType =
  | "timeout"
  | "http_error"
  | "invalid_response"
  | "invalid_structured_output";

export type OpenAiSafeDiagnostics = {
  providerHttpStatus: number | null;
  providerErrorCategory: OpenAiProviderErrorType;
  jsonParseFailed: boolean;
  schemaExtractionFailed: boolean;
  responseValidatorFailed: boolean;
  responseValidationFailureCode: CoachResponseValidationFailureCode | null;
  missingPublicFields: string[];
  unknownPublicFields: string[];
  invalidResponseType: boolean;
  invalidFallbackReasonCombination: boolean;
  messageCharacterLimitExceeded: boolean;
  responseWordLimitExceeded: boolean;
  responseByteLimitExceeded: boolean;
  nextActionLabelLimitExceeded: boolean;
  semanticSafetyFailed: boolean;
  semanticSafetyFailureCode: CoachRuntimeSafetyFailureCode | null;
  deterministicFallbackUsed: boolean;
};

function buildSafeDiagnostics(
  providerErrorCategory: OpenAiProviderErrorType,
  overrides: Partial<OpenAiSafeDiagnostics> = {}
): OpenAiSafeDiagnostics {
  return {
    providerHttpStatus: null,
    providerErrorCategory,
    jsonParseFailed: false,
    schemaExtractionFailed: false,
    responseValidatorFailed: false,
    responseValidationFailureCode: null,
    missingPublicFields: [],
    unknownPublicFields: [],
    invalidResponseType: false,
    invalidFallbackReasonCombination: false,
    messageCharacterLimitExceeded: false,
    responseWordLimitExceeded: false,
    responseByteLimitExceeded: false,
    nextActionLabelLimitExceeded: false,
    semanticSafetyFailed: false,
    semanticSafetyFailureCode: null,
    deterministicFallbackUsed: false,
    ...overrides,
  };
}

export class OpenAiProviderError extends Error {
  constructor(
    readonly errorType: OpenAiProviderErrorType,
    message: string,
    readonly diagnostics: OpenAiSafeDiagnostics = buildSafeDiagnostics(
      errorType
    )
  ) {
    super(message);
    this.name = "OpenAiProviderError";
  }
}

type FetchImplementation = typeof fetch;

const responsePayloadSchema = {
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

const publicResponseFields = [
  "message",
  "nextActionLabel",
  "responseType",
  "fallbackReasonId",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
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
): Pick<
  OpenAiSafeDiagnostics,
  | "responseValidatorFailed"
  | "responseValidationFailureCode"
  | "missingPublicFields"
  | "unknownPublicFields"
  | "invalidResponseType"
  | "invalidFallbackReasonCombination"
  | "messageCharacterLimitExceeded"
  | "responseWordLimitExceeded"
  | "responseByteLimitExceeded"
  | "nextActionLabelLimitExceeded"
> {
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

function readUsage(value: Record<string, unknown>): OpenAiProviderUsage | null {
  if (!isPlainObject(value.usage)) {
    return null;
  }

  const inputTokens = value.usage.input_tokens;
  const outputTokens = value.usage.output_tokens;
  const totalTokens = value.usage.total_tokens;

  if (
    typeof inputTokens !== "number" ||
    typeof outputTokens !== "number" ||
    typeof totalTokens !== "number"
  ) {
    return null;
  }

  return { inputTokens, outputTokens, totalTokens };
}

function readOutputText(
  value: Record<string, unknown>,
  providerHttpStatus: number
): string {
  if (!Array.isArray(value.output)) {
    throw new OpenAiProviderError(
      "invalid_response",
      "Provider response output is missing.",
      buildSafeDiagnostics("invalid_response", {
        providerHttpStatus,
        schemaExtractionFailed: true,
      })
    );
  }

  for (const item of value.output) {
    if (!isPlainObject(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (
        isPlainObject(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }

  throw new OpenAiProviderError(
    "invalid_response",
    "Provider response did not contain structured text.",
    buildSafeDiagnostics("invalid_response", {
      providerHttpStatus,
      schemaExtractionFailed: true,
    })
  );
}

function parseProviderResponse(
  rawBody: string,
  providerHttpStatus: number
): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new OpenAiProviderError(
      "invalid_response",
      "Provider response was not valid JSON.",
      buildSafeDiagnostics("invalid_response", {
        providerHttpStatus,
        jsonParseFailed: true,
      })
    );
  }

  if (!isPlainObject(parsed) || parsed.status !== "completed") {
    throw new OpenAiProviderError(
      "invalid_response",
      "Provider response did not complete.",
      buildSafeDiagnostics("invalid_response", {
        providerHttpStatus,
      })
    );
  }

  return parsed;
}

export class OpenAiCoachService implements CoachService {
  constructor(
    private readonly config: OpenAiCoachConfig,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {}

  async respond(request: CoachApiRequestV1): Promise<unknown> {
    return (await this.respondWithMetadata(request)).response;
  }

  async respondWithMetadata(
    request: CoachApiRequestV1
  ): Promise<OpenAiCoachResult> {
    const prompt = buildOpenAiCoachPrompt(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const startedAt = Date.now();
    let providerResponse: Response;

    try {
      providerResponse = await this.fetchImplementation(openAiResponsesEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          instructions: prompt.instructions,
          input: prompt.input,
          max_output_tokens: this.config.maxOutputTokens,
          store: false,
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "dj_lingo_coach_response",
              strict: true,
              schema: responsePayloadSchema,
            },
          },
          reasoning: {
            effort: "low",
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OpenAiProviderError("timeout", "Provider request timed out.");
      }

      throw new OpenAiProviderError(
        "http_error",
        error instanceof Error ? error.message : "Provider request failed."
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!providerResponse.ok) {
      throw new OpenAiProviderError(
        "http_error",
        `Provider returned HTTP ${providerResponse.status}.`,
        buildSafeDiagnostics("http_error", {
          providerHttpStatus: providerResponse.status,
        })
      );
    }

    const declaredLength = providerResponse.headers.get("Content-Length");

    if (
      declaredLength !== null &&
      Number.parseInt(declaredLength, 10) > maximumProviderResponseBytes
    ) {
      throw new OpenAiProviderError(
        "invalid_response",
        "Provider response was too large.",
        buildSafeDiagnostics("invalid_response", {
          providerHttpStatus: providerResponse.status,
        })
      );
    }

    const rawBody = await providerResponse.text();

    if (
      new TextEncoder().encode(rawBody).byteLength >
      maximumProviderResponseBytes
    ) {
      throw new OpenAiProviderError(
        "invalid_response",
        "Provider response was too large.",
        buildSafeDiagnostics("invalid_response", {
          providerHttpStatus: providerResponse.status,
        })
      );
    }

    const parsedResponse = parseProviderResponse(
      rawBody,
      providerResponse.status
    );
    const outputText = readOutputText(
      parsedResponse,
      providerResponse.status
    );
    let payload: unknown;

    try {
      payload = JSON.parse(outputText);
    } catch {
      throw new OpenAiProviderError(
        "invalid_structured_output",
        "Provider structured output was not valid JSON.",
        buildSafeDiagnostics("invalid_structured_output", {
          providerHttpStatus: providerResponse.status,
          jsonParseFailed: true,
        })
      );
    }

    let validatedResponse: CoachApiSuccessResponseV1;

    try {
      validatedResponse = validateCoachApiSuccessResponse(
        {
          contractVersion: coachApiContractVersion,
          requestId: request.requestId,
          response: payload,
        },
        request.requestId
      );
    } catch (error) {
      const validationFailureCode =
        error instanceof InvalidCoachResponseError
          ? error.code
          : "invalid_payload_shape";

      throw new OpenAiProviderError(
        "invalid_structured_output",
        "Provider structured output failed backend validation.",
        buildSafeDiagnostics("invalid_structured_output", {
          providerHttpStatus: providerResponse.status,
          ...inspectStructuredPayload(
            payload,
            validationFailureCode,
            request.requestId
          ),
        })
      );
    }

    try {
      validateCoachRuntimeSemanticSafety(validatedResponse);
    } catch (error) {
      const semanticSafetyFailureCode =
        error instanceof UnsafeCoachResponseError ? error.code : null;

      throw new OpenAiProviderError(
        "invalid_structured_output",
        "Provider structured output failed runtime safety validation.",
        buildSafeDiagnostics("invalid_structured_output", {
          providerHttpStatus: providerResponse.status,
          semanticSafetyFailed: true,
          semanticSafetyFailureCode,
        })
      );
    }

    return {
      response: validatedResponse,
      provider: "openai",
      model: this.config.model,
      latencyMs: Date.now() - startedAt,
      usage: readUsage(parsedResponse),
    };
  }
}
