import {
  CoachProviderError,
  type CoachProviderId,
  type CoachProviderResult,
  type CoachProviderUsage,
} from "../../src/coach/providerTypes";
import type {
  CoachApiRequestV1,
  CoachApiSuccessResponseV1,
} from "../../src/contracts/CoachApiContract";
import { validateCoachApiSuccessResponse } from "../../src/coach/coachResponseValidator";
import type { CoachEvaluationFixture } from "../fixtures/coachEvaluationFixtures";
import {
  evaluateCoachResponse,
  type CoachEvaluationReport,
} from "./coachEvaluator";
import { addSafePublicTextPreview } from "./safePublicPreview";

export type LiveCoachEvaluationAdapter = {
  provider: CoachProviderId;
  model: string;
  respondWithMetadata(
    request: CoachApiRequestV1
  ): Promise<CoachProviderResult>;
};

export type LiveCoachEvaluationOptions = {
  adapter: LiveCoachEvaluationAdapter;
  fixtures: readonly CoachEvaluationFixture[];
  printSafePublicText: boolean;
  estimateCostUsd?: (usage: CoachProviderUsage | null) => number | null;
};

export type LiveCoachEvaluationReport = CoachEvaluationReport & {
  responseValidationPassed: boolean;
  requestIdValidated: boolean;
  publicResponseShapeValid: boolean;
  semanticSafetyPassed: boolean;
  fallbackReasonId: string | null;
  safePublicPreview: string | null;
};

function hasExactPublicResponseShape(
  response: CoachApiSuccessResponseV1
): boolean {
  const keys = Object.keys(response).sort();

  return (
    keys.length === 3 &&
    keys[0] === "contractVersion" &&
    keys[1] === "requestId" &&
    keys[2] === "response"
  );
}

function buildSafePublicPreview(
  response: CoachApiSuccessResponseV1,
  enabled: boolean
): string | null {
  if (!enabled) {
    return null;
  }

  const nextActionLabel = response.response.nextActionLabel;

  return nextActionLabel
    ? `${response.response.message}\n${nextActionLabel}`
    : response.response.message;
}

function readFallbackReasonId(
  response: CoachApiSuccessResponseV1
): string | null {
  const fallbackReasonId = response.response.fallbackReasonId;

  return typeof fallbackReasonId === "string" ? fallbackReasonId : null;
}

function buildSuccessfulLiveReport(
  fixture: CoachEvaluationFixture,
  result: CoachProviderResult,
  estimatedCostUsd: number | null,
  printSafePublicText: boolean
): LiveCoachEvaluationReport {
  let validatedResponse: CoachApiSuccessResponseV1 | null = null;

  try {
    validatedResponse = validateCoachApiSuccessResponse(
      result.response,
      fixture.request.requestId
    );
  } catch {
    validatedResponse = null;
  }

  const evaluatedReport = addSafePublicTextPreview(
    evaluateCoachResponse(fixture, result.response, {
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      estimatedCostUsd,
      providerUsage: result.usage,
      errorType: null,
      diagnostics: null,
    }),
    result.response,
    printSafePublicText
  );
  const fallbackReasonId =
    validatedResponse === null
      ? null
      : readFallbackReasonId(validatedResponse);

  return {
    ...evaluatedReport,
    responseValidationPassed: validatedResponse !== null,
    requestIdValidated: validatedResponse !== null,
    publicResponseShapeValid:
      validatedResponse !== null &&
      hasExactPublicResponseShape(validatedResponse),
    semanticSafetyPassed:
      validatedResponse !== null && fallbackReasonId === null,
    fallbackReasonId,
    safePublicPreview:
      validatedResponse === null
        ? null
        : buildSafePublicPreview(validatedResponse, printSafePublicText),
  };
}

function buildFailedLiveReport(
  fixture: CoachEvaluationFixture,
  provider: CoachProviderId,
  model: string,
  error: unknown
): LiveCoachEvaluationReport {
  return {
    ...evaluateCoachResponse(fixture, null, {
      provider,
      model,
      latencyMs: null,
      estimatedCostUsd: null,
      providerUsage: null,
      errorType:
        error instanceof CoachProviderError
          ? error.errorType
          : "provider_error",
      diagnostics:
        error instanceof CoachProviderError ? error.diagnostics : null,
    }),
    responseValidationPassed: false,
    requestIdValidated: false,
    publicResponseShapeValid: false,
    semanticSafetyPassed: false,
    fallbackReasonId: null,
    safePublicPreview: null,
  };
}

export async function runLiveCoachEvaluation(
  options: LiveCoachEvaluationOptions
): Promise<LiveCoachEvaluationReport[]> {
  const reports: LiveCoachEvaluationReport[] = [];

  for (const fixture of options.fixtures) {
    try {
      const result = await options.adapter.respondWithMetadata(fixture.request);
      const estimatedCostUsd =
        result.estimatedCostUsd ??
        options.estimateCostUsd?.(result.usage) ??
        null;

      reports.push(
        buildSuccessfulLiveReport(
          fixture,
          result,
          estimatedCostUsd,
          options.printSafePublicText
        )
      );
    } catch (error) {
      reports.push(
        buildFailedLiveReport(
          fixture,
          options.adapter.provider,
          options.adapter.model,
          error
        )
      );
    }
  }

  return reports;
}
