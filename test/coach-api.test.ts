import { describe, expect, it } from "vitest";
import worker, { createWorker, Env } from "../src/index";
import type {
  CoachApiRequestV1,
  CoachApiSuccessResponseV1,
} from "../src/contracts/CoachApiContract";
import type { CoachService } from "../src/coach/coachService";
import { providerUsageCapBinding } from "./providerUsageCapFixtures";

// Keep this external transport shape aligned with the identically named
// mobile fixture in RemoteCoachService.test.ts.
const mobileShapedSession7AttemptFixture = {
  landingResult: "early" as const,
  landingOffsetMs: -180,
  landingTimingScore: 25,
  nextFocusId: "timing" as const,
};

const validRequest = {
  contractVersion: 1,
  requestId: "coach_test_1",
  question: {
    source: "suggested",
    suggestedQuestionId: "what_should_i_focus_on",
  },
  context: {
    learnerProfile: {
      mentorId: "nova",
      skillLevel: "complete_beginner",
      controllerStatus: "planning",
      preferredGenre: "house",
      goal: "first_transition",
    },
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

function makeRequest(body: unknown, headers?: HeadersInit): Request {
  return new Request("https://api.example.test/v1/coach/respond", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-DJ-Request-Id": "coach_test_1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function createTrackingCoachService(): CoachService & {
  respond: ReturnType<typeof vi.fn>;
} {
  return {
    respond: vi.fn(async (request: CoachApiRequestV1) => ({
      contractVersion: 1,
      requestId: request.requestId,
      response:
        request.context.lesson?.sessionNumber === 7 &&
        request.context.session7?.latestAttempt !== undefined
          ? {
              message:
                "You started Track B a little early. Keep counting steadily and wait for the next strong 1.",
              nextActionLabel: "Try the timing again.",
              responseType: "attempt_feedback",
              fallbackReasonId: null,
            }
          : {
              message: "Safe scoped coach response.",
              nextActionLabel: "Try the lesson step.",
              responseType: "lesson_explanation",
              fallbackReasonId: null,
            },
    })),
  };
}

function completeOpenAiEnv(
  overrides: Partial<Env> = {}
): Env {
  return {
    COACH_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key-not-real",
    OPENAI_MODEL: "reference-model",
    COACH_PROVIDER_DAILY_CALL_LIMIT: "100",
    COACH_PROVIDER_USAGE_CAP: providerUsageCapBinding(),
    ...overrides,
  };
}

function completeAnthropicEnv(
  overrides: Partial<Env> = {}
): Env {
  return {
    COACH_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "test-anthropic-key-not-real",
    ANTHROPIC_MODEL: "claude-reference-model",
    COACH_PROVIDER_DAILY_CALL_LIMIT: "100",
    COACH_PROVIDER_USAGE_CAP: providerUsageCapBinding(),
    ...overrides,
  };
}

function completeExperimentEnv(
  overrides: Partial<Env> = {}
): Env {
  return {
    COACH_PROVIDER: "experiment",
    COACH_EXPERIMENT_ENABLED: "true",
    COACH_EXPERIMENT_ID: "provider_quality",
    COACH_EXPERIMENT_VERSION: "v1",
    COACH_EXPERIMENT_ASSIGNMENT_SECRET:
      "test-only-assignment-secret-not-production",
    COACH_EXPERIMENT_OPENAI_BPS: "10000",
    OPENAI_API_KEY: "test-openai-key-not-real",
    OPENAI_MODEL: "openai-reference-model",
    ANTHROPIC_API_KEY: "test-anthropic-key-not-real",
    ANTHROPIC_MODEL: "anthropic-reference-model",
    COACH_PROVIDER_DAILY_CALL_LIMIT: "100",
    COACH_PROVIDER_USAGE_CAP: providerUsageCapBinding(),
    ...overrides,
  };
}

function openAiProviderResponse(output: unknown, extra: object = {}): Response {
  return Response.json({
    status: "completed",
    output: [
      {
        content: [
          {
            type: "output_text",
            text: JSON.stringify(output),
          },
        ],
      },
    ],
    ...extra,
  });
}

function anthropicProviderResponse(output: unknown): Response {
  return Response.json({
    type: "message",
    content: [{ type: "text", text: JSON.stringify(output) }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 100,
      output_tokens: 30,
    },
  });
}

describe("DJ Lingo Coach API", () => {
  it("allows only the required public request headers in CORS preflight", async () => {
    const response = await worker.fetch(
      new Request("https://api.example.test/v1/coach/respond", {
        method: "OPTIONS",
      }),
      {}
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Accept, Content-Type, X-DJ-Request-Id, X-DJ-Experiment-Cohort"
    );
    expect(
      response.headers.get("Access-Control-Allow-Headers")
    ).not.toContain("Install-Id");
  });

  it("returns health status", async () => {
    const response = await worker.fetch(
      new Request("https://api.example.test/health"),
      {}
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      service: "dj-coach-api",
      contractVersion: 1,
    });
  });

  it("returns a structured mock coach response", async () => {
    const response = await worker.fetch(makeRequest(validRequest), {});

    expect(response.status).toBe(200);

    const body = (await response.json()) as CoachApiSuccessResponseV1;
    expect(body).toMatchObject({
      contractVersion: 1,
      requestId: "coach_test_1",
      response: {
        responseType: "lesson_explanation",
        fallbackReasonId: null,
      },
    });
    expect(typeof body.response.message).toBe("string");
    expect(typeof body.response.nextActionLabel).toBe("string");
  });

  it("does not call OpenAI unless provider configuration is explicitly complete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(makeRequest(validRequest), {
      COACH_PROVIDER: "openai",
      OPENAI_MODEL: "reference-model",
    });

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not call Anthropic unless provider configuration is explicitly complete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(makeRequest(validRequest), {
      COACH_PROVIDER: "anthropic",
      ANTHROPIC_MODEL: "claude-reference-model",
    });

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fails closed before OpenAI invocation when the provider guardrail is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(
      makeRequest(validRequest),
      completeOpenAiEnv()
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "provider_guardrail_blocked",
        message: "Coach service is temporarily unavailable.",
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fails closed before Anthropic invocation when the provider guardrail is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(
      makeRequest(validRequest),
      completeAnthropicEnv()
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "provider_guardrail_blocked",
        message: "Coach service is temporarily unavailable.",
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    {
      name: "throws",
      limiter: {
        async limit() {
          throw new Error("limiter unavailable");
        },
      },
    },
    {
      name: "returns an invalid outcome",
      limiter: {
        async limit() {
          return {};
        },
      },
    },
  ])(
    "fails closed before OpenAI invocation when the provider guardrail $name",
    async ({ limiter }) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(
        makeRequest(validRequest),
        completeOpenAiEnv({
          COACH_PROVIDER_RATE_LIMITER: limiter as unknown as RateLimit,
        })
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: {
          code: "provider_guardrail_blocked",
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    }
  );

  it.each([
    {
      name: "free text",
      body: {
        ...validRequest,
        question: {
          source: "free_text",
          question: "CLAUDE_SCOPE_REJECT_MUST_NOT_REACH_PROVIDER",
        },
      },
    },
    {
      name: "an unsupported session",
      body: {
        ...validRequest,
        context: {
          ...validRequest.context,
          lesson: {
            ...validRequest.context.lesson,
            sessionNumber: 3,
          },
        },
      },
    },
    {
      name: "an unsupported suggested question",
      body: {
        ...validRequest,
        question: {
          source: "suggested",
          suggestedQuestionId: "explain_timing_result",
        },
      },
    },
  ])(
    "rejects $name before Anthropic guardrails or provider invocation",
    async ({ body }) => {
      const requestLimit = vi.fn(async () => ({ success: true }));
      const providerLimit = vi.fn(async () => ({ success: true }));
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(
        makeRequest(body),
        completeAnthropicEnv({
          COACH_RATE_LIMITER: { limit: requestLimit } as unknown as RateLimit,
          COACH_PROVIDER_RATE_LIMITER: {
            limit: providerLimit,
          } as unknown as RateLimit,
        })
      );

      expect(response.status).toBe(400);
      expect(requestLimit).not.toHaveBeenCalled();
      expect(providerLimit).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    }
  );

  it("keeps mock mode usable without provider-call guardrails", async () => {
    const response = await worker.fetch(makeRequest(validRequest), {
      COACH_PROVIDER: "mock",
    });

    expect(response.status).toBe(200);
  });

  it("uses the validated body request ID for successful responses", async () => {
    const response = await worker.fetch(
      makeRequest(validRequest, {
        "X-DJ-Request-Id": "different_valid_header_id",
      }),
      {}
    );
    const body = (await response.json()) as CoachApiSuccessResponseV1;

    expect(response.status).toBe(200);
    expect(body.requestId).toBe(validRequest.requestId);
  });

  it("rejects malformed JSON", async () => {
    const response = await worker.fetch(makeRequest("{"), {});

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "invalid_json",
        requestId: "coach_test_1",
      },
    });
  });

  it("does not reflect an invalid canonical request ID header", async () => {
    const response = await worker.fetch(
      makeRequest("{", {
        "X-DJ-Request-Id": "invalid request id",
      }),
      {}
    );
    const body = (await response.json()) as {
      error: { requestId?: string };
    };

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: "invalid_json",
        message: "Request body must be valid JSON.",
      },
    });
  });

  it("does not treat the former request ID header as canonical", async () => {
    const response = await worker.fetch(
      makeRequest("{", {
        "X-DJ-Request-Id": "",
        "X-DJ-Lingo-Request-Id": "legacy_request_id",
      }),
      {}
    );
    const body = (await response.json()) as {
      error: { requestId?: string };
    };

    expect(response.status).toBe(400);
    expect(body.error.requestId).toBeUndefined();
  });

  it("rejects unsupported fields", async () => {
    const response = await worker.fetch(
      makeRequest({ ...validRequest, unexpected: true }),
      {}
    );

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "invalid_request",
      },
    });
  });

  it("rejects invalid free text", async () => {
    const response = await worker.fetch(
      makeRequest({
        ...validRequest,
        question: {
          source: "free_text",
          question: " ",
        },
      }),
      {}
    );

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "invalid_request",
      },
    });
  });

  it("rejects valid free text before calling the coach service", async () => {
    const coachService = createTrackingCoachService();
    const scopedWorker = createWorker(coachService);
    const response = await scopedWorker.fetch(
      makeRequest({
        ...validRequest,
        question: {
          source: "free_text",
          question: "How should I practice this?",
        },
      }),
      {}
    );

    expect(response.status).toBe(400);
    expect(coachService.respond).not.toHaveBeenCalled();
  });

  it.each([1, 3, 4, 5, 6] as const)(
    "rejects Session %s before calling the coach service",
    async (sessionNumber) => {
      const coachService = createTrackingCoachService();
      const scopedWorker = createWorker(coachService);
      const response = await scopedWorker.fetch(
        makeRequest({
          ...validRequest,
          context: {
            ...validRequest.context,
            lesson: {
              ...validRequest.context.lesson,
              sessionNumber,
            },
          },
        }),
        {}
      );

      expect(response.status).toBe(400);
      expect(coachService.respond).not.toHaveBeenCalled();
    }
  );

  it("rejects a suggested question that is not allowed for its session", async () => {
    const coachService = createTrackingCoachService();
    const scopedWorker = createWorker(coachService);
    const response = await scopedWorker.fetch(
      makeRequest({
        ...validRequest,
        question: {
          source: "suggested",
          suggestedQuestionId: "explain_timing_result",
        },
      }),
      {}
    );

    expect(response.status).toBe(400);
    expect(coachService.respond).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "free text",
      body: {
        ...validRequest,
        question: {
          source: "free_text",
          question: "RAW_USER_FREE_TEXT_MUST_NOT_REACH_GUARDS",
        },
      },
    },
    {
      name: "an unsupported session",
      body: {
        ...validRequest,
        context: {
          ...validRequest.context,
          lesson: {
            ...validRequest.context.lesson,
            sessionNumber: 3,
          },
        },
      },
    },
    {
      name: "an unsupported suggested question",
      body: {
        ...validRequest,
        question: {
          source: "suggested",
          suggestedQuestionId: "explain_timing_result",
        },
      },
    },
  ])(
    "rejects $name before request/provider guardrails or provider invocation",
    async ({ body }) => {
      const requestLimit = vi.fn(async () => ({ success: true }));
      const providerLimit = vi.fn(async () => ({ success: true }));
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(
        makeRequest(body),
        completeOpenAiEnv({
          COACH_RATE_LIMITER: { limit: requestLimit } as unknown as RateLimit,
          COACH_PROVIDER_RATE_LIMITER: {
            limit: providerLimit,
          } as unknown as RateLimit,
        })
      );

      expect(response.status).toBe(400);
      expect(requestLimit).not.toHaveBeenCalled();
      expect(providerLimit).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    }
  );

  it("accepts allowed Session 2 and Session 7 suggested questions", async () => {
    const coachService = createTrackingCoachService();
    const scopedWorker = createWorker(coachService);
    const session2Response = await scopedWorker.fetch(
      makeRequest(validRequest),
      {}
    );
    const session7Response = await scopedWorker.fetch(
      makeRequest({
        ...validRequest,
        requestId: "coach_session_7_scope",
        question: {
          source: "suggested",
          suggestedQuestionId: "explain_timing_result",
        },
        context: {
          ...validRequest.context,
          lesson: {
            sessionNumber: 7,
            lessonId: "mini-attempt-review",
            lessonPhase: "result",
            activityType: "miniAttempt",
          },
          session7: {
            latestAttempt: mobileShapedSession7AttemptFixture,
            currentNextFocusId: "timing",
          },
        },
      }),
      {}
    );

    expect(session2Response.status).toBe(200);
    expect(session7Response.status).toBe(200);
    expect(coachService.respond).toHaveBeenCalledTimes(2);
  });

  it("returns 429 when the rate limiter rejects the key", async () => {
    const coachService = createTrackingCoachService();
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const env: Env = {
      COACH_RATE_LIMITER: {
        async limit() {
          return { success: false };
        },
      } as RateLimit,
    };

    const response = await createWorker(coachService).fetch(
      makeRequest(validRequest),
      env
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");

    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "rate_limited",
      },
    });
    expect(coachService.respond).not.toHaveBeenCalled();
    expect(
      JSON.parse(String(consoleLog.mock.calls.at(-1)?.[0]))
    ).toMatchObject({
      result: "rate_limited",
      publicErrorType: "rate_limited",
      providerInvocationAttempted: false,
    });
    consoleLog.mockRestore();
  });

  it("requires the request limiter in production, including mock mode", async () => {
    const coachService = createTrackingCoachService();
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const response = await createWorker(coachService).fetch(
      makeRequest(validRequest),
      {
        ENVIRONMENT: "production",
        COACH_PROVIDER: "mock",
      }
    );
    const event = JSON.parse(
      String(consoleLog.mock.calls.at(-1)?.[0])
    ) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "server_failure",
        message: "Coach service is temporarily unavailable.",
      },
    });
    expect(coachService.respond).not.toHaveBeenCalled();
    expect(event).toMatchObject({
      result: "request_limiter_unavailable",
      publicErrorType: "server_failure",
      providerInvocationAttempted: false,
    });
    expect(event).not.toHaveProperty("providerUsageCapOutcome");
    expect(event).not.toHaveProperty("actualExternalProvider");
    expect(event).not.toHaveProperty("providerLatencyMs");
    expect(event).not.toHaveProperty("providerInputTokens");
    consoleLog.mockRestore();
  });

  it("stops all provider stages after a valid request-limiter denial", async () => {
    const requestLimit = vi.fn(async () => ({ success: false }));
    const providerLimit = vi.fn(async () => ({ success: true }));
    const capConsume = vi.fn(async (_periodKey: string, cap: number) => ({
      allowed: true,
      limit: cap,
      remaining: cap - 1,
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const response = await worker.fetch(
      makeRequest(validRequest),
      completeOpenAiEnv({
        ENVIRONMENT: "production",
        COACH_RATE_LIMITER: {
          limit: requestLimit,
        } as unknown as RateLimit,
        COACH_PROVIDER_RATE_LIMITER: {
          limit: providerLimit,
        } as unknown as RateLimit,
        COACH_PROVIDER_USAGE_CAP:
          providerUsageCapBinding(capConsume),
      })
    );
    const event = JSON.parse(
      String(consoleLog.mock.calls.at(-1)?.[0])
    ) as Record<string, unknown>;

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(requestLimit).toHaveBeenCalledTimes(1);
    expect(providerLimit).not.toHaveBeenCalled();
    expect(capConsume).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(event).toMatchObject({
      result: "rate_limited",
      publicErrorType: "rate_limited",
      providerInvocationAttempted: false,
    });
    expect(event).not.toHaveProperty("providerUsageCapOutcome");
    expect(event).not.toHaveProperty("actualExternalProvider");

    fetchSpy.mockRestore();
    consoleLog.mockRestore();
  });

  it.each([
    {
      name: "throws",
      limit: vi.fn(async () => {
        throw new Error(
          "RAW_LIMITER_ERROR_203.0.113.55_coach:ip:203.0.113.55"
        );
      }),
    },
    {
      name: "returns a non-object",
      limit: vi.fn(async () => null),
    },
    {
      name: "omits boolean success",
      limit: vi.fn(async () => ({ success: "true" })),
    },
  ])(
    "fails closed before all provider stages when the request limiter $name",
    async ({ limit }) => {
      const rawIpAddress = "203.0.113.55";
      const rawLimiterKey = `coach:ip:${rawIpAddress}`;
      const providerLimit = vi.fn(async () => ({ success: true }));
      const capConsume = vi.fn(async (_periodKey: string, cap: number) => ({
        allowed: true,
        limit: cap,
        remaining: cap - 1,
      }));
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const consoleLog = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      const response = await worker.fetch(
        makeRequest(validRequest, {
          "CF-Connecting-IP": rawIpAddress,
        }),
        completeOpenAiEnv({
          ENVIRONMENT: "production",
          COACH_RATE_LIMITER: {
            limit,
          } as unknown as RateLimit,
          COACH_PROVIDER_RATE_LIMITER: {
            limit: providerLimit,
          } as unknown as RateLimit,
          COACH_PROVIDER_USAGE_CAP:
            providerUsageCapBinding(capConsume),
        })
      );
      const serializedLogs = consoleLog.mock.calls
        .map(([entry]) => String(entry))
        .join("\n");
      const event = JSON.parse(
        String(consoleLog.mock.calls.at(-1)?.[0])
      ) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: {
          code: "server_failure",
          message: "Coach service is temporarily unavailable.",
        },
      });
      expect(limit).toHaveBeenCalledTimes(1);
      expect(providerLimit).not.toHaveBeenCalled();
      expect(capConsume).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(event).toMatchObject({
        result: "request_limiter_unavailable",
        publicErrorType: "server_failure",
        providerInvocationAttempted: false,
      });
      expect(event).not.toHaveProperty("providerUsageCapOutcome");
      expect(event).not.toHaveProperty("actualExternalProvider");
      expect(event).not.toHaveProperty("experimentId");
      expect(serializedLogs).not.toContain("RAW_LIMITER_ERROR");
      expect(serializedLogs).not.toContain(rawIpAddress);
      expect(serializedLogs).not.toContain(rawLimiterKey);

      fetchSpy.mockRestore();
      consoleLog.mockRestore();
    }
  );

  it("fails closed for a present malformed limiter outside production", async () => {
    const coachService = createTrackingCoachService();
    const response = await createWorker(coachService).fetch(
      makeRequest(validRequest),
      {
        ENVIRONMENT: "development",
        COACH_RATE_LIMITER: {
          async limit() {
            return {};
          },
        } as unknown as RateLimit,
      }
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "server_failure" },
    });
    expect(coachService.respond).not.toHaveBeenCalled();
  });

  it("stops before dormant experiment assignment when the request limiter is unavailable", async () => {
    const providerLimit = vi.fn(async () => ({ success: true }));
    const capConsume = vi.fn(async (_periodKey: string, cap: number) => ({
      allowed: true,
      limit: cap,
      remaining: cap - 1,
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const response = await worker.fetch(
      makeRequest(validRequest, {
        "X-DJ-Experiment-Cohort":
          "123e4567-e89b-42d3-a456-426614174000",
      }),
      completeExperimentEnv({
        ENVIRONMENT: "production",
        COACH_RATE_LIMITER: {
          async limit() {
            throw new Error("request limiter unavailable");
          },
        } as RateLimit,
        COACH_PROVIDER_RATE_LIMITER: {
          limit: providerLimit,
        } as unknown as RateLimit,
        COACH_PROVIDER_USAGE_CAP:
          providerUsageCapBinding(capConsume),
      })
    );
    const event = JSON.parse(
      String(consoleLog.mock.calls.at(-1)?.[0])
    ) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(providerLimit).not.toHaveBeenCalled();
    expect(capConsume).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(event).toMatchObject({
      providerMode: "mock",
      result: "request_limiter_unavailable",
      providerInvocationAttempted: false,
    });
    expect(event).not.toHaveProperty("experimentId");
    expect(event).not.toHaveProperty("assignedProvider");

    fetchSpy.mockRestore();
    consoleLog.mockRestore();
  });

  it("allows a missing request limiter outside production", async () => {
    const coachService = createTrackingCoachService();
    const response = await createWorker(coachService).fetch(
      makeRequest(validRequest),
      {
        ENVIRONMENT: "development",
        COACH_PROVIDER: "mock",
      }
    );

    expect(response.status).toBe(200);
    expect(coachService.respond).toHaveBeenCalledTimes(1);
  });

  it("continues normally after a valid successful request-limiter result", async () => {
    const coachService = createTrackingCoachService();
    const limit = vi.fn(async () => ({ success: true }));
    const response = await createWorker(coachService).fetch(
      makeRequest(validRequest),
      {
        ENVIRONMENT: "production",
        COACH_PROVIDER: "mock",
        COACH_RATE_LIMITER: {
          limit,
        } as unknown as RateLimit,
      }
    );

    expect(response.status).toBe(200);
    expect(limit).toHaveBeenCalledTimes(1);
    expect(coachService.respond).toHaveBeenCalledTimes(1);
  });

  it("returns 429 without calling OpenAI when the provider limiter rejects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(
      makeRequest(validRequest),
      completeOpenAiEnv({
        COACH_PROVIDER_RATE_LIMITER: {
          async limit() {
            return { success: false };
          },
        } as RateLimit,
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({
      error: {
        code: "rate_limited",
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns 429 without calling Anthropic when the provider limiter rejects", async () => {
    const providerLimit = vi.fn(async () => ({ success: false }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(
      makeRequest(validRequest),
      completeAnthropicEnv({
        COACH_PROVIDER_RATE_LIMITER: {
          limit: providerLimit,
        } as unknown as RateLimit,
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({
      error: {
        code: "rate_limited",
      },
    });
    expect(providerLimit).toHaveBeenCalledWith({
      key: "coach-provider:anthropic:anonymous",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("ignores install-ID headers when choosing the rate-limit key", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const response = await worker.fetch(
      makeRequest(validRequest, {
        "CF-Connecting-IP": "203.0.113.10",
        "X-DJ-Lingo-Install-Id": "legacy_install_id",
      }),
      {
        COACH_RATE_LIMITER: { limit } as unknown as RateLimit,
      }
    );

    expect(response.status).toBe(200);
    expect(limit).toHaveBeenCalledWith({
      key: "coach:ip:203.0.113.10",
    });
  });

  it("does not use an install-ID header as anonymous request identity", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const response = await worker.fetch(
      makeRequest(validRequest, {
        "X-DJ-Lingo-Install-Id": "legacy_install_id",
      }),
      {
        COACH_RATE_LIMITER: { limit } as unknown as RateLimit,
      }
    );

    expect(response.status).toBe(200);
    expect(limit).toHaveBeenCalledWith({ key: "coach:anonymous" });
  });

  it("ignores install-ID headers for the provider-call limiter key", async () => {
    const providerLimit = vi.fn(async () => ({ success: true }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      openAiProviderResponse({
        message: "Keep the pulse steady and leave equal space between taps.",
        nextActionLabel: "Try one steady tap round.",
        responseType: "lesson_explanation",
        fallbackReasonId: null,
      })
    );
    const response = await worker.fetch(
      makeRequest(validRequest, {
        "X-DJ-Lingo-Install-Id": "legacy_install_id",
      }),
      completeOpenAiEnv({
        COACH_PROVIDER_RATE_LIMITER: {
          limit: providerLimit,
        } as unknown as RateLimit,
      })
    );

    expect(response.status).toBe(200);
    expect(providerLimit).toHaveBeenCalledWith({
      key: "coach-provider:openai:anonymous",
    });
    fetchSpy.mockRestore();
  });

  it("emits only sanitized operational telemetry fields", async () => {
    const rawProviderOutput = "RAW_PROVIDER_OUTPUT_MUST_NOT_BE_LOGGED";
    const rawPrompt = "RAW_PROMPT_MUST_NOT_BE_LOGGED";
    const apiKey = "SECRET_API_KEY_MUST_NOT_BE_LOGGED";
    const rawRequestBody = "RAW_REQUEST_BODY_MUST_NOT_BE_LOGGED";
    const userFreeText = "USER_FREE_TEXT_MUST_NOT_BE_LOGGED";
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      openAiProviderResponse(
        {
          message: rawProviderOutput,
          nextActionLabel: null,
          responseType: "unsupported_type",
          fallbackReasonId: null,
        },
        {
          provider_metadata: {
            rawPrompt,
            apiKey,
          },
        }
      )
    );
    const providerLimiter = {
      async limit() {
        return { success: true };
      },
    } as RateLimit;

    const providerResponse = await worker.fetch(
      makeRequest(validRequest),
      completeOpenAiEnv({
        OPENAI_API_KEY: apiKey,
        COACH_PROVIDER_RATE_LIMITER: providerLimiter,
      })
    );
    const freeTextResponse = await worker.fetch(
      makeRequest({
        ...validRequest,
        requestId: "coach_free_text_log_test",
        question: {
          source: "free_text",
          question: userFreeText,
        },
      }),
      {}
    );
    const invalidBodyResponse = await worker.fetch(
      makeRequest({
        ...validRequest,
        requestId: "coach_raw_body_log_test",
        unsupported: rawRequestBody,
      }),
      {}
    );

    expect(providerResponse.status).toBe(200);
    expect(freeTextResponse.status).toBe(400);
    expect(invalidBodyResponse.status).toBe(400);

    const serializedLogs = consoleLog.mock.calls
      .map(([entry]) => String(entry))
      .join("\n");
    expect(serializedLogs).not.toContain(rawProviderOutput);
    expect(serializedLogs).not.toContain(rawPrompt);
    expect(serializedLogs).not.toContain(apiKey);
    expect(serializedLogs).not.toContain(rawRequestBody);
    expect(serializedLogs).not.toContain(userFreeText);

    const allowedFields = new Set([
      "event",
      "requestId",
      "providerMode",
      "route",
      "sessionNumber",
      "questionSource",
      "suggestedQuestionId",
      "result",
      "publicErrorType",
      "fallbackReasonId",
      "experimentId",
      "experimentVersion",
      "assignedProvider",
      "actualExternalProvider",
      "fallbackCategory",
      "providerErrorCategory",
      "providerHttpStatus",
      "responseValidationFailureCode",
      "semanticSafetyFailureCode",
      "elapsedMs",
      "providerInvocationAttempted",
      "providerUsageCapOutcome",
      "providerUsageCapLimit",
      "providerUsageCapRemaining",
      "providerLatencyMs",
      "providerInputTokens",
      "providerOutputTokens",
      "providerTotalTokens",
    ]);

    for (const [entry] of consoleLog.mock.calls) {
      const event = JSON.parse(String(entry)) as Record<string, unknown>;
      expect(Object.keys(event).every((key) => allowedFields.has(key))).toBe(
        true
      );
    }

    expect(
      consoleLog.mock.calls.some(([entry]) =>
        String(entry).includes('"result":"provider_fallback"')
      )
    ).toBe(true);
    fetchSpy.mockRestore();
    consoleLog.mockRestore();
  });

  it("keeps unexpected non-provider fallback errors generic and sanitized", async () => {
    const rawMessage = "RAW_UNEXPECTED_ERROR_MESSAGE_MUST_NOT_LEAK";
    const rawStack = "RAW_UNEXPECTED_STACK_MUST_NOT_LEAK";
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const unexpectedError = new Error(rawMessage);
    unexpectedError.stack = rawStack;
    const providerResponse = new Response("ignored", { status: 200 });
    vi.spyOn(providerResponse, "text").mockRejectedValue(unexpectedError);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(providerResponse);
    const response = await worker.fetch(
      makeRequest(validRequest),
      completeOpenAiEnv({
        COACH_PROVIDER_RATE_LIMITER: {
          async limit() {
            return { success: true };
          },
        } as RateLimit,
      })
    );
    const body = (await response.json()) as CoachApiSuccessResponseV1;
    const serializedLogs = consoleLog.mock.calls
      .map(([entry]) => String(entry))
      .join("\n");
    const event = JSON.parse(
      String(consoleLog.mock.calls.at(-1)?.[0])
    ) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.response.responseType).toBe("lesson_explanation");
    expect(event).toMatchObject({
      providerMode: "openai",
      providerInvocationAttempted: true,
      actualExternalProvider: "openai",
      result: "provider_fallback",
      fallbackCategory: "provider_fallback",
    });
    expect(event).not.toHaveProperty("providerErrorCategory");
    expect(event).not.toHaveProperty("providerHttpStatus");
    expect(event).not.toHaveProperty("responseValidationFailureCode");
    expect(event).not.toHaveProperty("semanticSafetyFailureCode");
    expect(serializedLogs).not.toContain(rawMessage);
    expect(serializedLogs).not.toContain(rawStack);

    fetchSpy.mockRestore();
    consoleLog.mockRestore();
  });

  it("falls back for semantically unsafe Session 7 attempt feedback without public leakage", async () => {
    const rawProviderOutput =
      "You were a bit early/late by about 331 ms. RAW_SESSION7_PROVIDER_TEXT";
    const session7Request = {
      ...validRequest,
      requestId: "coach_session_7_semantic_fallback",
      question: {
        source: "suggested",
        suggestedQuestionId: "explain_timing_result",
      },
      context: {
        ...validRequest.context,
        lesson: {
          sessionNumber: 7,
          lessonId: "mini-attempt-review",
          lessonPhase: "result",
          activityType: "miniAttempt",
        },
        progress: {
          completedSessionNumbers: [1, 2, 3, 4, 5, 6],
        },
        session7: {
          latestAttempt: mobileShapedSession7AttemptFixture,
          currentNextFocusId: "timing",
        },
      },
    };
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      openAiProviderResponse({
        message: rawProviderOutput,
        nextActionLabel: "Try again.",
        responseType: "attempt_feedback",
        fallbackReasonId: null,
      })
    );
    const response = await worker.fetch(
      makeRequest(session7Request),
      completeOpenAiEnv({
        COACH_PROVIDER_RATE_LIMITER: {
          async limit() {
            return { success: true };
          },
        } as RateLimit,
      })
    );
    const body = (await response.json()) as CoachApiSuccessResponseV1;
    const serializedBody = JSON.stringify(body);
    const serializedLogs = consoleLog.mock.calls
      .map(([entry]) => String(entry))
      .join("\n");
    const event = JSON.parse(
      String(consoleLog.mock.calls.at(-1)?.[0])
    ) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.response.responseType).toBe("attempt_feedback");
    expect(body.response.message).toContain("early");
    expect(serializedBody).not.toContain(rawProviderOutput);
    expect(serializedBody).not.toContain("RAW_SESSION7_PROVIDER_TEXT");
    expect(event).toMatchObject({
      providerMode: "openai",
      providerInvocationAttempted: true,
      actualExternalProvider: "openai",
      result: "semantic_safety_fallback",
      fallbackCategory: "semantic_safety_fallback",
      providerErrorCategory: "invalid_structured_output",
      providerHttpStatus: 200,
      semanticSafetyFailureCode:
        "session7_ambiguous_timing_direction",
    });
    expect(serializedLogs).not.toContain(rawProviderOutput);
    expect(serializedLogs).not.toContain("RAW_SESSION7_PROVIDER_TEXT");

    fetchSpy.mockRestore();
    consoleLog.mockRestore();
  });

  it("returns Session 7 timing feedback when attempt context exists", async () => {
    const response = await worker.fetch(
      makeRequest({
        ...validRequest,
        question: {
          source: "suggested",
          suggestedQuestionId: "explain_timing_result",
        },
        context: {
          ...validRequest.context,
          lesson: {
            sessionNumber: 7,
            lessonId: "mini-attempt-review",
            lessonPhase: "result",
            activityType: "miniAttempt",
          },
          session7: {
            latestAttempt: mobileShapedSession7AttemptFixture,
            bestAttempt: mobileShapedSession7AttemptFixture,
            currentNextFocusId: "timing",
          },
        },
      }),
      {}
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as CoachApiSuccessResponseV1;
    expect(body.response.responseType).toBe("attempt_feedback");
    expect(body.response.message).toContain("early");
  });

  it("does not return invalid internal output as a successful response", async () => {
    const invalidWorker = createWorker({
      async respond(request) {
        return {
          contractVersion: 1,
          requestId: `${request.requestId}_mismatch`,
          response: {
            message: "Internal provider output.",
            nextActionLabel: null,
            responseType: "lesson_explanation",
            fallbackReasonId: null,
          },
        };
      },
    });
    const response = await invalidWorker.fetch(makeRequest(validRequest), {});
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "server_failure",
        message: "Coach service is temporarily unavailable.",
        requestId: "coach_test_1",
      },
    });
  });

  describe("provider experiment routing", () => {
    const cohortId = "123e4567-e89b-42d3-a456-426614174000";
    const validProviderPayload = {
      message: "Keep the pulse steady and leave equal space between taps.",
      nextActionLabel: "Try one steady tap round.",
      responseType: "lesson_explanation",
      fallbackReasonId: null,
    };

    function experimentRequest(
      body: unknown = validRequest,
      headers: HeadersInit = {}
    ) {
      return makeRequest(body, {
        "X-DJ-Experiment-Cohort": cohortId,
        ...headers,
      });
    }

    it("keeps mock mode authoritative even when a cohort header is present", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(experimentRequest(), {
        ...completeExperimentEnv(),
        COACH_PROVIDER: "mock",
      });

      expect(response.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it.each([
      {
        name: "missing experiment config",
        env: completeExperimentEnv({
          COACH_EXPERIMENT_ASSIGNMENT_SECRET: "",
        }),
        headers: {},
      },
      {
        name: "invalid experiment config",
        env: completeExperimentEnv({
          COACH_EXPERIMENT_OPENAI_BPS: "10001",
        }),
        headers: {},
      },
      {
        name: "incomplete assigned-provider configuration",
        env: completeExperimentEnv({
          ANTHROPIC_API_KEY: "",
        }),
        headers: {},
      },
      {
        name: "missing cohort header",
        env: completeExperimentEnv(),
        headers: { "X-DJ-Experiment-Cohort": "" },
      },
      {
        name: "malformed cohort header",
        env: completeExperimentEnv(),
        headers: { "X-DJ-Experiment-Cohort": "malformed" },
      },
      {
        name: "oversized cohort header",
        env: completeExperimentEnv(),
        headers: { "X-DJ-Experiment-Cohort": "a".repeat(200) },
      },
    ])("uses mock for $name", async ({ env, headers }) => {
      const providerLimit = vi.fn(async () => ({ success: true }));
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(
        experimentRequest(validRequest, headers),
        {
          ...env,
          COACH_PROVIDER_RATE_LIMITER: {
            limit: providerLimit,
          } as unknown as RateLimit,
        }
      );

      expect(response.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(providerLimit).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it.each([
      {
        name: "OpenAI",
        openAiBasisPoints: "10000",
        expectedProvider: "openai",
        expectedUrl: "https://api.openai.com/v1/responses",
        response: openAiProviderResponse(validProviderPayload),
      },
      {
        name: "Anthropic",
        openAiBasisPoints: "0",
        expectedProvider: "anthropic",
        expectedUrl: "https://api.anthropic.com/v1/messages",
        response: anthropicProviderResponse(validProviderPayload),
      },
    ])(
      "invokes only assigned $name and keeps the public body provider-neutral",
      async ({
        openAiBasisPoints,
        expectedProvider,
        expectedUrl,
        response: providerResponse,
      }) => {
        const providerLimit = vi.fn(async () => ({ success: true }));
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(providerResponse);
        const response = await worker.fetch(
          experimentRequest(validRequest, {
            "X-DJ-Provider": expectedProvider === "openai"
              ? "anthropic"
              : "openai",
          }),
          completeExperimentEnv({
            COACH_EXPERIMENT_OPENAI_BPS: openAiBasisPoints,
            COACH_PROVIDER_RATE_LIMITER: {
              limit: providerLimit,
            } as unknown as RateLimit,
          })
        );
        const body = (await response.json()) as Record<string, unknown>;

        expect(response.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0]?.[0]).toBe(expectedUrl);
        expect(providerLimit).toHaveBeenCalledWith({
          key: `coach-provider:${expectedProvider}:anonymous`,
        });
        expect(Object.keys(body)).toEqual([
          "contractVersion",
          "requestId",
          "response",
        ]);
        expect(JSON.stringify(body)).not.toContain(expectedProvider);
        fetchSpy.mockRestore();
      }
    );

    it("does not cross over when the assigned provider fails", async () => {
      const consoleLog = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      const providerLimit = vi.fn(async () => ({ success: true }));
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("assigned provider unavailable"));
      const response = await worker.fetch(
        experimentRequest(),
        completeExperimentEnv({
          COACH_EXPERIMENT_OPENAI_BPS: "10000",
          COACH_PROVIDER_RATE_LIMITER: {
            limit: providerLimit,
          } as unknown as RateLimit,
        })
      );
      const body = (await response.json()) as CoachApiSuccessResponseV1;

      expect(response.status).toBe(200);
      expect(body.response.message).toContain("steady");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        "https://api.openai.com/v1/responses"
      );
      expect(
        consoleLog.mock.calls.some(([entry]) =>
          String(entry).includes(
            '"assignedProvider":"openai"'
          )
        )
      ).toBe(true);
      expect(
        consoleLog.mock.calls.some(([entry]) =>
          String(entry).includes(
            '"fallbackCategory":"provider_fallback"'
          )
        )
      ).toBe(true);
      fetchSpy.mockRestore();
      consoleLog.mockRestore();
    });

    it("blocks the assigned provider before invocation", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(
        experimentRequest(),
        completeExperimentEnv({
          COACH_PROVIDER_RATE_LIMITER: {
            async limit() {
              return { success: false };
            },
          } as RateLimit,
        })
      );

      expect(response.status).toBe(429);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("rejects product scope before experiment routing or guardrails", async () => {
      const requestLimit = vi.fn(async () => ({ success: true }));
      const providerLimit = vi.fn(async () => ({ success: true }));
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await worker.fetch(
        experimentRequest({
          ...validRequest,
          question: {
            source: "free_text",
            question: "Do not route this request.",
          },
        }),
        completeExperimentEnv({
          COACH_RATE_LIMITER: {
            limit: requestLimit,
          } as unknown as RateLimit,
          COACH_PROVIDER_RATE_LIMITER: {
            limit: providerLimit,
          } as unknown as RateLimit,
        })
      );

      expect(response.status).toBe(400);
      expect(requestLimit).not.toHaveBeenCalled();
      expect(providerLimit).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("never exposes the cohort in provider requests, telemetry, or responses", async () => {
      const consoleLog = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      const providerLimit = vi.fn(async () => ({ success: true }));
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(openAiProviderResponse(validProviderPayload));
      const response = await worker.fetch(
        experimentRequest(),
        completeExperimentEnv({
          COACH_PROVIDER_RATE_LIMITER: {
            limit: providerLimit,
          } as unknown as RateLimit,
        })
      );
      const body = await response.text();
      const providerRequest = JSON.stringify(fetchSpy.mock.calls);
      const logs = consoleLog.mock.calls
        .map(([entry]) => String(entry))
        .join("\n");

      expect(response.status).toBe(200);
      expect(body).not.toContain(cohortId);
      expect(providerRequest).not.toContain(cohortId);
      expect(logs).not.toContain(cohortId);

      const event = JSON.parse(
        String(consoleLog.mock.calls.at(-1)?.[0])
      ) as Record<string, unknown>;
      expect(event).toMatchObject({
        providerMode: "experiment",
        experimentId: "provider_quality",
        experimentVersion: "v1",
        assignedProvider: "openai",
        actualExternalProvider: "openai",
        providerInvocationAttempted: true,
        result: "success",
      });
      expect(Object.keys(event).sort()).toEqual(
        [
          "actualExternalProvider",
          "assignedProvider",
          "elapsedMs",
          "event",
          "experimentId",
          "experimentVersion",
          "providerInvocationAttempted",
          "providerLatencyMs",
          "providerMode",
          "providerUsageCapLimit",
          "providerUsageCapOutcome",
          "providerUsageCapRemaining",
          "requestId",
          "result",
          "route",
          "sessionNumber",
          "suggestedQuestionId",
          "questionSource",
        ].sort()
      );

      fetchSpy.mockRestore();
      consoleLog.mockRestore();
    });
  });
});
