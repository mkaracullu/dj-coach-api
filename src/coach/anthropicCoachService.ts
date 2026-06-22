import type { CoachApiRequestV1 } from "../contracts/CoachApiContract";
import type { CoachService } from "./coachService";
import { buildCoachPrompt } from "./coachPrompt";
import type { AnthropicCoachConfig } from "./providerConfig";
import {
  coachResponsePayloadSchema,
  isPlainObject,
  validateProviderPayload,
} from "./providerResponse";
import {
  buildCoachProviderSafeDiagnostics,
  CoachProviderError,
  normalizeCoachProviderUsage,
  type CoachProviderErrorCategory,
  type CoachProviderResult,
  type CoachProviderSafeDiagnostics,
  type CoachProviderUsage,
} from "./providerTypes";

const anthropicMessagesEndpoint = "https://api.anthropic.com/v1/messages";
const anthropicApiVersion = "2023-06-01";
const maximumProviderResponseBytes = 64 * 1024;

export type AnthropicProviderUsage = CoachProviderUsage;
export type AnthropicCoachResult = CoachProviderResult<"anthropic">;
export type AnthropicProviderErrorType = CoachProviderErrorCategory;
export type AnthropicSafeDiagnostics = CoachProviderSafeDiagnostics;

export class AnthropicProviderError extends CoachProviderError {
  constructor(
    readonly errorType: AnthropicProviderErrorType,
    message: string,
    diagnostics: AnthropicSafeDiagnostics =
      buildCoachProviderSafeDiagnostics(errorType)
  ) {
    super("anthropic", errorType, message, diagnostics);
    this.name = "AnthropicProviderError";
  }
}

type FetchImplementation = typeof fetch;

function readUsage(
  value: Record<string, unknown>
): AnthropicProviderUsage | null {
  if (!isPlainObject(value.usage)) {
    return null;
  }

  const inputTokens = value.usage.input_tokens;
  const outputTokens = value.usage.output_tokens;

  return normalizeCoachProviderUsage(inputTokens, outputTokens);
}

function parseProviderResponse(
  rawBody: string,
  providerHttpStatus: number
): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new AnthropicProviderError(
      "invalid_response",
      "Provider response was not valid JSON.",
      buildCoachProviderSafeDiagnostics("invalid_response", {
        providerHttpStatus,
        jsonParseFailed: true,
      })
    );
  }

  if (
    !isPlainObject(parsed) ||
    parsed.type !== "message" ||
    (parsed.stop_reason !== "end_turn" &&
      parsed.stop_reason !== "stop_sequence")
  ) {
    throw new AnthropicProviderError(
      "invalid_response",
      "Provider response did not complete.",
      buildCoachProviderSafeDiagnostics("invalid_response", {
        providerHttpStatus,
      })
    );
  }

  return parsed;
}

function readOutputText(
  value: Record<string, unknown>,
  providerHttpStatus: number
): string {
  if (!Array.isArray(value.content)) {
    throw new AnthropicProviderError(
      "invalid_response",
      "Provider response content is missing.",
      buildCoachProviderSafeDiagnostics("invalid_response", {
        providerHttpStatus,
        schemaExtractionFailed: true,
      })
    );
  }

  const firstContent = value.content[0];

  if (
    !isPlainObject(firstContent) ||
    firstContent.type !== "text" ||
    typeof firstContent.text !== "string"
  ) {
    throw new AnthropicProviderError(
      "invalid_response",
      "Provider response did not contain structured text.",
      buildCoachProviderSafeDiagnostics("invalid_response", {
        providerHttpStatus,
        schemaExtractionFailed: true,
      })
    );
  }

  return firstContent.text;
}

export class AnthropicCoachService implements CoachService {
  private readonly fetchImplementation: FetchImplementation;

  constructor(
    private readonly config: AnthropicCoachConfig,
    fetchImplementation: FetchImplementation = fetch
  ) {
    this.fetchImplementation = (input, init) =>
      fetchImplementation(input, init);
  }

  async respond(request: CoachApiRequestV1): Promise<unknown> {
    return (await this.respondWithMetadata(request)).response;
  }

  async respondWithMetadata(
    request: CoachApiRequestV1
  ): Promise<AnthropicCoachResult> {
    const startedAt = Date.now();
    const prompt = buildCoachPrompt(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let providerResponse: Response;

    try {
      providerResponse = await this.fetchImplementation(
        anthropicMessagesEndpoint,
        {
          method: "POST",
          headers: {
            "x-api-key": this.config.apiKey,
            "anthropic-version": anthropicApiVersion,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.config.model,
            max_tokens: this.config.maxOutputTokens,
            system: prompt.instructions,
            messages: [
              {
                role: "user",
                content: prompt.input,
              },
            ],
            output_config: {
              format: {
                type: "json_schema",
                schema: coachResponsePayloadSchema,
              },
            },
          }),
          signal: controller.signal,
        }
      );
    } catch {
      if (controller.signal.aborted) {
        throw new AnthropicProviderError(
          "timeout",
          "Provider request timed out."
        );
      }

      throw new AnthropicProviderError(
        "http_error",
        "Provider request failed."
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!providerResponse.ok) {
      throw new AnthropicProviderError(
        "http_error",
        `Provider returned HTTP ${providerResponse.status}.`,
        buildCoachProviderSafeDiagnostics("http_error", {
          providerHttpStatus: providerResponse.status,
        })
      );
    }

    const declaredLength = providerResponse.headers.get("Content-Length");

    if (
      declaredLength !== null &&
      Number.parseInt(declaredLength, 10) > maximumProviderResponseBytes
    ) {
      throw new AnthropicProviderError(
        "invalid_response",
        "Provider response was too large.",
        buildCoachProviderSafeDiagnostics("invalid_response", {
          providerHttpStatus: providerResponse.status,
        })
      );
    }

    const rawBody = await providerResponse.text();

    if (
      new TextEncoder().encode(rawBody).byteLength >
      maximumProviderResponseBytes
    ) {
      throw new AnthropicProviderError(
        "invalid_response",
        "Provider response was too large.",
        buildCoachProviderSafeDiagnostics("invalid_response", {
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
      throw new AnthropicProviderError(
        "invalid_structured_output",
        "Provider structured output was not valid JSON.",
        buildCoachProviderSafeDiagnostics("invalid_structured_output", {
          providerHttpStatus: providerResponse.status,
          jsonParseFailed: true,
        })
      );
    }

    const validatedResponse = validateProviderPayload(
      payload,
      request.requestId,
      providerResponse.status,
      (errorType, message, diagnostics) =>
        new AnthropicProviderError(errorType, message, diagnostics)
    );

    return {
      response: validatedResponse,
      provider: "anthropic",
      model: this.config.model,
      latencyMs: Date.now() - startedAt,
      usage: readUsage(parsedResponse),
      estimatedCostUsd: null,
    };
  }
}
