import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketToday } from '../../src/ideas/idea-a/market-today';
import type { MarketTodayData } from '../../src/ideas/idea-a/market-daily-types';
import '../../src/app/styles.css';
import '../../src/ideas/idea-a/market-design.css';
import { dailyFixture, dailyFixtureImage } from './market-daily-data';

function Fixture() {
  const [data, setData] = useState<MarketTodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selection, setSelection] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/market-today-fixture/snapshot', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Could not load trends.');
      setData(await response.json());
    }).catch(() => {
      if (!controller.signal.aborted) setError('Could not load trends.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);
  return (
    <main>
      <output aria-label="Trend selection">{selection}</output>
      <MarketToday data={data} loading={loading} error={error} locale="en" resolveImage={dailyFixtureImage}
        onRetry={() => { setError(undefined); setLoading(true); setAttempt(attempt + 1); }}
        onTrendSelect={(slug, tab) => setSelection(`${slug}:${tab}`)}
        dailyJob={{ run: async (signal, onStatus) => {
          onStatus('running');
          const response = await fetch('/market-today-fixture/job', { method: 'POST', signal });
          if (!response.ok) throw new Error('Could not update trends.');
          setData({ ...dailyFixture, run: { ...dailyFixture.run!, trend_date: '2026-11-22' } });
          onStatus('published');
        } }} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
