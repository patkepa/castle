export interface SearchShadowDiagnostics {
  comparisonCount: number;
  desktopFailureCount: number;
  browserFailureCount: number;
  sameFirstResultCount: number;
  exactOrderCount: number;
  overlapAtTenTotal: number;
  comparedResultCount: number;
  rankDisplacementTotal: number;
  lastComparedAt: string | null;
}

export interface SearchShadowComparison {
  desktopResultIds?: readonly string[];
  browserResultIds?: readonly string[];
  desktopFailed?: boolean;
  browserFailed?: boolean;
  comparedAt?: Date;
}

const emptyDiagnostics = (): SearchShadowDiagnostics => ({
  comparisonCount: 0,
  desktopFailureCount: 0,
  browserFailureCount: 0,
  sameFirstResultCount: 0,
  exactOrderCount: 0,
  overlapAtTenTotal: 0,
  comparedResultCount: 0,
  rankDisplacementTotal: 0,
  lastComparedAt: null,
});

let diagnostics = emptyDiagnostics();

/**
 * Compares two result rankings and retains aggregate counters only. Query text,
 * note IDs, titles, snippets, and individual comparisons are never persisted.
 */
export function recordSearchShadowComparison({
  desktopResultIds = [],
  browserResultIds = [],
  desktopFailed = false,
  browserFailed = false,
  comparedAt = new Date(),
}: SearchShadowComparison): SearchShadowDiagnostics {
  const desktop = desktopResultIds.slice(0, 10);
  const browser = browserResultIds.slice(0, 10);
  const browserRanks = new Map(browser.map((id, index) => [id, index]));
  const shared = desktop.flatMap((id, desktopRank) => {
    const browserRank = browserRanks.get(id);
    return browserRank === undefined
      ? []
      : [{ desktopRank, browserRank }];
  });

  diagnostics = {
    comparisonCount: diagnostics.comparisonCount + 1,
    desktopFailureCount:
      diagnostics.desktopFailureCount + Number(desktopFailed),
    browserFailureCount:
      diagnostics.browserFailureCount + Number(browserFailed),
    sameFirstResultCount:
      diagnostics.sameFirstResultCount +
      Number(
        desktop.length > 0 &&
          browser.length > 0 &&
          desktop[0] === browser[0],
      ),
    exactOrderCount:
      diagnostics.exactOrderCount +
      Number(
        desktop.length === browser.length &&
          desktop.every((id, index) => id === browser[index]),
      ),
    overlapAtTenTotal: diagnostics.overlapAtTenTotal + shared.length,
    comparedResultCount: diagnostics.comparedResultCount + shared.length,
    rankDisplacementTotal:
      diagnostics.rankDisplacementTotal +
      shared.reduce(
        (total, ranks) =>
          total + Math.abs(ranks.desktopRank - ranks.browserRank),
        0,
      ),
    lastComparedAt: comparedAt.toISOString(),
  };
  return getSearchShadowDiagnostics();
}

export function getSearchShadowDiagnostics(): SearchShadowDiagnostics {
  return { ...diagnostics };
}

export function resetSearchShadowDiagnostics(): SearchShadowDiagnostics {
  diagnostics = emptyDiagnostics();
  return getSearchShadowDiagnostics();
}

export function summarizeSearchShadowDiagnostics(
  value = diagnostics,
): {
  firstResultAgreement: number | null;
  exactOrderAgreement: number | null;
  meanOverlapAtTen: number | null;
  meanRankDisplacement: number | null;
} {
  return {
    firstResultAgreement: ratio(
      value.sameFirstResultCount,
      value.comparisonCount,
    ),
    exactOrderAgreement: ratio(value.exactOrderCount, value.comparisonCount),
    meanOverlapAtTen: ratio(value.overlapAtTenTotal, value.comparisonCount),
    meanRankDisplacement: ratio(
      value.rankDisplacementTotal,
      value.comparedResultCount,
    ),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
