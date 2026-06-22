import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { providerUsageCapBinding } from "./providerUsageCapFixtures";

const syntheticCohort = "123e4567-e89b-42d3-a456-426614174000";
const assignmentSecret = "test-only-assignment-secret-not-production";
const rawSecretSentinel = "RAW_ASSIGNMENT_SECRET_MUST_NOT_LEAK";
const validRequest = {
  contractVersion: 1,
  requestId: "coach_runtime_readiness",
  question: {
    source: "suggested",
    suggestedQuestionId: "what_should_i_focus_on",
  },
  context: {
    lesson: {
      sessionNumber: 2,
      lessonId: "tap-pulse",
      lessonPhase: "practice",
      activityType: "tapPulse",
    },
    progress: {
      completedSessionNumbers: [1],
    },
  },
  locale: "en-US",
};
const validProviderPayload = {
  message: "Keep the pulse steady and leave equal space between taps.",
  nextActionLabel: "Try one steady tap round.",
  responseType: "lesson_explanation",
  fallbackReasonId: null,
};

function request(
  body: unknown = validRequest,
  headers: HeadersInit = {}
): Request {
  const requestHeaders = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-DJ-Request-Id": validRequest.requestId,
    "X-DJ-Experiment-Cohort": syntheticCohort,
  });
  new Headers(headers).forEach((value, key) => {
    requestHeaders.set(key, value);
  });

  return new Request("https://api.example.test/v1/coach/respond", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

function experimentEnv(
  provider: "openai" | "anthropic",
  overrides: Partial<Env> = {}
): Env {
  return {
    COACH_PROVIDER: "experiment",
    COACH_EXPERIMENT_ENABLED: "true",
    COACH_EXPERIMENT_ID: "provider_quality",
    COACH_EXPERIMENT_VERSION: "v1",
    COACH_EXPERIMENT_ASSIGNMENT_SECRET: assignmentSecret,
    COACH_EXPERIMENT_OPENAI_BPS: provider === "openai" ? "10000" : "0",
    OPENAI_API_KEY: "test-openai-key-not-real",
    OPENAI_MODEL: "openai-reference-model",
    ANTHROPIC_API_KEY: "test-anthropic-key-not-real",
    ANTHROPIC_MODEL: "anthropic-reference-model",
    COACH_PROVIDER_DAILY_CALL_LIMIT: "100",
    COACH_PROVIDER_USAGE_CAP: providerUsageCapBinding(),
    ...overrides,
  };
}

function providerResponse(
  provider: "openai" | "anthropic",
  payload: unknown = validProviderPayload
): Response {
  if (provider === "openai") {
    return Response.json({
      status: "completed",
      output: [
        {
          content: [
            { type: "output_text", text: JSON.stringify(payload) },
          ],
        },
      ],
    });
  }

  return Response.json({
    type: "message",
    content: [{ type: "text", text: JSON.stringify(payload) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 30 },
  });
}

function providerUrl(provider: "openai" | "anthropic"): string {
  return provider === "openai"
    ? "https://api.openai.com/v1/responses"
    : "https://api.anthropic.com/v1/messages";
}

function captureTelemetry() {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

  return {
    log,
    last(): Record<string, unknown> {
      return JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<
        string,
        unknown
      >;
    },
    serialized(): string {
      return log.mock.calls.map(([entry]) => String(entry)).join("\n");
    },
  };
}

function allowedProviderLimiter() {
  return vi.fn(async () => ({ success: true }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("provider experiment runtime readiness", () => {
  it.each([
    { name: "absent experiment config", overrides: {} },
    {
      name: "present experiment config",
      overrides: experimentEnv("openai"),
    },
  ])("keeps global mock authoritative with $name", async ({ overrides }) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    for (const cohortHeader of [undefined, syntheticCohort, "malformed"]) {
      const headers = new Headers();
      if (cohortHeader !== undefined) {
        headers.set("X-DJ-Experiment-Cohort", cohortHeader);
      }
      const response = await worker.fetch(
        request(validRequest, headers),
        { ...overrides, COACH_PROVIDER: "mock" }
      );

      expect(response.status).toBe(200);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, "false", "", "TRUE", "yes"])(
    "fails closed when experiment enabled is %s",
    async (enabled) => {
      const providerLimit = allowedProviderLimiter();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const env = experimentEnv("openai", {
        COACH_PROVIDER_RATE_LIMITER: {
          limit: providerLimit,
        } as unknown as RateLimit,
      });
      if (enabled === undefined) {
        delete env.COACH_EXPERIMENT_ENABLED;
      } else {
        env.COACH_EXPERIMENT_ENABLED = enabled;
      }
      const response = await worker.fetch(
        request(),
        env
      );

      expect(response.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(providerLimit).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["missing ID", "COACH_EXPERIMENT_ID", undefined],
    ["empty ID", "COACH_EXPERIMENT_ID", ""],
    ["missing version", "COACH_EXPERIMENT_VERSION", undefined],
    ["empty version", "COACH_EXPERIMENT_VERSION", ""],
    ["missing secret", "COACH_EXPERIMENT_ASSIGNMENT_SECRET", undefined],
    ["short secret", "COACH_EXPERIMENT_ASSIGNMENT_SECRET", "short"],
    ["negative allocation", "COACH_EXPERIMENT_OPENAI_BPS", "-1"],
    ["oversized allocation", "COACH_EXPERIMENT_OPENAI_BPS", "10001"],
    ["fractional allocation", "COACH_EXPERIMENT_OPENAI_BPS", "5000.5"],
    ["unsupported OpenAI config", "OPENAI_MODEL", ""],
    ["unsupported Anthropic config", "ANTHROPIC_MODEL", ""],
  ] as const)(
    "fails closed for %s without config leakage",
    async (_name, key, value) => {
      const telemetry = captureTelemetry();
      const providerLimit = allowedProviderLimiter();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const env = experimentEnv("openai", {
        COACH_EXPERIMENT_ASSIGNMENT_SECRET: rawSecretSentinel,
        COACH_PROVIDER_RATE_LIMITER: {
          limit: providerLimit,
        } as unknown as RateLimit,
      });
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
      const response = await worker.fetch(
        request(),
        env
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(providerLimit).not.toHaveBeenCalled();
      expect(body).not.toContain(rawSecretSentinel);
      expect(telemetry.serialized()).not.toContain(rawSecretSentinel);
      expect(telemetry.last()).toMatchObject({
        providerMode: "experiment",
        providerInvocationAttempted: false,
        result: "success",
      });
      expect(telemetry.last()).not.toHaveProperty("assignedProvider");
      expect(telemetry.last()).not.toHaveProperty("actualExternalProvider");
    }
  );

  it.each(["openai", "anthropic"] as const)(
    "runs the assigned %s path exactly once with provider-neutral output",
    async (provider) => {
      const telemetry = captureTelemetry();
      const providerLimit = allowedProviderLimiter();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(providerResponse(provider));
      const response = await worker.fetch(
        request(validRequest, {
          "x-dj-experiment-cohort": syntheticCohort,
          "X-DJ-Provider": provider === "openai" ? "anthropic" : "openai",
        }),
        experimentEnv(provider, {
          COACH_PROVIDER_RATE_LIMITER: {
            limit: providerLimit,
          } as unknown as RateLimit,
        })
      );
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(providerUrl(provider));
      expect(providerLimit).toHaveBeenCalledWith({
        key: `coach-provider:${provider}:anonymous`,
      });
      expect(Object.keys(body)).toEqual([
        "contractVersion",
        "requestId",
        "response",
      ]);
      expect(JSON.stringify(body)).not.toContain(provider);
      expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain(
        syntheticCohort
      );
      expect(telemetry.last()).toMatchObject({
        providerMode: "experiment",
        assignedProvider: provider,
        actualExternalProvider: provider,
        providerInvocationAttempted: true,
        result: "success",
      });
    }
  );

  it.each(["openai", "anthropic"] as const)(
    "retains %s assignment when the provider guard is unavailable",
    async (provider) => {
      const telemetry = captureTelemetry();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(request(), experimentEnv(provider));

      expect(response.status).toBe(503);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(telemetry.last()).toMatchObject({
        assignedProvider: provider,
        providerInvocationAttempted: false,
        result: "provider_guardrail_blocked",
      });
      expect(telemetry.last()).not.toHaveProperty("actualExternalProvider");
    }
  );

  it.each(["openai", "anthropic"] as const)(
    "retains %s assignment when the provider limiter rejects",
    async (provider) => {
      const telemetry = captureTelemetry();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(
        request(),
        experimentEnv(provider, {
          COACH_PROVIDER_RATE_LIMITER: {
            async limit() {
              return { success: false };
            },
          } as RateLimit,
        })
      );

      expect(response.status).toBe(429);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(telemetry.last()).toMatchObject({
        assignedProvider: provider,
        providerInvocationAttempted: false,
        result: "rate_limited",
      });
      expect(telemetry.last()).not.toHaveProperty("actualExternalProvider");
    }
  );

  it.each(["openai", "anthropic"] as const)(
    "fails closed when the %s guard returns a malformed outcome",
    async (provider) => {
      const telemetry = captureTelemetry();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(
        request(),
        experimentEnv(provider, {
          COACH_PROVIDER_RATE_LIMITER: {
            async limit() {
              return {};
            },
          } as unknown as RateLimit,
        })
      );

      expect(response.status).toBe(503);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(telemetry.last()).toMatchObject({
        assignedProvider: provider,
        providerInvocationAttempted: false,
        result: "provider_guardrail_blocked",
      });
    }
  );

  it.each(["openai", "anthropic"] as const)(
    "never crosses over from %s for provider and validation failures",
    async (provider) => {
      const cases: Array<{
        name: string;
        response?: Response;
        error?: Error;
        fallbackCategory: string;
        expectedDiagnostics?: Record<string, unknown>;
      }> = [
        {
          name: "network",
          error: new Error("RAW_NETWORK_FAILURE"),
          fallbackCategory: "provider_fallback",
          expectedDiagnostics: {
            providerErrorCategory: "http_error",
          },
        },
        {
          name: "HTTP",
          response: new Response("RAW_HTTP_FAILURE", { status: 503 }),
          fallbackCategory: "provider_fallback",
          expectedDiagnostics: {
            providerErrorCategory: "http_error",
            providerHttpStatus: 503,
          },
        },
        {
          name: "malformed provider envelope",
          response: Response.json({ unexpected: "RAW_PROVIDER_OUTPUT" }),
          fallbackCategory: "provider_fallback",
          expectedDiagnostics: {
            providerErrorCategory: "invalid_response",
            providerHttpStatus: 200,
          },
        },
        {
          name: "invalid structured output",
          response: providerResponse(provider, {
            ...validProviderPayload,
            responseType: "unsupported_type",
          }),
          fallbackCategory: "provider_fallback",
          expectedDiagnostics: {
            providerErrorCategory: "invalid_structured_output",
            providerHttpStatus: 200,
            responseValidationFailureCode: "invalid_response_type",
          },
        },
        {
          name: "semantic safety",
          response: providerResponse(provider, {
            ...validProviderPayload,
            message: "I changed your progress and completed the lesson.",
          }),
          fallbackCategory: "semantic_safety_fallback",
          expectedDiagnostics: {
            providerErrorCategory: "invalid_structured_output",
            providerHttpStatus: 200,
            semanticSafetyFailureCode: "app_state_mutation_claim",
          },
        },
      ];

      for (const failure of cases) {
        const telemetry = captureTelemetry();
        const providerLimit = allowedProviderLimiter();
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        if (failure.error) {
          fetchSpy.mockRejectedValue(failure.error);
        } else {
          fetchSpy.mockResolvedValue(failure.response!);
        }

        const response = await worker.fetch(
          request(),
          experimentEnv(provider, {
            COACH_PROVIDER_RATE_LIMITER: {
              limit: providerLimit,
            } as unknown as RateLimit,
          })
        );
        const body = await response.text();

        expect(response.status, failure.name).toBe(200);
        expect(fetchSpy, failure.name).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0]?.[0], failure.name).toBe(
          providerUrl(provider)
        );
        expect(body, failure.name).not.toContain(provider);
        expect(body, failure.name).not.toContain("RAW_");
        expect(telemetry.last(), failure.name).toMatchObject({
          assignedProvider: provider,
          actualExternalProvider: provider,
          providerInvocationAttempted: true,
          result: failure.fallbackCategory,
          fallbackCategory: failure.fallbackCategory,
          ...failure.expectedDiagnostics,
        });
        expect(telemetry.serialized(), failure.name).not.toContain("RAW_");

        fetchSpy.mockRestore();
        telemetry.log.mockRestore();
      }
    }
  );

  it.each(["openai", "anthropic"] as const)(
    "does not cross over when assigned %s times out",
    async (provider) => {
      vi.useFakeTimers();
      const telemetry = captureTelemetry();
      const providerLimit = allowedProviderLimiter();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new Error("RAW_TIMEOUT_FAILURE"));
            });
          })
      );
      const responsePromise = worker.fetch(
        request(),
        experimentEnv(provider, {
          COACH_PROVIDER_RATE_LIMITER: {
            limit: providerLimit,
          } as unknown as RateLimit,
        })
      );

      for (
        let attempt = 0;
        attempt < 20 && fetchSpy.mock.calls.length === 0;
        attempt += 1
      ) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(12_000);
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(providerUrl(provider));
      expect(telemetry.last()).toMatchObject({
        assignedProvider: provider,
        actualExternalProvider: provider,
        providerInvocationAttempted: true,
        result: "provider_fallback",
        fallbackCategory: "provider_fallback",
        providerErrorCategory: "timeout",
      });
      expect(telemetry.serialized()).not.toContain("RAW_TIMEOUT_FAILURE");
    }
  );

  it("keeps validation and scope failures before experiment assignment", async () => {
    const structuralTelemetry = captureTelemetry();
    const structural = await worker.fetch(
      request({ ...validRequest, unsupported: "RAW_BODY_SENTINEL" }),
      experimentEnv("openai")
    );
    const structuralEvent = structuralTelemetry.last();
    structuralTelemetry.log.mockRestore();

    const scopeTelemetry = captureTelemetry();
    const scope = await worker.fetch(
      request({
        ...validRequest,
        question: {
          source: "free_text",
          question: "RAW_FREE_TEXT_SENTINEL",
        },
      }),
      experimentEnv("openai")
    );
    const scopeEvent = scopeTelemetry.last();

    expect(structural.status).toBe(400);
    expect(structuralEvent).toMatchObject({
      providerMode: "mock",
      providerInvocationAttempted: false,
      result: "validation_error",
    });
    expect(scope.status).toBe(400);
    expect(scopeEvent).toMatchObject({
      providerMode: "mock",
      providerInvocationAttempted: false,
      result: "scope_reject",
    });
    expect(JSON.stringify([structuralEvent, scopeEvent])).not.toContain("RAW_");
  });

  it("keeps CORS and HTTP boundaries narrow", async () => {
    const preflight = await worker.fetch(
      new Request("https://api.example.test/v1/coach/respond", {
        method: "OPTIONS",
      }),
      {}
    );
    const allowedHeaders = preflight.headers
      .get("Access-Control-Allow-Headers")
      ?.split(", ")
      .sort();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const malformed = await worker.fetch(
      request(validRequest, {
        "x-dj-experiment-cohort": "a".repeat(200),
      }),
      experimentEnv("openai", {
        COACH_PROVIDER_RATE_LIMITER: {
          limit: allowedProviderLimiter(),
        } as unknown as RateLimit,
      })
    );

    expect(allowedHeaders).toEqual(
      [
        "Accept",
        "Content-Type",
        "X-DJ-Experiment-Cohort",
        "X-DJ-Request-Id",
      ].sort()
    );
    expect(allowedHeaders).not.toContain("X-DJ-Provider");
    expect(malformed.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves the existing request body limit before experiment routing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const oversized = new Request(
      "https://api.example.test/v1/coach/respond",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": String(16 * 1024 + 1),
          "X-DJ-Request-Id": validRequest.requestId,
          "X-DJ-Experiment-Cohort": syntheticCohort,
        },
        body: "{}",
      }
    );
    const response = await worker.fetch(
      oversized,
      experimentEnv("openai", {
        COACH_PROVIDER_RATE_LIMITER: {
          limit: allowedProviderLimiter(),
        } as unknown as RateLimit,
      })
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "request_too_large" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never logs or exposes experiment identity or provider internals", async () => {
    const telemetry = captureTelemetry();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        providerResponse("openai", {
          ...validProviderPayload,
          message: "RAW_PROVIDER_OUTPUT_MUST_NOT_LEAK",
          responseType: "unsupported_type",
        })
      );
    const response = await worker.fetch(
      request(),
      experimentEnv("openai", {
        COACH_EXPERIMENT_ASSIGNMENT_SECRET: rawSecretSentinel,
        OPENAI_API_KEY: "RAW_API_KEY_MUST_NOT_LEAK",
        COACH_PROVIDER_RATE_LIMITER: {
          limit: allowedProviderLimiter(),
        } as unknown as RateLimit,
      })
    );
    const publicBody = await response.text();
    const providerRequest = JSON.stringify(fetchSpy.mock.calls);
    const logs = telemetry.serialized();

    expect(response.status).toBe(200);
    expect(publicBody).not.toContain("RAW_");
    expect(providerRequest).not.toContain(syntheticCohort);
    expect(providerRequest).not.toContain(rawSecretSentinel);
    expect(logs).not.toContain(syntheticCohort);
    expect(logs).not.toContain(rawSecretSentinel);
    expect(logs).not.toContain("RAW_API_KEY_MUST_NOT_LEAK");
    expect(logs).not.toContain("RAW_PROVIDER_OUTPUT_MUST_NOT_LEAK");
    expect(telemetry.last()).not.toHaveProperty("cohortId");
    expect(telemetry.last()).not.toHaveProperty("cohortHash");
    expect(telemetry.last()).not.toHaveProperty("participantId");
  });
});
