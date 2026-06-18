export type ApiErrorCode =
  | "method_not_allowed"
  | "not_found"
  | "invalid_json"
  | "invalid_request"
  | "request_too_large"
  | "rate_limited"
  | "server_failure";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}
