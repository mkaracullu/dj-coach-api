import { describe, expect, it } from "vitest";
import worker, { Env } from "../src/index";
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
      "X-DJ-Lingo-Request-Id": "coach_test_1",
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
      service: "dj-lingo-coach-api",
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

  it("rejects malformed JSON", async () => {
    const response = await worker.fetch(makeRequest("{"), {});

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "invalid_json",
      },
    });
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
              landingTimingScore: 38,
              nextFocusId: "timing",
            },
            bestAttempt: {
              completedAt: "2026-06-18T12:00:00.000Z",
              landingResult: "early",
              landingOffsetMs: -180,
              landingTimingScore: 38,
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
});
