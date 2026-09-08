import { Icon } from "@patkepa/kantzen-ui/primitives";
import { useEffect, useMemo, useState } from "react";
import type { CastleChatAuditSnapshot } from "../../platform/ai_chat";
import type {
  CastleIndexStatus,
  CastleKnowledgeOverview,
} from "../../platform/knowledge_queries";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import {
  getSearchShadowDiagnostics,
  summarizeSearchShadowDiagnostics,
  type SearchShadowDiagnostics,
} from "../../lib/searchShadowDiagnostics";

export function KnowledgeInsightsTool() {
  const platform = useCastlePlatform();
  const [overview, setOverview] = useState<CastleKnowledgeOverview | null>(null);
  const [indexStatus, setIndexStatus] = useState<CastleIndexStatus | null>(null);
  const [audit, setAudit] = useState<CastleChatAuditSnapshot | null>(null);
  const [search, setSearch] = useState<SearchShadowDiagnostics>(() =>
    getSearchShadowDiagnostics(),
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSearch(getSearchShadowDiagnostics());
    if (!platform.knowledgeQueries) {
      setOverview(null);
      setIndexStatus(null);
      setAudit(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void Promise.all([
      platform.knowledgeQueries.overview(),
      platform.knowledgeQueries.status(),
      platform.aiChat?.audit() ?? Promise.resolve(null),
    ])
      .then(([nextOverview, nextIndexStatus, nextAudit]) => {
        if (cancelled) return;
        setOverview(nextOverview);
        setIndexStatus(nextIndexStatus);
        setAudit(nextAudit);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform.aiChat, platform.knowledgeQueries, refreshSequence]);

  const searchSummary = useMemo(
    () => summarizeSearchShadowDiagnostics(search),
    [search],
  );
  const maximumEntityCount = Math.max(
    1,
    ...(overview?.entities.map((entity) => entity.total) ?? []),
  );

  const clearAudit = async () => {
    if (!platform.aiChat) return;
    setAudit(await platform.aiChat.clearAudit());
  };

  if (!platform.knowledgeQueries) {
    return (
      <section className="knowledge-insights-tool is-unavailable">
        <Icon icon="desktop" size={24} aria-hidden="true" />
        <h1>Desktop intelligence</h1>
        <p>Local index analytics and AI diagnostics are available in Castle Desktop.</p>
      </section>
    );
  }

  return (
    <section aria-label="Castle intelligence" className="knowledge-insights-tool">
      <header className="knowledge-insights-header">
        <div>
          <span>Local intelligence layer</span>
          <h1>Castle index and AI diagnostics</h1>
          <p>
            SQL-backed summaries from the disposable local index. Markdown remains
            the source of truth.
          </p>
        </div>
        <button
          disabled={loading}
          onClick={() => setRefreshSequence((value) => value + 1)}
          type="button"
        >
          <Icon icon="refresh" size={13} aria-hidden="true" />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error ? (
        <div className="knowledge-insights-error" role="alert">
          <Icon icon="warning-sign" aria-hidden="true" />
          {error}
        </div>
      ) : null}

      {overview ? (
        <>
          <div className="knowledge-metric-grid" aria-label="Index summary">
            <Metric label="Notes" value={formatNumber(overview.notes.total)} />
            <Metric label="Words" value={formatNumber(overview.notes.wordCount)} />
            <Metric label="Links" value={formatNumber(overview.links)} />
            <Metric label="Search chunks" value={formatNumber(overview.chunks)} />
            <Metric
              label="Embedded chunks"
              value={formatNumber(overview.embeddedChunks)}
            />
            <Metric
              label="Reading time"
              value={`${formatNumber(overview.notes.readingMinutes)} min`}
            />
          </div>

          <article className="knowledge-insights-panel">
            <header>
              <div>
                <span>Cross-domain analytics</span>
                <h2>Indexed entities</h2>
              </div>
              <small>{shortGeneration(overview.generation)}</small>
            </header>
            {overview.entities.length > 0 ? (
              <div className="knowledge-entity-chart">
                {overview.entities.map((entity) => (
                  <div className="knowledge-entity-row" key={entity.kind}>
                    <div>
                      <strong>{humanize(entity.kind)}</strong>
                      <span>{formatNumber(entity.total)}</span>
                    </div>
                    <div className="knowledge-entity-bar" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(
                            2,
                            (entity.total / maximumEntityCount) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="knowledge-statuses">
                      {entity.statuses.map((status) => (
                        <span key={status.label}>
                          {humanize(status.label)} {formatNumber(status.count)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="knowledge-insights-empty">No typed entities are indexed.</p>
            )}
          </article>
        </>
      ) : loading ? (
        <div className="knowledge-insights-loading" role="status">
          Loading local analytics…
        </div>
      ) : null}

      {indexStatus ? (
        <article className="knowledge-insights-panel">
          <header>
            <div>
              <span>On-device semantic search</span>
              <h2>Multilingual embeddings</h2>
            </div>
            <small>Local only</small>
          </header>
          <dl className="knowledge-diagnostic-list">
            <Diagnostic
              label="Runtime"
              value={humanize(indexStatus.embedding.state)}
            />
            <Diagnostic
              label="Model"
              value={shortModelName(indexStatus.embedding.provider.model)}
            />
            <Diagnostic
              label="Semantic index"
              value={indexStatus.manifest?.semanticAvailable ? "Ready" : "Lexical fallback"}
            />
            <Diagnostic
              label="Dimensions"
              value={formatNumber(indexStatus.embedding.provider.dimensions)}
            />
            <Diagnostic
              label="Cache hits"
              value={formatNumber(indexStatus.embedding.scheduler?.lastCacheHits ?? 0)}
            />
            <Diagnostic
              label="Generated"
              value={formatNumber(indexStatus.embedding.scheduler?.lastGenerated ?? 0)}
            />
            <Diagnostic
              label="Pending"
              value={formatNumber(indexStatus.embedding.scheduler?.lastPending ?? 0)}
            />
            <Diagnostic
              label="Retries"
              value={formatNumber(indexStatus.embedding.scheduler?.lastRetries ?? 0)}
            />
          </dl>
          {indexStatus.embedding.lastErrorClass ? (
            <p className="knowledge-privacy-note">
              {humanize(indexStatus.embedding.lastErrorClass)}. Lexical search remains
              available.
            </p>
          ) : (
            <p className="knowledge-privacy-note">
              The public model is downloaded once. Note text and generated vectors stay
              in Castle&apos;s private local cache.
            </p>
          )}
        </article>
      ) : null}

      <div className="knowledge-diagnostics-grid">
        <article className="knowledge-insights-panel">
          <header>
            <div>
              <span>Private shadow evaluation</span>
              <h2>Search agreement</h2>
            </div>
            <small>Memory only</small>
          </header>
          <dl className="knowledge-diagnostic-list">
            <Diagnostic label="Comparisons" value={formatNumber(search.comparisonCount)} />
            <Diagnostic
              label="First-result agreement"
              value={formatPercent(searchSummary.firstResultAgreement)}
            />
            <Diagnostic
              label="Mean overlap at 10"
              value={formatDecimal(searchSummary.meanOverlapAtTen)}
            />
            <Diagnostic
              label="Mean rank displacement"
              value={formatDecimal(searchSummary.meanRankDisplacement)}
            />
            <Diagnostic
              label="Backend failures"
              value={formatNumber(
                search.desktopFailureCount + search.browserFailureCount,
              )}
            />
          </dl>
          <p className="knowledge-privacy-note">
            Query text, result IDs, note titles, and excerpts are not retained.
          </p>
        </article>

        <article className="knowledge-insights-panel">
          <header>
            <div>
              <span>Operational audit</span>
              <h2>AI requests</h2>
            </div>
            <small>{audit ? `${audit.entries.length} retained` : "Unavailable"}</small>
          </header>
          {audit && audit.entries.length > 0 ? (
            <ol className="knowledge-audit-list">
              {audit.entries.slice(0, 8).map((entry) => (
                <li key={`${entry.requestId}:${entry.startedAt}`}>
                  <span className={`is-${entry.outcome}`}>{entry.outcome}</span>
                  <strong>{entry.providerName ?? "Retrieving context"}</strong>
                  <small>
                    {entry.sourceCount} sources · {entry.toolCallCount} tool calls ·{" "}
                    {formatNumber(entry.responseCharacters)} chars
                    {entry.durationMilliseconds === null
                      ? ""
                      : ` · ${entry.durationMilliseconds} ms`}
                  </small>
                  <small>{entry.toolNames.map(humanize).join(", ") || "No tools"}</small>
                  <em>
                    {entry.externalTransmission === null
                      ? "Pending"
                      : entry.externalTransmission
                        ? "External"
                        : "Local"}
                  </em>
                </li>
              ))}
            </ol>
          ) : (
            <p className="knowledge-insights-empty">No AI operations this session.</p>
          )}
          <footer>
            <p className="knowledge-privacy-note">
              Prompts, responses, citations, paths, and note IDs are never logged.
            </p>
            <button
              disabled={
                !audit ||
                !audit.entries.some((entry) => entry.outcome !== "active")
              }
              onClick={() => void clearAudit()}
              type="button"
            >
              Clear session audit
            </button>
          </footer>
        </article>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="knowledge-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatDecimal(value: number | null) {
  return value === null ? "—" : value.toFixed(1);
}

function humanize(value: string) {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function shortGeneration(value: string) {
  return value.length > 20 ? `${value.slice(0, 20)}…` : value;
}

function shortModelName(model: string) {
  return model.split("/").at(-1) ?? model;
}
