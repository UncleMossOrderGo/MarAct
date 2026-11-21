import { requestJson } from '../../../shared/http';
import type { Language } from '../language';

const root = '/api/ideas/idea-b';

export type Sort = 'relevance' | 'lowest_product_price';
export type SearchInput = {
  buyer_id: string;
  fruit_query: string;
  quantity_kg?: string | null;
  delivery_by?: string | null;
  max_product_total_thb?: string | null;
  sort_by: Sort;
};

export type Product = {
  listing_id: string;
  fruit_id: string;
  farm_name: string;
  product_name: string;
  unit_price_thb: string;
  available_kg: number;
  minimum_order_kg: number;
  earliest_delivery: string;
  quantity_kg: string | null;
  estimated_product_total_thb: string | null;
  estimated_shipping_thb: string | null;
  reasons: string[];
  warnings: string[];
};

export type SearchResult = {
  items: Product[];
  sort_basis: 'lowest_product_price' | 'personalized_relevance';
  warnings: string[];
};

export type Cart = {
  line_items: Product[];
  product_subtotal_thb: string;
  shipping_total_thb: string | null;
  within_product_budget: boolean | null;
  remaining_product_budget_thb: string | null;
  unfulfilled_items: { item: { fruit_query: string; quantity_kg: string }; reason: string }[];
  warnings: string[];
};

export type Chat = {
  message: string;
  products: Product[];
  suggested_cart: Cart | null;
  warnings: string[];
  assumptions: string[];
  source: 'deterministic' | 'openai';
  conversation_id: string;
  search_context: SearchInput | null;
  trend_opportunities: Opportunity[];
  tool_calls: { name: string; status: 'completed' | 'error'; fruit_id?: string }[];
};

export type Opportunity = {
  fruit_id: string;
  fruit_name: string;
  signal_type: string;
  direction: 'rising' | 'steady' | 'falling' | 'insufficient_data';
  value: number | null;
  source_name: string;
  observation_window: string;
  comparison_window: string;
  observed_at: string;
  buyer_fit_reasons: string[];
  matching_listing_ids: string[];
  caveat: string;
  market_context?: MarketContext | null;
};

export type MarketContext = {
  status: 'available' | 'unavailable' | 'insufficient_evidence';
  summary: string | null;
  searched_at: string | null;
  citations: { title: string; url: string }[];
};

function post<T>(path: string, lang: Language, body: unknown) {
  return requestJson<T>(`${root}/${path}?lang=${lang}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

export const findProducts = (request: SearchInput, lang: Language) => post<SearchResult>('recommendations', lang, request);
export const askCopilot = (
  buyer: string, message: string, conversation: string | null, prior: SearchInput | null, lang: Language,
) => post<Chat>('copilot/chat', lang, { buyer_id: buyer, message, conversation_id: conversation, previous_search: prior });

export function previewItem(buyer: string, fruit: string, quantity: string, lang: Language, budget?: string | null) {
  return post<Cart>('smart-cart/preview', lang, {
    buyer_id: buyer, items: [{ fruit_query: fruit, quantity_kg: quantity }], budget_thb: budget || null,
  });
}

export const loadOpportunities = (buyer: string, lang: Language) =>
  requestJson<{ opportunities: Opportunity[] }>(`${root}/trends/opportunities?buyer_id=${encodeURIComponent(buyer)}&lang=${lang}`);

export const loadMarket = (fruit: string, lang: Language) =>
  requestJson<{ market_context: MarketContext }>(`${root}/trends?fruit=${encodeURIComponent(fruit)}&lang=${lang}&web_search=true`);
