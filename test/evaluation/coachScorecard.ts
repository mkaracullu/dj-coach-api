import type {
  CoachEvaluationReport,
  EvaluationHardGateId,
  EvaluationQualityFailureId,
  EvaluationQualityWarningId,
} from "./coachEvaluator";

export type CoachEvaluationScorecard = {
  provider: string;
  model: string | null;
  reportCount: number;
  hardGatePassCount: number;
  hardGatePassRate: number;
  hardGateFailureCounts: Partial<Record<EvaluationHardGateId, number>>;
  qualityGatePassCount: number;
  qualityGatePassRate: number;
  averageScore: number;
  qualityFailureCounts: Partial<
    Record<EvaluationQualityFailureId, number>
  >;
  qualityWarningCounts: Partial<
    Record<EvaluationQualityWarningId, number>
  >;
  averageLatencyMs: number | null;
  totalEstimatedCostUsd: number | null;
};

function incrementCount<T extends string>(
  counts: Map<T, number>,
  finding: T
): void {
  counts.set(finding, (counts.get(finding) ?? 0) + 1);
}

function sortedCounts<T extends string>(
  counts: Map<T, number>
): Partial<Record<T, number>> {
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ) as Partial<Record<T, number>>;
}

export function buildCoachEvaluationScorecards(
  reports: readonly CoachEvaluationReport[]
): CoachEvaluationScorecard[] {
  const groups = new Map<string, CoachEvaluationReport[]>();

  for (const report of reports) {
    const key = JSON.stringify([report.provider, report.model]);
    const group = groups.get(key);

    if (group) {
      group.push(report);
    } else {
      groups.set(key, [report]);
    }
  }

  return [...groups.values()]
    .map((group) => {
      const first = group[0];

      if (first === undefined) {
        throw new Error("Scorecard group must contain a report.");
      }

      const hardGatePassCount = group.filter(
        (report) => report.hardGatePassed
      ).length;
      const qualityGatePassCount = group.filter(
        (report) => report.qualityGatePassed
      ).length;
      const latencies = group.flatMap((report) =>
        report.latencyMs === null ? [] : [report.latencyMs]
      );
      const costs = group.flatMap((report) =>
        report.estimatedCostUsd === null
          ? []
          : [report.estimatedCostUsd]
      );
      const qualityFailureCounts = new Map<
        EvaluationQualityFailureId,
        number
      >();
      const hardGateFailureCounts = new Map<
        EvaluationHardGateId,
        number
      >();
      const qualityWarningCounts = new Map<
        EvaluationQualityWarningId,
        number
      >();

      for (const report of group) {
        for (const failure of report.hardGateFailures) {
          incrementCount(hardGateFailureCounts, failure);
        }

        for (const failure of report.qualityFailures) {
          incrementCount(qualityFailureCounts, failure);
        }

        for (const warning of report.qualityWarnings) {
          incrementCount(qualityWarningCounts, warning);
        }
      }

      return {
        provider: first.provider,
        model: first.model,
        reportCount: group.length,
        hardGatePassCount,
        hardGatePassRate: hardGatePassCount / group.length,
        hardGateFailureCounts: sortedCounts(hardGateFailureCounts),
        qualityGatePassCount,
        qualityGatePassRate: qualityGatePassCount / group.length,
        averageScore:
          group.reduce((total, report) => total + report.score, 0) /
          group.length,
        qualityFailureCounts: sortedCounts(qualityFailureCounts),
        qualityWarningCounts: sortedCounts(qualityWarningCounts),
        averageLatencyMs:
          latencies.length === 0
            ? null
            : latencies.reduce((total, latency) => total + latency, 0) /
              latencies.length,
        totalEstimatedCostUsd:
          costs.length === 0
            ? null
            : costs.reduce((total, cost) => total + cost, 0),
      };
    })
    .sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        (left.model ?? "").localeCompare(right.model ?? "")
    );
}
