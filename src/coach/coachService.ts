import {
  coachApiContractVersion,
  CoachApiRequestV1,
  CoachApiSuccessResponseV1,
} from "../contracts/CoachApiContract";
import { buildMockCoachResponse } from "./mockCoach";
import { validateCoachApiSuccessResponse } from "./coachResponseValidator";
import { validateCoachRuntimeSemanticSafety } from "./coachRuntimeSafety";
import { OpenAiCoachService } from "./openAiCoachService";
import {
  CoachProviderEnvironment,
  resolveCoachProviderConfig,
} from "./providerConfig";
import { CoachProviderError } from "./providerTypes";

export type CoachService = {
  respond(request: CoachApiRequestV1): Promise<unknown>;
};

export type CoachServiceFallbackResult =
  | "provider_fallback"
  | "semantic_safety_fallback";

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
  primaryService: CoachService,
  onFallback?: (result: CoachServiceFallbackResult) => void
): CoachService {
  return {
    async respond(request) {
      try {
        return await primaryService.respond(request);
      } catch (error) {
        onFallback?.(
          error instanceof CoachProviderError &&
              error.diagnostics.semanticSafetyFailed
            ? "semantic_safety_fallback"
            : "provider_fallback"
        );
        return mockCoachService.respond(request);
      }
    },
  };
}

export function createConfiguredCoachService(
  env: CoachProviderEnvironment,
  fetchImplementation: typeof fetch = fetch,
  onFallback?: (result: CoachServiceFallbackResult) => void
): CoachService {
  const config = resolveCoachProviderConfig(env);

  if (config.provider === "mock") {
    return mockCoachService;
  }

  return withDeterministicFallback(
    new OpenAiCoachService(config, fetchImplementation),
    onFallback
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
