import type { MarketTodayData } from '../../src/ideas/idea-a/market-daily-types';

export const dailyFixture: MarketTodayData = {
  shop: { id: 'bakery-main', name: 'MarAct Bakery', category: 'bakery' },
  run: {
    id: 'run-1', trend_date: '2026-11-21', started_at: '2026-11-21T06:00:00+07:00',
    finished_at: '2026-11-21T06:00:04+07:00', status: 'ok', source: 'seed',
  },
  trends: [
    {
      slug: 'pistachio-gelato', name: 'Pistachio Gelato', kind: 'dessert', momentum: 'rising', is_new: true,
      why_rising: 'Pistachio desserts are appearing on more bakery menus.',
      why_fit: 'Pistachio works in chilled bakery desserts.',
      menu_idea: 'Pistachio Gelato Cake', image_key: 'pistachio-gelato',
      sources: [{ url: 'https://example.com/pistachio', title: 'Dessert menu report', published_at: '2026-11-19' }],
      ingredients: [
        {
          name: 'Pistachio Paste', ingredient_id: 'pistachio-paste', suggested_kg: 2, availability: 'available',
          listings: [
            { id: 'pistachio-sweeting', seller_id: 'sweeting', seller_name: 'Sweetingred Co.', price_per_kg_thb: '820.00', stock_kg: 25 },
            { id: 'pistachio-bakemate', seller_id: 'bakemate', seller_name: 'BakeMate', price_per_kg_thb: '870.00', stock_kg: 20 },
          ],
        },
        {
          name: 'Whipping Cream', ingredient_id: 'whipping-cream', suggested_kg: 5, availability: 'available',
          listings: [{ id: 'cream-dairypro', seller_id: 'dairypro', seller_name: 'DairyPro', price_per_kg_thb: '195.00', stock_kg: 30 }],
        },
        {
          name: 'Milk', ingredient_id: 'milk', suggested_kg: 10, availability: 'available',
          listings: [{ id: 'milk-thaidairy', seller_id: 'thaidairy', seller_name: 'ThaiDairy', price_per_kg_thb: '42.00', stock_kg: 50 }],
        },
        { name: 'Kataifi topping', ingredient_id: null, suggested_kg: 0, availability: 'unmatched', listings: [] },
      ],
    },
    {
      slug: 'strawberry-shortcake', name: 'Strawberry Shortcake', kind: 'dessert', momentum: 'peak', is_new: false,
      why_rising: 'A familiar bakery dessert.', why_fit: 'Fits bakery menus.', menu_idea: 'Strawberry shortcake',
      image_key: 'strawberry-shortcake', sources: [], ingredients: [],
    },
    {
      slug: 'mango-smoothie', name: 'Mango Smoothie', kind: 'drink', momentum: 'rising', is_new: false,
      why_rising: 'Mango is appearing on drink menus.', why_fit: 'Fits seasonal menus.', menu_idea: 'Mango smoothie',
      image_key: 'mango-smoothie', sources: [], ingredients: [],
    },
  ],
};

export { trendImage as dailyFixtureImage } from '../../src/ideas/idea-a/market-ingredient-assets';
