export type DailyLocale = 'th' | 'en';

export type DailyShop = { id: string; name: string; category: 'bakery' | 'cafe' | 'juice_shop' };

export type DailyRun = {
  id: string;
  trend_date: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  source: string;
};

export type DailyListing = {
  id: string;
  seller_id: string;
  seller_name: string;
  price_per_kg_thb: string;
  stock_kg: number;
};

export type DailyIngredient = {
  name_th?: string | null;
  name: string;
  ingredient_id: string | null;
  suggested_kg: number;
  availability: string;
  listings: readonly DailyListing[];
  image_key?: string | null;
};

export type DailyTrend = {
  slug: string;
  name: string;
  kind: string;
  momentum: 'rising' | 'peak' | 'fading';
  is_new: boolean;
  why_rising: string;
  why_fit: string;
  menu_idea: string;
  image_key: string | null;
  sources: readonly { url: string; title: string; published_at?: string | null }[];
  ingredients: readonly DailyIngredient[];
};

export type MarketTodayData = { shop: DailyShop; run: DailyRun | null; trends: readonly DailyTrend[] };
export type MarketTrendTab = 'overview' | 'ingredients';
export type DailyImageResolver = (key?: string | null) => string;

export function eligibleListings(ingredient: DailyIngredient) {
  return ingredient.ingredient_id ? ingredient.listings.filter(({ stock_kg }) => stock_kg >= 1) : [];
}
