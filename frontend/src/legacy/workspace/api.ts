import { requestJson } from '../../shared/http';
import type { Language } from './language';

const base = '/api/ideas/idea-b';

export type Fruit = 'mango' | 'pineapple';
export type ExplanationSource = 'deterministic' | 'openai';
export type Preferences = {
  price_weight: number;
  quality_weight: number;
  reliability_weight: number;
  relationship_weight: number;
};

export type Order = {
  buyer_id: string;
  fruit: Fruit;
  quantity_kg: string;
  delivery_by: string;
  max_total_thb: string | null;
  preferences: Preferences;
};

export type Farm = {
  farm_id: string;
  farm_name: string;
  unit_price_thb: number;
  subtotal_thb: number;
  estimated_shipping_thb: number | null;
  estimated_fees_thb: number | null;
  total_cost_thb: number | null;
  availability: { min_order_kg: number; stock_kg: number; earliest_delivery: string };
  familiar: boolean;
  score: number;
  reasons: string[];
  tradeoffs: string[];
  provenance: string;
  missing_fields: string[];
};

export type Recommendations = {
  data_status: 'demo';
  options: Farm[];
  explanation: string;
  explanation_source: ExplanationSource;
};

type TrendPeriod = { start: string; end: string };
export type TrendSignal = {
  metric: 'search_interest' | 'social_mentions';
  current_value: number | null;
  previous_value: number | null;
  week_over_week_pct: number | null;
  source_id: string;
};

export type FruitTrend = {
  fruit: Fruit;
  observed_period: TrendPeriod;
  comparison_period: TrendPeriod;
  signals: TrendSignal[];
  score: number | null;
  trend_label: 'rising' | 'steady' | 'falling' | 'insufficient_data';
  sources: {
    source_id: string;
    name: string;
    collected_at: string;
    geographic_scope: string;
    metric_definition: string;
  }[];
  data_status: 'demo' | 'observed';
  explanation: string;
  explanation_source: ExplanationSource;
  limitations: string[];
};

export type OrderDraft = {
  fruit: Fruit | null;
  quantity_kg: string | null;
  delivery_by: string | null;
  max_total_thb: string | null;
  preferences: Record<keyof Preferences, string | null>;
  unsupported_constraints: string[];
};

export type Interpretation = { source: ExplanationSource; draft: OrderDraft | null; message: string };

export function getRecommendations(order: Order, lang: Language, signal: AbortSignal, explain = false) {
  return requestJson<Recommendations>(`${base}/recommendations?lang=${lang}${explain ? '&explain=true' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
    signal,
  });
}

export function getTrend(fruit: Fruit, lang: Language, signal: AbortSignal, explain = false) {
  return requestJson<FruitTrend>(`${base}/trends?fruit=${fruit}&lang=${lang}${explain ? '&explain=true' : ''}`, { signal });
}

export function interpretBrief(brief: string, lang: Language, signal: AbortSignal) {
  return requestJson<Interpretation>(`${base}/agent/interpret?lang=${lang}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: brief }),
    signal,
  });
}
