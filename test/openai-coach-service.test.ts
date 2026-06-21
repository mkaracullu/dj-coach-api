import { describe, expect, it, vi } from "vitest";
import {
  createConfiguredCoachService,
  getCoachApiResponse,
} from "../src/coach/coachService";
import {
  OpenAiCoachService,
  OpenAiProviderError,
} from "../src/coach/openAiCoachService";
import { buildCoachPrompt } from "../src/coach/coachPrompt";
import {
  resolveCoachProviderConfig,
  resolveOpenAiMaxOutputTokens,
} from "../src/coach/providerConfig";
import {
  addSafePublicTextPreview,
  isSafePublicTextPreviewEnabled,
} from "./evaluation/safePublicPreview";
import { evaluateCoachResponse } from "./evaluation/coachEvaluator";
import { coachEvaluationFixtures } from "./fixtures/coachEvaluationFixtures";

const fixture = coachEvaluationFixtures[0]!;

function providerResponse(output: unknown, extra: object = {}): Response {
  return Response.json({
    id: "response_test",
    status: "completed",
    model: "reference-model",
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(output),
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 120,
      output_tokens: 40,
      total_tokens: 160,
    },
    ...extra,
  });
}

function openAiConfig() {
  return {
    provider: "openai" as const,
    apiKey: "test-key-not-real",
    model: "reference-model",
    timeoutMs: 1_000,
    maxOutputTokens: 400,
  };
}

describe("OpenAI reference coach adapter", () => {
  it("adds trusted Session 2 Tap the Pulse objectives without prescribing an answer", () => {
    const englishPrompt = buildCoachPrompt(fixture.request);
    const turkishPrompt = buildCoachPrompt(
      coachEvaluationFixtures[1]!.request
    );

    expect(englishPrompt.input).toContain(
      "keep a steady pulse, hear equal or even spacing between beats"
    );
    expect(englishPrompt.input).toContain("tap in time with the track");
    expect(englishPrompt.input).toContain("timing and consistency");
    expect(englishPrompt.input).toContain(
      "Compare taps with tempo or BPM only when relevant."
    );
    expect(turkishPrompt.input).toContain(
      "connect ritim and vuruş to eşit veya düzenli aralıklar and zamanlama"
    );
    expect(turkishPrompt.input).toContain(
      "tempo is the track's speed"
    );
    expect(turkishPrompt.instructions).toContain(
      "avoid English-Turkish hybrids such as “puls” and “Tap’lerin”"
    );
    expect(turkishPrompt.instructions).toContain("“düzenli vuruş”");
    expect(turkishPrompt.instructions).toContain("“dokunuşların”");
    expect(englishPrompt.input).not.toContain(
      "Keep the pulse steady and leave equal space between taps."
    );
  });

  it("includes explicit response-type selection guidance", () => {
    const prompt = buildCoachPrompt(fixture.request);

    expect(prompt.instructions).toContain(
      "use concept_clarification when the learner asks what a concept means"
    );
    expect(prompt.instructions).toContain(
      "use lesson_explanation for lesson instructions"
    );
    expect(prompt.instructions).toContain(
      "If trusted Session 7 attempt metrics or results are present, use attempt_feedback."
    );
    expect(prompt.instructions).toContain(
      "never use lesson_explanation for an attempt-result answer"
    );
  });

  it("steers Session 7 close-result coaching to attempt feedback", () => {
    const session7Prompt = buildCoachPrompt(
      coachEvaluationFixtures[2]!.request
    );

    expect(session7Prompt.input).toContain(
      "Trusted measured attempt result: landing=close"
    );
    expect(session7Prompt.input).toContain(
      "use responseType attempt_feedback"
    );
    expect(session7Prompt.input).toContain(
      "near the intended moment"
    );
    expect(session7Prompt.input).toContain("steady counting");
    expect(session7Prompt.input).toContain("strong 1");
    expect(session7Prompt.input).toContain("next retry");
    expect(session7Prompt.input).not.toContain(
      "heard the learner's transition"
    );
  });

  it("uses safe output-token defaults and accepts valid overrides", () => {
    expect(resolveOpenAiMaxOutputTokens(undefined)).toBe(600);
    expect(resolveOpenAiMaxOutputTokens("320")).toBe(320);
    expect(resolveOpenAiMaxOutputTokens("99")).toBe(600);
    expect(resolveOpenAiMaxOutputTokens("801")).toBe(600);
    expect(resolveOpenAiMaxOutputTokens("400tokens")).toBe(600);
  });

  it.each([
    [
      "goal-short-practice-mix",
      "responseType capability_limit",
      "fallbackReasonId unavailable_analysis",
    ],
    [
      "unsupported-room-audio-camera",
      "responseType capability_limit",
      "fallbackReasonId unavailable_analysis",
    ],
    [
      "injection-fake-audio-analysis",
      "responseType scope_redirect",
      "fallbackReasonId prompt_injection",
    ],
    [
      "injection-complete-lesson",
      "responseType scope_redirect",
      "fallbackReasonId prompt_injection",
    ],
    [
      "injection-controller-action",
      "responseType scope_redirect",
      "fallbackReasonId prompt_injection",
    ],
  ])("routes %s through the capability boundary", (
    fixtureId,
    expectedResponseType,
    expectedFallbackReason
  ) => {
    const routingFixture = coachEvaluationFixtures.find(
      (candidate) => candidate.id === fixtureId
    )!;
    const prompt = buildCoachPrompt(routingFixture.request);

    expect(prompt.input).toContain(`use ${expectedResponseType}`);
    expect(prompt.input).toContain(expectedFallbackReason);
    expect(prompt.input).toContain(
      "exactly two short sentences"
    );
    expect(prompt.input).toContain(
      "not connected here"
    );
    expect(prompt.input).toContain("safe current-lesson practice step");
    expect(prompt.input).toContain("short lesson-scoped nextActionLabel");
    expect(prompt.input).toContain(
      "Never use lesson_explanation or concept_clarification"
    );
  });

  it("routes controller support questions to setup guidance or capability limit", () => {
    const controllerFixture = coachEvaluationFixtures.find(
      (candidate) => candidate.id === "goal-understand-controls"
    )!;
    const prompt = buildCoachPrompt(controllerFixture.request);

    expect(prompt.input).toContain(
      "use responseType setup_guidance or capability_limit"
    );
    expect(prompt.input).toContain("controller Play, Cue, and timing");
    expect(prompt.input).toContain(
      "cannot inspect or know the learner's physical controller"
    );
  });

  it("keeps mock mode when the provider is disabled or incomplete", async () => {
    expect(resolveCoachProviderConfig({})).toEqual({ provider: "mock" });
    expect(
      resolveCoachProviderConfig({
        COACH_PROVIDER: "openai",
        OPENAI_MODEL: "reference-model",
      })
    ).toEqual({ provider: "mock" });

    const fetchImplementation = vi.fn<typeof fetch>();
    const service = createConfiguredCoachService(
      {
        COACH_PROVIDER: "openai",
        OPENAI_MODEL: "reference-model",
      },
      fetchImplementation
    );
    const response = await getCoachApiResponse(fixture.request, service);

    expect(response.response.message).toContain("steady");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("maps valid structured output through the backend validator", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({
        message: "Keep the pulse steady and leave equal space between taps.",
        nextActionLabel: "Try one steady tap round.",
        responseType: "lesson_explanation",
        fallbackReasonId: null,
      })
    );
    const service = new OpenAiCoachService(
      openAiConfig(),
      fetchImplementation
    );
    const result = await service.respondWithMetadata(fixture.request);

    expect(result.response).toEqual({
      contractVersion: 1,
      requestId: fixture.request.requestId,
      response: {
        message: "Keep the pulse steady and leave equal space between taps.",
        nextActionLabel: "Try one steady tap round.",
        responseType: "lesson_explanation",
        fallbackReasonId: null,
      },
    });
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 40,
      totalTokens: 160,
    });
    expect(result.estimatedCostUsd).toBeNull();

    const requestBody = JSON.parse(
      String(fetchImplementation.mock.calls[0]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      model: "reference-model",
      store: false,
      max_output_tokens: 400,
      reasoning: {
        effort: "low",
      },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "dj_lingo_coach_response",
          strict: true,
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
    expect(JSON.stringify(requestBody)).not.toContain("test-key-not-real");
  });

  it("keeps safe public-text preview disabled unless explicitly enabled", async () => {
    const response = await getCoachApiResponse(fixture.request);
    const report = evaluateCoachResponse(fixture, response);

    expect(isSafePublicTextPreviewEnabled(undefined)).toBe(false);
    expect(isSafePublicTextPreviewEnabled("false")).toBe(false);
    expect(addSafePublicTextPreview(report, response, false)).not.toHaveProperty(
      "publicResponse"
    );
    expect(
      addSafePublicTextPreview(report, response, true).publicResponse
    ).toEqual(response.response);
  });

  it("rejects invalid provider output without returning raw text", async () => {
    const rawProviderOutput = "RAW_PROVIDER_OUTPUT_MUST_NOT_LEAK";
    const rawPrompt = "HIDDEN_PROMPT_MUST_NOT_LEAK";
    const apiKey = "SECRET_API_KEY_MUST_NOT_LEAK";
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse(
        {
          message: rawProviderOutput,
          nextActionLabel: null,
          responseType: "controller_action",
          fallbackReasonId: null,
          actionId: "finish_lesson",
        },
        {
          provider_metadata: {
            rawPrompt,
            apiKey,
          },
        }
      )
    );
    const service = new OpenAiCoachService(
      openAiConfig(),
      fetchImplementation
    );

    try {
      await service.respond(fixture.request);
      throw new Error("Expected invalid structured output.");
    } catch (error) {
      expect(error).toMatchObject({
        name: "OpenAiProviderError",
        errorType: "invalid_structured_output",
        diagnostics: {
          providerHttpStatus: 200,
          providerErrorCategory: "invalid_structured_output",
          jsonParseFailed: false,
          schemaExtractionFailed: false,
          responseValidatorFailed: true,
          responseValidationFailureCode: "invalid_payload_shape",
          missingPublicFields: [],
          unknownPublicFields: ["actionId"],
          invalidResponseType: true,
          deterministicFallbackUsed: false,
        },
      });

      const serializedDiagnostics = JSON.stringify(
        (error as OpenAiProviderError).diagnostics
      );
      expect(serializedDiagnostics).not.toContain(rawProviderOutput);
      expect(serializedDiagnostics).not.toContain(rawPrompt);
      expect(serializedDiagnostics).not.toContain(apiKey);
      expect(serializedDiagnostics).not.toContain("provider_metadata");
    }
  });

  it("reports invalid fallback combinations without weakening validation", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({
        message:
          "I cannot analyze that input because it is not connected here. Return to the lesson practice.",
        nextActionLabel: "Practice the lesson step.",
        responseType: "capability_limit",
        fallbackReasonId: null,
      })
    );
    const service = new OpenAiCoachService(
      openAiConfig(),
      fetchImplementation
    );

    await expect(service.respond(fixture.request)).rejects.toMatchObject({
      errorType: "invalid_structured_output",
      diagnostics: {
        responseValidatorFailed: true,
        responseValidationFailureCode:
          "invalid_fallback_reason_combination",
        invalidFallbackReasonCombination: true,
      },
    });
  });

  it("categorizes structured JSON parse failures without retaining text", async () => {
    const rawStructuredText = "NOT_JSON_PROVIDER_TEXT";
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: rawStructuredText,
              },
            ],
          },
        ],
      })
    );
    const service = new OpenAiCoachService(
      openAiConfig(),
      fetchImplementation
    );

    try {
      await service.respond(fixture.request);
      throw new Error("Expected invalid structured output.");
    } catch (error) {
      expect(error).toMatchObject({
        errorType: "invalid_structured_output",
        diagnostics: {
          providerHttpStatus: 200,
          jsonParseFailed: true,
          schemaExtractionFailed: false,
          responseValidatorFailed: false,
        },
      });
      expect(
        JSON.stringify((error as OpenAiProviderError).diagnostics)
      ).not.toContain(rawStructuredText);
    }
  });

  it("uses deterministic fallback when configured provider output is invalid", async () => {
    const fallbackResults: string[] = [];
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({
        rawModelText: "unsupported output",
        provider: "openai",
        tokenUsage: 999,
      })
    );
    const service = createConfiguredCoachService(
      {
        COACH_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key-not-real",
        OPENAI_MODEL: "reference-model",
      },
      fetchImplementation,
      (result) => fallbackResults.push(result)
    );
    const response = await getCoachApiResponse(fixture.request, service);

    expect(response).toEqual({
      contractVersion: 1,
      requestId: fixture.request.requestId,
      response: {
        message:
          "Focus on steady spacing between taps. The goal is not speed; it is control.",
        nextActionLabel: "Tap with steady spacing.",
        responseType: "lesson_explanation",
        fallbackReasonId: null,
      },
    });
    expect(JSON.stringify(response)).not.toContain("openai");
    expect(JSON.stringify(response)).not.toContain("tokenUsage");
    expect(JSON.stringify(response)).not.toContain("rawModelText");

    expect(fallbackResults).toEqual(["provider_fallback"]);
  });

  it("uses deterministic fallback for structurally valid unsafe provider text", async () => {
    const fallbackResults: string[] = [];
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
        COACH_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key-not-real",
        OPENAI_MODEL: "reference-model",
      },
      fetchImplementation,
      (result) => fallbackResults.push(result)
    );
    const response = await getCoachApiResponse(fixture.request, service);

    expect(response.response.message).toBe(
      "Focus on steady spacing between taps. The goal is not speed; it is control."
    );

    expect(fallbackResults).toEqual(["semantic_safety_fallback"]);
  });

  it("allows structurally valid safe capability denials", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      providerResponse({
        message:
          "I can't inspect your controller, but you can count 1-2-3-4 and press Play on the next strong 1.",
        nextActionLabel: "Practice the count before pressing Play.",
        responseType: "setup_guidance",
        fallbackReasonId: null,
      })
    );
    const service = new OpenAiCoachService(
      openAiConfig(),
      fetchImplementation
    );

    await expect(service.respond(fixture.request)).resolves.toMatchObject({
      response: {
        message: expect.stringContaining("can't inspect your controller"),
        responseType: "setup_guidance",
      },
    });
  });
});
