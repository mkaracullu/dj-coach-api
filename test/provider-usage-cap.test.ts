import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { createWorker, type Env } from "../src/index";
import {
  createCloudflareProviderUsageCapPort,
  ProviderUsageCap,
} from "../src/infrastructure/cloudflare/providerUsageCap";
import type { ProviderUsageCapPort } from "../src/usageCap/providerUsageCap";
import {
  providerUsageCapBinding,
  providerUsageCapPort,
} from "./providerUsageCapFixtures";

const requestBody = {
  contractVersion: 1,
  requestId: "provider_cap_test",
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

function request(body: unknown = requestBody): Request {
  return new Request("https://api.example.test/v1/coach/respond", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-DJ-Request-Id": requestBody.requestId,
    },
    body: JSON.stringify(body),
  });
}

function providerResponse(usage?: unknown): Response {
  return Response.json({
    status: "completed",
    output: [
      {
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              message:
                "Keep the pulse steady and leave equal space between taps.",
              nextActionLabel: "Try one steady tap round.",
              responseType: "lesson_explanation",
              fallbackReasonId: null,
            }),
          },
        ],
      },
    ],
    ...(usage === undefined ? {} : { usage }),
  });
}

function externalEnv(overrides: Partial<Env> = {}): Env {
  return {
    COACH_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key-not-real",
    OPENAI_MODEL: "reference-model",
    COACH_PROVIDER_DAILY_CALL_LIMIT: "2",
    COACH_PROVIDER_RATE_LIMITER: {
      async limit() {
        return { success: true };
      },
    } as RateLimit,
    COACH_PROVIDER_USAGE_CAP: providerUsageCapBinding(),
    ...overrides,
  };
}

function lastTelemetry(
  log: ReturnType<typeof vi.spyOn>
): Record<string, unknown> {
  return JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<
    string,
    unknown
  >;
}

function inMemoryDurableObjectState(
  operations: Array<{ query: string; bindings: unknown[] }> = []
): DurableObjectState {
  const counts = new Map<string, number>();
  const sql = {
    exec(query: string, ...bindings: unknown[]) {
      const normalized = query.replace(/\s+/g, " ").trim();
      operations.push({ query: normalized, bindings });

      if (normalized.startsWith("DELETE FROM provider_call_usage")) {
        const currentPeriod = String(bindings[0]);
        for (const key of counts.keys()) {
          if (key !== currentPeriod) {
            counts.delete(key);
          }
        }
        return { toArray: () => [] };
      }

      if (normalized.startsWith("SELECT used")) {
        const periodKey = String(bindings[0]);
        const used = counts.get(periodKey);
        return {
          toArray: () => (used === undefined ? [] : [{ used }]),
        };
      }

      if (normalized.startsWith("INSERT INTO provider_call_usage")) {
        counts.set(String(bindings[0]), Number(bindings[1]));
        return { toArray: () => [] };
      }

      return { toArray: () => [] };
    },
  };

  return {
    storage: {
      sql,
      transactionSync<T>(closure: () => T): T {
        return closure();
      },
    },
  } as unknown as DurableObjectState;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("global provider usage cap", () => {
  it("allows the request flow to use a provider-neutral port", async () => {
    const consume = vi.fn<ProviderUsageCapPort["consume"]>(
      async ({ limit }) => ({
        allowed: true,
        limit,
        remaining: limit - 1,
      })
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      providerResponse()
    );
    const portableWorker = createWorker(
      undefined,
      () => providerUsageCapPort(consume)
    );
    const env = externalEnv();
    delete env.COACH_PROVIDER_USAGE_CAP;

    const response = await portableWorker.fetch(request(), env);

    expect(response.status).toBe(200);
    expect(consume).toHaveBeenCalledWith({
      periodKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      limit: 2,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("maps the Cloudflare namespace and validated stub response to the port", async () => {
    const consume = vi.fn(async (periodKey: string, limit: number) => ({
      allowed: true,
      limit,
      remaining: limit - 1,
    }));
    const port = createCloudflareProviderUsageCapPort({
      COACH_PROVIDER_USAGE_CAP: providerUsageCapBinding(consume),
    });

    await expect(
      port?.consume({ periodKey: "2026-06-22", limit: 3 })
    ).resolves.toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
    });
    expect(consume).toHaveBeenCalledWith("2026-06-22", 3);
  });

  it("consumes exactly once after the short-window guard and immediately before invocation", async () => {
    const order: string[] = [];
    const capConsume = vi.fn(async (_periodKey: string, limit: number) => {
      order.push("global-cap");
      return { allowed: true, limit, remaining: limit - 1 };
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        order.push("provider");
        return providerResponse();
      });

    const response = await worker.fetch(
      request(),
      externalEnv({
        COACH_PROVIDER_RATE_LIMITER: {
          async limit() {
            order.push("short-window-guard");
            return { success: true };
          },
        } as RateLimit,
        COACH_PROVIDER_USAGE_CAP: providerUsageCapBinding(capConsume),
      })
    );

    expect(response.status).toBe(200);
    expect(capConsume).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "short-window-guard",
      "global-cap",
      "provider",
    ]);
  });

  it("serializes concurrent consumption and never exceeds the configured limit", async () => {
    const cap = new ProviderUsageCap(
      inMemoryDurableObjectState(),
      {}
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, async () =>
        cap.consume("2026-06-22", 3)
      )
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(results.filter((result) => !result.allowed)).toHaveLength(5);
    expect(results.at(2)).toEqual({
      allowed: true,
      limit: 3,
      remaining: 0,
    });
  });

  it("uses independent UTC-day counters and resets on the next day key", () => {
    const cap = new ProviderUsageCap(
      inMemoryDurableObjectState(),
      {}
    );

    expect(cap.consume("2026-06-22", 1)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(cap.consume("2026-06-22", 1)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(cap.consume("2026-06-23", 1)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it("stores only the UTC period key and consumed call count", () => {
    const operations: Array<{
      query: string;
      bindings: unknown[];
    }> = [];
    const cap = new ProviderUsageCap(
      inMemoryDurableObjectState(operations),
      {}
    );

    cap.consume("2026-06-22", 3);

    const serializedBindings = JSON.stringify(
      operations.flatMap((operation) => operation.bindings)
    );
    expect(serializedBindings).toContain("2026-06-22");
    expect(serializedBindings).not.toContain(requestBody.requestId);
    expect(serializedBindings).not.toContain(
      requestBody.question.suggestedQuestionId
    );
    expect(serializedBindings).not.toContain(
      requestBody.context.lesson.lessonId
    );
    expect(
      operations.every((operation) =>
        operation.bindings.every(
          (binding) =>
            typeof binding === "string" ||
            typeof binding === "number"
        )
      )
    ).toBe(true);
  });

  it("consumes an allowance when the attempted provider call fails", async () => {
    const capConsume = vi.fn(async (_periodKey: string, limit: number) => ({
      allowed: true,
      limit,
      remaining: limit - 1,
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("provider unavailable", { status: 503 })
    );

    const response = await worker.fetch(
      request(),
      externalEnv({
        COACH_PROVIDER_USAGE_CAP: providerUsageCapBinding(capConsume),
      })
    );

    expect(response.status).toBe(200);
    expect(capConsume).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not consume for scope, request-rate, or provider-guard rejection", async () => {
    const capConsume = vi.fn();
    const binding = providerUsageCapBinding(capConsume);

    const scopeResponse = await worker.fetch(
      request({
        ...requestBody,
        question: {
          source: "free_text",
          question: "This remains outside the accepted product scope.",
        },
      }),
      externalEnv({ COACH_PROVIDER_USAGE_CAP: binding })
    );
    const requestRateResponse = await worker.fetch(
      request(),
      externalEnv({
        COACH_PROVIDER_USAGE_CAP: binding,
        COACH_RATE_LIMITER: {
          async limit() {
            return { success: false };
          },
        } as RateLimit,
      })
    );
    const providerRateResponse = await worker.fetch(
      request(),
      externalEnv({
        COACH_PROVIDER_USAGE_CAP: binding,
        COACH_PROVIDER_RATE_LIMITER: {
          async limit() {
            return { success: false };
          },
        } as RateLimit,
      })
    );

    expect(scopeResponse.status).toBe(400);
    expect(requestRateResponse.status).toBe(429);
    expect(providerRateResponse.status).toBe(429);
    expect(capConsume).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing binding",
      configure(env: Env) {
        delete env.COACH_PROVIDER_USAGE_CAP;
      },
    },
    {
      name: "missing limit",
      configure(env: Env) {
        delete env.COACH_PROVIDER_DAILY_CALL_LIMIT;
      },
    },
    {
      name: "malformed limit",
      configure(env: Env) {
        env.COACH_PROVIDER_DAILY_CALL_LIMIT = "2calls";
      },
    },
    {
      name: "throwing binding",
      configure(env: Env) {
        env.COACH_PROVIDER_USAGE_CAP = providerUsageCapBinding(async () => {
          throw new Error("unavailable");
        });
      },
    },
    {
      name: "malformed result",
      configure(env: Env) {
        env.COACH_PROVIDER_USAGE_CAP = providerUsageCapBinding(async () => ({
          allowed: true,
        }));
      },
    },
  ])("fails closed for external providers with $name", async ({ configure }) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const env = externalEnv();
    configure(env);
    const response = await worker.fetch(
      request(),
      env
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "provider_guardrail_blocked" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks exhausted allowance without invoking the provider", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(
      request(),
      externalEnv({
        COACH_PROVIDER_USAGE_CAP: providerUsageCapBinding(
          async (_periodKey, limit) => ({
            allowed: false,
            limit,
            remaining: 0,
          })
        ),
      })
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lastTelemetry(log)).toMatchObject({
      result: "provider_usage_cap_blocked",
      providerInvocationAttempted: false,
      providerUsageCapOutcome: "blocked",
      providerUsageCapLimit: 2,
      providerUsageCapRemaining: 0,
    });
  });

  it("keeps mock mode usable without cap configuration", async () => {
    const response = await worker.fetch(request(), {
      COACH_PROVIDER: "mock",
    });

    expect(response.status).toBe(200);
  });

  it("emits sanitized provider latency and valid token usage", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      providerResponse({
        input_tokens: 120,
        output_tokens: 40,
        total_tokens: 160,
      })
    );

    const response = await worker.fetch(request(), externalEnv());
    const event = lastTelemetry(log);

    expect(response.status).toBe(200);
    expect(event).toMatchObject({
      actualExternalProvider: "openai",
      providerInvocationAttempted: true,
      providerUsageCapOutcome: "allowed",
      providerUsageCapLimit: 2,
      providerUsageCapRemaining: 1,
      providerInputTokens: 120,
      providerOutputTokens: 40,
      providerTotalTokens: 160,
    });
    expect(event.providerLatencyMs).toEqual(expect.any(Number));
    expect(Number(event.providerLatencyMs)).toBeGreaterThanOrEqual(0);
  });

  it("safely derives total tokens when valid provider totals are absent", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      providerResponse({
        input_tokens: 120,
        output_tokens: 40,
      })
    );

    const response = await worker.fetch(request(), externalEnv());

    expect(response.status).toBe(200);
    expect(lastTelemetry(log)).toMatchObject({
      providerInputTokens: 120,
      providerOutputTokens: 40,
      providerTotalTokens: 160,
    });
  });

  it.each([
    { name: "absent", usage: undefined },
    {
      name: "negative",
      usage: {
        input_tokens: -1,
        output_tokens: 4,
        total_tokens: 3,
      },
    },
    {
      name: "non-finite",
      usage: {
        input_tokens: 4,
        output_tokens: Number.POSITIVE_INFINITY,
        total_tokens: Number.POSITIVE_INFINITY,
      },
    },
    {
      name: "inconsistent total",
      usage: {
        input_tokens: 4,
        output_tokens: 5,
        total_tokens: 2,
      },
    },
  ])("does not invent telemetry for $name usage metadata", async ({ usage }) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      providerResponse(usage)
    );

    const response = await worker.fetch(request(), externalEnv());
    const event = lastTelemetry(log);

    expect(response.status).toBe(200);
    expect(event).not.toHaveProperty("providerInputTokens");
    expect(event).not.toHaveProperty("providerOutputTokens");
    expect(event).not.toHaveProperty("providerTotalTokens");
  });
});
