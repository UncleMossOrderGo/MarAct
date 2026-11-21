import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketProduct, type MarketProductCartItem } from '../../src/features/shop/market-product';
import '../../src/app/styles.css';

const fruit = { id: 'mango', name_en: 'Mango', name_th: 'มะม่วง', tags: ['tropical', 'smoothie'] };
const firstOffer = {
  id: 'tropical', seller: { id: 'seller-a', name: 'Tropical Farm', area: 'Bangkok' },
  price_per_kg_thb: '45.00', stock_kg: 600, active: true,
};
const secondOffer = {
  id: 'mango-market', seller: { id: 'seller-b', name: 'Sunrise Fruits' },
  price_per_kg_thb: '52.00', stock_kg: 3, active: true,
};
const unavailable = new URLSearchParams(location.search).has('unavailable');
const offers = [
  unavailable ? { ...firstOffer, active: false } : firstOffer,
  unavailable ? { ...secondOffer, stock_kg: 0 } : secondOffer,
  { ...secondOffer, id: 'hidden', seller: { id: 'seller-c', name: 'Third Seller' } },
];

function Fixture() {
  const [productOpen, setProductOpen] = useState(true);
  const [item, setItem] = useState<MarketProductCartItem>();
  return (
    <main>
      {productOpen ? (
        <MarketProduct fruit={fruit} listings={offers} suggestedKg={0} trendName="Mango smoothies"
          onAdd={setItem} onBack={() => setProductOpen(false)} />
      ) : <h1>Marketplace</h1>}
      <output aria-label="Cart handoff">{item ? JSON.stringify(item) : ''}</output>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
