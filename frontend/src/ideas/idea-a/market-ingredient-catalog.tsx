import { Search, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MarketProduct, type MarketProductCartItem } from './market-product';
import { marketplaceListingImage } from './marketplace-fruit-images';
import './market-ingredient-catalog.css';

export type MarketIngredientListing = {
  id: string;
  ingredient_id: string;
  name_en: string;
  name_th: string;
  category: string;
  unit: string;
  image_key?: string | null;
  stock_kg: number;
  price_per_kg_thb: string;
  seller_id: string;
  seller_name: string;
  seller_area?: string;
  active?: boolean;
};

type Locale = 'th' | 'en';
type ImageResolver = (key?: string | null) => string;
type Filters = { q?: string; category?: string };
type CatalogLoader = (filters: Filters, signal: AbortSignal) => Promise<readonly MarketIngredientListing[]>;

const categories = [
  ['all', 'All', 'ทั้งหมด'],
  ['fruit', 'Fruit', 'ผลไม้'],
  ['baking', 'Baking', 'เบเกอรี่'],
  ['dairy', 'Dairy', 'ผลิตภัณฑ์นม'],
  ['drink_base', 'Drink base', 'วัตถุดิบเครื่องดื่ม'],
  ['other', 'Other', 'อื่น ๆ'],
] as const;

const labels = {
  en: {
    title: 'Marketplace', search: 'Search ingredients', filters: 'Ingredient categories',
    load: 'Loading ingredients…', error: 'Could not load ingredients.', retry: 'Retry',
    empty: 'No ingredients found.', stock: 'kg in stock', unavailable: 'Out of stock',
    cart: 'Add to cart', added: 'Added to cart.', kg: 'kg',
  },
  th: {
    title: 'ตลาดวัตถุดิบ', search: 'ค้นหาวัตถุดิบ', filters: 'หมวดหมู่วัตถุดิบ',
    load: 'กำลังโหลดวัตถุดิบ…', error: 'โหลดวัตถุดิบไม่สำเร็จ', retry: 'ลองอีกครั้ง',
    empty: 'ไม่พบวัตถุดิบ', stock: 'กก. พร้อมขาย', unavailable: 'สินค้าหมด',
    cart: 'เพิ่มลงตะกร้า', added: 'เพิ่มลงตะกร้าแล้ว', kg: 'กก.',
  },
} as const;

function ingredientName(listing: MarketIngredientListing, locale: Locale) {
  return locale === 'th' ? listing.name_th || listing.name_en : listing.name_en || listing.name_th;
}

function listingImage(listing: MarketIngredientListing, imageFor?: ImageResolver) {
  return imageFor?.(listing.image_key ?? listing.ingredient_id)
    ?? marketplaceListingImage({ id: listing.ingredient_id, name_en: listing.name_en }, listing.id);
}

function inStock(listing: MarketIngredientListing) {
  return listing.active !== false && listing.stock_kg >= 1;
}

export function MarketIngredientCatalog({ locale = 'th', loadListings, onSelect, onAdd, imageFor }: {
  locale?: Locale;
  loadListings: CatalogLoader;
  onSelect: (ingredientId: string) => void;
  onAdd: (item: MarketProductCartItem) => void;
  imageFor?: ImageResolver;
}) {
  const copy = labels[locale];
  const [request, setRequest] = useState<Filters>({});
  const { q, category } = request;
  const [result, setResult] = useState<{
    request: Filters;
    listings?: readonly MarketIngredientListing[];
  }>();
  const [added, setAdded] = useState(false);
  const current = result?.request === request ? result : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void loadListings({ q: request.q?.trim() || undefined, category: request.category }, controller.signal)
      .then((listings) => {
        if (!controller.signal.aborted) setResult({ request, listings });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ request });
      });
    return () => controller.abort();
  }, [loadListings, request]);

  return (
    <section className="market-ingredient-catalog" aria-label={copy.title} lang={locale}>
      <h1>{copy.title}</h1>
      <label className="market-catalog-search">
        <Search size={20} aria-hidden="true" />
        <span>{copy.search}</span>
        <input type="search" value={q ?? ''} onChange={(event) => {
          setRequest({ q: event.currentTarget.value, category });
          setAdded(false);
        }} />
      </label>
      <div className="market-catalog-filters" role="group" aria-label={copy.filters}>
        {categories.map(([value, english, thai]) => (
          <button key={value} type="button" aria-pressed={(category ?? 'all') === value}
            onClick={() => {
              setRequest({ q, category: value === 'all' ? undefined : value });
              setAdded(false);
            }}>
            {locale === 'th' ? thai : english}
          </button>
        ))}
      </div>
      {!current && <p role="status">{copy.load}</p>}
      {current && !current.listings && (
        <>
          <p role="alert">{copy.error}</p>
          <button type="button" onClick={() => setRequest((current) => ({ ...current }))}>{copy.retry}</button>
        </>
      )}
      {current?.listings?.length === 0 && <p>{copy.empty}</p>}
      {!!current?.listings?.length && (
        <ul className="market-catalog-grid">
          {current.listings.map((listing) => {
            const name = ingredientName(listing, locale);
            const image = listingImage(listing, imageFor);
            const available = inStock(listing);
            return (
              <li key={listing.id}>
                <div className="market-catalog-photo">
                  {image && <img src={image} alt="" loading="lazy" />}
                </div>
                <div className="market-catalog-card">
                  <h2><button type="button" onClick={() => onSelect(listing.ingredient_id)}>{name}</button></h2>
                  <p>{listing.seller_name}</p>
                  <p>{available ? `${listing.stock_kg} ${copy.stock}` : copy.unavailable}</p>
                  <div className="market-catalog-card-action">
                    <strong>฿{listing.price_per_kg_thb} / {copy.kg}</strong>
                    <button type="button" aria-label={`${copy.cart}: ${name} (${listing.seller_name})`}
                      disabled={!available} onClick={() => {
                        onAdd({
                          listing_id: listing.id,
                          ingredient_id: listing.ingredient_id,
                          qty_kg: 1,
                          fruit_name: name,
                          seller_name: listing.seller_name,
                          price_per_kg_thb: listing.price_per_kg_thb,
                          stock_kg: listing.stock_kg,
                          image_url: image,
                        });
                        setAdded(true);
                      }}>
                      <ShoppingCart size={20} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {added && <p role="status">{copy.added}</p>}
    </section>
  );
}

export function MarketIngredientProduct({ listings, locale = 'th', onAdd, onBack, imageFor }: {
  listings: readonly MarketIngredientListing[];
  locale?: Locale;
  onAdd: (item: MarketProductCartItem) => void;
  onBack: () => void;
  imageFor?: ImageResolver;
}) {
  const first = listings[0];
  if (!first) return (
    <section lang={locale}>
      <p>{labels[locale].empty}</p>
      <button type="button" onClick={onBack}>{locale === 'th' ? 'กลับไปตลาด' : 'Back to marketplace'}</button>
    </section>
  );

  return (
    <MarketProduct
      fruit={{ id: first.ingredient_id, name_en: first.name_en, name_th: first.name_th, tags: [] }}
      listings={listings.map((listing) => ({
        id: listing.id,
        seller: { id: listing.seller_id, name: listing.seller_name, area: listing.seller_area },
        price_per_kg_thb: listing.price_per_kg_thb,
        stock_kg: listing.stock_kg,
        active: listing.active !== false,
        image_url: listingImage(listing, imageFor),
      }))}
      locale={locale}
      showAllOffers
      suggestedKg={1}
      onBack={onBack}
      onAdd={(item) => onAdd({ ...item, ingredient_id: first.ingredient_id })}
    />
  );
}
