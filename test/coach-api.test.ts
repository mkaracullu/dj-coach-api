import { describe, expect, it } from "vitest";
import worker, { createWorker, Env } from "../src/index";
import type {
  CoachApiRequestV1,
  CoachApiSuccessResponseV1,
} from "../src/contracts/CoachApiContract";
import type { CoachService } from "../src/coach/coachService";

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
      response: {
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
      "elapsedMs",
      "providerInvocationAttempted",
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
          "providerMode",
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
