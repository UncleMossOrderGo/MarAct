import type { Page } from '@playwright/test';
import { featuredIngredientCopy } from './ingredient-copy';

const bakery = { id: 'bakery-main', name: 'MarAct Bakery', category: 'bakery' };
const cafe = { id: 'cafe-main', name: 'MarAct Café', category: 'cafe' };
const trendSlug = 'pistachio-gelato';
const run = {
  id: 'review-run', trend_date: '2026-11-21', started_at: '2026-11-20T23:00:00Z',
  finished_at: '2026-11-20T23:01:00Z', status: 'fallback', source: 'seed',
};
const offers = [
  { id: 'pistachio-sweeting', ingredient_id: 'pistachio-paste', seller_id: 'sweeting', seller_name: 'Sweetingred Co.', price_per_kg_thb: '820.00', stock_kg: 25, category: 'baking', unit: 'kg', qty: 2 },
  { id: 'cream-dairypro', ingredient_id: 'whipping-cream', seller_id: 'dairypro', seller_name: 'DairyPro', price_per_kg_thb: '195.00', stock_kg: 30, category: 'dairy', unit: 'kg', qty: 5 },
  { id: 'milk-thaidairy', ingredient_id: 'milk', seller_id: 'thaidairy', seller_name: 'ThaiDairy', price_per_kg_thb: '42.00', stock_kg: 50, category: 'dairy', unit: 'kg', qty: 10 },
];
const listings = offers.map((offer, index) => ({
  ...offer, image_key: offer.ingredient_id,
  name_en: featuredIngredientCopy.en.ingredients[index], name_th: featuredIngredientCopy.th.ingredients[index],
}));
const order = {
  id: 'review-order', shop_id: bakery.id, total_thb: '5495.00', created_at: run.finished_at, status: 'placed',
  items: offers.map((offer, index) => ({
    listing_id: offer.id, ingredient_id: offer.ingredient_id,
    ingredient_name: featuredIngredientCopy.en.ingredients[index], seller_name: offer.seller_name,
    qty_kg: index === 0 ? 5 : offer.qty, price_per_kg_thb: offer.price_per_kg_thb,
    line_total_thb: ['4100.00', '975.00', '420.00'][index], trend_slug: trendSlug, trend_label: 'Pistachio Gelato',
  })),
};

export async function installDailyUxFixture(page: Page) {
  let snapshot = run;
  let attempt: { attempt_id: string; state: string } | null = null;
  let statusReads = 0;
  let todayFailure = false;
  let todayEmpty = false;
  let checkoutFailure = false;
  let releaseToday: (() => void) | undefined;
  let delayedToday: Promise<void> | undefined;
  await page.clock.setFixedTime(new Date('2026-11-21T06:00:00+07:00'));
  await page.route('**/api/shop/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/shop', '');
    const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'th';
    const copy = featuredIngredientCopy[locale];
    if (path === '/shops') return route.fulfill({ json: { default_shop_id: bakery.id, shops: [bakery, cafe] } });
    if (/\/shops\/[^/]+\/today$/.test(path) || path === '/trends/today') {
      if (delayedToday) await delayedToday;
      if (todayFailure) return route.fulfill({ status: 503 });
      if (todayEmpty) return route.fulfill({ json: { shop: bakery, run: null, trends: [] } });
      const trends = [{
        slug: trendSlug, name: copy.title, kind: 'menu', momentum: 'rising', is_new: true,
        why_rising: locale === 'en'
          ? 'The demo source highlights pistachio gelato as a bakery menu idea.'
          : 'แหล่งข้อมูลตัวอย่างแนะนำเจลาโตพิสตาชิโอสำหรับเมนูเบเกอรี',
        why_fit: copy.reason, menu_idea: copy.menu, image_key: trendSlug,
        sources: [{ title: 'Fixture source', url: 'https://example.com/pistachio', published_at: '2026-11-19' }],
        ingredients: [
          ...offers.map((offer, index) => ({
            name: copy.ingredients[index], ingredient_id: offer.ingredient_id,
            suggested_kg: offer.qty, availability: 'available',
            listings: index === 0
              ? [offer, { ...offer, id: 'pistachio-bakemate', seller_id: 'bakemate', seller_name: 'BakeMate',
                price_per_kg_thb: '870.00', stock_kg: 20 }]
              : [offer],
          })),
          { name: copy.ingredients[3], ingredient_id: null, suggested_kg: 0, availability: 'unmatched', listings: [] },
        ],
      }, ...['strawberry-shortcake', 'mango-smoothie'].map((slug) => ({
        slug, name: slug === 'strawberry-shortcake' ? 'Strawberry Shortcake' : 'Mango Smoothie',
        kind: 'menu', momentum: 'rising', is_new: false, why_rising: copy.reason, why_fit: copy.reason,
        menu_idea: copy.menu, image_key: slug, sources: [], ingredients: [],
      }))];
      return route.fulfill({ json: { shop: path.includes(cafe.id) ? cafe : bakery, run: snapshot, trends } });
    }
    if (path === '/listings') return route.fulfill({ json: { listings } });
    if (path === '/jobs/daily-trend/demo') {
      statusReads = 0;
      attempt = { attempt_id: 'review-refresh', state: 'running' };
      return route.fulfill({ status: 202, json: attempt });
    }
    if (path === '/jobs/daily-trend/latest') {
      if (attempt?.state === 'running' && ++statusReads === 2) {
        attempt = { ...attempt, state: 'published' };
        snapshot = { ...run, id: attempt.attempt_id };
      }
      return route.fulfill({ json: { attempt, latest_usable: snapshot, demo_enabled: true } });
    }
    if (path === '/orders' && route.request().method() === 'POST') {
      if (checkoutFailure) return route.fulfill({ status: 422, json: { detail: 'Only 4 kg remain. Reduce the quantity.' } });
      const body = route.request().postDataJSON();
      if (!body.items.some(({ listing_id, qty_kg, trend_slug }: { listing_id: string; qty_kg: number; trend_slug: string }) =>
        listing_id === 'pistachio-sweeting' && qty_kg === 5 && trend_slug === trendSlug)) {
        return route.fulfill({ status: 422, json: { detail: 'Missing the 5 kg trend-attributed item.' } });
      }
      return route.fulfill({ status: 201, json: order });
    }
    if (path.endsWith('/orders')) return route.fulfill({ json: { orders: [order] } });
    if (path === '/orders/review-order') return route.fulfill({ json: order });
    return route.fulfill({ status: 404 });
  });
  return {
    failToday(value: boolean) { todayFailure = value; },
    emptyToday() { todayEmpty = true; },
    failCheckout(value: boolean) { checkoutFailure = value; },
    delayToday() {
      delayedToday = new Promise<void>((resolve) => { releaseToday = resolve; });
      return () => { releaseToday?.(); delayedToday = undefined; };
    },
  };
}
