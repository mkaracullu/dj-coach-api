import { coachApiLimits } from "../contracts/CoachApiContract";
import { ApiError, ApiErrorCode } from "./ApiError";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Accept, Content-Type, X-DJ-Lingo-Request-Id, X-DJ-Lingo-Install-Id",
  "Access-Control-Max-Age": "86400",
} as const;

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);

  headers.set("Content-Type", "application/json; charset=utf-8");

  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function emptyCorsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export function errorResponse(
  error: ApiError,
  requestId?: string
): Response {
  const headers = new Headers();

  if (error.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }

  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(requestId ? { requestId } : {}),
      },
    },
    {
      status: error.status,
      headers,
    }
  );
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  retryAfterSeconds?: number
): ApiError {
  return new ApiError(code, message, status, retryAfterSeconds);
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }

  return bytes;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("Content-Length");

  if (contentLength) {
    const parsedLength = Number(contentLength);

    if (
      Number.isFinite(parsedLength) &&
      parsedLength > coachApiLimits.requestBodyMaxBytes
    ) {
      throw apiError(
        "request_too_large",
        "Coach request body is too large.",
        413
      );
    }
  }

  const text = await request.text();

  if (utf8ByteLength(text) > coachApiLimits.requestBodyMaxBytes) {
    throw apiError(
      "request_too_large",
      "Coach request body is too large.",
      413
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw apiError("invalid_json", "Request body must be valid JSON.", 400);
  }
}
