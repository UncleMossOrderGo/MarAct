import { useEffect, useState } from 'react';
import { marketplaceListingImage } from './marketplace-fruit-images';
import './marketplace-feed.css';

export type MarketplaceFruit = {
  id: string;
  name_en: string;
  name_th: string;
  tags: string[];
};

type FeedListing = {
  id: string;
  seller: { id: string; name: string };
  price_per_kg_thb: string;
  stock_kg?: number;
};

export type MarketplaceFeedData = {
  feed_key: string;
  run_id: string | null;
  items: readonly {
    fruit: MarketplaceFruit;
    score: number;
    suggested_kg: number;
    trend_name?: string | null;
    listings: readonly FeedListing[];
    seller_count?: number;
    explanation: string;
    explanation_source: string;
  }[];
};

export type ExplanationUpdate = {
  fruit_id: string;
  explanation: string;
  explanation_source: string;
};

export type OpenExplanationStream = (
  request: { shopId: string; feedKey: string; locale: string },
  events: { onExplanation: (update: ExplanationUpdate) => void; onObsolete: () => void },
) => () => void;

type MarketplaceFeedProps = {
  shop: { id: string; name: string };
  feed: MarketplaceFeedData | null;
  loading?: boolean;
  error?: string;
  query?: string;
  locale?: string;
  onSelectFruit: (fruit: MarketplaceFruit) => void;
  openExplanations?: OpenExplanationStream;
  onObsolete?: () => void;
};

function FeedGrid({
  shop, feed, locale = 'en', query = '', onSelectFruit, openExplanations, onObsolete,
}: MarketplaceFeedProps & { feed: MarketplaceFeedData }) {
  const [updates, setUpdates] = useState<Record<string, ExplanationUpdate>>({});
  const shopId = shop.id;
  const feedKey = feed.feed_key;

  useEffect(() => {
    if (!openExplanations) return;

    let active = true;
    let close: (() => void) | undefined;
    try {
      close = openExplanations({ shopId, feedKey, locale }, {
        onExplanation(update) {
          if (!active) return;
          setUpdates((current) => ({ ...current, [update.fruit_id]: update }));
        },
        onObsolete() {
          if (active) onObsolete?.();
        },
      });
    } catch {
      // The templates from the feed remain available if the stream cannot open.
    }
    return () => {
      active = false;
      close?.();
    };
  }, [shopId, feedKey, locale, openExplanations, onObsolete]);

  if (!feed.items.length) return <p>No fruit recommendations yet.</p>;
  const search = query.trim().toLocaleLowerCase();
  const matches = feed.items
    .map((item, index) => ({ item, rank: index + 1 }))
    .filter(({ item: { fruit } }) =>
      fruit.name_en.toLocaleLowerCase().includes(search) || fruit.name_th.toLocaleLowerCase().includes(search),
    );
  if (!matches.length) return <p role="status">No fruit matches your search.</p>;

  return (
    <ol className="market-feed-grid" aria-label="Ranked fruit recommendations">
      {matches.map(({ item: { fruit, listings, seller_count, suggested_kg, trend_name, explanation }, rank }) => {
        const recommended = listings[0];
        const photo = marketplaceListingImage(fruit, recommended?.id);
        const sellers = seller_count ?? new Set(listings.map((listing) => listing.seller.id)).size;
        const update = updates[fruit.id];

        return (
          <li key={fruit.id} className="market-fruit-card">
            <div className="market-fruit-media">
              {photo && <img src={photo} alt={fruit.name_en} loading="lazy" />}
              <span className="market-fruit-rank" aria-label={`Rank ${rank}`}>#{rank}</span>
            </div>
            <div className="market-fruit-content">
              <h3><button type="button" onClick={() => onSelectFruit(fruit)}>{fruit.name_en}</button></h3>
              {fruit.name_th && <p lang="th" className="market-feed-muted">{fruit.name_th}</p>}
              {trend_name && <p className="market-trend-tag">{trend_name}</p>}
              {recommended && (
                <>
                  <p className="market-fruit-offer">
                    <strong>฿{recommended.price_per_kg_thb} / kg</strong> from {recommended.seller.name}
                  </p>
                  {recommended.stock_kg !== undefined && (
                    <p className="market-feed-muted">{recommended.stock_kg} kg in stock</p>
                  )}
                </>
              )}
              <p className="market-feed-muted">{sellers} {sellers === 1 ? 'seller' : 'sellers'}</p>
              <p className="market-fruit-suggestion">
                {suggested_kg > 0 ? `Suggested ${suggested_kg} kg` : 'No restock suggested'}
              </p>
              <p className="market-fruit-explanation">{update?.explanation ?? explanation}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function MarketplaceFeed(props: MarketplaceFeedProps) {
  const { shop, feed, loading, error, locale = 'en' } = props;

  return (
    <section className="market-feed" aria-label="Personalized marketplace">
      <h2>Recommended for {shop.name}</h2>
      {loading && <p role="status">Loading fruit recommendations…</p>}
      {error && <p role="alert">{error}</p>}
      {feed && <FeedGrid key={JSON.stringify([shop.id, feed.feed_key, locale])} {...props} feed={feed} />}
    </section>
  );
}
