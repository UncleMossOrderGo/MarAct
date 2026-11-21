import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ReceiptText } from 'lucide-react';

import type { SavedMarketOrder } from './market-checkout';
import { commerceApi } from './market-commerce-api';
import type { MarketLocale } from './market-locale';
import { marketOrderAmount } from './market-order-history';
import { MarketOrderTimeline } from './market-order-timeline';
import './market-commerce.css';

const demoCode = new URL('./brand/demo-payment-qr.svg', import.meta.url).href;
const duration = 5 * 60;
const copy = {
  en: {
    back: 'Back to orders', title: 'Demo PromptPay', total: 'Total', order: 'Order',
    warning: 'Demo only. This QR code cannot transfer money.',
    code: 'Non-payable demo QR code', expires: 'Code expires in', expired: 'This demo code expired.',
    renew: 'Get a new demo code', pay: 'I’ve paid', pending: 'Recording demo payment…',
    error: 'Could not record the demo payment. Try again.', receipt: 'Demo payment receipt',
    reference: 'Reference',
  },
  th: {
    back: 'กลับไปยังคำสั่งซื้อ', title: 'พร้อมเพย์จำลอง', total: 'ยอดรวม', order: 'คำสั่งซื้อ',
    warning: 'สำหรับสาธิตเท่านั้น คิวอาร์โค้ดนี้ใช้โอนเงินจริงไม่ได้',
    code: 'คิวอาร์โค้ดสาธิตสำหรับการชำระเงินจำลอง', expires: 'โค้ดหมดอายุใน', expired: 'โค้ดสำหรับสาธิตหมดอายุแล้ว',
    renew: 'รับโค้ดสาธิตใหม่', pay: 'ฉันชำระแล้ว', pending: 'กำลังบันทึกการชำระเงินจำลอง…',
    error: 'ไม่สามารถบันทึกการชำระเงินจำลองได้ ลองอีกครั้ง', receipt: 'ใบรับเงินจำลอง',
    reference: 'หมายเลขอ้างอิง',
  },
};

type PayOrder = typeof commerceApi.pay;

function PaymentOrder({ order, locale, onPaid, pay }: {
  order: SavedMarketOrder;
  locale: MarketLocale;
  onPaid: (order: SavedMarketOrder) => void;
  pay: PayOrder;
}) {
  const words = copy[locale];
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + duration * 1_000);
  const [now, setNow] = useState(Date.now);
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  const outstanding = order.status === 'placed';
  const running = outstanding && seconds > 0;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [running]);

  async function payOrder() {
    if (request.current || !outstanding || Date.now() >= expiresAt) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    try {
      const updated = await pay(order.id, order.shop_id, controller.signal);
      if (updated.id !== order.id || updated.shop_id !== order.shop_id) throw new Error('Order mismatch');
      if (!controller.signal.aborted) onPaid(updated);
    } catch {
      if (!controller.signal.aborted) setError(words.error);
    } finally {
      if (!controller.signal.aborted) setPending(false);
      request.current = null;
    }
  }

  return (
    <article className="market-order-panel market-payment-order" aria-label={`${words.order} ${order.id}`}>
      <div className="market-payment-heading">
        <div>
          <h2>{order.seller_name ?? words.order}</h2>
          <p>#{order.id}</p>
        </div>
        <strong>{marketOrderAmount(order.total_thb, locale)}</strong>
      </div>
      {outstanding ? (
        seconds > 0 ? (
          <div className="market-payment-code">
            <img src={demoCode} alt={words.code} width={160} height={160} />
            <p>{words.expires} <span role="timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span></p>
            <button type="button" className="market-checkout-action" disabled={pending} onClick={() => void payOrder()}>
              {pending ? words.pending : words.pay}
            </button>
          </div>
        ) : (
          <div className="market-payment-code">
            <p role="status">{words.expired}</p>
            <button type="button" className="market-checkout-back" onClick={() => {
              const restarted = Date.now();
              setNow(restarted);
              setExpiresAt(restarted + duration * 1_000);
            }}>{words.renew}</button>
          </div>
        )
      ) : order.payment_ref && (
        <div className="market-payment-receipt" role="status">
          <ReceiptText size={20} aria-hidden="true" />
          <div><strong>{words.receipt}</strong><p>{words.reference}: {order.payment_ref}</p></div>
        </div>
      )}
      {error && <p className="market-checkout-error" role="alert">{error}</p>}
      <MarketOrderTimeline order={order} locale={locale} />
    </article>
  );
}

type MarketPaymentProps = {
  order: SavedMarketOrder;
  locale: MarketLocale;
  onOrderChange?: (order: SavedMarketOrder) => void;
  onBack: () => void;
  pay?: PayOrder;
};

export function MarketPayment(props: MarketPaymentProps) {
  return <PaymentGroup key={props.order.id} {...props} />;
}

function PaymentGroup({ order, locale, onOrderChange, onBack, pay = commerceApi.pay }: MarketPaymentProps) {
  const words = copy[locale];
  const replacements = useRef(new Map<string, SavedMarketOrder>());
  const [, render] = useState(0);
  const orders = (order.orders ?? [order]).map((entry) => replacements.current.get(entry.id) ?? entry);

  function update(updated: SavedMarketOrder) {
    replacements.current.set(updated.id, updated);
    render((count) => count + 1);
    if (!order.orders) {
      onOrderChange?.(updated);
      return;
    }
    const children = order.orders.map((entry) => replacements.current.get(entry.id) ?? entry);
    const status = children.every((child) => child.status === 'confirmed') ? 'confirmed'
      : children.every((child) => child.status !== 'placed') ? 'paid' : 'placed';
    onOrderChange?.({ ...order, status, orders: children });
  }

  return (
    <section className="market-checkout market-payment" aria-label={words.title} lang={locale}>
      <button className="market-checkout-back" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" /> {words.back}
      </button>
      <h1>{words.title}</h1>
      <p className="market-payment-warning">{words.warning}</p>
      <p className="market-order-total"><span>{words.total}</span><strong>{marketOrderAmount(order.total_thb, locale)}</strong></p>
      {orders.map((entry) => <PaymentOrder key={entry.id} order={entry} locale={locale} pay={pay} onPaid={update} />)}
    </section>
  );
}
