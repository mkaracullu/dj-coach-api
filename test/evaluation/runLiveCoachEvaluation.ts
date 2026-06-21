import {
  CoachProviderError,
  type CoachProviderId,
  type CoachProviderResult,
  type CoachProviderUsage,
} from "../../src/coach/providerTypes";
import type { CoachApiRequestV1 } from "../../src/contracts/CoachApiContract";
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

export async function runLiveCoachEvaluation(
  options: LiveCoachEvaluationOptions
): Promise<CoachEvaluationReport[]> {
  const reports: CoachEvaluationReport[] = [];

  for (const fixture of options.fixtures) {
    try {
      const result = await options.adapter.respondWithMetadata(fixture.request);
      const estimatedCostUsd =
        result.estimatedCostUsd ??
        options.estimateCostUsd?.(result.usage) ??
        null;

      reports.push(
        addSafePublicTextPreview(
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
          options.printSafePublicText
        )
      );
    } catch (error) {
      reports.push(
        evaluateCoachResponse(fixture, null, {
          provider: options.adapter.provider,
          model: options.adapter.model,
          latencyMs: null,
          estimatedCostUsd: null,
          providerUsage: null,
          errorType:
            error instanceof CoachProviderError
              ? error.errorType
              : "provider_error",
          diagnostics:
            error instanceof CoachProviderError ? error.diagnostics : null,
        })
      );
    }
  }

  return reports;
}
