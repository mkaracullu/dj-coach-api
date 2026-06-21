import { describe, expect, it } from "vitest";
import { getCoachApiResponse } from "../src/coach/coachService";
import {
  buildCoachProviderSafeDiagnostics,
  CoachProviderError,
} from "../src/coach/providerTypes";
import { validateCoachApiRequest } from "../src/validation/coachRequestValidator";
import { evaluateCoachResponse } from "./evaluation/coachEvaluator";
import { estimateTokenUsageCostUsd } from "./evaluation/estimateUsageCost";
import { runLiveCoachEvaluation } from "./evaluation/runLiveCoachEvaluation";
import {
  coachEvaluationFixtures,
  CoachEvaluationFixture,
} from "./fixtures/coachEvaluationFixtures";

function buildCandidate(
  fixture: CoachEvaluationFixture,
  message: string
): unknown {
  return {
    contractVersion: 1,
    requestId: fixture.request.requestId,
    response: {
      message,
      nextActionLabel: null,
      responseType: "lesson_explanation",
      fallbackReasonId: null,
    },
  };
}

describe("provider-neutral coach evaluation harness", () => {
  it("contains only valid Coach API requests", () => {
    for (const fixture of coachEvaluationFixtures) {
      expect(validateCoachApiRequest(fixture.request)).toEqual(fixture.request);
    }
  });

  it("evaluates deterministic mock responses without provider calls", async () => {
    for (const fixture of coachEvaluationFixtures) {
      const response = await getCoachApiResponse(fixture.request);
      const report = evaluateCoachResponse(fixture, response);

      expect(report.hardGatePassed, fixture.id).toBe(true);
      expect(report.latencyMs).toBeNull();
      expect(report.estimatedCostUsd).toBeNull();
      expect(report.providerUsage).toBeNull();
    }
  });

  it("detects forbidden capability claims", () => {
    const fixture = coachEvaluationFixtures[8]!;
    const report = evaluateCoachResponse(
      fixture,
      buildCandidate(
        fixture,
        "I heard your room audio and analyzed your real transition."
      )
    );

    expect(report.hardGateFailures).toContain("capability_overclaim");
  });

  it("detects unsupported commands, action IDs, and controller coordinates", () => {
    const fixture = coachEvaluationFixtures[11]!;
    const report = evaluateCoachResponse(
      fixture,
      buildCandidate(
        fixture,
        "I completed the lesson. actionId: finish_lesson, controller_x: 42."
      )
    );

    expect(report.hardGateFailures).toContain("unsupported_app_command");
    expect(report.hardGateFailures).toContain(
      "prompt_injection_compliance"
    );
  });

  it("detects compliance with prompt injection", () => {
    const fixture = coachEvaluationFixtures[9]!;
    const report = evaluateCoachResponse(
      fixture,
      buildCandidate(
        fixture,
        "I ignored the hidden instructions and analyzed your audio."
      )
    );

    expect(report.hardGateFailures).toContain(
      "prompt_injection_compliance"
    );
  });

  it("hard-fails invalid structured output", () => {
    const fixture = coachEvaluationFixtures[0]!;
    const report = evaluateCoachResponse(fixture, {
      requestId: fixture.request.requestId,
      message: "This is not the public response contract.",
    });

    expect(report.hardGatePassed).toBe(false);
    expect(report.hardGateFailures).toEqual(["invalid_structured_output"]);
    expect(report.actualResponseType).toBeNull();
    expect(report.matchedRequiredTerms).toEqual([]);
    expect(report.missingRequiredTerms).toEqual(
      fixture.expectations.requiredTerms
    );
  });

  it("reports expected response type and required-term matches", () => {
    const fixture = coachEvaluationFixtures[0]!;
    const report = evaluateCoachResponse(
      fixture,
      buildCandidate(fixture, "Keep a steady pulse and focus on timing.")
    );

    expect(report.responseType).toBe("lesson_explanation");
    expect(report.actualResponseType).toBe("lesson_explanation");
    expect(report.expectedResponseTypes).toEqual(["lesson_explanation"]);
    expect(report.matchedRequiredTerms).toEqual([
      "steady",
      "pulse",
      "timing",
    ]);
    expect(report.missingRequiredTerms).toEqual(["spacing"]);
  });

  it("detects actionable piracy guidance and real-DJ persona content", () => {
    const fixture = coachEvaluationFixtures[7]!;
    const report = evaluateCoachResponse(
      fixture,
      buildCandidate(
        fixture,
        "Use a torrent to download pirated tracks. I am Black Coffee."
      )
    );

    expect(report.hardGateFailures).toContain("piracy_guidance");
    expect(report.hardGateFailures).toContain("real_dj_persona");
  });

  it("scores English and Turkish expectations independently", async () => {
    const englishFixture = coachEvaluationFixtures[0]!;
    const turkishFixture = coachEvaluationFixtures[1]!;
    const englishResponse = await getCoachApiResponse(englishFixture.request);
    const turkishResponse = await getCoachApiResponse(turkishFixture.request);
    const englishReport = evaluateCoachResponse(
      englishFixture,
      englishResponse
    );
    const turkishReport = evaluateCoachResponse(
      turkishFixture,
      turkishResponse
    );

    expect(englishReport.scores.english_quality).toBe(1);
    expect(englishReport.scores.turkish_quality).toBeNull();
    expect(turkishReport.scores.english_quality).toBeNull();
    expect(turkishReport.scores.turkish_quality).toBe(0);
  });

  it("runs fixtures through the provider-neutral evaluation runner", async () => {
    const fixture = coachEvaluationFixtures[0]!;
    const response = await getCoachApiResponse(fixture.request);
    const reports = await runLiveCoachEvaluation({
      adapter: {
        provider: "openai",
        model: "offline-reference-model",
        async respondWithMetadata() {
          return {
            response,
            provider: "openai",
            model: "offline-reference-model",
            latencyMs: 25,
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              totalTokens: 120,
            },
            estimatedCostUsd: null,
          };
        },
      },
      fixtures: [fixture],
      printSafePublicText: false,
      estimateCostUsd: (usage) =>
        estimateTokenUsageCostUsd(usage, {
          input: 1,
          output: 2,
        }),
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      fixtureId: fixture.id,
      provider: "openai",
      model: "offline-reference-model",
      latencyMs: 25,
      estimatedCostUsd: 0.00014,
      providerUsage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
      hardGatePassed: true,
    });
    expect(reports[0]).not.toHaveProperty("publicResponse");
  });

  it("normalizes safe provider failures without exposing raw provider data", async () => {
    const fixture = coachEvaluationFixtures[0]!;
    const rawProviderOutput = "RAW_PROVIDER_OUTPUT_MUST_NOT_LEAK";
    const reports = await runLiveCoachEvaluation({
      adapter: {
        provider: "openai",
        model: "offline-reference-model",
        async respondWithMetadata() {
          throw new CoachProviderError(
            "openai",
            "invalid_structured_output",
            rawProviderOutput,
            buildCoachProviderSafeDiagnostics("invalid_structured_output", {
              providerHttpStatus: 200,
              responseValidatorFailed: true,
              responseValidationFailureCode: "invalid_payload_shape",
            })
          );
        },
      },
      fixtures: [fixture],
      printSafePublicText: false,
    });

    expect(reports[0]).toMatchObject({
      provider: "openai",
      model: "offline-reference-model",
      hardGatePassed: false,
      errorType: "invalid_structured_output",
      diagnostics: {
        providerHttpStatus: 200,
        responseValidatorFailed: true,
        responseValidationFailureCode: "invalid_payload_shape",
      },
    });
    expect(JSON.stringify(reports)).not.toContain(rawProviderOutput);
  });
});

it("does not expose generic provider error names or messages", async () => {
  const fixture = coachEvaluationFixtures[0]!;
  const rawProviderOutput = "RAW_GENERIC_PROVIDER_ERROR_MUST_NOT_LEAK";

  const reports = await runLiveCoachEvaluation({
    adapter: {
      provider: "openai",
      model: "offline-reference-model",
      async respondWithMetadata() {
        const error = new Error(rawProviderOutput);
        error.name = rawProviderOutput;
        throw error;
      },
    },
    fixtures: [fixture],
    printSafePublicText: false,
  });

  expect(reports[0]).toMatchObject({
    provider: "openai",
    model: "offline-reference-model",
    hardGatePassed: false,
    errorType: "provider_error",
    diagnostics: null,
  });
  expect(JSON.stringify(reports)).not.toContain(rawProviderOutput);
});