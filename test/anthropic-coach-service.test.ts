import { describe, expect, it, vi } from "vitest";
import {
  AnthropicCoachService,
  AnthropicProviderError,
} from "../src/coach/anthropicCoachService";
import {
  createConfiguredCoachService,
  getCoachApiResponse,
  type CoachServiceFallbackResult,
} from "../src/coach/coachService";
import {
  resolveAnthropicMaxOutputTokens,
  resolveCoachProviderConfig,
} from "../src/coach/providerConfig";
import { runLiveCoachEvaluation } from "./evaluation/runLiveCoachEvaluation";
import { coachEvaluationFixtures } from "./fixtures/coachEvaluationFixtures";

const fixture = coachEvaluationFixtures[0]!;
const session7EarlyFixture = coachEvaluationFixtures.find(
  (candidate) => candidate.id === "session-7-early"
)!;

function anthropicConfig() {
  return {
    provider: "anthropic" as const,
    apiKey: "test-anthropic-key-not-real",
    model: "claude-reference-model",
    timeoutMs: 1_000,
    maxOutputTokens: 400,
  };
}

function providerResponse(
  output: unknown,
  extra: Record<string, unknown> = {}
): Response {
  return Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-reference-model",
    content: [
      {
        type: "text",
        text: JSON.stringify(output),
      },
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 110,
      output_tokens: 35,
    },
    ...extra,
  });
}

describe("Anthropic reference coach adapter", () => {
  it("uses safe output-token defaults and accepts valid overrides", () => {
    expect(resolveAnthropicMaxOutputTokens(undefined)).toBe(600);
    expect(resolveAnthropicMaxOutputTokens("320")).toBe(320);
    expect(resolveAnthropicMaxOutputTokens("99")).toBe(600);
    expect(resolveAnthropicMaxOutputTokens("801")).toBe(600);
    expect(resolveAnthropicMaxOutputTokens("400tokens")).toBe(600);
  });

  it("keeps mock mode when Anthropic is disabled or incomplete", async () => {
    expect(
      resolveCoachProviderConfig({
        COACH_PROVIDER: "anthropic",
        ANTHROPIC_MODEL: "claude-reference-model",
      })
    ).toEqual({ provider: "mock" });

    const fetchImplementation = vi.fn<typeof fetch>();
    const service = createConfiguredCoachService(
      {
        COACH_PROVIDER: "anthropic",
        ANTHROPIC_MODEL: "claude-reference-model",
      },
      fetchImplementation
    );
    const response = await getCoachApiResponse(fixture.request, service);

    expect(response.response.message).toContain("steady");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("maps valid structured output through the public contract", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({
        message: "Keep the pulse steady and leave equal space between taps.",
        nextActionLabel: "Try one steady tap round.",
        responseType: "lesson_explanation",
        fallbackReasonId: null,
      })
    );
    const service = new AnthropicCoachService(
      anthropicConfig(),
      fetchImplementation
    );
    const result = await service.respondWithMetadata(fixture.request);

    expect(result).toMatchObject({
      provider: "anthropic",
      model: "claude-reference-model",
      usage: {
        inputTokens: 110,
        outputTokens: 35,
        totalTokens: 145,
      },
      estimatedCostUsd: null,
      response: {
        contractVersion: 1,
        requestId: fixture.request.requestId,
        response: {
          message: "Keep the pulse steady and leave equal space between taps.",
          nextActionLabel: "Try one steady tap round.",
          responseType: "lesson_explanation",
          fallbackReasonId: null,
        },
      },
    });

    const [url, requestInit] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(requestInit?.headers).toMatchObject({
      "x-api-key": "test-anthropic-key-not-real",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    });

    const requestBody = JSON.parse(
      String(requestInit?.body)
    ) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      model: "claude-reference-model",
      max_tokens: 400,
      messages: [
        {
          role: "user",
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            required: [
              "message",
              "nextActionLabel",
              "responseType",
              "fallbackReasonId",
            ],
            additionalProperties: false,
          },
        },
      },
    });
    expect(typeof requestBody.system).toBe("string");
    expect(JSON.stringify(requestBody)).not.toContain(
      "test-anthropic-key-not-real"
    );
  });

  it("normalizes HTTP and malformed-output failures safely", async () => {
    const httpService = new AnthropicCoachService(
      anthropicConfig(),
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { error: { message: "RAW_PROVIDER_ERROR_MUST_NOT_LEAK" } },
          { status: 429 }
        )
      )
    );
    const malformedService = new AnthropicCoachService(
      anthropicConfig(),
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "message",
            content: [{ type: "text", text: "NOT_JSON_PROVIDER_TEXT" }],
            stop_reason: "end_turn",
          }),
          { status: 200 }
        )
      )
    );

    await expect(httpService.respond(fixture.request)).rejects.toMatchObject({
      name: "AnthropicProviderError",
      provider: "anthropic",
      errorType: "http_error",
      diagnostics: {
        providerHttpStatus: 429,
        providerErrorCategory: "http_error",
      },
    });
    await expect(
      malformedService.respond(fixture.request)
    ).rejects.toMatchObject({
      name: "AnthropicProviderError",
      provider: "anthropic",
      errorType: "invalid_structured_output",
      diagnostics: {
        providerHttpStatus: 200,
        jsonParseFailed: true,
      },
    });
  });

  it("invokes an injected fetch without changing its receiver", async () => {
    let receivedReceiver: unknown = null;
    const fetchImplementation: typeof fetch = function (
      this: unknown,
      ..._args: Parameters<typeof fetch>
    ) {
      receivedReceiver = this;

      if (this !== undefined) {
        return Promise.reject(new TypeError("Illegal invocation"));
      }

      return Promise.resolve(
        providerResponse({
          message: "Keep the pulse steady and leave equal space between taps.",
          nextActionLabel: "Try one steady tap round.",
          responseType: "lesson_explanation",
          fallbackReasonId: null,
        })
      );
    };
    const service = new AnthropicCoachService(
      anthropicConfig(),
      fetchImplementation
    );

    const result = await service.respondWithMetadata(fixture.request);

    expect(receivedReceiver).toBeUndefined();
    expect(result.provider).toBe("anthropic");
  });

  it("falls back without leaking provider data into the public response", async () => {
    const rawProviderOutput = "RAW_CLAUDE_OUTPUT_MUST_NOT_LEAK";
    const apiKey = "SECRET_ANTHROPIC_KEY_MUST_NOT_LEAK";
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({
        message: rawProviderOutput,
        nextActionLabel: null,
        responseType: "unsupported_type",
        fallbackReasonId: null,
        rawPrompt: "RAW_PROMPT_MUST_NOT_LEAK",
      })
    );
    const fallbackResults: CoachServiceFallbackResult[] = [];
    const service = createConfiguredCoachService(
      {
        COACH_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_MODEL: "claude-reference-model",
      },
      fetchImplementation,
      (result) => fallbackResults.push(result)
    );
    const response = await getCoachApiResponse(fixture.request, service);
    const serializedResponse = JSON.stringify(response);

    expect(response.response.message).toContain("steady");
    expect(fallbackResults).toEqual([
      {
        category: "provider_fallback",
        providerErrorCategory: "invalid_structured_output",
        providerHttpStatus: 200,
        responseValidationFailureCode: "invalid_payload_shape",
      },
    ]);
    expect(serializedResponse).not.toContain(rawProviderOutput);
    expect(serializedResponse).not.toContain(apiKey);
    expect(serializedResponse).not.toContain("anthropic");
    expect(serializedResponse).not.toContain("rawPrompt");
    expect(serializedResponse).not.toContain("diagnostics");
  });

  it("uses semantic-safety fallback for structurally valid unsafe text", async () => {
    const fallbackResults: CoachServiceFallbackResult[] = [];
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({
        message: "I changed your progress and completed the lesson.",
        nextActionLabel: "Continue to the next session.",
        responseType: "lesson_explanation",
        fallbackReasonId: null,
      })
    );
    const service = createConfiguredCoachService(
      {
        COACH_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "test-anthropic-key-not-real",
        ANTHROPIC_MODEL: "claude-reference-model",
      },
      fetchImplementation,
      (result) => fallbackResults.push(result)
    );
    const response = await getCoachApiResponse(fixture.request, service);

    expect(response.response.message).toContain("steady");
    expect(fallbackResults).toEqual([
      {
        category: "semantic_safety_fallback",
        providerErrorCategory: "invalid_structured_output",
        providerHttpStatus: 200,
        semanticSafetyFailureCode: "app_state_mutation_claim",
      },
    ]);
  });

  it("uses sanitized semantic-safety fallback for unsafe Session 7 feedback", async () => {
    const unsafeProviderMessage =
      "Track B'yi yaklaşık 733 ms geç başlattın.";
    const fallbackResults: CoachServiceFallbackResult[] = [];
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({
        message: unsafeProviderMessage,
        nextActionLabel: "Tekrar dene",
        responseType: "attempt_feedback",
        fallbackReasonId: null,
      })
    );
    const service = createConfiguredCoachService(
      {
        COACH_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "test-anthropic-key-not-real",
        ANTHROPIC_MODEL: "claude-reference-model",
      },
      fetchImplementation,
      (result) => fallbackResults.push(result)
    );
    const response = await getCoachApiResponse(
      session7EarlyFixture.request,
      service
    );

    expect(response.response.responseType).toBe("attempt_feedback");
    expect(JSON.stringify(response)).not.toContain(unsafeProviderMessage);
    expect(fallbackResults).toEqual([
      {
        category: "semantic_safety_fallback",
        providerErrorCategory: "invalid_structured_output",
        providerHttpStatus: 200,
        semanticSafetyFailureCode:
          "session7_contradictory_timing_direction",
      },
    ]);
    expect(JSON.stringify(fallbackResults)).not.toContain(
      unsafeProviderMessage
    );
  });

  it("keeps raw Anthropic failures out of evaluation reports", async () => {
    const rawProviderOutput = "RAW_ANTHROPIC_ERROR_MUST_NOT_LEAK";
    const reports = await runLiveCoachEvaluation({
      adapter: {
        provider: "anthropic",
        model: "claude-reference-model",
        async respondWithMetadata() {
          throw new AnthropicProviderError(
            "invalid_response",
            rawProviderOutput
          );
        },
      },
      fixtures: [fixture],
      printSafePublicText: false,
    });

    expect(reports[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-reference-model",
      errorType: "invalid_response",
      diagnostics: {
        providerErrorCategory: "invalid_response",
      },
    });
    expect(JSON.stringify(reports)).not.toContain(rawProviderOutput);
  });
});

it.each(["refusal", "max_tokens"] as const)(
  "rejects Anthropic %s responses without exposing provider text",
  async (stopReason) => {
    const rawProviderText =
      "RAW_ANTHROPIC_STOP_RESPONSE_MUST_NOT_LEAK";

    const service = new AnthropicCoachService(
      anthropicConfig(),
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-reference-model",
          content: [
            {
              type: "text",
              text: rawProviderText,
            },
          ],
          stop_reason: stopReason,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        })
      )
    );

    try {
      await service.respond(fixture.request);
      throw new Error("Expected Anthropic provider response to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        name: "AnthropicProviderError",
        provider: "anthropic",
        errorType: "invalid_response",
        diagnostics: {
          providerHttpStatus: 200,
          providerErrorCategory: "invalid_response",
        },
      });

      expect(String(error)).not.toContain(rawProviderText);
      expect(JSON.stringify(error)).not.toContain(rawProviderText);
    }
  }
);

it("does not scan later content blocks for structured output", async () => {
  const validLaterPayload = JSON.stringify({
    message: "This later block must not be accepted.",
    nextActionLabel: null,
    responseType: "lesson_explanation",
    fallbackReasonId: null,
  });

  const service = new AnthropicCoachService(
    anthropicConfig(),
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-reference-model",
        content: [
          {
            type: "unexpected_block",
          },
          {
            type: "text",
            text: validLaterPayload,
          },
        ],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      })
    )
  );

  await expect(service.respond(fixture.request)).rejects.toMatchObject({
    name: "AnthropicProviderError",
    provider: "anthropic",
    errorType: "invalid_response",
    diagnostics: {
      providerHttpStatus: 200,
      schemaExtractionFailed: true,
    },
  });
});
