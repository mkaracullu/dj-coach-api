import {
  coachApiContractVersion,
  CoachApiRequestV1,
  CoachApiSuccessResponseV1,
} from "../contracts/CoachApiContract";
import { buildMockCoachResponse } from "./mockCoach";
import { validateCoachApiSuccessResponse } from "./coachResponseValidator";
import { validateCoachRuntimeSemanticSafety } from "./coachRuntimeSafety";
import {
  OpenAiCoachService,
  OpenAiProviderError,
} from "./openAiCoachService";
import {
  CoachProviderEnvironment,
  resolveCoachProviderConfig,
} from "./providerConfig";

export type CoachService = {
  respond(request: CoachApiRequestV1): Promise<unknown>;
};

export const mockCoachService: CoachService = {
  async respond(request) {
    return {
      contractVersion: coachApiContractVersion,
      requestId: request.requestId,
      response: buildMockCoachResponse(request),
    };
  },
};

function withDeterministicFallback(
  primaryService: CoachService
): CoachService {
  return {
    async respond(request) {
      try {
        return await primaryService.respond(request);
      } catch (error) {
        const safeDiagnostics =
          error instanceof OpenAiProviderError
            ? {
                ...error.diagnostics,
                deterministicFallbackUsed: true,
              }
            : null;

        console.error(
          JSON.stringify({
            message: "Coach provider failed; using deterministic fallback.",
            errorType:
              error instanceof OpenAiProviderError
                ? error.errorType
                : error instanceof Error
                  ? error.name
                  : "UnknownProviderError",
            diagnostics: safeDiagnostics,
          })
        );
        return mockCoachService.respond(request);
      }
    },
  };
}

export function createConfiguredCoachService(
  env: CoachProviderEnvironment,
  fetchImplementation: typeof fetch = fetch
): CoachService {
  const config = resolveCoachProviderConfig(env);

  if (config.provider === "mock") {
    return mockCoachService;
  }

  return withDeterministicFallback(
    new OpenAiCoachService(config, fetchImplementation)
  );
}

export async function getCoachApiResponse(
  request: CoachApiRequestV1,
  service: CoachService = mockCoachService
): Promise<CoachApiSuccessResponseV1> {
  const candidate = await service.respond(request);
  const validatedResponse = validateCoachApiSuccessResponse(
    candidate,
    request.requestId
  );
  return validateCoachRuntimeSemanticSafety(validatedResponse);
}
