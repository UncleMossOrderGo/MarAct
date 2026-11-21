import { useEffect, useId, useRef, useState } from 'react';

import './market-cart.css';

export type MarketCartLine = {
  listing_id: string;
  qty_kg: number;
  trend_slug?: string | null;
};

export type MarketItemName =
  | { ingredient_name: string; fruit_name?: string }
  | { fruit_name: string; ingredient_name?: string };

export function marketItemName(item: MarketItemName) {
  return item.ingredient_name ?? item.fruit_name;
}

export type MarketCartItem = MarketCartLine & MarketItemName & {
  trend_label?: string | null;
  seller_name: string;
  price_per_kg_thb: string;
  stock_kg: number;
  image_url?: string;
};

const cartStorageKey = 'maract.idea-a.carts';
const emptyCart: readonly MarketCartItem[] = [];
const currency = new Intl.NumberFormat('en-TH', {
  style: 'currency',
  currency: 'THB',
  currencyDisplay: 'narrowSymbol',
});

export function marketLineKey(listingId: string, trendSlug?: string | null) {
  return JSON.stringify([listingId, trendSlug ?? null]);
}

export function orderLines(items: readonly MarketCartLine[]): MarketCartLine[] {
  return items.map(({ listing_id, qty_kg, trend_slug }) => ({
    listing_id,
    qty_kg,
    ...(trend_slug ? { trend_slug } : {}),
  }));
}

function maxQuantity(item: MarketCartItem, lines: readonly MarketCartItem[]) {
  const reserved = lines.reduce((quantity, line) =>
    line.listing_id === item.listing_id && (line.trend_slug ?? null) !== (item.trend_slug ?? null)
      ? quantity + line.qty_kg
      : quantity, 0);
  return Math.min(500, Math.max(0, item.stock_kg - reserved));
}

function readCarts(): ReadonlyMap<string, readonly MarketCartItem[]> {
  try {
    return new Map(JSON.parse(localStorage.getItem(cartStorageKey) ?? '[]'));
  } catch {
    return new Map();
  }
}

export function useMarketCart(shopId: string | null) {
  const [shops, setShops] = useState(readCarts);
  const items = shopId === null ? emptyCart : shops.get(shopId) ?? emptyCart;

  useEffect(() => {
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify([...shops]));
    } catch {
      // Cart state remains usable when browser storage is unavailable.
    }
  }, [shops]);

  function updateShop(id: string, updateItems: (current: readonly MarketCartItem[]) => readonly MarketCartItem[]) {
    setShops((current) => {
      const previous = current.get(id) ?? emptyCart;
      const next = updateItems(previous);
      if (next === previous) return current;
      const updated = new Map(current);
      if (next.length > 0) updated.set(id, next);
      else updated.delete(id);
      return updated;
    });
  }

  function add(item: MarketCartItem) {
    addAll([item]);
  }

  function addAll(lines: readonly MarketCartItem[]) {
    if (shopId === null) return;
    updateShop(shopId, (current) => lines.reduce((cart, item) => {
      if (!Number.isInteger(item.qty_kg) || item.qty_kg <= 0) return cart;
      const key = marketLineKey(item.listing_id, item.trend_slug);
      const isSameLine = (line: MarketCartItem) => marketLineKey(line.listing_id, line.trend_slug) === key;
      const existing = cart.find(isSameLine);
      const qty_kg = Math.min((existing?.qty_kg ?? 0) + item.qty_kg, maxQuantity(item, cart));
      if (!qty_kg) return cart;
      const next = { ...item, qty_kg };
      const updateStock = (line: MarketCartItem) =>
        line.listing_id === item.listing_id ? { ...line, stock_kg: item.stock_kg } : line;
      return existing
        ? cart.map((line) => isSameLine(line) ? next : updateStock(line))
        : [...cart.map(updateStock), next];
    }, current));
  }

  function setQuantity(listingId: string, quantity: number, trendSlug?: string | null) {
    if (shopId === null || !Number.isInteger(quantity) || quantity < 1) return;
    const key = marketLineKey(listingId, trendSlug);
    updateShop(shopId, (current) => current.map((item) =>
      marketLineKey(item.listing_id, item.trend_slug) === key && quantity <= maxQuantity(item, current)
        ? { ...item, qty_kg: quantity }
        : item,
    ));
  }

  function remove(listingId: string, trendSlug?: string | null) {
    if (shopId === null) return;
    const key = marketLineKey(listingId, trendSlug);
    updateShop(shopId, (current) => current.filter((line) => marketLineKey(line.listing_id, line.trend_slug) !== key));
  }

  function clearShop(placedShopId: string) {
    updateShop(placedShopId, () => emptyCart);
  }

  return { items, add, addAll, setQuantity, remove, clearShop, checkoutItems: orderLines(items) };
}

type MarketCartProps = {
  items: readonly MarketCartItem[];
  onQuantityChange: (listingId: string, quantity: number, trendSlug?: string | null) => void;
  onRemove: (listingId: string, trendSlug?: string | null) => void;
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
              <li key={marketLineKey(item.listing_id, item.trend_slug)} className="market-cart__item">
                {item.image_url && <img src={item.image_url} alt="" width={64} height={64} />}
                <div className="market-cart__description">
                  <h3>{marketItemName(item)}</h3>
                  <p>{item.seller_name}</p>
                  {item.trend_label && <p>{item.trend_label}</p>}
                  <div className="market-cart__controls">
                    <div className="market-cart__quantity">
                      <button
                        type="button"
                        aria-label={`Decrease ${marketItemName(item)} from ${item.seller_name} quantity`}
                        disabled={item.qty_kg <= 1}
                        onClick={() => onQuantityChange(item.listing_id, item.qty_kg - 1, item.trend_slug)}
                      >
                        −
                      </button>
                      <output aria-label={`${marketItemName(item)} from ${item.seller_name} quantity`}>{item.qty_kg} kg</output>
                      <button
                        type="button"
                        aria-label={`Increase ${marketItemName(item)} from ${item.seller_name} quantity`}
                        disabled={item.qty_kg >= maxQuantity(item, items)}
                        onClick={() => onQuantityChange(item.listing_id, item.qty_kg + 1, item.trend_slug)}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${marketItemName(item)} from ${item.seller_name}`}
                      onClick={() => onRemove(item.listing_id, item.trend_slug)}
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
          <footer className="market-cart__actions">
            <dl className="market-cart__total">
              <dt>Estimated subtotal</dt>
              <dd>{currency.format(subtotal / 100)}</dd>
            </dl>
            <button className="market-cart__checkout" type="button" onClick={() => onCheckout(orderLines(items))}>
              Continue to checkout
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
