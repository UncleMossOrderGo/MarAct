import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { MarketCart, useMarketCart, type MarketCartItem, type MarketCartLine } from '../../src/ideas/idea-a/market-cart';

const mango: MarketCartItem = {
  listing_id: 'mango-1',
  fruit_name: 'Mango',
  seller_name: 'Tropical Farm',
  price_per_kg_thb: '12.50',
  qty_kg: 2,
  stock_kg: 4,
};

function CartFixture() {
  const [shop, setShop] = useState('smoothie');
  const [open, setOpen] = useState(false);
  const [checkout, setCheckout] = useState<MarketCartLine[]>();
  const cart = useMarketCart(shop);

  return (
    <>
      <label>
        Active shop
        <select value={shop} onChange={(event) => setShop(event.currentTarget.value)}>
          <option value="smoothie">Smoothie Café</option>
          <option value="bakery">Bakery</option>
        </select>
      </label>
      <button type="button" onClick={() => cart.add(mango)}>Add mango</button>
      <button type="button" onClick={() => cart.addAll([
        { ...mango, trend_slug: 'dessert', trend_label: 'Mango pudding' },
        { ...mango, trend_slug: 'drink', trend_label: 'Mango smoothie', qty_kg: 3 },
      ])}>Add attributed mango</button>
      <button type="button" onClick={() => setOpen(true)}>Open cart</button>
      <button type="button" onClick={() => cart.clearShop('smoothie')}>Clear Smoothie Café cart</button>
      <output aria-label="Checkout payload">{JSON.stringify(checkout)}</output>
      {open && (
        <MarketCart
          items={cart.items}
          onQuantityChange={cart.setQuantity}
          onRemove={cart.remove}
          onClose={() => setOpen(false)}
          onCheckout={(lines) => {
            setCheckout(lines);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<CartFixture />);
