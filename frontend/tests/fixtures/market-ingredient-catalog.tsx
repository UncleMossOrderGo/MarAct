import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { requestJson } from '../../src/shared/http';
import {
  MarketIngredientCatalog, MarketIngredientProduct, type MarketIngredientListing,
} from '../../src/features/shop/market-ingredient-catalog';
import type { MarketProductCartItem } from '../../src/features/shop/market-product';
import '../../src/app/styles.css';

async function loadListings(
  filters: { q?: string; category?: string; ingredient_id?: string },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const { listings } = await requestJson<{ listings: MarketIngredientListing[] }>(
    `/api/shop/listings?${params}`,
    { signal },
  );
  return listings;
}

function Fixture() {
  const locale = new URLSearchParams(location.search).get('locale') === 'th' ? 'th' : 'en';
  const [details, setDetails] = useState<MarketIngredientListing[]>();
  const [cartLine, setCartLine] = useState<MarketProductCartItem>();
  return (
    <main>
      {details ? (
        <MarketIngredientProduct listings={details} locale={locale} onAdd={setCartLine}
          onBack={() => setDetails(undefined)} />
      ) : (
        <MarketIngredientCatalog loadListings={loadListings} locale={locale} onAdd={setCartLine}
          onSelect={(ingredient_id) => void loadListings({ ingredient_id }).then(setDetails)} />
      )}
      <output aria-label="Cart payload">{cartLine && JSON.stringify(cartLine)}</output>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
