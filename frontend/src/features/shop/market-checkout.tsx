import { useRef, useState } from 'react';

import { HttpError } from '../../shared/http';
import { marketItemName, marketLineKey, orderLines, type MarketCartLine, type MarketItemName } from './market-cart';
import { marketplaceMascot } from './market-brand';
import { MarketOrderDetails, marketOrderAmount as amountLabel } from './market-order-history';
import './market-checkout.css';

export { MarketOrders } from './market-order-history';

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
  seller_id?: string | null;
  seller_name?: string | null;
  checkout_group_id?: string | null;
  payment_ref?: string | null;
  paid_at?: string | null;
  confirmed_at?: string | null;
  orders?: SavedMarketOrder[] | null;
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

const checkoutCopy = {
  en: {
    checkout: 'Checkout', backCart: 'Back to cart', place: 'Place order', placing: 'Placing order…',
    summary: 'Order summary', empty: 'Your cart is empty.', total: 'Total', estimate: 'Estimated total',
    kilogram: 'kg', placed: 'Order placed.', confirmation: 'Order confirmation', saved: 'Order saved',
    view: 'View orders', trends: 'Back to Trends', keepShopping: 'Keep shopping',
    failed: 'Could not place the order. Try again.',
    stock: 'An offer may have changed. Review the cart and adjust quantities to the available stock.',
    replay: 'This checkout could not be replayed. Return to the cart and review the order.',
  },
  th: {
    checkout: 'ตรวจสอบคำสั่งซื้อ', backCart: 'กลับไปยังตะกร้า', place: 'สั่งซื้อ', placing: 'กำลังสั่งซื้อ…',
    summary: 'สรุปคำสั่งซื้อ', empty: 'ตะกร้าของคุณยังว่าง', total: 'ยอดรวม', estimate: 'ยอดรวมโดยประมาณ',
    kilogram: 'กก.', placed: 'สั่งซื้อสำเร็จ', confirmation: 'ยืนยันคำสั่งซื้อ', saved: 'บันทึกคำสั่งซื้อแล้ว',
    view: 'ดูคำสั่งซื้อ', trends: 'กลับไปยังเทรนด์', keepShopping: 'เลือกซื้อสินค้าต่อ',
    failed: 'ไม่สามารถสั่งซื้อได้ ลองอีกครั้ง',
    stock: 'สินค้าอาจมีการเปลี่ยนแปลง ตรวจสอบจำนวนที่มีในสต็อกและปรับจำนวนในตะกร้า',
    replay: 'ไม่สามารถส่งคำสั่งซื้อนี้ซ้ำได้ กลับไปตรวจสอบตะกร้า',
  },
};

type Locale = keyof typeof checkoutCopy;

function checkoutError(error: unknown, copy: (typeof checkoutCopy)[Locale]) {
  if (!(error instanceof HttpError)) return copy.failed;
  const { detail, status } = error;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (status === 422) {
    if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
      return detail.message;
    }
    return copy.stock;
  }
  if (status === 409) return copy.replay;
  return copy.failed;
}

type MarketCheckoutProps = {
  locale?: Locale;
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
  locale = 'en', shopId, lines, attempts, items, signature, onPlaceOrder, onPlaced, onBack,
}: MarketCheckoutProps & { items: MarketCartLine[]; signature: string }) {
  const copy = checkoutCopy[locale];
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
      setError(checkoutError(failure, copy));
      return;
    } finally {
      submitting.current = false;
      setPending(false);
    }
    onPlaced(order);
  }

  return (
    <section className="market-checkout" aria-label={copy.checkout} lang={locale}>
      <button className="market-checkout-back" type="button" onClick={onBack} disabled={pending}>
        {copy.backCart}
      </button>
      <h1>{copy.place}</h1>
      <div className="market-order-panel">
        <h2>{copy.summary}</h2>
        {lines.length === 0 ? <p>{copy.empty}</p> : (
          <ul className="market-order-items">
            {lines.map((line) => (
              <li key={marketLineKey(line.listing_id, line.trend_slug)}>
                {line.image_url && <img src={line.image_url} alt="" width={56} height={56} />}
                <div>
                  <strong>{marketItemName(line)}</strong>
                  <span>{line.seller_name}</span>
                  {line.trend_label && <span>{line.trend_label}</span>}
                  <span>{line.qty_kg} {copy.kilogram} × {amountLabel(line.price_per_kg_thb, locale)} / {copy.kilogram}</span>
                </div>
                <span>{amountLabel(Number(line.price_per_kg_thb) * line.qty_kg, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="market-checkout-error" role="alert">{error}</p>}
      <div className="market-checkout-submit">
        <p className="market-order-total">
          <span>{saved ? copy.total : copy.estimate}</span>
          <strong>{amountLabel(saved?.total_thb ?? totalCents / 100, locale)}</strong>
        </p>
        <button
          className="market-checkout-action"
          type="button"
          onClick={placeOrder}
          disabled={pending || items.length === 0 || Boolean(saved)}
        >
          {pending ? copy.placing : copy.place}
        </button>
        {saved && <p role="status">{copy.placed}</p>}
      </div>
    </section>
  );
}

export function MarketOrderConfirmation({
  order, onViewOrders, onKeepShopping, onBackToTrends, locale = 'en',
}: { order: SavedMarketOrder; onViewOrders: () => void; onKeepShopping?: () => void; onBackToTrends?: () => void; locale?: Locale }) {
  const copy = checkoutCopy[locale];
  return (
    <section className="market-checkout" aria-label={copy.confirmation} lang={locale}>
      <div className="market-order-confirmation-title">
        {(onKeepShopping || onBackToTrends) && <img src={marketplaceMascot} alt="" width={104} height={104} />}
        <h1>{copy.saved}</h1>
      </div>
      <button className="market-checkout-action" type="button" onClick={onViewOrders}>{copy.view}</button>
      {(onBackToTrends || onKeepShopping) && (
        <button className="market-checkout-back" type="button" onClick={onBackToTrends ?? onKeepShopping}>
          {onBackToTrends ? copy.trends : copy.keepShopping}
        </button>
      )}
      <article className="market-order-panel"><MarketOrderDetails order={order} locale={locale} /></article>
    </section>
  );
}
