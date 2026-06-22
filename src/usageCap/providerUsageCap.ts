const millisecondsPerDay = 24 * 60 * 60 * 1_000;

export type ProviderUsageCapConsumeRequest = {
  periodKey: string;
  limit: number;
};

export type ProviderUsageCapDecision =
  | {
      allowed: true;
      limit: number;
      remaining: number;
    }
  | {
      allowed: false;
      limit: number;
      remaining: 0;
    };

export type ProviderUsageCapPort = {
  consume(
    request: ProviderUsageCapConsumeRequest
  ): Promise<ProviderUsageCapDecision>;
};

export type ProviderUsageCapAllowedOutcome = {
  outcome: "allowed";
  limit: number;
  remaining: number;
};

export class ProviderUsageCapUnavailableError extends Error {
  constructor() {
    super("Provider usage cap is unavailable.");
    this.name = "ProviderUsageCapUnavailableError";
  }
}

export class ProviderUsageCapReachedError extends Error {
  readonly retryAfterSeconds: number;
  readonly remaining = 0;

  constructor(
    nowMs: number,
    readonly limit: number
  ) {
    super("Provider usage cap was reached.");
    this.name = "ProviderUsageCapReachedError";

    const nextUtcDayMs =
      Math.floor(nowMs / millisecondsPerDay + 1) * millisecondsPerDay;
    this.retryAfterSeconds = Math.max(
      1,
      Math.ceil((nextUtcDayMs - nowMs) / 1_000)
    );
  }
}

function resolveDailyCallLimit(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function isValidDecision(
  value: ProviderUsageCapDecision,
  expectedLimit: number
): boolean {
  return (
    value.limit === expectedLimit &&
    Number.isSafeInteger(value.remaining) &&
    value.remaining >= 0 &&
    value.remaining <= expectedLimit &&
    (value.allowed
      ? value.remaining < expectedLimit
      : value.remaining === 0)
  );
}

export async function consumeDailyProviderAllowance(
  port: ProviderUsageCapPort | undefined,
  configuredLimit: string | undefined,
  nowMs = Date.now()
): Promise<ProviderUsageCapAllowedOutcome> {
  const limit = resolveDailyCallLimit(configuredLimit);

  if (!port || limit === null) {
    throw new ProviderUsageCapUnavailableError();
  }

  let decision: ProviderUsageCapDecision;

  try {
    decision = await port.consume({
      periodKey: utcDayKey(nowMs),
      limit,
    });
  } catch {
    throw new ProviderUsageCapUnavailableError();
  }

  if (!isValidDecision(decision, limit)) {
    throw new ProviderUsageCapUnavailableError();
  }

  if (!decision.allowed) {
    throw new ProviderUsageCapReachedError(nowMs, decision.limit);
  }

  return {
    outcome: "allowed",
    limit,
    remaining: decision.remaining,
  };
}
