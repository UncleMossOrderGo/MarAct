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
  image_url?: string;
};

export type MarketProductCartItem = {
  listing_id: string;
  ingredient_id?: string;
  qty_kg: number;
  fruit_name: string;
  seller_name: string;
  price_per_kg_thb: string;
  stock_kg: number;
  image_url?: string;
};

const productCopy = {
  en: {
    detail: 'Product detail', back: 'Back to marketplace', seller: 'Choose a seller',
    quantity: 'Quantity (kg)', decrease: 'Decrease quantity', increase: 'Increase quantity',
    range: (max: number) => `Enter a whole number from 1 to ${max} kg.`,
    cart: 'Add to cart', added: 'Cart updated.', kg: 'kg', stock: 'kg in stock',
    unavailable: 'Unavailable', noOffers: 'No offers available.',
  },
  th: {
    detail: 'รายละเอียดวัตถุดิบ', back: 'กลับไปตลาด', seller: 'เลือกผู้ขาย',
    quantity: 'จำนวน (กก.)', decrease: 'ลดจำนวน', increase: 'เพิ่มจำนวน',
    range: (max: number) => `กรอกจำนวนเต็มตั้งแต่ 1 ถึง ${max} กก.`,
    cart: 'เพิ่มลงตะกร้า', added: 'อัปเดตตะกร้าแล้ว', kg: 'กก.', stock: 'กก. พร้อมขาย',
    unavailable: 'สินค้าหมด', noOffers: 'ไม่มีสินค้าพร้อมขาย',
  },
} as const;

type ProductLocale = keyof typeof productCopy;

type MarketProductProps = {
  fruit: MarketProductFruit;
  listings: readonly MarketProductListing[];
  suggestedKg: number;
  locale?: ProductLocale;
  showAllOffers?: boolean;
  trendName?: string | null;
  onAdd: (item: MarketProductCartItem) => void;
  onBack: () => void;
};

function limitFor(listing: MarketProductListing) {
  return listing.active ? Math.max(0, Math.min(500, Math.floor(listing.stock_kg))) : 0;
}

function AddOffer({ listing, suggestedKg, copy, onAdd }: {
  listing: MarketProductListing;
  suggestedKg: number;
  copy: typeof productCopy[ProductLocale];
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
      <label htmlFor={id}>{copy.quantity}</label>
      <div className="market-quantity-stepper">
        <button type="button" aria-label={copy.decrease} disabled={valid && amount <= 1}
          onClick={() => setQuantity(String(valid ? amount - 1 : 1))}>−</button>
        <input id={id} type="number" inputMode="numeric" min={1} max={max} step={1}
          value={quantity} required aria-invalid={!valid} aria-describedby={`${id}-limit`}
          onChange={(event) => setQuantity(event.currentTarget.value)} />
        <button type="button" aria-label={copy.increase} disabled={valid && amount >= max}
          onClick={() => setQuantity(String(valid ? amount + 1 : 1))}>+</button>
      </div>
      <p id={`${id}-limit`}>{copy.range(max)}</p>
      <button className="market-product-add" disabled={!valid}>
        <ShoppingCart size={20} aria-hidden="true" />
        {copy.cart}
      </button>
    </form>
  );
}

function ProductDetail({
  fruit, listings, suggestedKg, locale = 'en', showAllOffers = false, trendName, onAdd, onBack,
}: MarketProductProps) {
  const copy = productCopy[locale];
  const title = locale === 'th' ? fruit.name_th || fruit.name_en : fruit.name_en || fruit.name_th;
  const alternateTitle = locale === 'th' ? fruit.name_en : fruit.name_th;
  const radioName = useId();
  const [sellerId, setSellerId] = useState('');
  const [added, setAdded] = useState('');
  const offers = showAllOffers ? listings : listings.slice(0, 2);
  const available = offers.filter((offer) => limitFor(offer) > 0);
  const seller = available.find(({ id }) => id === sellerId) ?? available[0];
  const displayedOffer = seller ?? offers[0];
  const imageUrl = displayedOffer?.image_url ?? marketplaceListingImage(fruit, displayedOffer?.id);

  return (
    <section aria-label={copy.detail} className="market-product" lang={locale}>
      <button className="market-product-back" type="button" onClick={onBack}>
        <ArrowLeft size={20} aria-hidden="true" />
        {copy.back}
      </button>
      <div className="market-product-layout">
        {imageUrl && <img className="market-product-image" src={imageUrl} alt={title} />}
        <div>
          <h1>{title}</h1>
          {alternateTitle && alternateTitle !== title && <p lang={locale === 'th' ? 'en' : 'th'}>{alternateTitle}</p>}
          {trendName && <p className="market-product-trend">{trendName}</p>}
          {fruit.tags.length > 0 && <p>{fruit.tags.join(', ')}</p>}
          <fieldset className="market-product-offers">
            <legend>{copy.seller}</legend>
            {offers.map((offer) => {
              const inStock = limitFor(offer) > 0;
              return (
                <label className="market-product-offer" key={offer.id}>
                  <input type="radio" name={radioName} checked={seller?.id === offer.id}
                    disabled={!inStock} onChange={() => { setSellerId(offer.id); setAdded(''); }} />
                  <span>
                    <strong>{offer.seller.name}</strong>
                    {offer.seller.area && <small>{offer.seller.area}</small>}
                  </span>
                  <span>
                    <strong>฿{offer.price_per_kg_thb} / {copy.kg}</strong>
                    <small>{inStock ? `${offer.stock_kg} ${copy.stock}` : copy.unavailable}</small>
                  </span>
                </label>
              );
            })}
            {!seller && <p>{copy.noOffers}</p>}
          </fieldset>
          {seller && <AddOffer key={seller.id} listing={seller} suggestedKg={suggestedKg} copy={copy} onAdd={(qty) => {
            onAdd({
              listing_id: seller.id,
              qty_kg: qty,
              fruit_name: title,
              seller_name: seller.seller.name,
              price_per_kg_thb: seller.price_per_kg_thb,
              stock_kg: seller.stock_kg,
              image_url: imageUrl,
            });
            setAdded(copy.added);
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
