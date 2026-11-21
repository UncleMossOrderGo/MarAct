import { useEffect, useId, useRef, useState } from 'react';

import './market-cart.css';

export type MarketCartLine = {
  listing_id: string;
  qty_kg: number;
};

export type MarketCartItem = MarketCartLine & {
  fruit_name: string;
  seller_name: string;
  price_per_kg_thb: string;
  stock_kg: number;
  image_url?: string;
};

const emptyCart: readonly MarketCartItem[] = [];
const currency = new Intl.NumberFormat('en-TH', {
  style: 'currency',
  currency: 'THB',
  currencyDisplay: 'narrowSymbol',
});

function maxQuantity(item: MarketCartItem) {
  return Math.min(500, item.stock_kg);
}

function validQuantity(quantity: number, item: MarketCartItem) {
  return Number.isInteger(quantity) && quantity > 0 && quantity <= maxQuantity(item);
}

function orderLines(items: readonly MarketCartItem[]): MarketCartLine[] {
  return items.map(({ listing_id, qty_kg }) => ({ listing_id, qty_kg }));
}

export function useMarketCart(shopId: string | null) {
  const [shops, setShops] = useState<ReadonlyMap<string, readonly MarketCartItem[]>>(() => new Map());
  const items = shopId === null ? emptyCart : shops.get(shopId) ?? emptyCart;

  function update(updateItems: (current: readonly MarketCartItem[]) => readonly MarketCartItem[]) {
    if (shopId === null) return;
    setShops((current) => {
      const previous = current.get(shopId) ?? emptyCart;
      const next = updateItems(previous);
      if (next === previous) return current;
      const updated = new Map(current);
      if (next.length > 0) updated.set(shopId, next);
      else updated.delete(shopId);
      return updated;
    });
  }

  function add(item: MarketCartItem) {
    if (!validQuantity(item.qty_kg, item)) return;
    update((current) => {
      const existing = current.find((line) => line.listing_id === item.listing_id);
      if (!existing) return [...current, item];
      const quantity = Math.min(existing.qty_kg + item.qty_kg, maxQuantity(item));
      return current.map((line) =>
        line.listing_id === item.listing_id ? { ...item, qty_kg: quantity } : line,
      );
    });
  }

  function setQuantity(listingId: string, quantity: number) {
    update((current) => {
      const item = current.find((line) => line.listing_id === listingId);
      if (!item || item.qty_kg === quantity || !validQuantity(quantity, item)) return current;
      return current.map((line) =>
        line.listing_id === listingId ? { ...line, qty_kg: quantity } : line,
      );
    });
  }

  function remove(listingId: string) {
    update((current) => current.filter((line) => line.listing_id !== listingId));
  }

  function clearShop(placedShopId: string) {
    setShops((current) => {
      if (!current.has(placedShopId)) return current;
      const updated = new Map(current);
      updated.delete(placedShopId);
      return updated;
    });
  }

  return { items, add, setQuantity, remove, clearShop, checkoutItems: orderLines(items) };
}

type MarketCartProps = {
  items: readonly MarketCartItem[];
  onQuantityChange: (listingId: string, quantity: number) => void;
  onRemove: (listingId: string) => void;
  onCheckout: (items: MarketCartLine[]) => void;
  onClose: () => void;
};

function priceInSatang(price: string) {
  return Math.round(Number(price) * 100);
}

export function MarketCart({ items, onQuantityChange, onRemove, onCheckout, onClose }: MarketCartProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const subtotal = items.reduce((total, item) => total + priceInSatang(item.price_per_kg_thb) * item.qty_kg, 0);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function closeCart() {
    dialogRef.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="market-cart"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        closeCart();
      }}
    >
      <div className="market-cart__header">
        <h2 id={titleId}>Your cart ({items.length})</h2>
        <button type="button" onClick={closeCart}>Close cart</button>
      </div>
      {items.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <>
          <ul className="market-cart__items">
            {items.map((item) => (
              <li key={item.listing_id} className="market-cart__item">
                {item.image_url && <img src={item.image_url} alt="" width={64} height={64} />}
                <div className="market-cart__description">
                  <h3>{item.fruit_name}</h3>
                  <p>{item.seller_name}</p>
                  <div className="market-cart__controls">
                    <div className="market-cart__quantity">
                      <button
                        type="button"
                        aria-label={`Decrease ${item.fruit_name} from ${item.seller_name} quantity`}
                        disabled={item.qty_kg <= 1}
                        onClick={() => onQuantityChange(item.listing_id, item.qty_kg - 1)}
                      >
                        −
                      </button>
                      <output aria-label={`${item.fruit_name} from ${item.seller_name} quantity`}>{item.qty_kg} kg</output>
                      <button
                        type="button"
                        aria-label={`Increase ${item.fruit_name} from ${item.seller_name} quantity`}
                        disabled={item.qty_kg >= maxQuantity(item)}
                        onClick={() => onQuantityChange(item.listing_id, item.qty_kg + 1)}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${item.fruit_name} from ${item.seller_name}`}
                      onClick={() => onRemove(item.listing_id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="market-cart__prices">
                  <p>{currency.format(Number(item.price_per_kg_thb))} / kg</p>
                  <strong>{currency.format(priceInSatang(item.price_per_kg_thb) * item.qty_kg / 100)}</strong>
                </div>
              </li>
            ))}
          </ul>
          <dl className="market-cart__total">
            <dt>Estimated subtotal</dt>
            <dd>{currency.format(subtotal / 100)}</dd>
          </dl>
          <button className="market-cart__checkout" type="button" onClick={() => onCheckout(orderLines(items))}>
            Continue to checkout
          </button>
        </>
      )}
    </dialog>
  );
}
