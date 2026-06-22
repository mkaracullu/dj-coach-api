import { DurableObject } from "cloudflare:workers";
import type {
  ProviderUsageCapConsumeRequest,
  ProviderUsageCapDecision,
  ProviderUsageCapPort,
} from "../../usageCap/providerUsageCap";

const providerUsageCapObjectName = "environment-wide-provider-calls";

export type CloudflareProviderUsageCapEnvironment = {
  COACH_PROVIDER_DAILY_CALL_LIMIT?: string;
  COACH_PROVIDER_USAGE_CAP?: DurableObjectNamespace<ProviderUsageCap>;
};

type StoredUsage = {
  used: number;
};

function isProviderUsageCapDecision(
  value: unknown,
  expectedLimit: number
): value is ProviderUsageCapDecision {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const allowed = Reflect.get(value, "allowed");
  const limit = Reflect.get(value, "limit");
  const remaining = Reflect.get(value, "remaining");

  return (
    typeof allowed === "boolean" &&
    limit === expectedLimit &&
    Number.isSafeInteger(remaining) &&
    remaining >= 0 &&
    remaining <= expectedLimit &&
    (allowed ? remaining < expectedLimit : remaining === 0)
  );
}

export function createCloudflareProviderUsageCapPort(
  env: CloudflareProviderUsageCapEnvironment
): ProviderUsageCapPort | undefined {
  const namespace = env.COACH_PROVIDER_USAGE_CAP;

  if (!namespace) {
    return undefined;
  }

  return {
    async consume(request) {
      const stub = namespace.getByName(providerUsageCapObjectName);
      const result: unknown = await stub.consume(
        request.periodKey,
        request.limit
      );

      if (!isProviderUsageCapDecision(result, request.limit)) {
        throw new Error("Invalid provider usage cap result.");
      }

      return result;
    },
  };
}

export class ProviderUsageCap extends DurableObject<Record<string, never>> {
  constructor(
    ctx: DurableObjectState,
    env: Record<string, never>
  ) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS provider_call_usage (
        period_key TEXT PRIMARY KEY,
        used INTEGER NOT NULL CHECK (used >= 0)
      )
    `);
  }

  consume(
    periodKey: ProviderUsageCapConsumeRequest["periodKey"],
    limit: ProviderUsageCapConsumeRequest["limit"]
  ): ProviderUsageCapDecision {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(periodKey) ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    ) {
      throw new Error("Invalid provider usage cap request.");
    }

    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM provider_call_usage WHERE period_key <> ?",
        periodKey
      );

      const stored = this.ctx.storage.sql
        .exec<StoredUsage>(
          "SELECT used FROM provider_call_usage WHERE period_key = ?",
          periodKey
        )
        .toArray()[0];
      const used = stored?.used ?? 0;

      if (!Number.isSafeInteger(used) || used < 0 || used >= limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
        };
      }

      const nextUsed = used + 1;
      this.ctx.storage.sql.exec(
        `INSERT INTO provider_call_usage (period_key, used)
         VALUES (?, ?)
         ON CONFLICT(period_key) DO UPDATE SET used = excluded.used`,
        periodKey,
        nextUsed
      );

      return {
        allowed: true,
        limit,
        remaining: limit - nextUsed,
      };
    });
  }
}
