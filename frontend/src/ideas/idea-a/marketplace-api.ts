import { requestJson } from '../../shared/http';
import type { MarketOrderRequest, SavedMarketOrder } from './market-checkout';
import type { MarketIngredientListing } from './market-ingredient-catalog';
import type { DailyLocale, DailyRun, DailyShop, MarketTodayData } from './market-daily-types';

const base = '/api/ideas/idea-a';
const shopPath = (id: string) => `/shops/${encodeURIComponent(id)}`;

type CatalogOffer = Omit<MarketIngredientListing, 'name_en' | 'name_th' | 'category' | 'unit' | 'image_key'> & {
  ingredient: Pick<MarketIngredientListing, 'name_en' | 'name_th' | 'category' | 'unit' | 'image_key'>;
};
export type JobAttempt = {
  attempt_id: string;
  state: 'running' | 'published' | 'error';
  error?: string | null;
};
export type JobStatus = {
  attempt: JobAttempt | null;
  latest_usable: DailyRun | null;
  demo_enabled: boolean;
};
export const dailyMarketplaceApi = {
  shops: (signal?: AbortSignal) =>
    requestJson<{ shops: DailyShop[]; default_shop_id: string | null }>(`${base}/shops`, { signal }),
  today: (shopId: string, locale: DailyLocale, signal?: AbortSignal) =>
    requestJson<MarketTodayData>(`${base}${shopPath(shopId)}/today?${new URLSearchParams({ locale })}`, { signal }),
  async listings(filters: { ingredient_id?: string; q?: string; category?: string }, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (filters.ingredient_id) query.set('ingredient_id', filters.ingredient_id);
    if (filters.q) query.set('q', filters.q);
    if (filters.category) query.set('category', filters.category);
    const { listings } = await requestJson<{ listings: CatalogOffer[] }>(`${base}/listings?${query}`, { signal });
    return listings.map(({ ingredient, ...offer }) => ({ ...offer, ...ingredient }));
  },
  trigger: (signal?: AbortSignal) =>
    requestJson<JobAttempt>(`${base}/jobs/daily-trend/demo`, { method: 'POST', signal }),
  jobStatus: (signal?: AbortSignal) =>
    requestJson<JobStatus>(`${base}/jobs/daily-trend/latest`, { signal }),
  checkout: (body: MarketOrderRequest) => requestJson<SavedMarketOrder>(`${base}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  orders: (shopId: string, signal?: AbortSignal) =>
    requestJson<{ orders: SavedMarketOrder[] }>(`${base}${shopPath(shopId)}/orders`, { signal }),
};


export async function waitForDailyPublication(
  signal: AbortSignal, onStatus: (state: 'running' | 'published') => void,
) {
  const accepted = await dailyMarketplaceApi.trigger(signal);
  let attempt: JobAttempt | null = accepted;
  while (true) {
    signal.throwIfAborted();
    if (attempt?.attempt_id === accepted.attempt_id) {
      if (attempt.state === 'published') {
        onStatus('published');
        return;
      }
      if (attempt.state === 'error') throw new Error(attempt.error ?? 'Publication failed.');
    }
    onStatus('running');
    await delay(signal);
    attempt = (await dailyMarketplaceApi.jobStatus(signal)).attempt;
  }
}

function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 1000);
    function abort() {
      window.clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
