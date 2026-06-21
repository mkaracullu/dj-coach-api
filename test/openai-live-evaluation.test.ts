import { describe, expect, it } from "vitest";
import { OpenAiCoachService } from "../src/coach/openAiCoachService";
import { resolveOpenAiMaxOutputTokens } from "../src/coach/providerConfig";
import { estimateTokenUsageCostUsd } from "./evaluation/estimateUsageCost";
import {
  assertLiveCanaryAccepted,
  buildSanitizedLiveCanarySummary,
  selectSingleAuthorizedFixture,
} from "./evaluation/liveCanary";
import { isLiveEvaluationEnabled } from "./evaluation/liveEvaluationConfig";
import { runLiveCoachEvaluation } from "./evaluation/runLiveCoachEvaluation";
import { isSafePublicTextPreviewEnabled } from "./evaluation/safePublicPreview";
import { selectCoachEvaluationFixtures } from "./evaluation/selectCoachEvaluationFixtures";
import { coachEvaluationFixtures } from "./fixtures/coachEvaluationFixtures";

declare const process: {
  env: Record<string, string | undefined>;
  stdout: {
    write(value: string): void;
  };
};

const evaluationEnv = process.env;
const liveEvaluationEnabled = isLiveEvaluationEnabled(
  evaluationEnv,
  "openai"
);
const liveCanaryEnabled =
  evaluationEnv.COACH_LIVE_EVALUATION_CANARY === "true";

function requiredEnvironment(name: string): string {
  const value = evaluationEnv[name];

  if (!value) {
    throw new Error(`${name} is required for live provider evaluation.`);
  }

  return value;
}

function parseNonNegativeNumber(
  name: string,
  required: boolean
): number | null {
  const value = evaluationEnv[name];

  if (!value) {
    if (required) {
      throw new Error(`${name} is required for live canary evaluation.`);
    }

    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }

  return parsed;
}

describe.skipIf(!liveEvaluationEnabled)(
  "opt-in OpenAI reference provider evaluation",
  () => {
    it("runs gated evaluation and enforces canary acceptance when requested", async () => {
      const selectedFixtures = liveCanaryEnabled
        ? [
            selectSingleAuthorizedFixture(
              coachEvaluationFixtures,
              evaluationEnv.COACH_EVAL_FIXTURE_IDS,
              evaluationEnv.COACH_EVAL_FIXTURE_LIMIT
            ),
          ]
        : selectCoachEvaluationFixtures(
            coachEvaluationFixtures,
            evaluationEnv.COACH_EVAL_FIXTURE_IDS,
            evaluationEnv.COACH_EVAL_FIXTURE_LIMIT
          );
      const apiKey = requiredEnvironment("OPENAI_API_KEY");
      const model = requiredEnvironment("OPENAI_MODEL");
      const inputPrice = parseNonNegativeNumber(
        "OPENAI_INPUT_COST_PER_MILLION_USD",
        liveCanaryEnabled
      );
      const outputPrice = parseNonNegativeNumber(
        "OPENAI_OUTPUT_COST_PER_MILLION_USD",
        liveCanaryEnabled
      );
      const maximumCostUsd = parseNonNegativeNumber(
        "COACH_LIVE_EVALUATION_MAX_COST_USD",
        liveCanaryEnabled
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
      const reports = await runLiveCoachEvaluation({
        adapter: {
          provider: "openai",
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

      if (liveCanaryEnabled) {
        const report = reports[0];
        const selectedFixture = selectedFixtures[0];

        if (
          report === undefined ||
          selectedFixture === undefined ||
          maximumCostUsd === null
        ) {
          throw new Error(
            "Live canary did not produce exactly one enforceable report."
          );
        }

        const summary = buildSanitizedLiveCanarySummary(report);

        process.stdout.write(
          `DJ_LINGO_CANARY_REPORT=${JSON.stringify(summary)}\n`
        );

        assertLiveCanaryAccepted(report, {
          provider: "openai",
          model,
          fixtureId: selectedFixture.id,
          requireUsage: true,
          requireEstimatedCost: true,
          requireSafePublicPreview: printSafePublicText,
          maximumCostUsd,
        });

        return;
      }

      console.log(JSON.stringify({ reports }, null, 2));
      expect(reports).toHaveLength(selectedFixtures.length);
    }, 60_000);
  }
);
