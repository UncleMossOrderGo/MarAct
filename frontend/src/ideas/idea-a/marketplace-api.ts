import { requestJson } from '../../shared/http';
import type { MarketOrderRequest, SavedMarketOrder } from './market-checkout';
import type { ExplanationUpdate, OpenExplanationStream } from './marketplace-feed';

const base = '/api/ideas/idea-a';
const shopPath = (id: string) => `/shops/${encodeURIComponent(id)}`;

export type Shop = { id: string; name: string; category: string; menu_tags: string[] };
export type Fruit = { id: string; name_en: string; name_th: string; tags: string[] };
export type Seller = { id: string; name: string; area: string; rating: number };
export type Listing = {
  id: string;
  seller: Seller;
  fruit: Fruit;
  price_per_kg_thb: string;
  stock_kg: number;
  active: boolean;
};
export type TrendSource = { url: string; title: string };
export type TrendCard = {
  fruit_id: string;
  trend_name: string;
  rationale: string;
  related_menus: string[];
  confidence: number;
  mention_count: number;
  score: number;
  sources: TrendSource[];
};
export type TrendStatus = 'ok' | 'fallback' | 'error';
export type TrendRun = {
  id: string;
  started_at: string;
  finished_at: string;
  status: TrendStatus;
  source: string;
};
export type Trends = { run: TrendRun | null; cards: TrendCard[] };
export type FeedItem = {
  fruit: Fruit;
  score: number;
  suggested_kg: number;
  trend_name: string | null;
  listings: Listing[];
  explanation: string;
  explanation_source: string;
};
export type Feed = { feed_key: string; run_id: string | null; items: FeedItem[] };
export const marketplaceApi = {
  shops: (signal?: AbortSignal) => requestJson<{ shops: Shop[] }>(`${base}/shops`, { signal }),
  async trends(signal?: AbortSignal) {
    const { run, cards } = await requestJson<Trends>(`${base}/trends/latest`, { signal });
    return { run: run && { ...run, completed_at: run.finished_at }, cards };
  },
  refreshTrends: () => requestJson<{ run_id: string; status: TrendStatus }>(
    `${base}/trends/run`, { method: 'POST' },
  ),
  feed: (shopId: string, signal?: AbortSignal) =>
    requestJson<Feed>(`${base}${shopPath(shopId)}/feed`, { signal }),
  explanationsUrl: (shopId: string, feedKey: string, locale: string) =>
    `${base}${shopPath(shopId)}/feed/explanations?${new URLSearchParams({ feed_key: feedKey, locale })}`,
  checkout: (body: MarketOrderRequest) => requestJson<SavedMarketOrder>(`${base}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  orders: (shopId: string, signal?: AbortSignal) =>
    requestJson<{ orders: SavedMarketOrder[] }>(`${base}${shopPath(shopId)}/orders`, { signal }),
};

function isExplanation(value: unknown): value is ExplanationUpdate {
  return typeof value === 'object' && value !== null &&
    'fruit_id' in value && typeof value.fruit_id === 'string' &&
    'explanation' in value && typeof value.explanation === 'string' &&
    'explanation_source' in value && typeof value.explanation_source === 'string';
}

export const openMarketplaceExplanations: OpenExplanationStream = ({ shopId, feedKey, locale }, events) => {
  const controller = new AbortController();
  async function stream() {
    const response = await fetch(marketplaceApi.explanationsUrl(shopId, feedKey, locale), {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    if (response.status === 409 && !controller.signal.aborted) {
      events.onObsolete();
      return;
    }
    if (!response.ok || !response.body) return;

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      let buffer = '';
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const lines = frame.split(/\r?\n/);
          const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
          if (event === 'done' || controller.signal.aborted) return;
          if (event !== 'explanation') continue;
          const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          const update: unknown = JSON.parse(data);
          if (isExplanation(update)) events.onExplanation(update);
        }
      }
    } finally {
      await reader.cancel();
    }
  }

  void stream().catch(() => {
    // The initial feed already provides an explanation for every recommendation.
  });
  return () => controller.abort();
};
