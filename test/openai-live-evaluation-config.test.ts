import { describe, expect, it, vi } from "vitest";
import { selectCoachEvaluationFixtures } from "./evaluation/selectCoachEvaluationFixtures";
import { coachEvaluationFixtures } from "./fixtures/coachEvaluationFixtures";

describe("OpenAI live evaluation fixture selection", () => {
  it("selects only requested fixture IDs in requested order", () => {
    const selected = selectCoachEvaluationFixtures(
      coachEvaluationFixtures,
      "injection-controller-action,goal-short-practice-mix",
      "1"
    );

    expect(selected.map((fixture) => fixture.id)).toEqual([
      "injection-controller-action",
      "goal-short-practice-mix",
    ]);
  });

  it("fails unknown fixture IDs before provider calls", () => {
    const providerCall = vi.fn();

    expect(() => {
      const selected = selectCoachEvaluationFixtures(
        coachEvaluationFixtures,
        "goal-short-practice-mix,unknown-fixture",
        undefined
      );

      for (const fixture of selected) {
        providerCall(fixture);
      }
    }).toThrow("Unknown COACH_EVAL_FIXTURE_IDS: unknown-fixture.");
    expect(providerCall).not.toHaveBeenCalled();
  });

  it("uses the fixture limit only when fixture IDs are not provided", () => {
    const selected = selectCoachEvaluationFixtures(
      coachEvaluationFixtures,
      undefined,
      "2"
    );

    expect(selected.map((fixture) => fixture.id)).toEqual([
      "session-2-tap-pulse-en",
      "session-2-tap-pulse-tr",
    ]);
  });
});
