import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketplaceFeed, type MarketplaceFeedData, type OpenExplanationStream } from '../../src/ideas/idea-a/marketplace-feed';
import { MarketplaceTrends, type MarketplaceTrendData } from '../../src/ideas/idea-a/marketplace-trends';

const shops = [{ id: 'cafe', name: 'Smoothie Café' }, { id: 'bakery', name: 'Bakery' }];
const streams: Parameters<OpenExplanationStream>[1][] = [];
const openStream: OpenExplanationStream = (_request, events) => {
  streams.push(events);
  return () => { document.documentElement.dataset.streamClosed = 'true'; };
};

const trends: MarketplaceTrendData = {
  run: { created_at: '2026-11-21T08:30:00Z', status: 'fallback', source: 'seed' },
  cards: [{
    fruit_id: 'mango',
    trend_name: 'Mango smoothies',
    rationale: 'Fresh mango drinks are popular.',
    related_menus: ['Mango shake'],
    confidence: 0.9,
    mention_count: 1,
    score: 0.8,
    sources: [
      { title: 'Read the source', url: 'https://example.com/mango' },
      { title: 'Invalid source', url: 'javascript:void(0)' },
    ],
  }],
};

function Fixture() {
  const [shopIndex, setShopIndex] = useState(0);
  const [selection, setSelection] = useState('');
  const [view, setView] = useState<'strip' | 'full'>('strip');
  const [refreshCount, setRefreshCount] = useState(0);
  const shop = shops[shopIndex];
  const fruit = { id: 'mango', name_en: 'Mango', name_th: 'มะม่วง', tags: ['smoothie'] };
  const feed: MarketplaceFeedData = {
    feed_key: `${shop.id}-key`,
    run_id: null,
    items: [{
      fruit,
      score: 0.85,
      suggested_kg: shopIndex ? 0 : 5,
      trend_name: 'Mango smoothies',
      listings: [
        { id: 'mango-1', seller: { id: 'farm', name: 'Tropical Farm' }, price_per_kg_thb: '72.00' },
        { id: 'mango-2', seller: { id: 'market', name: 'Sunrise Market' }, price_per_kg_thb: '75.00' },
      ],
      explanation: `Template for ${shop.name}`,
      explanation_source: 'template',
    }],
  };

  function emit(index: number, explanation: string) {
    streams[index]?.onExplanation({ fruit_id: 'mango', explanation, explanation_source: 'ai' });
  }

  async function refresh() {
    setRefreshCount((count) => count + 1);
    const response = await fetch('/marketplace-feed-fixture/trends/run', { method: 'POST' });
    if (!response.ok) throw new Error('Refresh failed');
  }

  return (
    <>
      <button onClick={() => setShopIndex(1)}>Switch shop</button>
      <button onClick={() => emit(0, 'Previous stream')}>Emit first stream</button>
      <button onClick={() => emit(streams.length - 1, 'Current stream')}>Emit latest stream</button>
      <output>{selection}</output>
      <output>Refreshes {refreshCount}</output>
      <MarketplaceTrends trends={trends} view={view} onRefresh={refresh} onViewTrends={() => setView('full')} />
      <MarketplaceFeed shop={shop} feed={feed} onSelectFruit={(fruit) => setSelection(fruit.id)}
        openExplanations={openStream} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
