import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketShell, type MarketDestination } from '../../src/ideas/idea-a/market-shell';
import { MarketSkeleton } from '../../src/ideas/idea-a/market-skeleton';
import '../../src/app/styles.css';

const shops = [
  { id: 'smoothie', name: 'Smoothie Café', category: 'Drink shop', menu_tags: ['smoothie', 'tropical'] },
  { id: 'bakery', name: 'Bakery', category: 'Bakery', menu_tags: ['pastry'] },
  { id: 'cafe', name: 'Café', category: 'Café', menu_tags: [] },
];
const cartCounts: Record<string, number> = { smoothie: 2, bakery: 0, cafe: 1 };
const daily = new URLSearchParams(location.search).has('daily');

function Fixture() {
  const [shopId, setShopId] = useState<string | null>(null);
  const [destination, setDestination] = useState<MarketDestination>(daily ? 'today' : 'marketplace');
  const [cartOpenFor, setCartOpenFor] = useState<string | null>(null);
  return (
    <main>
      <MarketShell shops={shops} activeShopId={shopId} destination={destination}
        defaultShopId={daily ? 'bakery' : undefined} locale="en"
        onShopChange={(id) => { setShopId(id); setDestination(daily ? 'today' : 'marketplace'); setCartOpenFor(null); }}
        onNavigate={setDestination} onOpenCart={() => setCartOpenFor(shopId ?? (daily ? 'bakery' : null))}
        cartCount={cartCounts[shopId ?? ''] ?? 0}>
        {destination !== 'profile' && <h1>{destination}</h1>}
        {daily && destination === 'settings' && <MarketSkeleton label="Loading settings" />}
        {cartOpenFor && <p role="status">Cart opened for {cartOpenFor}</p>}
      </MarketShell>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
