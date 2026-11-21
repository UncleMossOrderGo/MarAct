import { marketItemName, marketLineKey } from './market-cart';
import type { SavedMarketOrder } from './market-checkout';
import { marketplaceListingImage } from './marketplace-fruit-images';
import './market-order-history.css';

type Locale = 'th' | 'en';

const orderCopy = {
  en: {
    orders: 'Orders', order: 'Order', history: 'Order history', loading: 'Loading orders…',
    retry: 'Retry loading orders', empty: 'No orders for this shop yet.',
    trend: 'Related trend', total: 'Total', placed: 'Placed', kilogram: 'kg', view: 'View order', items: 'items', item: 'item',
  },
  th: {
    orders: 'คำสั่งซื้อ', order: 'คำสั่งซื้อ', history: 'ประวัติคำสั่งซื้อ', loading: 'กำลังโหลดคำสั่งซื้อ…',
    retry: 'ลองโหลดคำสั่งซื้ออีกครั้ง', empty: 'ร้านนี้ยังไม่มีคำสั่งซื้อ',
    trend: 'เทรนด์ที่เกี่ยวข้อง', total: 'ยอดรวม', placed: 'สั่งซื้อแล้ว', kilogram: 'กก.', view: 'ดูคำสั่งซื้อ', items: 'รายการ', item: 'รายการ',
  },
};

export function marketOrderAmount(amount: string | number, locale: Locale = 'en') {
  return new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-TH', {
    style: 'currency', currency: 'THB', currencyDisplay: 'narrowSymbol',
  }).format(Number(amount));
}

export function marketOrderDate(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(date));
}

export function MarketOrderDetails({ order, locale = 'en', compact = false }: {
  order: SavedMarketOrder;
  locale?: Locale;
  compact?: boolean;
}) {
  const copy = orderCopy[locale];
  const trends = [...new Set(order.items.flatMap(({ trend_label }) => trend_label ? [trend_label] : []))];

  return (
    <>
      <div className="market-order-heading">
        <h2>{copy.order} {order.id}</h2>
        <time dateTime={order.created_at}>{marketOrderDate(order.created_at, locale)}</time>
        <span className="market-order-status">{order.status === 'placed' ? copy.placed : order.status}</span>
      </div>
      {trends.length > 0 && (
        <p className="market-order-trend">{copy.trend}: {trends.join(', ')}</p>
      )}
      {compact && <p>{order.items.length} {order.items.length === 1 ? copy.item : copy.items}</p>}
      {!compact && (
        <ul className="market-order-items">
          {order.items.map((item) => {
            const name = marketItemName(item) ?? '';
            const image = item.image_url ?? marketplaceListingImage({
              id: item.ingredient_id ?? item.fruit_id ?? '', name_en: name,
            }, item.listing_id);
            return (
              <li key={marketLineKey(item.listing_id, item.trend_slug)}>
                {image && <img src={image} alt="" width={56} height={56} />}
                <div>
                  <strong>{name}</strong>
                  <span>{item.seller_name}</span>
                  <span>{item.qty_kg} {copy.kilogram} × {marketOrderAmount(item.price_per_kg_thb, locale)} / {copy.kilogram}</span>
                  {trends.length > 1 && item.trend_label && <span>{item.trend_label}</span>}
                </div>
                <span>{marketOrderAmount(item.line_total_thb, locale)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="market-order-total">
        <span>{copy.total}</span>
        <strong>{marketOrderAmount(order.total_thb, locale)}</strong>
      </p>
    </>
  );
}

type MarketOrderHistoryProps = {
  orders: readonly SavedMarketOrder[];
  locale?: Locale;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onSelectOrder: (order: SavedMarketOrder) => void;
};

export function MarketOrders(props: MarketOrderHistoryProps) {
  return <MarketOrderHistory {...props} showLineDetails />;
}

export function MarketOrderHistory({
  orders, locale = 'en', loading, error, onRetry, onSelectOrder, showLineDetails = false,
}: MarketOrderHistoryProps & { showLineDetails?: boolean }) {
  const copy = orderCopy[locale];

  return (
    <section className="market-checkout market-order-history" aria-label={copy.history} lang={locale}>
      <h1>{copy.orders}</h1>
      {loading && <p role="status">{copy.loading}</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          {onRetry && <button type="button" onClick={onRetry}>{copy.retry}</button>}
        </div>
      )}
      {!loading && !error && orders.length === 0 && <p>{copy.empty}</p>}
      {orders.map((order) => (
        <article key={order.id} className="market-order-panel">
          <MarketOrderDetails order={order} locale={locale} compact={!showLineDetails} />
          <button type="button" className="market-checkout-back" onClick={() => onSelectOrder(order)}>
            {copy.view} {order.id}
          </button>
        </article>
      ))}
    </section>
  );
}
