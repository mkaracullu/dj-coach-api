import type { CoachEvaluationFixture } from "../fixtures/coachEvaluationFixtures";

export function selectCoachEvaluationFixtures(
  fixtures: readonly CoachEvaluationFixture[],
  fixtureIdsValue: string | undefined,
  fixtureLimitValue: string | undefined
): readonly CoachEvaluationFixture[] {
  if (fixtureIdsValue !== undefined) {
    const requestedIds = fixtureIdsValue
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (requestedIds.length === 0) {
      throw new Error(
        "COACH_EVAL_FIXTURE_IDS must contain at least one fixture ID."
      );
    }

    const fixturesById = new Map(
      fixtures.map((fixture) => [fixture.id, fixture])
    );
    const unknownIds = requestedIds.filter((id) => !fixturesById.has(id));

    if (unknownIds.length > 0) {
      throw new Error(
        `Unknown COACH_EVAL_FIXTURE_IDS: ${[...new Set(unknownIds)].join(", ")}.`
      );
    }

    return [...new Set(requestedIds)].map((id) => fixturesById.get(id)!);
  }

  const requestedLimit = Number(fixtureLimitValue ?? "3");
  const fixtureLimit = Math.min(
    fixtures.length,
    Math.max(1, Number.isSafeInteger(requestedLimit) ? requestedLimit : 3)
  );

  return fixtures.slice(0, fixtureLimit);
}
