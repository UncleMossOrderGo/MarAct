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

function CheckoutFixture() {
  const [shopId, setShopId] = useState('smoothie');
  const [carts, setCarts] = useState<Record<string, MarketCheckoutLine[]>>({
    smoothie: [initialLine],
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
        <MarketOrderConfirmation order={saved} onViewOrders={() => setScreen('orders')} />
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
