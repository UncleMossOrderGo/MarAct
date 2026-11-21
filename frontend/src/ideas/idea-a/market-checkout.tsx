import { useRef, useState } from 'react';

import { HttpError } from '../../shared/http';
import { marketItemName, marketLineKey, orderLines, type MarketCartLine, type MarketItemName } from './market-cart';
import { marketplaceMascot } from './market-brand';
import { marketplaceListingImage } from './marketplace-fruit-images';
import './market-checkout.css';

export type MarketCheckoutLine = MarketCartLine & MarketItemName & {
  seller_name: string;
  price_per_kg_thb: string;
  trend_label?: string | null;
  image_url?: string;
};

export type MarketOrderRequest = {
  shop_id: string;
  idempotency_key: string;
  items: MarketCartLine[];
};

export type SavedMarketOrder = {
  id: string;
  shop_id: string;
  status: string;
  total_thb: string;
  created_at: string;
  items: readonly (MarketCheckoutLine & {
    ingredient_id?: string;
    fruit_id?: string;
    line_total_thb: string;
  })[];
};

type CheckoutAttempt = {
  signature: string;
  key: string;
};

type MarketCheckoutAttempts = ReturnType<typeof useMarketCheckoutAttempts>;

export function useMarketCheckoutAttempts() {
  const [attempts] = useState(() => {
    const byShop = new Map<string, CheckoutAttempt>();
    return {
      keyFor(shopId: string, signature: string) {
        const previous = byShop.get(shopId);
        if (previous?.signature === signature) return previous.key;
        const key = crypto.randomUUID();
        byShop.set(shopId, { signature, key });
        return key;
      },
      complete(shopId: string, key: string) {
        if (byShop.get(shopId)?.key === key) byShop.delete(shopId);
      },
      invalidate(shopId: string) {
        byShop.delete(shopId);
      },
    };
  });
  return attempts;
}

const currency = new Intl.NumberFormat('en-TH', {
  style: 'currency',
  currency: 'THB',
  currencyDisplay: 'narrowSymbol',
});
const bangkokOrderDate = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Bangkok',
});

function amountLabel(amount: string | number) {
  return currency.format(Number(amount));
}

function checkoutError(error: unknown) {
  if (!(error instanceof HttpError)) return 'Could not place the order. Try again.';
  const { detail, status } = error;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (status === 422) {
    if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
      return detail.message;
    }
    return 'An offer may have changed. Review the cart and adjust quantities to the available stock.';
  }
  if (status === 409) return 'This checkout could not be replayed. Return to the cart and review the order.';
  return 'Could not place the order. Try again.';
}

type MarketCheckoutProps = {
  shopId: string;
  lines: readonly MarketCheckoutLine[];
  attempts: MarketCheckoutAttempts;
  onPlaceOrder: (request: MarketOrderRequest) => Promise<SavedMarketOrder>;
  onPlaced: (order: SavedMarketOrder) => void;
  onBack: () => void;
};

export function MarketCheckout(props: MarketCheckoutProps) {
  const items = orderLines(props.lines).sort((a, b) =>
    marketLineKey(a.listing_id, a.trend_slug).localeCompare(marketLineKey(b.listing_id, b.trend_slug)),
  );
  const signature = JSON.stringify(items);
  return (
    <CheckoutSummary
      key={JSON.stringify([props.shopId, signature])}
      {...props}
      items={items}
      signature={signature}
    />
  );
}

function CheckoutSummary({
  shopId, lines, attempts, items, signature, onPlaceOrder, onPlaced, onBack,
}: MarketCheckoutProps & { items: MarketCartLine[]; signature: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const [saved, setSaved] = useState<SavedMarketOrder>();
  const totalCents = lines.reduce(
    (sum, line) => sum + Math.round(Number(line.price_per_kg_thb) * 100) * line.qty_kg,
    0,
  );

  async function placeOrder() {
    if (submitting.current || items.length === 0 || saved) return;
    submitting.current = true;
    setPending(true);
    setError('');
    let order: SavedMarketOrder;
    try {
      const key = attempts.keyFor(shopId, signature);
      order = await onPlaceOrder({ shop_id: shopId, idempotency_key: key, items });
      if (order.shop_id !== shopId) throw new Error('Order shop mismatch');
      attempts.complete(shopId, key);
      setSaved(order);
    } catch (failure) {
      setError(checkoutError(failure));
      return;
    } finally {
      submitting.current = false;
      setPending(false);
    }
    onPlaced(order);
  }

  return (
    <section className="market-checkout" aria-label="Checkout">
      <button className="market-checkout-back" type="button" onClick={onBack} disabled={pending}>
        Back to cart
      </button>
      <h1>Place order</h1>
      <div className="market-order-panel">
        <h2>Order summary</h2>
        {lines.length === 0 ? <p>Your cart is empty.</p> : (
          <ul className="market-order-items">
            {lines.map((line) => (
              <li key={marketLineKey(line.listing_id, line.trend_slug)}>
                {line.image_url && <img src={line.image_url} alt="" width={56} height={56} />}
                <div>
                  <strong>{marketItemName(line)}</strong>
                  <span>{line.seller_name}</span>
                  {line.trend_label && <span>{line.trend_label}</span>}
                  <span>{line.qty_kg} kg × {amountLabel(line.price_per_kg_thb)} / kg</span>
                </div>
                <span>{amountLabel(Number(line.price_per_kg_thb) * line.qty_kg)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="market-checkout-error" role="alert">{error}</p>}
      <div className="market-checkout-submit">
        <p className="market-order-total">
          <span>{saved ? 'Total' : 'Estimated total'}</span>
          <strong>{amountLabel(saved?.total_thb ?? totalCents / 100)}</strong>
        </p>
        <button
          className="market-checkout-action"
          type="button"
          onClick={placeOrder}
          disabled={pending || items.length === 0 || Boolean(saved)}
        >
          {pending ? 'Placing order…' : 'Place order'}
        </button>
        {saved && <p role="status">Order placed.</p>}
      </div>
    </section>
  );
}

function orderStatus(status: string) {
  return status === 'placed' ? 'Placed' : status;
}

function OrderDetails({ order }: { order: SavedMarketOrder }) {
  return (
    <>
      <div className="market-order-heading">
        <h2>Order {order.id}</h2>
        <time dateTime={order.created_at}>{bangkokOrderDate.format(new Date(order.created_at))}</time>
        <span className="market-order-status">{orderStatus(order.status)}</span>
      </div>
      <ul className="market-order-items">
        {order.items.map((item) => {
          const image = item.image_url ?? marketplaceListingImage({
            id: item.ingredient_id ?? item.fruit_id ?? '', name_en: marketItemName(item) ?? '',
          }, item.listing_id);
          return (
            <li key={marketLineKey(item.listing_id, item.trend_slug)}>
              {image && <img src={image} alt="" width={56} height={56} />}
              <div>
                <strong>{marketItemName(item)}</strong>
                <span>{item.seller_name}</span>
                {item.trend_label && <span>{item.trend_label}</span>}
                <span>{item.qty_kg} kg × {amountLabel(item.price_per_kg_thb)} / kg</span>
              </div>
              <span>{amountLabel(item.line_total_thb)}</span>
            </li>
          );
        })}
      </ul>
      <p className="market-order-total">
        <span>Total</span>
        <strong>{amountLabel(order.total_thb)}</strong>
      </p>
    </>
  );
}

export function MarketOrderConfirmation({
  order, onViewOrders, onKeepShopping, onBackToTrends,
}: { order: SavedMarketOrder; onViewOrders: () => void; onKeepShopping?: () => void; onBackToTrends?: () => void }) {
  return (
    <section className="market-checkout" aria-label="Order confirmation">
      <div className="market-order-confirmation-title">
        {(onKeepShopping || onBackToTrends) && <img src={marketplaceMascot} alt="" width={104} height={104} />}
        <h1>Order saved</h1>
      </div>
      <article className="market-order-panel"><OrderDetails order={order} /></article>
      <button className="market-checkout-action" type="button" onClick={onViewOrders}>View orders</button>
      {(onBackToTrends || onKeepShopping) && (
        <button className="market-checkout-back" type="button" onClick={onBackToTrends ?? onKeepShopping}>
          {onBackToTrends ? 'Back to Trends' : 'Keep shopping'}
        </button>
      )}
    </section>
  );
}

export function MarketOrders({
  orders, loading, error, onRetry, onSelectOrder,
}: {
  orders: readonly SavedMarketOrder[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onSelectOrder: (order: SavedMarketOrder) => void;
}) {
  return (
    <section className="market-checkout" aria-label="Order history">
      <h1>Orders</h1>
      {loading && <p role="status">Loading orders…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          {onRetry && <button type="button" onClick={onRetry}>Retry loading orders</button>}
        </div>
      )}
      {!loading && !error && orders.length === 0 && <p>No orders for this shop yet.</p>}
      {orders.map((order) => (
        <article key={order.id} className="market-order-panel">
          <OrderDetails order={order} />
          <button type="button" onClick={() => onSelectOrder(order)}>View order {order.id}</button>
        </article>
      ))}
    </section>
  );
}
