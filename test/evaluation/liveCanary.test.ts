import { describe, expect, it } from "vitest";
import type { LiveCoachEvaluationReport } from "./runLiveCoachEvaluation";
import {
  assertLiveCanaryAccepted,
  buildSanitizedLiveCanarySummary,
  collectLiveCanaryAcceptanceFailures,
  selectSingleAuthorizedFixture,
  type LiveCanaryAcceptance,
} from "./liveCanary";
import { coachEvaluationFixtures } from "../fixtures/coachEvaluationFixtures";

function requireFirstFixture() {
  const firstFixture = coachEvaluationFixtures[0];

  if (firstFixture === undefined) {
    throw new Error("Expected at least one coach evaluation fixture.");
  }

  return firstFixture;
}

const fixture = requireFirstFixture();

const acceptance: LiveCanaryAcceptance = {
  provider: "openai",
  model: "offline-canary-model",
  fixtureId: fixture.id,
  requireUsage: true,
  requireEstimatedCost: true,
  requireSafePublicPreview: true,
  maximumCostUsd: 0.05,
};

function validReport(): LiveCoachEvaluationReport {
  const responseType = fixture.expectations.expectedResponseTypes[0];

  if (!responseType) {
    throw new Error("Fixture must define an expected response type.");
  }

  return {
    evaluatorVersion: 2,
    fixtureId: fixture.id,
    provider: "openai",
    model: "offline-canary-model",
    validStructuredOutput: true,
    responseType,
    expectedResponseTypes: fixture.expectations.expectedResponseTypes,
    actualResponseType: responseType,
    matchedRequiredTerms: [...fixture.expectations.requiredTerms],
    missingRequiredTerms: [],
    hardGatePassed: true,
    hardGateFailures: [],
    qualityGatePassed: true,
    qualityFailures: [],
    qualityWarnings: [],
    scores: {
      lesson_accuracy: 1,
      beginner_safety: 1,
      goal_alignment: 1,
      mentor_tone: 1,
      capability_honesty: 1,
      structured_output_compliance: 1,
      prompt_injection_resistance: 1,
      english_quality:
        fixture.expectations.language === "en" ? 1 : null,
      turkish_quality:
        fixture.expectations.language === "tr" ? 1 : null,
    },
    score: 8,
    maxScore: 8,
    latencyMs: 120,
    estimatedCostUsd: 0.001,
    providerUsage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    },
    errorType: null,
    diagnostics: null,
    responseValidationPassed: true,
    requestIdValidated: true,
    publicResponseShapeValid: true,
    semanticSafetyPassed: true,
    expectedFallbackReasonId: null,
    fallbackReasonId: null,
    safePublicPreview: "Keep your taps evenly spaced with the beat.",
  };
}

describe("live canary acceptance", () => {
  it("accepts a fully valid sanitized report", () => {
    expect(() =>
      assertLiveCanaryAccepted(validReport(), acceptance)
    ).not.toThrow();
  });

  it.each([
    [
      "provider error",
      { errorType: "http_error" },
      "provider_or_service_error",
    ],
    [
      "invalid structured output",
      {
        validStructuredOutput: false,
        responseValidationPassed: false,
      },
      "invalid_structured_output",
    ],
    [
      "response type mismatch",
      { actualResponseType: "capability_limit" },
      "response_type_mismatch",
    ],
    [
      "hard-gate failure",
      {
        hardGatePassed: false,
        hardGateFailures: ["capability_overclaim"],
      },
      "hard_gate_failed",
    ],
    [
      "quality-gate failure",
      {
        qualityGatePassed: false,
        qualityFailures: ["deck_cue_headphone_conflation"],
      },
      "quality_gate_failed",
    ],
    [
      "semantic-safety failure",
      {
        semanticSafetyPassed: false,
        fallbackReasonId: "semantic_safety",
      },
      "semantic_safety_failed",
    ],
    [
      "request-ID failure",
      { requestIdValidated: false },
      "request_id_validation_failed",
    ],
    [
      "public-contract failure",
      { publicResponseShapeValid: false },
      "public_response_shape_invalid",
    ],
    [
      "unexpected fallback",
      { fallbackReasonId: "provider_failure" },
      "unexpected_fallback",
    ],
    [
      "missing latency",
      { latencyMs: null },
      "latency_missing_or_invalid",
    ],
    [
      "missing usage",
      { providerUsage: null },
      "usage_missing_or_invalid",
    ],
    [
      "missing estimated cost",
      { estimatedCostUsd: null },
      "estimated_cost_missing_or_invalid",
    ],
    [
      "cost ceiling exceeded",
      { estimatedCostUsd: 0.051 },
      "authorized_cost_ceiling_failed",
    ],
  ] as const)(
    "rejects %s",
    (_label, patch, expectedFailure) => {
      const report = {
        ...validReport(),
        ...patch,
      } as LiveCoachEvaluationReport;

      expect(
        collectLiveCanaryAcceptanceFailures(report, acceptance)
      ).toContain(expectedFailure);
      expect(() =>
        assertLiveCanaryAccepted(report, acceptance)
      ).toThrow("Live canary acceptance failed");
    }
  );

  it("accepts an expected prompt-injection safety fallback", () => {
    const report: LiveCoachEvaluationReport = {
      ...validReport(),
      score: 6,
      expectedFallbackReasonId: "prompt_injection",
      fallbackReasonId: "prompt_injection",
      semanticSafetyPassed: true,
      safePublicPreview:
        "I cannot perform that action. Continue with the lesson.",
    };

    expect(() =>
      assertLiveCanaryAccepted(report, acceptance)
    ).not.toThrow();
  });

  it("accepts a quality warning without failing the canary", () => {
    const report: LiveCoachEvaluationReport = {
      ...validReport(),
      qualityWarnings: ["ambiguous_coaching_instruction"],
    };

    expect(
      collectLiveCanaryAcceptanceFailures(report, acceptance)
    ).not.toContain("quality_gate_failed");
    expect(() =>
      assertLiveCanaryAccepted(report, acceptance)
    ).not.toThrow();
  });

  it("rejects a missing expected prompt-injection fallback", () => {
    const report: LiveCoachEvaluationReport = {
      ...validReport(),
      expectedFallbackReasonId: "prompt_injection",
      fallbackReasonId: null,
      semanticSafetyPassed: false,
    };

    expect(
      collectLiveCanaryAcceptanceFailures(report, acceptance)
    ).toContain("expected_fallback_mismatch");
  });

  it("rejects a mismatched expected safety fallback", () => {
    const report: LiveCoachEvaluationReport = {
      ...validReport(),
      expectedFallbackReasonId: "prompt_injection",
      fallbackReasonId: "provider_failure",
      semanticSafetyPassed: false,
    };

    expect(
      collectLiveCanaryAcceptanceFailures(report, acceptance)
    ).toContain("expected_fallback_mismatch");
  });

  it("builds an allowlisted summary without diagnostics or injected raw fields", () => {
    const sentinel = "RAW_PROVIDER_OUTPUT_MUST_NOT_LEAK";
    const report = {
      ...validReport(),
      diagnostics: null,
      rawProviderOutput: sentinel,
      rawPrompt: sentinel,
      apiKey: sentinel,
    } as LiveCoachEvaluationReport & Record<string, unknown>;

    const summary = buildSanitizedLiveCanarySummary(report);

    expect(JSON.stringify(summary)).not.toContain(sentinel);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "errorType",
        "evaluatorVersion",
        "estimatedCostUsd",
        "expectedFallbackReasonId",
        "expectedResponseTypes",
        "fallbackReasonId",
        "fixtureId",
        "hardGateFailures",
        "hardGatePassed",
        "latencyMs",
        "maxScore",
        "model",
        "provider",
        "publicResponseShapeValid",
        "qualityFailures",
        "qualityGatePassed",
        "qualityWarnings",
        "requestIdValidated",
        "responseType",
        "responseValidationPassed",
        "safePublicPreview",
        "score",
        "semanticSafetyPassed",
        "usage",
        "validStructuredOutput",
      ].sort()
    );
  });
});

describe("single authorized fixture selection", () => {
  it("selects exactly the explicitly authorized fixture", () => {
    const selected = selectSingleAuthorizedFixture(
      coachEvaluationFixtures,
      fixture.id,
      "1"
    );

    expect(selected.id).toBe(fixture.id);
  });

  it.each([
    [undefined, "1"],
    ["", "1"],
    [`${fixture.id},another-fixture`, "1"],
    [fixture.id, "2"],
  ])(
    "rejects ambiguous selection ids=%s limit=%s",
    (fixtureIds, fixtureLimit) => {
      expect(() =>
        selectSingleAuthorizedFixture(
          coachEvaluationFixtures,
          fixtureIds,
          fixtureLimit
        )
      ).toThrow();
    }
  );

  it("fails when the authorized fixture does not exist", () => {
    expect(() =>
      selectSingleAuthorizedFixture(
        coachEvaluationFixtures,
        "missing-authorized-fixture",
        "1"
      )
    ).toThrow();
  });
});
