import { describe, expect, it } from "vitest";
import worker, { createWorker, Env } from "../src/index";
import type { CoachApiSuccessResponseV1 } from "../src/contracts/CoachApiContract";

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

describe("DJ Lingo Coach API", () => {
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

  it("returns 429 when the rate limiter rejects the key", async () => {
    const env: Env = {
      COACH_RATE_LIMITER: {
        async limit() {
          return { success: false };
        },
      } as RateLimit,
    };

    const response = await worker.fetch(makeRequest(validRequest), env);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");

    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "rate_limited",
      },
    });
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
            latestAttempt: {
              completedAt: "2026-06-18T12:00:00.000Z",
              landingResult: "early",
              landingOffsetMs: -180,
              landingTimingScore: 25,
              nextFocusId: "timing",
            },
            bestAttempt: {
              completedAt: "2026-06-18T12:00:00.000Z",
              landingResult: "early",
              landingOffsetMs: -180,
              landingTimingScore: 25,
              nextFocusId: "timing",
            },
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
});
