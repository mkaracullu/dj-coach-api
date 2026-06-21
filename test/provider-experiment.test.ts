import { describe, expect, it } from "vitest";
import {
  assignCoachExperimentProvider,
  readCoachExperimentCohort,
  resolveCoachExperimentConfig,
} from "../src/coach/providerExperiment";
import type { CoachProviderEnvironment } from "../src/coach/providerConfig";

const cohortId = "123e4567-e89b-42d3-a456-426614174000";

function completeExperimentEnv(
  overrides: Partial<CoachProviderEnvironment> = {}
): CoachProviderEnvironment {
  return {
    COACH_PROVIDER: "experiment",
    COACH_EXPERIMENT_ENABLED: "true",
    COACH_EXPERIMENT_ID: "provider_quality",
    COACH_EXPERIMENT_VERSION: "v1",
    COACH_EXPERIMENT_ASSIGNMENT_SECRET:
      "test-only-assignment-secret-not-production",
    COACH_EXPERIMENT_OPENAI_BPS: "5000",
    OPENAI_API_KEY: "test-openai-key-not-real",
    OPENAI_MODEL: "openai-reference-model",
    ANTHROPIC_API_KEY: "test-anthropic-key-not-real",
    ANTHROPIC_MODEL: "anthropic-reference-model",
    ...overrides,
  };
}

describe("provider experiment assignment", () => {
  it("resolves only complete explicit experiment configuration", () => {
    expect(resolveCoachExperimentConfig(completeExperimentEnv())).toMatchObject({
      experimentId: "provider_quality",
      experimentVersion: "v1",
      openAiBasisPoints: 5000,
    });
    expect(
      resolveCoachExperimentConfig(
        completeExperimentEnv({ COACH_PROVIDER: "mock" })
      )
    ).toBeUndefined();
    expect(
      resolveCoachExperimentConfig(
        completeExperimentEnv({
          COACH_EXPERIMENT_ASSIGNMENT_SECRET: "",
        })
      )
    ).toBeUndefined();
    expect(
      resolveCoachExperimentConfig(
        completeExperimentEnv({ COACH_EXPERIMENT_OPENAI_BPS: "10001" })
      )
    ).toBeUndefined();
    expect(
      resolveCoachExperimentConfig(
        completeExperimentEnv({ ANTHROPIC_API_KEY: "" })
      )
    ).toBeUndefined();
  });

  it("accepts only canonical opaque UUID cohort headers", () => {
    expect(
      readCoachExperimentCohort(
        new Request("https://example.test", {
          headers: { "X-DJ-Experiment-Cohort": cohortId },
        })
      )
    ).toBe(cohortId);
    expect(
      readCoachExperimentCohort(
        new Request("https://example.test", {
          headers: { "X-DJ-Experiment-Cohort": "malformed" },
        })
      )
    ).toBeUndefined();
    expect(
      readCoachExperimentCohort(
        new Request("https://example.test", {
          headers: {
            "X-DJ-Experiment-Cohort": "a".repeat(200),
          },
        })
      )
    ).toBeUndefined();
  });

  it("is stable for the same experiment and cohort", async () => {
    const config = resolveCoachExperimentConfig(completeExperimentEnv())!;
    const first = await assignCoachExperimentProvider(config, cohortId);
    const second = await assignCoachExperimentProvider(config, cohortId);

    expect(second.assignedProvider).toBe(first.assignedProvider);
  });

  it("uses keyed and versioned assignment inputs", async () => {
    const baseline = resolveCoachExperimentConfig(
      completeExperimentEnv()
    )!;
    const anotherVersion = resolveCoachExperimentConfig(
      completeExperimentEnv({ COACH_EXPERIMENT_VERSION: "v2" })
    )!;
    const anotherSecret = resolveCoachExperimentConfig(
      completeExperimentEnv({
        COACH_EXPERIMENT_ASSIGNMENT_SECRET:
          "different-test-secret-not-production",
      })
    )!;

    const baselineAssignment = await assignCoachExperimentProvider(
      baseline,
      cohortId
    );
    const versionedAssignment = await assignCoachExperimentProvider(
      anotherVersion,
      cohortId
    );
    const rekeyedAssignment = await assignCoachExperimentProvider(
      anotherSecret,
      cohortId
    );

    expect(versionedAssignment.experimentVersion).toBe("v2");
    expect(rekeyedAssignment.experimentVersion).toBe("v1");
    expect(versionedAssignment.assignmentBucket).not.toBe(
      baselineAssignment.assignmentBucket
    );
    expect(rekeyedAssignment.assignmentBucket).not.toBe(
      baselineAssignment.assignmentBucket
    );
  });

  it("honors strict allocation boundaries", async () => {
    const allOpenAi = resolveCoachExperimentConfig(
      completeExperimentEnv({ COACH_EXPERIMENT_OPENAI_BPS: "10000" })
    )!;
    const allAnthropic = resolveCoachExperimentConfig(
      completeExperimentEnv({ COACH_EXPERIMENT_OPENAI_BPS: "0" })
    )!;

    await expect(
      assignCoachExperimentProvider(allOpenAi, cohortId)
    ).resolves.toMatchObject({ assignedProvider: "openai" });
    await expect(
      assignCoachExperimentProvider(allAnthropic, cohortId)
    ).resolves.toMatchObject({ assignedProvider: "anthropic" });
  });

  it("supports both variants at an intermediate allocation", async () => {
    const config = resolveCoachExperimentConfig(completeExperimentEnv())!;
    const syntheticCohorts = Array.from(
      { length: 32 },
      (_, index) =>
        `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`
    );
    const assignments = await Promise.all(
      syntheticCohorts.map((syntheticCohort) =>
        assignCoachExperimentProvider(config, syntheticCohort)
      )
    );

    expect(new Set(assignments.map(({ assignedProvider }) => assignedProvider)))
      .toEqual(new Set(["openai", "anthropic"]));
    expect(
      assignments.every(
        ({ assignmentBucket }) =>
          assignmentBucket >= 0 && assignmentBucket < 10_000
      )
    ).toBe(true);
    expect(
      assignments.every(
        ({ assignedProvider, assignmentBucket }) =>
          assignedProvider ===
          (assignmentBucket < 5_000 ? "openai" : "anthropic")
      )
    ).toBe(true);
  });
});
