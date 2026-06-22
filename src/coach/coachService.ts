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
  type CoachProviderExecutionMetadata,
  type CoachProviderErrorCategory,
  type CoachProviderId,
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

export type CoachProviderExecutionObserver = (
  metadata: CoachProviderExecutionMetadata
) => void;

function observeProviderExecution(
  observer: CoachProviderExecutionObserver | undefined,
  metadata: CoachProviderExecutionMetadata
): void {
  try {
    observer?.(metadata);
  } catch {
    // Operational metadata must never change the public response or retry a provider.
  }
}

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
  provider: CoachProviderId,
  primaryService: {
    respondWithMetadata(
      request: CoachApiRequestV1
    ): Promise<{
      response: CoachApiSuccessResponseV1;
      latencyMs: number;
      usage: CoachProviderExecutionMetadata["usage"];
    }>;
  },
  onFallback?: (result: CoachServiceFallbackResult) => void,
  onProviderExecution?: CoachProviderExecutionObserver
): CoachService {
  return {
    async respond(request) {
      const startedAt = Date.now();

      try {
        const result = await primaryService.respondWithMetadata(request);
        observeProviderExecution(onProviderExecution, {
          provider,
          latencyMs: Math.max(0, result.latencyMs),
          usage: result.usage,
        });
        return result.response;
      } catch (error) {
        observeProviderExecution(onProviderExecution, {
          provider,
          latencyMs: Math.max(0, Date.now() - startedAt),
          usage: null,
        });
        onFallback?.(buildFallbackResult(error));
        return mockCoachService.respond(request);
      }
    },
  };
}

export function createConfiguredCoachService(
  env: CoachProviderEnvironment,
  fetchImplementation: typeof fetch = fetch,
  onFallback?: (result: CoachServiceFallbackResult) => void,
  onProviderExecution?: CoachProviderExecutionObserver
): CoachService {
  const config = resolveCoachProviderConfig(env);
  return createCoachServiceFromConfig(
    config,
    fetchImplementation,
    onFallback,
    onProviderExecution
  );
}

export function createCoachServiceFromConfig(
  config: CoachProviderConfig,
  fetchImplementation: typeof fetch = fetch,
  onFallback?: (result: CoachServiceFallbackResult) => void,
  onProviderExecution?: CoachProviderExecutionObserver
): CoachService {
  if (config.provider === "mock") {
    return mockCoachService;
  }

  const primaryService =
    config.provider === "openai"
      ? new OpenAiCoachService(config, fetchImplementation)
      : new AnthropicCoachService(config, fetchImplementation);

  return withDeterministicFallback(
    config.provider,
    primaryService,
    onFallback,
    onProviderExecution
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
