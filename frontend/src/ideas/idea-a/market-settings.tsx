import type { SavedMarketOrder } from './market-checkout';
import { marketOrderAmount, marketOrderDate } from './market-order-history';
import './market-settings.css';

type Locale = 'th' | 'en';

type MarketSettingsShop = { id: string; name: string; category: string };
type MarketSettingsRun = { finished_at?: string | null };

const settings = {
  en: {
    title: 'Settings', shop: 'Active shop', language: 'Language', purchases: 'Recent purchases',
    updated: 'Last trend update', noRun: 'No trends published yet.', noOrders: 'No orders yet.', order: 'Order',
    categories: { bakery: 'Bakery', cafe: 'Café', juice_shop: 'Juice shop' },
  },
  th: {
    title: 'การตั้งค่า', shop: 'ร้านที่ใช้งาน', language: 'ภาษา', purchases: 'รายการซื้อล่าสุด',
    updated: 'อัปเดตเทรนด์ล่าสุด', noRun: 'ยังไม่มีการเผยแพร่เทรนด์', noOrders: 'ยังไม่มีคำสั่งซื้อ', order: 'คำสั่งซื้อ',
    categories: { bakery: 'เบเกอรี', cafe: 'คาเฟ่', juice_shop: 'ร้านน้ำผลไม้' },
  },
};

export function MarketSettings({
  shop, run, orders, locale, onLocaleChange, onSelectOrder,
}: {
  shop: MarketSettingsShop;
  run?: MarketSettingsRun | null;
  orders: readonly SavedMarketOrder[];
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onSelectOrder?: (order: SavedMarketOrder) => void;
}) {
  const copy = settings[locale];
  const category = Object.entries(copy.categories).find(([key]) => key === shop.category)?.[1] ?? shop.category;
  const recentOrders = orders.filter((order) => order.shop_id === shop.id).slice(0, 3);

  return (
    <section className="market-settings" lang={locale}>
      <h1>{copy.title}</h1>
      <dl>
        <div>
          <dt>{copy.shop}</dt>
          <dd>{shop.name} <small>{category}</small></dd>
        </div>
        <div>
          <dt>{copy.updated}</dt>
          <dd>{run?.finished_at ? (
            <time dateTime={run.finished_at}>{marketOrderDate(run.finished_at, locale)}</time>
          ) : copy.noRun}</dd>
        </div>
      </dl>
      <label>
        {copy.language}
        <select value={locale} onChange={(event) => onLocaleChange(event.currentTarget.value === 'en' ? 'en' : 'th')}>
          <option value="th" lang="th">ไทย</option>
          <option value="en" lang="en">English</option>
        </select>
      </label>
      <div>
        <h2>{copy.purchases}</h2>
        {recentOrders.length ? (
          <ul>
            {recentOrders.map((order) => (
              <li key={order.id}>
                <span>
                  {onSelectOrder ? (
                    <button type="button" onClick={() => onSelectOrder(order)}>{copy.order} {order.id}</button>
                  ) : <strong>{copy.order} {order.id}</strong>}
                  <time dateTime={order.created_at}>{marketOrderDate(order.created_at, locale)}</time>
                </span>
                <strong>{marketOrderAmount(order.total_thb, locale)}</strong>
              </li>
            ))}
          </ul>
        ) : <p>{copy.noOrders}</p>}
      </div>
    </section>
  );
}
