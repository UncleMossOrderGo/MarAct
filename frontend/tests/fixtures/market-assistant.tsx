import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketAssistantPanel } from '../../src/ideas/idea-a/market-assistant';
import { marketItemName } from '../../src/ideas/idea-a/market-cart';

function Fixture() {
  const [cart, setCart] = useState('');
  return <>
    <p role="status">{cart}</p>
    <MarketAssistantPanel shopId="bakery-main" locale="en" page="trend" focused={{ type: 'trend', id: 'gelato' }}
      onAdd={(item) => setCart(`${item.qty_kg} kg ${marketItemName(item)}`)} />
  </>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
