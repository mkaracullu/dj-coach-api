import {
  CoachApiRequestV1,
} from "../contracts/CoachApiContract";
import type { CoachService } from "./coachService";
import {
  coachResponsePayloadSchema,
  isPlainObject,
  validateProviderPayload,
} from "./providerResponse";
import { buildCoachPrompt } from "./coachPrompt";
import type { OpenAiCoachConfig } from "./providerConfig";
import {
  buildCoachProviderSafeDiagnostics,
  CoachProviderError,
  type CoachProviderErrorCategory,
  type CoachProviderResult,
  type CoachProviderSafeDiagnostics,
  type CoachProviderUsage,
} from "./providerTypes";

const openAiResponsesEndpoint = "https://api.openai.com/v1/responses";
const maximumProviderResponseBytes = 64 * 1024;

export type OpenAiProviderUsage = CoachProviderUsage;
export type OpenAiCoachResult = CoachProviderResult<"openai">;
export type OpenAiProviderErrorType = CoachProviderErrorCategory;
export type OpenAiSafeDiagnostics = CoachProviderSafeDiagnostics;

export class OpenAiProviderError extends CoachProviderError {
  constructor(
    readonly errorType: OpenAiProviderErrorType,
    message: string,
    diagnostics: OpenAiSafeDiagnostics =
      buildCoachProviderSafeDiagnostics(errorType)
  ) {
    super("openai", errorType, message, diagnostics);
    this.name = "OpenAiProviderError";
  }
}

type FetchImplementation = typeof fetch;

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
      buildCoachProviderSafeDiagnostics("invalid_response", {
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
    buildCoachProviderSafeDiagnostics("invalid_response", {
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
      buildCoachProviderSafeDiagnostics("invalid_response", {
        providerHttpStatus,
        jsonParseFailed: true,
      })
    );
  }

  if (!isPlainObject(parsed) || parsed.status !== "completed") {
    throw new OpenAiProviderError(
      "invalid_response",
      "Provider response did not complete.",
      buildCoachProviderSafeDiagnostics("invalid_response", {
        providerHttpStatus,
      })
    );
  }

  return parsed;
}

export class OpenAiCoachService implements CoachService {
  private readonly fetchImplementation: FetchImplementation;

  constructor(
    private readonly config: OpenAiCoachConfig,
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
  ): Promise<OpenAiCoachResult> {
    const prompt = buildCoachPrompt(request);
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
              schema: coachResponsePayloadSchema,
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
      throw new OpenAiProviderError(
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
      throw new OpenAiProviderError(
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
      throw new OpenAiProviderError(
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
        new OpenAiProviderError(errorType, message, diagnostics)
    );

    return {
      response: validatedResponse,
      provider: "openai",
      model: this.config.model,
      latencyMs: Date.now() - startedAt,
      usage: readUsage(parsedResponse),
      estimatedCostUsd: null,
    };
  }
}
