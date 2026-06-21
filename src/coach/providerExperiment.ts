import type {
  AnthropicCoachConfig,
  CoachProviderEnvironment,
  OpenAiCoachConfig,
} from "./providerConfig";
import { resolveExternalCoachProviderConfig } from "./providerConfig";
import type { CoachProviderId } from "./providerTypes";

export const coachExperimentCohortHeader =
  "X-DJ-Experiment-Cohort" as const;

const cohortIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const experimentTextPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const minimumAssignmentSecretLength = 16;

export type CoachExperimentConfig = {
  experimentId: string;
  experimentVersion: string;
  assignmentSecret: string;
  openAiBasisPoints: number;
  openAiConfig: OpenAiCoachConfig;
  anthropicConfig: AnthropicCoachConfig;
};

export type CoachExperimentAssignment = {
  experimentId: string;
  experimentVersion: string;
  assignedProvider: CoachProviderId;
  assignmentBucket: number;
  providerConfig: OpenAiCoachConfig | AnthropicCoachConfig;
};

export function readCoachExperimentCohort(
  request: Request
): string | undefined {
  const value = request.headers.get(coachExperimentCohortHeader);
  return value !== null && cohortIdPattern.test(value) ? value : undefined;
}

export function resolveCoachExperimentConfig(
  env: CoachProviderEnvironment
): CoachExperimentConfig | undefined {
  if (
    env.COACH_PROVIDER !== "experiment" ||
    env.COACH_EXPERIMENT_ENABLED !== "true" ||
    !env.COACH_EXPERIMENT_ID ||
    !experimentTextPattern.test(env.COACH_EXPERIMENT_ID) ||
    !env.COACH_EXPERIMENT_VERSION ||
    !experimentTextPattern.test(env.COACH_EXPERIMENT_VERSION) ||
    !env.COACH_EXPERIMENT_ASSIGNMENT_SECRET ||
    env.COACH_EXPERIMENT_ASSIGNMENT_SECRET.length <
      minimumAssignmentSecretLength
  ) {
    return undefined;
  }

  const openAiBasisPoints = Number(env.COACH_EXPERIMENT_OPENAI_BPS);

  if (
    !Number.isSafeInteger(openAiBasisPoints) ||
    openAiBasisPoints < 0 ||
    openAiBasisPoints > 10_000
  ) {
    return undefined;
  }

  const openAiConfig = resolveExternalCoachProviderConfig(env, "openai");
  const anthropicConfig = resolveExternalCoachProviderConfig(
    env,
    "anthropic"
  );

  if (
    openAiConfig?.provider !== "openai" ||
    anthropicConfig?.provider !== "anthropic"
  ) {
    return undefined;
  }

  return {
    experimentId: env.COACH_EXPERIMENT_ID,
    experimentVersion: env.COACH_EXPERIMENT_VERSION,
    assignmentSecret: env.COACH_EXPERIMENT_ASSIGNMENT_SECRET,
    openAiBasisPoints,
    openAiConfig,
    anthropicConfig,
  };
}

export async function assignCoachExperimentProvider(
  config: CoachExperimentConfig,
  cohortId: string
): Promise<CoachExperimentAssignment> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.assignmentSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const canonicalInput = [
    config.experimentId,
    config.experimentVersion,
    cohortId,
  ].join(":");
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalInput))
  );
  const bucket =
    (((digest[0]! << 24) |
      (digest[1]! << 16) |
      (digest[2]! << 8) |
      digest[3]!) >>>
      0) %
    10_000;
  const assignedProvider: CoachProviderId =
    bucket < config.openAiBasisPoints ? "openai" : "anthropic";

  return {
    experimentId: config.experimentId,
    experimentVersion: config.experimentVersion,
    assignedProvider,
    assignmentBucket: bucket,
    providerConfig:
      assignedProvider === "openai"
        ? config.openAiConfig
        : config.anthropicConfig,
  };
}
