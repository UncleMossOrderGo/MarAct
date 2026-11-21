import { useRef, useState } from 'react';
import './marketplace-feed.css';

type TrendCard = {
  fruit_id: string;
  trend_name: string;
  rationale: string;
  related_menus: readonly string[];
  confidence: number;
  mention_count: number;
  score: number;
  sources: readonly { url: string; title: string }[];
};

export type MarketplaceTrendData = {
  run: {
    started_at?: string;
    completed_at?: string | null;
    created_at?: string;
    status: string;
    source: string;
  } | null;
  cards: readonly TrendCard[];
};

type MarketplaceTrendsProps = {
  trends: MarketplaceTrendData | null;
  view?: 'strip' | 'full';
  cached?: boolean;
  loading?: boolean;
  error?: string;
  onRefresh: () => Promise<void>;
  onViewTrends?: () => void;
};

const bangkokTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Bangkok',
});

function sourceHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    return undefined;
  }
}

export function MarketplaceTrends({
  trends, view = 'strip', cached = false, loading = false, error, onRefresh, onViewTrends,
}: MarketplaceTrendsProps) {
  const refreshing = useRef(false);
  const [pending, setPending] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const run = trends?.run;
  const timestamp = run?.completed_at ?? run?.created_at ?? run?.started_at;
  const runTime = timestamp ? new Date(timestamp) : undefined;
  const isCached = cached || run?.source === 'seed' || run?.status === 'fallback';
  const cards = view === 'strip' ? trends?.cards.slice(0, 3) : trends?.cards;

  async function refresh() {
    if (refreshing.current || loading) return;
    refreshing.current = true;
    setPending(true);
    setRefreshError(false);
    try {
      await onRefresh();
    } catch {
      setRefreshError(true);
    } finally {
      refreshing.current = false;
      setPending(false);
    }
  }

  return (
    <section className="market-trends" aria-label="Web & social buzz">
      <div className="market-trend-header">
        <h2>Web &amp; social buzz</h2>
        <button type="button" disabled={loading || pending} onClick={refresh}>Run trend check</button>
      </div>
      <div className="market-trend-meta">
        {runTime && timestamp && Number.isFinite(runTime.getTime()) && (
          <p>Last run <time dateTime={timestamp}>{bangkokTime.format(runTime)} Bangkok time</time></p>
        )}
        {run && <span className="market-trend-tag">{isCached ? 'Showing cached trends' : 'Live trends'}</span>}
      </div>
      {(loading || pending) && <p role="status">{pending ? 'Checking trends…' : 'Loading trends…'}</p>}
      {(error || refreshError) && <p role="alert">{error ?? 'Could not refresh trends. Try again.'}</p>}
      {!loading && !pending && !error && !refreshError && !cards?.length && <p>No trends are available yet.</p>}
      {!!cards?.length && (
        <ul className={`market-trend-cards market-trend-cards--${view}`}>
          {cards.map((card) => (
            <li key={card.fruit_id}>
              <h3>{card.trend_name}</h3>
              <p>{card.rationale}</p>
              {view === 'full' && card.related_menus.length > 0 && (
                <p className="market-feed-muted">Menu ideas · {card.related_menus.join(', ')}</p>
              )}
              {view === 'full' && (
                <p className="market-feed-muted">{card.mention_count} {card.mention_count === 1 ? 'source' : 'sources'}</p>
              )}
              <div className="market-trend-sources">
                {card.sources.map(({ title, url }) => {
                  const href = sourceHref(url);
                  return href && <a key={href} href={href}>{title}</a>;
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      {view === 'strip' && onViewTrends && <button type="button" onClick={onViewTrends}>View all trends</button>}
    </section>
  );
}
