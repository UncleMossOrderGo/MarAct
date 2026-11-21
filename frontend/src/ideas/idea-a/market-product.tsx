import { useId, useState } from 'react';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { marketplaceListingImage } from './marketplace-fruit-images';
import './market-product.css';

export type MarketProductFruit = {
  id: string;
  name_en: string;
  name_th: string;
  tags: readonly string[];
};

export type MarketProductListing = {
  id: string;
  seller: { id: string; name: string; area?: string; rating?: number | string | null };
  price_per_kg_thb: string;
  stock_kg: number;
  active: boolean;
};

export type MarketProductCartItem = {
  listing_id: string;
  qty_kg: number;
  fruit_name: string;
  seller_name: string;
  price_per_kg_thb: string;
  stock_kg: number;
  image_url?: string;
};

type MarketProductProps = {
  fruit: MarketProductFruit;
  listings: readonly MarketProductListing[];
  suggestedKg: number;
  trendName?: string | null;
  onAdd: (item: MarketProductCartItem) => void;
  onBack: () => void;
};

function limitFor(listing: MarketProductListing) {
  return listing.active ? Math.max(0, Math.min(500, Math.floor(listing.stock_kg))) : 0;
}

function AddOffer({ listing, suggestedKg, onAdd }: {
  listing: MarketProductListing;
  suggestedKg: number;
  onAdd: (quantity: number) => void;
}) {
  const id = useId();
  const max = limitFor(listing);
  const initial = Math.min(max, Math.max(1, suggestedKg));
  const [quantity, setQuantity] = useState(String(initial));
  const amount = Number(quantity);
  const valid = /^\d+$/.test(quantity) && Number.isInteger(amount) && amount >= 1 && amount <= max;

  return (
    <form className="market-product-purchase" onSubmit={(event) => {
      event.preventDefault();
      if (valid) onAdd(amount);
    }}>
      <label htmlFor={id}>Quantity (kg)</label>
      <div className="market-quantity-stepper">
        <button type="button" aria-label="Decrease quantity" disabled={valid && amount <= 1}
          onClick={() => setQuantity(String(valid ? amount - 1 : 1))}>−</button>
        <input id={id} type="number" inputMode="numeric" min={1} max={max} step={1}
          value={quantity} required aria-invalid={!valid} aria-describedby={`${id}-limit`}
          onChange={(event) => setQuantity(event.currentTarget.value)} />
        <button type="button" aria-label="Increase quantity" disabled={valid && amount >= max}
          onClick={() => setQuantity(String(valid ? amount + 1 : 1))}>+</button>
      </div>
      <p id={`${id}-limit`}>Enter a whole number from 1 to {max} kg.</p>
      <button className="market-product-add" disabled={!valid}>
        <ShoppingCart size={20} aria-hidden="true" />
        Add to cart
      </button>
    </form>
  );
}

function ProductDetail({ fruit, listings, suggestedKg, trendName, onAdd, onBack }: MarketProductProps) {
  const [sellerId, setSellerId] = useState('');
  const [added, setAdded] = useState('');
  const offers = listings.slice(0, 2);
  const available = offers.filter((offer) => limitFor(offer) > 0);
  const seller = available.find(({ id }) => id === sellerId) ?? available[0];
  const imageUrl = marketplaceListingImage(fruit, seller?.id ?? offers[0]?.id);

  return (
    <section aria-label="Product detail" className="market-product">
      <button className="market-product-back" type="button" onClick={onBack}>
        <ArrowLeft size={20} aria-hidden="true" />
        Back to marketplace
      </button>
      <div className="market-product-layout">
        {imageUrl && <img className="market-product-image" src={imageUrl} alt={fruit.name_en} />}
        <div>
          <h1>{fruit.name_en}</h1>
          {fruit.name_th && <p lang="th">{fruit.name_th}</p>}
          {trendName && <p className="market-product-trend">{trendName}</p>}
          {fruit.tags.length > 0 && <p>{fruit.tags.join(', ')}</p>}
          <fieldset className="market-product-offers">
            <legend>Choose a seller</legend>
            {offers.map((offer) => {
              const inStock = limitFor(offer) > 0;
              return (
                <label className="market-product-offer" key={offer.id}>
                  <input type="radio" name="market-seller" checked={seller?.id === offer.id}
                    disabled={!inStock} onChange={() => { setSellerId(offer.id); setAdded(''); }} />
                  <span>
                    <strong>{offer.seller.name}</strong>
                    {offer.seller.area && <small>{offer.seller.area}</small>}
                  </span>
                  <span>
                    <strong>฿{offer.price_per_kg_thb} / kg</strong>
                    <small>{inStock ? `${offer.stock_kg} kg in stock` : 'Unavailable'}</small>
                  </span>
                </label>
              );
            })}
            {!seller && <p>No offers available.</p>}
          </fieldset>
          {seller && <AddOffer key={seller.id} listing={seller} suggestedKg={suggestedKg} onAdd={(qty) => {
            onAdd({
              listing_id: seller.id,
              qty_kg: qty,
              fruit_name: fruit.name_en,
              seller_name: seller.seller.name,
              price_per_kg_thb: seller.price_per_kg_thb,
              stock_kg: seller.stock_kg,
              image_url: imageUrl,
            });
            setAdded('Cart updated.');
          }} />}
          <p className="market-product-status" role="status">{added}</p>
        </div>
      </div>
    </section>
  );
}

export function MarketProduct(props: MarketProductProps) {
  return <ProductDetail key={props.fruit.id} {...props} />;
}
