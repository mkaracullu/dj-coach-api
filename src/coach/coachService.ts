import {
  coachApiContractVersion,
  CoachApiRequestV1,
  CoachApiSuccessResponseV1,
} from "../contracts/CoachApiContract";
import { AnthropicCoachService } from "./anthropicCoachService";
import { buildMockCoachResponse } from "./mockCoach";
import { validateCoachApiSuccessResponse } from "./coachResponseValidator";
import { validateCoachRuntimeSemanticSafety } from "./coachRuntimeSafety";
import { OpenAiCoachService } from "./openAiCoachService";
import {
  CoachProviderEnvironment,
  type CoachProviderConfig,
  resolveCoachProviderConfig,
} from "./providerConfig";
import {
  CoachProviderError,
  type CoachProviderErrorCategory,
} from "./providerTypes";
import type { CoachResponseValidationFailureCode } from "./coachResponseValidator";
import type { CoachRuntimeSafetyFailureCode } from "./coachRuntimeSafety";

export type CoachService = {
  respond(request: CoachApiRequestV1): Promise<unknown>;
};

export type CoachServiceFallbackCategory =
  | "provider_fallback"
  | "semantic_safety_fallback";

export type CoachServiceFallbackResult = {
  category: CoachServiceFallbackCategory;
  providerErrorCategory?: CoachProviderErrorCategory;
  providerHttpStatus?: number;
  responseValidationFailureCode?: CoachResponseValidationFailureCode;
  semanticSafetyFailureCode?: CoachRuntimeSafetyFailureCode;
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

function buildFallbackResult(error: unknown): CoachServiceFallbackResult {
  if (!(error instanceof CoachProviderError)) {
    return { category: "provider_fallback" };
  }

  const diagnostics = error.diagnostics;

  return {
    category: diagnostics.semanticSafetyFailed
      ? "semantic_safety_fallback"
      : "provider_fallback",
    providerErrorCategory: diagnostics.providerErrorCategory,
    ...(typeof diagnostics.providerHttpStatus === "number" &&
    Number.isFinite(diagnostics.providerHttpStatus)
      ? { providerHttpStatus: diagnostics.providerHttpStatus }
      : {}),
    ...(diagnostics.responseValidationFailureCode
      ? {
          responseValidationFailureCode:
            diagnostics.responseValidationFailureCode,
        }
      : {}),
    ...(diagnostics.semanticSafetyFailureCode
      ? {
          semanticSafetyFailureCode:
            diagnostics.semanticSafetyFailureCode,
        }
      : {}),
  };
}

function withDeterministicFallback(
  primaryService: CoachService,
  onFallback?: (result: CoachServiceFallbackResult) => void
): CoachService {
  return {
    async respond(request) {
      try {
        return await primaryService.respond(request);
      } catch (error) {
        onFallback?.(buildFallbackResult(error));
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
  return createCoachServiceFromConfig(
    config,
    fetchImplementation,
    onFallback
  );
}

export function createCoachServiceFromConfig(
  config: CoachProviderConfig,
  fetchImplementation: typeof fetch = fetch,
  onFallback?: (result: CoachServiceFallbackResult) => void
): CoachService {
  if (config.provider === "mock") {
    return mockCoachService;
  }

  const primaryService =
    config.provider === "openai"
      ? new OpenAiCoachService(config, fetchImplementation)
      : new AnthropicCoachService(config, fetchImplementation);

  return withDeterministicFallback(
    primaryService,
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
