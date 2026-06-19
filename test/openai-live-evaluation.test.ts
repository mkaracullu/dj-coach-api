import { describe, expect, it } from "vitest";
import {
  OpenAiCoachService,
  OpenAiProviderError,
} from "../src/coach/openAiCoachService";
import { resolveOpenAiMaxOutputTokens } from "../src/coach/providerConfig";
import { evaluateCoachResponse } from "./evaluation/coachEvaluator";
import {
  addSafePublicTextPreview,
  isSafePublicTextPreviewEnabled,
} from "./evaluation/safePublicPreview";
import { selectCoachEvaluationFixtures } from "./evaluation/selectCoachEvaluationFixtures";
import { coachEvaluationFixtures } from "./fixtures/coachEvaluationFixtures";

declare const process: {
  env: Record<string, string | undefined>;
};

const evaluationEnv = process.env;
const liveEvaluationEnabled =
  evaluationEnv.COACH_LIVE_EVALUATION === "true";

function requiredEnvironment(name: string): string {
  const value = evaluationEnv[name];

  if (!value) {
    throw new Error(`${name} is required for live provider evaluation.`);
  }

  return value;
}

function optionalPrice(name: string): number | null {
  const value = evaluationEnv[name];

  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function estimateCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMillion: number | null,
  outputPricePerMillion: number | null
): number | null {
  if (
    inputPricePerMillion === null ||
    outputPricePerMillion === null
  ) {
    return null;
  }

  return (
    (inputTokens * inputPricePerMillion +
      outputTokens * outputPricePerMillion) /
    1_000_000
  );
}

describe.skipIf(!liveEvaluationEnabled)(
  "opt-in OpenAI reference provider evaluation",
  () => {
    it("runs an explicitly capped fixture set and prints metadata-only reports", async () => {
      const selectedFixtures = selectCoachEvaluationFixtures(
        coachEvaluationFixtures,
        evaluationEnv.COACH_EVAL_FIXTURE_IDS,
        evaluationEnv.COACH_EVAL_FIXTURE_LIMIT
      );
      const apiKey = requiredEnvironment("OPENAI_API_KEY");
      const model = requiredEnvironment("OPENAI_MODEL");
      const inputPrice = optionalPrice(
        "OPENAI_INPUT_COST_PER_MILLION_USD"
      );
      const outputPrice = optionalPrice(
        "OPENAI_OUTPUT_COST_PER_MILLION_USD"
      );
      const printSafePublicText = isSafePublicTextPreviewEnabled(
        evaluationEnv.COACH_LIVE_EVALUATION_PRINT_SAFE_TEXT
      );
      const service = new OpenAiCoachService({
        provider: "openai",
        apiKey,
        model,
        timeoutMs: 12_000,
        maxOutputTokens: resolveOpenAiMaxOutputTokens(
          evaluationEnv.OPENAI_MAX_OUTPUT_TOKENS
        ),
      });
      const reports = [];

      for (const fixture of selectedFixtures) {
        try {
          const result = await service.respondWithMetadata(fixture.request);
          const estimatedCostUsd = result.usage
            ? estimateCost(
                result.usage.inputTokens,
                result.usage.outputTokens,
                inputPrice,
                outputPrice
              )
            : null;

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
              printSafePublicText
            )
          );
        } catch (error) {
          reports.push(
            evaluateCoachResponse(fixture, null, {
              provider: "openai",
              model,
              latencyMs: null,
              estimatedCostUsd: null,
              providerUsage: null,
              errorType:
                error instanceof OpenAiProviderError
                  ? error.errorType
                  : error instanceof Error
                    ? error.name
                    : "UnknownProviderError",
              diagnostics:
                error instanceof OpenAiProviderError
                  ? error.diagnostics
                  : null,
            })
          );
        }
      }

      console.log(JSON.stringify({ reports }, null, 2));

      expect(reports).toHaveLength(selectedFixtures.length);
    }, 60_000);
  }
);
