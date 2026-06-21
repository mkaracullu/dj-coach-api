import type { CoachProviderUsage } from "../../src/coach/providerTypes";

export type TokenPricePerMillionUsd = {
  input: number | null;
  output: number | null;
};

export function estimateTokenUsageCostUsd(
  usage: CoachProviderUsage | null,
  price: TokenPricePerMillionUsd
): number | null {
  if (
    usage === null ||
    price.input === null ||
    price.output === null
  ) {
    return null;
  }

  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output) /
    1_000_000
  );
}
