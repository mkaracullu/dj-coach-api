import { describe, expect, it } from "vitest";
import { evaluateCoachResponse } from "./coachEvaluator";
import { buildCoachEvaluationScorecards } from "./coachScorecard";
import {
  coachEvaluationFixtures,
  type CoachEvaluationFixture,
} from "../fixtures/coachEvaluationFixtures";

function requireFixture(id: string): CoachEvaluationFixture {
  const fixture = coachEvaluationFixtures.find(
    (candidate) => candidate.id === id
  );

  if (fixture === undefined) {
    throw new Error(`Missing coach evaluation fixture: ${id}`);
  }

  return fixture;
}

function buildCandidate(
  fixture: CoachEvaluationFixture,
  message: string,
  nextActionLabel: string | null,
  responseType: string
): unknown {
  return {
    contractVersion: 1,
    requestId: fixture.request.requestId,
    response: {
      message,
      nextActionLabel,
      responseType,
      fallbackReasonId: null,
    },
  };
}

describe("provider-neutral coach evaluation scorecard", () => {
  it("does not count invalid structured output as a quality-gate pass", () => {
    const fixture = requireFixture("session-2-tap-pulse-en");
    const report = evaluateCoachResponse(fixture, {
      requestId: fixture.request.requestId,
      message: "Not the public response contract.",
    });
    const scorecard = buildCoachEvaluationScorecards([report])[0];

    expect(report.validStructuredOutput).toBe(false);
    expect(report.hardGatePassed).toBe(false);
    expect(report.hardGateFailures).toEqual([
      "invalid_structured_output",
    ]);
    expect(report.qualityGatePassed).toBe(false);
    expect(report.qualityFailures).toEqual([]);
    expect(scorecard).toMatchObject({
      reportCount: 1,
      hardGatePassCount: 0,
      hardGatePassRate: 0,
      qualityGatePassCount: 0,
      qualityGatePassRate: 0,
    });
  });

  it("aggregates deterministic sanitized metrics without raw text", () => {
    const turkishFixture = requireFixture("session-2-tap-pulse-tr");
    const controlsFixture = requireFixture("goal-understand-controls");
    const sentinel = "RAW_PROVIDER_OUTPUT_MUST_NOT_LEAK";
    const reports = [
      evaluateCoachResponse(
        turkishFixture,
        buildCandidate(
          turkishFixture,
          `Ritme dokun ve eşit vuruşları sürdür. pepe pepe pepe ${sentinel}`,
          "Sadece 4 vuruş say",
          "concept_clarification"
        ),
        {
          provider: "provider-b",
          model: "model-2",
          latencyMs: 40,
          estimatedCostUsd: 0.002,
          providerUsage: null,
          errorType: null,
          diagnostics: null,
        }
      ),
      evaluateCoachResponse(
        controlsFixture,
        buildCandidate(
          controlsFixture,
          "On a controller, deck Cue sets a cue point for timing. Play starts the track.",
          null,
          "setup_guidance"
        ),
        {
          provider: "provider-a",
          model: "model-1",
          latencyMs: 20,
          estimatedCostUsd: 0.001,
          providerUsage: null,
          errorType: null,
          diagnostics: null,
        }
      ),
      evaluateCoachResponse(
        turkishFixture,
        buildCandidate(
          turkishFixture,
          "Ritme dokun ve vuruşları eşit aralıklarla sürdür.",
          "4 vuruş boyunca dokun",
          "concept_clarification"
        ),
        {
          provider: "provider-b",
          model: "model-2",
          latencyMs: 20,
          estimatedCostUsd: 0.003,
          providerUsage: null,
          errorType: null,
          diagnostics: null,
        }
      ),
    ];

    const scorecards = buildCoachEvaluationScorecards(reports);
    const reversedScorecards = buildCoachEvaluationScorecards(
      [...reports].reverse()
    );

    expect(scorecards).toEqual(reversedScorecards);
    expect(scorecards).toHaveLength(2);
    expect(scorecards[1]).toMatchObject({
      provider: "provider-b",
      model: "model-2",
      reportCount: 2,
      hardGatePassCount: 2,
      hardGatePassRate: 1,
      qualityGatePassCount: 1,
      qualityGatePassRate: 0.5,
      qualityFailureCounts: {
        nonsensical_language_repetition: 1,
      },
      qualityWarningCounts: {
        next_action_mismatch: 1,
      },
      averageScore: 7.5,
      averageLatencyMs: 30,
      totalEstimatedCostUsd: 0.005,
    });
    expect(JSON.stringify(scorecards)).not.toContain(sentinel);
    expect(JSON.stringify(scorecards)).not.toContain("message");
    expect(JSON.stringify(scorecards)).not.toContain("safePublicPreview");
  });
});
