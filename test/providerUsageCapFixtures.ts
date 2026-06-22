import type { ProviderUsageCap } from "../src/infrastructure/cloudflare/providerUsageCap";
import type {
  ProviderUsageCapDecision,
  ProviderUsageCapPort,
} from "../src/usageCap/providerUsageCap";

export type ProviderUsageCapConsume = (
  periodKey: string,
  limit: number
) => Promise<unknown>;

export function providerUsageCapBinding(
  consume: ProviderUsageCapConsume = async (_periodKey, limit) => ({
    allowed: true,
    limit,
    remaining: Math.max(0, limit - 1),
  })
): DurableObjectNamespace<ProviderUsageCap> {
  return {
    getByName() {
      return { consume };
    },
  } as unknown as DurableObjectNamespace<ProviderUsageCap>;
}

export function providerUsageCapPort(
  consume: ProviderUsageCapPort["consume"] = async ({ limit }) => ({
    allowed: true,
    limit,
    remaining: Math.max(0, limit - 1),
  })
): ProviderUsageCapPort {
  return { consume };
}

export function allowedProviderUsageCapDecision(
  limit: number,
  remaining = Math.max(0, limit - 1)
): ProviderUsageCapDecision {
  return {
    allowed: true,
    limit,
    remaining,
  };
}
