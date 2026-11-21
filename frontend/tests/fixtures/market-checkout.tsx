import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  MarketCheckout, MarketOrderConfirmation, MarketOrders, useMarketCheckoutAttempts,
  type MarketCheckoutLine, type SavedMarketOrder,
} from '../../src/ideas/idea-a/market-checkout';
import { requestJson } from '../../src/shared/http';

const initialLine: MarketCheckoutLine = {
  listing_id: 'mango-1',
  fruit_name: 'Mango',
  seller_name: 'Tropical Farm',
  qty_kg: 5,
  price_per_kg_thb: '3.00',
};

const ingredientLines: MarketCheckoutLine[] = [
  { listing_id: 'pistachio-sweeting', ingredient_name: 'Pistachio paste', seller_name: 'Sweetingred Co.', qty_kg: 2, price_per_kg_thb: '820.00' },
  { listing_id: 'cream-dairypro', ingredient_name: 'Whipping cream', seller_name: 'DairyPro', qty_kg: 5, price_per_kg_thb: '195.00' },
  { listing_id: 'milk-thaidairy', ingredient_name: 'Milk', seller_name: 'ThaiDairy', qty_kg: 10, price_per_kg_thb: '42.00' },
].map((line) => ({ ...line, trend_slug: 'pistachio-gelato', trend_label: 'Pistachio Gelato' }));
const withIngredients = new URLSearchParams(location.search).has('ingredients');

function CheckoutFixture() {
  const [shopId, setShopId] = useState('smoothie');
  const [carts, setCarts] = useState<Record<string, MarketCheckoutLine[]>>({
    smoothie: withIngredients ? ingredientLines : [initialLine],
    bakery: [{ ...initialLine, qty_kg: 2 }],
  });
  const [orders, setOrders] = useState<SavedMarketOrder[]>([]);
  const [saved, setSaved] = useState<SavedMarketOrder>();
  const [screen, setScreen] = useState<'cart' | 'checkout' | 'confirmed' | 'orders'>('checkout');
  const attempts = useMarketCheckoutAttempts();
  const lines = carts[shopId] ?? [];

  return (
    <main>
      <label>
        Active shop
        <select value={shopId} onChange={(event) => {
          setShopId(event.target.value);
          setScreen('checkout');
        }}>
          <option value="smoothie">Smoothie Café</option>
          <option value="bakery">Bakery</option>
        </select>
      </label>
      <button type="button" onClick={() => setScreen('orders')}>Open order history</button>
      {screen === 'cart' && (
        <>
          <button type="button" onClick={() => {
            attempts.invalidate(shopId);
            setCarts((previous) => ({
              ...previous,
              [shopId]: lines.map((line) => ({ ...line, qty_kg: 4 })),
            }));
          }}>Change to 4 kg</button>
          {withIngredients && (
            <button type="button" onClick={() => {
              setCarts((previous) => ({
                ...previous,
                [shopId]: lines.map((line) => line.listing_id === 'pistachio-sweeting' ? { ...line, qty_kg: 5 } : line),
              }));
            }}>Change pistachio to 5 kg</button>
          )}
          <button type="button" onClick={() => setScreen('checkout')}>Review order</button>
        </>
      )}
      {screen === 'checkout' && (
        <MarketCheckout
          shopId={shopId}
          lines={lines}
          attempts={attempts}
          onPlaceOrder={(request) => requestJson('/component-fixtures/place-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          })}
          onPlaced={(order) => {
            setCarts((previous) => ({ ...previous, [order.shop_id]: [] }));
            setOrders((previous) => [order, ...previous]);
            setSaved(order);
            setScreen('confirmed');
          }}
          onBack={() => setScreen('cart')}
        />
      )}
      {screen === 'confirmed' && saved && (
        <MarketOrderConfirmation order={saved} onViewOrders={() => setScreen('orders')}
          onBackToTrends={withIngredients ? () => setScreen('checkout') : undefined} />
      )}
      {screen === 'orders' && (
        <MarketOrders
          orders={orders.filter((order) => order.shop_id === shopId)}
          onSelectOrder={(order) => {
            setSaved(order);
            setScreen('confirmed');
          }}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<CheckoutFixture />);
