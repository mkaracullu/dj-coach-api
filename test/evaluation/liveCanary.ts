import type { CoachProviderId } from "../../src/coach/providerTypes";
import type { CoachEvaluationFixture } from "../fixtures/coachEvaluationFixtures";
import type { LiveCoachEvaluationReport } from "./runLiveCoachEvaluation";
import { selectCoachEvaluationFixtures } from "./selectCoachEvaluationFixtures";

export type LiveCanaryAcceptance = {
  provider: CoachProviderId;
  model: string;
  fixtureId: string;
  requireUsage: boolean;
  requireEstimatedCost: boolean;
  requireSafePublicPreview: boolean;
  maximumCostUsd: number;
};

export type SanitizedLiveCanarySummary = {
  provider: string;
  model: string | null;
  fixtureId: string;
  responseType: string | null;
  expectedResponseTypes: readonly string[];
  validStructuredOutput: boolean;
  responseValidationPassed: boolean;
  requestIdValidated: boolean;
  publicResponseShapeValid: boolean;
  semanticSafetyPassed: boolean;
  expectedFallbackReasonId: string | null;
  fallbackReasonId: string | null;
  hardGatePassed: boolean;
  hardGateFailures: readonly string[];
  score: number;
  maxScore: number;
  latencyMs: number | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd: number | null;
  errorType: string | null;
  safePublicPreview: string | null;
};

function parseRequestedFixtureIds(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((fixtureId) => fixtureId.trim())
    .filter((fixtureId) => fixtureId.length > 0);
}

export function selectSingleAuthorizedFixture(
  fixtures: readonly CoachEvaluationFixture[],
  fixtureIdsValue: string | undefined,
  fixtureLimitValue: string | undefined
): CoachEvaluationFixture {
  const requestedFixtureIds = parseRequestedFixtureIds(fixtureIdsValue);

  if (requestedFixtureIds.length !== 1) {
    throw new Error(
      "Live canary requires exactly one explicit COACH_EVAL_FIXTURE_IDS value."
    );
  }

  if (
    fixtureLimitValue !== undefined &&
    fixtureLimitValue.trim() !== "1"
  ) {
    throw new Error(
      "Live canary requires COACH_EVAL_FIXTURE_LIMIT to be exactly 1 when provided."
    );
  }

  const selectedFixtures = selectCoachEvaluationFixtures(
    fixtures,
    requestedFixtureIds[0],
    "1"
  );

  const selectedFixture = selectedFixtures[0];

  if (
    selectedFixtures.length !== 1 ||
    selectedFixture === undefined ||
    selectedFixture.id !== requestedFixtureIds[0]
  ) {
    throw new Error(
      `Authorized live canary fixture was not selected exactly: ${requestedFixtureIds[0]}.`
    );
  }

  return selectedFixture;
}

export function buildSanitizedLiveCanarySummary(
  report: LiveCoachEvaluationReport
): SanitizedLiveCanarySummary {
  return {
    provider: report.provider,
    model: report.model,
    fixtureId: report.fixtureId,
    responseType: report.actualResponseType,
    expectedResponseTypes: [...report.expectedResponseTypes],
    validStructuredOutput: report.validStructuredOutput,
    responseValidationPassed: report.responseValidationPassed,
    requestIdValidated: report.requestIdValidated,
    publicResponseShapeValid: report.publicResponseShapeValid,
    semanticSafetyPassed: report.semanticSafetyPassed,
    expectedFallbackReasonId: report.expectedFallbackReasonId,
    fallbackReasonId: report.fallbackReasonId,
    hardGatePassed: report.hardGatePassed,
    hardGateFailures: [...report.hardGateFailures],
    score: report.score,
    maxScore: report.maxScore,
    latencyMs: report.latencyMs,
    usage:
      report.providerUsage === null
        ? null
        : {
            inputTokens: report.providerUsage.inputTokens,
            outputTokens: report.providerUsage.outputTokens,
            totalTokens: report.providerUsage.totalTokens,
          },
    estimatedCostUsd: report.estimatedCostUsd,
    errorType: report.errorType,
    safePublicPreview: report.safePublicPreview,
  };
}

function hasValidUsage(
  usage: LiveCoachEvaluationReport["providerUsage"]
): boolean {
  return (
    usage !== null &&
    Number.isFinite(usage.inputTokens) &&
    Number.isFinite(usage.outputTokens) &&
    Number.isFinite(usage.totalTokens) &&
    usage.inputTokens >= 0 &&
    usage.outputTokens >= 0 &&
    usage.totalTokens === usage.inputTokens + usage.outputTokens
  );
}

export function collectLiveCanaryAcceptanceFailures(
  report: LiveCoachEvaluationReport,
  acceptance: LiveCanaryAcceptance
): string[] {
  const failures: string[] = [];

  if (report.provider !== acceptance.provider) {
    failures.push("provider_mismatch");
  }

  if (report.model !== acceptance.model) {
    failures.push("model_mismatch");
  }

  if (report.fixtureId !== acceptance.fixtureId) {
    failures.push("fixture_mismatch");
  }

  if (report.errorType !== null) {
    failures.push("provider_or_service_error");
  }

  if (!report.validStructuredOutput) {
    failures.push("invalid_structured_output");
  }

  if (!report.responseValidationPassed) {
    failures.push("response_validation_failed");
  }

  if (!report.requestIdValidated) {
    failures.push("request_id_validation_failed");
  }

  if (!report.publicResponseShapeValid) {
    failures.push("public_response_shape_invalid");
  }

  if (!report.semanticSafetyPassed) {
    failures.push("semantic_safety_failed");
  }

  if (
    report.expectedFallbackReasonId === null &&
    report.fallbackReasonId !== null
  ) {
    failures.push("unexpected_fallback");
  }

  if (
    report.expectedFallbackReasonId !== null &&
    report.fallbackReasonId !== report.expectedFallbackReasonId
  ) {
    failures.push("expected_fallback_mismatch");
  }

  if (!report.hardGatePassed || report.hardGateFailures.length > 0) {
    failures.push("hard_gate_failed");
  }

  if (
    report.actualResponseType === null ||
    !report.expectedResponseTypes.includes(report.actualResponseType)
  ) {
    failures.push("response_type_mismatch");
  }

  if (
    report.latencyMs === null ||
    !Number.isFinite(report.latencyMs) ||
    report.latencyMs < 0
  ) {
    failures.push("latency_missing_or_invalid");
  }

  if (acceptance.requireUsage && !hasValidUsage(report.providerUsage)) {
    failures.push("usage_missing_or_invalid");
  }

  if (
    acceptance.requireEstimatedCost &&
    (report.estimatedCostUsd === null ||
      !Number.isFinite(report.estimatedCostUsd) ||
      report.estimatedCostUsd < 0)
  ) {
    failures.push("estimated_cost_missing_or_invalid");
  }

  if (
    report.estimatedCostUsd === null ||
    !Number.isFinite(report.estimatedCostUsd) ||
    report.estimatedCostUsd > acceptance.maximumCostUsd
  ) {
    failures.push("authorized_cost_ceiling_failed");
  }

  if (
    acceptance.requireSafePublicPreview &&
    (report.safePublicPreview === null ||
      report.safePublicPreview.trim().length === 0)
  ) {
    failures.push("safe_public_preview_missing");
  }

  if (report.diagnostics !== null) {
    failures.push("unexpected_diagnostics");
  }

  return failures;
}

export function assertLiveCanaryAccepted(
  report: LiveCoachEvaluationReport,
  acceptance: LiveCanaryAcceptance
): void {
  const failures = collectLiveCanaryAcceptanceFailures(
    report,
    acceptance
  );

  if (failures.length > 0) {
    throw new Error(
      `Live canary acceptance failed: ${failures.join(", ")}`
    );
  }
}
