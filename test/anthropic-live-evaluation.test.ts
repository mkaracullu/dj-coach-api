import { describe, expect, it } from "vitest";
import { AnthropicCoachService } from "../src/coach/anthropicCoachService";
import { resolveAnthropicMaxOutputTokens } from "../src/coach/providerConfig";
import { estimateTokenUsageCostUsd } from "./evaluation/estimateUsageCost";
import { isLiveEvaluationEnabled } from "./evaluation/liveEvaluationConfig";
import { runLiveCoachEvaluation } from "./evaluation/runLiveCoachEvaluation";
import { isSafePublicTextPreviewEnabled } from "./evaluation/safePublicPreview";
import { selectCoachEvaluationFixtures } from "./evaluation/selectCoachEvaluationFixtures";
import { coachEvaluationFixtures } from "./fixtures/coachEvaluationFixtures";

declare const process: {
  env: Record<string, string | undefined>;
};

const evaluationEnv = process.env;
const liveEvaluationEnabled = isLiveEvaluationEnabled(
  evaluationEnv,
  "anthropic"
);

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

describe.skipIf(!liveEvaluationEnabled)(
  "opt-in Anthropic reference provider evaluation",
  () => {
    it("runs an explicitly capped fixture set and prints metadata-only reports", async () => {
      const selectedFixtures = selectCoachEvaluationFixtures(
        coachEvaluationFixtures,
        evaluationEnv.COACH_EVAL_FIXTURE_IDS,
        evaluationEnv.COACH_EVAL_FIXTURE_LIMIT
      );
      const apiKey = requiredEnvironment("ANTHROPIC_API_KEY");
      const model = requiredEnvironment("ANTHROPIC_MODEL");
      const inputPrice = optionalPrice(
        "ANTHROPIC_INPUT_COST_PER_MILLION_USD"
      );
      const outputPrice = optionalPrice(
        "ANTHROPIC_OUTPUT_COST_PER_MILLION_USD"
      );
      const printSafePublicText = isSafePublicTextPreviewEnabled(
        evaluationEnv.COACH_LIVE_EVALUATION_PRINT_SAFE_TEXT
      );
      const service = new AnthropicCoachService({
        provider: "anthropic",
        apiKey,
        model,
        timeoutMs: 12_000,
        maxOutputTokens: resolveAnthropicMaxOutputTokens(
          evaluationEnv.ANTHROPIC_MAX_OUTPUT_TOKENS
        ),
      });
      const reports = await runLiveCoachEvaluation({
        adapter: {
          provider: "anthropic",
          model,
          respondWithMetadata: (request) =>
            service.respondWithMetadata(request),
        },
        fixtures: selectedFixtures,
        printSafePublicText,
        estimateCostUsd: (usage) =>
          estimateTokenUsageCostUsd(usage, {
            input: inputPrice,
            output: outputPrice,
          }),
      });

      console.log(JSON.stringify({ reports }, null, 2));

      expect(reports).toHaveLength(selectedFixtures.length);
    }, 60_000);
  }
);
