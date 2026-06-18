import { describe, expect, it } from "vitest";
import {
  InvalidCoachResponseError,
  validateCoachApiSuccessResponse,
} from "../src/coach/coachResponseValidator";
import { getCoachApiResponse } from "../src/coach/coachService";
import { coachEvaluationFixtures } from "./fixtures/coachEvaluationFixtures";

describe("coach provider-output validation", () => {
  it("accepts the deterministic mock response", async () => {
    const fixture = coachEvaluationFixtures[0]!;
    await expect(getCoachApiResponse(fixture.request)).resolves.toMatchObject({
      contractVersion: 1,
      requestId: fixture.request.requestId,
    });
  });

  it.each([
    [
      "missing fields",
      {
        contractVersion: 1,
        requestId: "validator_test",
        response: {
          message: "Keep the pulse steady.",
          responseType: "lesson_explanation",
          fallbackReasonId: null,
        },
      },
    ],
    [
      "unknown fields",
      {
        contractVersion: 1,
        requestId: "validator_test",
        response: {
          message: "Keep the pulse steady.",
          nextActionLabel: null,
          responseType: "lesson_explanation",
          fallbackReasonId: null,
          actionId: "complete_lesson",
        },
      },
    ],
    [
      "mismatched request ID",
      {
        contractVersion: 1,
        requestId: "wrong_request",
        response: {
          message: "Keep the pulse steady.",
          nextActionLabel: null,
          responseType: "lesson_explanation",
          fallbackReasonId: null,
        },
      },
    ],
    [
      "unsupported contract version",
      {
        contractVersion: 2,
        requestId: "validator_test",
        response: {
          message: "Keep the pulse steady.",
          nextActionLabel: null,
          responseType: "lesson_explanation",
          fallbackReasonId: null,
        },
      },
    ],
    [
      "invalid response type",
      {
        contractVersion: 1,
        requestId: "validator_test",
        response: {
          message: "Keep the pulse steady.",
          nextActionLabel: null,
          responseType: "controller_action",
          fallbackReasonId: null,
        },
      },
    ],
    [
      "invalid fallback combination",
      {
        contractVersion: 1,
        requestId: "validator_test",
        response: {
          message: "Keep the pulse steady.",
          nextActionLabel: null,
          responseType: "lesson_explanation",
          fallbackReasonId: "service_failure",
        },
      },
    ],
  ])("rejects %s", (_label, candidate) => {
    expect(() =>
      validateCoachApiSuccessResponse(candidate, "validator_test")
    ).toThrow(InvalidCoachResponseError);
  });

  it("rejects response text over the hard word limit", () => {
    const message = Array.from({ length: 101 }, () => "beat").join(" ");

    expect(() =>
      validateCoachApiSuccessResponse(
        {
          contractVersion: 1,
          requestId: "validator_test",
          response: {
            message,
            nextActionLabel: null,
            responseType: "lesson_explanation",
            fallbackReasonId: null,
          },
        },
        "validator_test"
      )
    ).toThrow(InvalidCoachResponseError);
  });

  it.each([
    ["an empty message", "", null],
    ["an oversized message", "x".repeat(701), null],
    ["an empty next action", "Keep the pulse steady.", ""],
    [
      "an oversized next action",
      "Keep the pulse steady.",
      "x".repeat(161),
    ],
  ])("rejects %s", (_label, message, nextActionLabel) => {
    expect(() =>
      validateCoachApiSuccessResponse(
        {
          contractVersion: 1,
          requestId: "validator_test",
          response: {
            message,
            nextActionLabel,
            responseType: "lesson_explanation",
            fallbackReasonId: null,
          },
        },
        "validator_test"
      )
    ).toThrow(InvalidCoachResponseError);
  });
});
