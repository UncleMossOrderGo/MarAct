import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketShell, type MarketDestination } from '../../src/ideas/idea-a/market-shell';
import '../../src/app/styles.css';

const shops = [
  { id: 'smoothie', name: 'Smoothie Café', category: 'Drink shop', menu_tags: ['smoothie', 'tropical'] },
  { id: 'bakery', name: 'Bakery', category: 'Bakery', menu_tags: ['pastry'] },
  { id: 'cafe', name: 'Café', category: 'Café', menu_tags: [] },
];
const cartCounts: Record<string, number> = { smoothie: 2, bakery: 0, cafe: 1 };

function Fixture() {
  const [shopId, setShopId] = useState<string | null>(null);
  const [destination, setDestination] = useState<MarketDestination>('marketplace');
  const [cartOpenFor, setCartOpenFor] = useState<string | null>(null);
  return (
    <main>
      <MarketShell shops={shops} activeShopId={shopId} destination={destination}
        onShopChange={(id) => { setShopId(id); setDestination('marketplace'); setCartOpenFor(null); }}
        onNavigate={setDestination} onOpenCart={() => setCartOpenFor(shopId)} cartCount={cartCounts[shopId ?? ''] ?? 0}>
        {destination !== 'profile' && <h1>{destination}</h1>}
        {cartOpenFor && <p role="status">Cart opened for {cartOpenFor}</p>}
      </MarketShell>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
