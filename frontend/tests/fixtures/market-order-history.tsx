import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SavedMarketOrder } from '../../src/features/shop/market-checkout';
import { MarketOrderDetails, MarketOrderHistory } from '../../src/features/shop/market-order-history';
import { MarketSettings } from '../../src/features/shop/market-settings';
import '../../src/app/styles.css';
import '../../src/features/shop/market-checkout.css';

const shop = { id: 'bakery-main', name: 'MarAct Bakery', category: 'bakery' };
const order: SavedMarketOrder = {
  id: 'order-1', shop_id: shop.id, created_at: '2026-11-21T02:00:00Z', status: 'placed', total_thb: '4100.00',
  items: [{
    listing_id: 'pistachio-sweeting', ingredient_id: 'pistachio-paste', ingredient_name: 'Pistachio paste',
    seller_name: 'Sweetingred Co.', qty_kg: 5, price_per_kg_thb: '820.00', line_total_thb: '4100.00',
    trend_slug: 'pistachio-gelato', trend_label: 'Pistachio Gelato',
  }],
};
const legacy: SavedMarketOrder = {
  ...order, id: 'order-2', total_thb: '78.00', created_at: '2026-11-20T02:00:00Z',
  items: [{
    listing_id: 'mango-orchard', fruit_id: 'mango', fruit_name: 'Mango',
    seller_name: 'Tropical Farm', qty_kg: 1, price_per_kg_thb: '78.00', line_total_thb: '78.00',
  }],
};
const orders = [order, legacy];

function Fixture() {
  const [run, setRun] = useState({ finished_at: '2026-11-21T00:05:00Z' });
  const [locale, setLocale] = useState<'th' | 'en'>(localStorage.getItem('settings-fixture-language') === 'en' ? 'en' : 'th');
  const [selected, setSelected] = useState<SavedMarketOrder>();

  return (
    <main>
      <button onClick={() => setRun({ finished_at: '2026-11-22T00:05:00Z' })}>New trend run</button>
      <MarketSettings shop={shop} orders={orders} run={run} locale={locale} onSelectOrder={setSelected}
        onLocaleChange={(next) => {
          localStorage.setItem('settings-fixture-language', next);
          setLocale(next);
        }} />
      <MarketOrderHistory orders={orders} locale={locale} onSelectOrder={setSelected} />
      {selected && <section className="market-checkout" aria-label="Selected order">
        <MarketOrderDetails order={selected} locale={locale} />
      </section>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
