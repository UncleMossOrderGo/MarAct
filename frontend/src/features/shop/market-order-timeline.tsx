import { Check, Circle, Clock3 } from 'lucide-react';
import type { SavedMarketOrder } from './market-checkout';
import type { MarketLocale } from './market-locale';
import './market-commerce.css';

const copy = {
  en: { timeline: 'Order status', placed: 'Placed', paid: 'Paid', confirmed: 'Confirmed', pending: 'Pending' },
  th: { timeline: 'สถานะคำสั่งซื้อ', placed: 'สั่งซื้อแล้ว', paid: 'ชำระแล้ว', confirmed: 'ยืนยันแล้ว', pending: 'รอดำเนินการ' },
};

export function marketOrderDate(date: string, locale: MarketLocale) {
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(date));
}

export function marketStatusLabel(status: string, locale: MarketLocale) {
  const words = copy[locale];
  switch (status) {
    case 'placed': return words.placed;
    case 'paid': return words.paid;
    case 'confirmed': return words.confirmed;
    default: return status;
  }
}

export function MarketOrderTimeline({ order, locale }: { order: SavedMarketOrder; locale: MarketLocale }) {
  const labels = copy[locale];
  const hasPaid = order.status === 'paid' || order.status === 'confirmed';
  const steps = [
    { key: 'placed', date: order.created_at, done: true },
    { key: 'paid', date: order.paid_at, done: hasPaid },
    { key: 'confirmed', date: order.confirmed_at, done: order.status === 'confirmed' },
  ] as const;
  return (
    <ol className="market-order-timeline" aria-label={labels.timeline}>
      {steps.map(({ key, date, done }, index) => {
        const current = !done && Boolean(steps[index - 1]?.done);
        const Icon = done ? Check : current ? Clock3 : Circle;
        return (
          <li key={key} data-done={done} aria-current={current ? 'step' : undefined}>
            <Icon size={16} aria-hidden="true" />
            <div>
              <strong>{labels[key]}</strong>
              {date ? <time dateTime={date}>{marketOrderDate(date, locale)}</time> : !done && <small>{labels.pending}</small>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
