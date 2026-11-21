import { useEffect, useState } from 'react';
import { Boxes, ClipboardList, Pencil, ShoppingBasket, Sparkles, TrendingDown } from 'lucide-react';
import { requestJson } from '../../shared/http';
import type { MarketCartItem } from './market-cart';
import type { MarketIngredientListing } from './market-ingredient-catalog';
import { ingredientImage } from './market-ingredient-assets';
import { marketCopy, type MarketLocale } from './market-locale';
import { MarketSkeleton } from './market-skeleton';
import { dailyMarketplaceApi } from './marketplace-api';
import { useMarketplaceResource } from './marketplace-resource';
import './market-stock-dashboard.css';

type Stock = {
  ingredient_id: string; name_en: string; name_th: string; kg_on_hand: string | null;
  days_of_cover: string | null; usage_7d_kg: string; reorder_kg: number | null;
};
const stockPath = (shop: string) => `/api/shop/shops/${encodeURIComponent(shop)}/stock`;
const readStock = (shop: string, signal: AbortSignal) => requestJson<{ items: Stock[] }>(stockPath(shop), { signal });
const readOffers = (_shop: string, signal: AbortSignal) => dailyMarketplaceApi.listings({}, signal);
const labels = {
  en: {
    title: 'Stock dashboard', subtitle: 'Plan your next seven days from recent usage and your latest kitchen count.',
    counted: 'Ingredients counted', low: 'Below 7 days', uncounted: 'Need a count', plan: 'Weekly top-up',
    planInfo: 'Estimated from the past seven days, less stock on hand and items already in your basket.',
    empty: 'No top-up available for the recorded shortages.', buy: 'Add top-up to basket', check: 'Inventory',
    ingredient: 'Ingredient', amount: 'On hand', used: 'Used in 7 days', cover: 'Days left', all: 'All',
    search: 'Find an ingredient', count: 'Edit count', save: 'Save count', cancel: 'Cancel',
    ask: 'Ask about', unknown: 'No count', noUsage: 'No usage', noRows: 'No ingredients match.',
    kg: 'kg', days: 'days', addCount: 'Count', editError: 'Could not save this count. Try again.',
    offersError: 'Supplier offers could not be loaded.', editKg: 'Count in kg', saved: 'Stock count saved.',
  },
  th: {
    title: 'ภาพรวมสต็อกร้าน', subtitle: 'วางแผนวัตถุดิบสำหรับ 7 วันถัดไปจากยอดใช้จริงและสต็อกล่าสุดในครัว',
    counted: 'วัตถุดิบที่นับแล้ว', low: 'เหลือไม่ถึง 7 วัน', uncounted: 'รอนับสต็อก', plan: 'รายการเติมสต็อกประจำสัปดาห์',
    planInfo: 'คำนวณจากยอดใช้ 7 วันที่ผ่านมา หักสต็อกในร้านและจำนวนที่มีในตะกร้าแล้ว',
    empty: 'ยังไม่มีรายการที่เติมได้สำหรับวัตถุดิบที่ขาด', buy: 'เพิ่มรายการเติมสต็อกลงตะกร้า', check: 'รายการวัตถุดิบ',
    ingredient: 'วัตถุดิบ', amount: 'คงเหลือ', used: 'ใช้ใน 7 วัน', cover: 'พอใช้ได้', all: 'ทั้งหมด',
    search: 'ค้นหาวัตถุดิบ', count: 'แก้ไขสต็อก', save: 'บันทึกสต็อก', cancel: 'ยกเลิก',
    ask: 'ถามเกี่ยวกับ', unknown: 'ยังไม่ได้นับ', noUsage: 'ยังไม่มียอดใช้', noRows: 'ไม่พบวัตถุดิบที่ตรงกัน',
    kg: 'กก.', days: 'วัน', addCount: 'นับสต็อก', editError: 'บันทึกสต็อกไม่สำเร็จ ลองอีกครั้ง',
    offersError: 'โหลดข้อเสนอจากผู้ขายไม่สำเร็จ', editKg: 'จำนวนที่นับได้ (กก.)', saved: 'บันทึกสต็อกแล้ว',
  },
};
type Filter = 'all' | 'low' | 'uncounted';
function topUp(row: Stock, offers: readonly MarketIngredientListing[], cart: readonly MarketCartItem[], locale: MarketLocale) {
  const lines: MarketCartItem[] = [];
  const eligible = offers.filter(o => o.ingredient_id === row.ingredient_id && o.active !== false)
    .sort((a, b) => Number(a.price_per_kg_thb) - Number(b.price_per_kg_thb) || a.id.localeCompare(b.id));
  const reserved = (id: string) => cart.filter(line => line.listing_id === id).reduce((sum, line) => sum + line.qty_kg, 0);
  let needed = (row.reorder_kg ?? 0) - eligible.reduce((sum, offer) => sum + reserved(offer.id), 0);
  for (const offer of eligible) {
    if (needed <= 0) break;
    const qty = Math.min(needed, Math.min(500, offer.stock_kg) - reserved(offer.id));
    if (qty < 1) continue;
    lines.push({ listing_id: offer.id, qty_kg: qty, seller_name: offer.seller_name, stock_kg: offer.stock_kg,
      price_per_kg_thb: offer.price_per_kg_thb, ingredient_name: locale === 'th' ? row.name_th : row.name_en,
      image_url: ingredientImage(offer.image_key ?? row.ingredient_id) });
    needed -= qty;
  }
  return lines;
}

export function MarketStockDashboard({ shopId, locale, cart, onAdd, onAsk }: {
  shopId: string; locale: MarketLocale; cart: readonly MarketCartItem[];
  onAdd: (items: readonly MarketCartItem[]) => void; onAsk: (ingredient: string) => void;
}) {
  const copy = labels[locale];
  const common = marketCopy[locale];
  const stock = useMarketplaceResource(shopId, readStock, true);
  const offers = useMarketplaceResource(shopId, readOffers);
  const reloadStock = stock.reload;
  useEffect(() => {
    window.addEventListener('maract:stock-updated', reloadStock);
    return () => window.removeEventListener('maract:stock-updated', reloadStock);
  }, [reloadStock]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string>();
  const [count, setCount] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const rows = [...(stock.data?.items ?? [])].sort((a, b) =>
    Number((b.reorder_kg ?? 0) > 0) - Number((a.reorder_kg ?? 0) > 0) ||
    Number(a.days_of_cover ?? Infinity) - Number(b.days_of_cover ?? Infinity) ||
    Number(a.kg_on_hand === null) - Number(b.kg_on_hand === null) || a.name_en.localeCompare(b.name_en));
  const plan = rows.flatMap(row => topUp(row, offers.data ?? [], cart, locale));
  const low = rows.filter(row => (row.reorder_kg ?? 0) > 0).length;
  const unknown = rows.filter(row => row.kg_on_hand === null).length;
  const metrics = [
    { label: copy.counted, value: rows.length - unknown, Icon: Boxes },
    { label: copy.low, value: low, Icon: TrendingDown },
    { label: copy.uncounted, value: unknown, Icon: ClipboardList },
  ];
  const matching = rows.filter(row => (filter === 'all' || (filter === 'low' ? (row.reorder_kg ?? 0) > 0 : row.kg_on_hand === null))
    && [row.name_en, row.name_th].some(name => name.toLowerCase().includes(search.trim().toLowerCase())));
  const format = new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-GB', { maximumFractionDigits: 3 });
  const money = new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-TH', { style: 'currency', currency: 'THB' });
  async function save() {
    if (!editing || !count.trim() || saveState === 'saving') return;
    setSaveState('saving');
    try {
      await requestJson(stockPath(shopId), { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredient_id: editing, kg_on_hand: count }) });
      setEditing(undefined); setSaveState('saved'); stock.reload();
    } catch { setSaveState('error'); }
  }
  return <section className="market-stock-dashboard">
    <h1>{copy.title}</h1><p>{copy.subtitle}</p>
    {stock.loading && !stock.data && <MarketSkeleton label={common.loading} />}
    {stock.failed && <p role="alert">{common.loadError} <button onClick={stock.reload}>{common.retry}</button></p>}
    {stock.data && <>
      <dl className="market-stock-metrics">
        {metrics.map(({ label, value, Icon }) => <div key={label}>
          <dt><Icon size={18} aria-hidden="true" />{label}</dt><dd>{value}</dd>
        </div>)}
      </dl>
      <section className="market-stock-plan">
        <h2><ShoppingBasket aria-hidden="true" size={22} />{copy.plan}</h2><p>{copy.planInfo}</p>
        {offers.loading && <MarketSkeleton label={common.loading} lines={1} />}
        {offers.failed && <p role="alert">{copy.offersError} <button onClick={offers.reload}>{common.retry}</button></p>}
        {offers.data && (plan.length > 0 ? <>
          <ul>{plan.map(line => <li key={line.listing_id}><span><strong>{line.ingredient_name}</strong> · {line.seller_name}</span>
            <span>{line.qty_kg} {copy.kg} · {money.format(line.qty_kg * Number(line.price_per_kg_thb))}</span></li>)}</ul>
          <button className="market-primary" disabled={stock.loading || stock.failed} onClick={() => onAdd(plan)}>
            {copy.buy} · {money.format(plan.reduce((sum, item) => sum + item.qty_kg * Number(item.price_per_kg_thb), 0))}
          </button></> : <p>{copy.empty}</p>)}
      </section>
      <h2>{copy.check}</h2>
      <div className="market-stock-tools">
        <div role="group" aria-label={copy.check}>{(['all', 'low', 'uncounted'] as const).map(value =>
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{copy[value]}</button>)}</div>
        <input type="search" aria-label={copy.search} placeholder={copy.search} value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {saveState === 'saved' && <p role="status">{copy.saved}</p>}
      {matching.length === 0 && <p>{copy.noRows}</p>}
      <ul className="market-stock-items">{matching.map(row => {
        const name = locale === 'th' ? row.name_th : row.name_en;
        return <li key={row.ingredient_id}>
          <div className="market-stock-name"><strong>{name}</strong><button type="button" aria-label={`${copy.ask} ${name}`}
            onClick={() => onAsk(row.ingredient_id)}><Sparkles size={16} aria-hidden="true" /></button></div>
          <dl>{[[copy.amount, row.kg_on_hand === null ? copy.unknown : `${format.format(Number(row.kg_on_hand))} ${copy.kg}`],
            [copy.used, `${format.format(Number(row.usage_7d_kg))} ${copy.kg}`],
            [copy.cover, row.days_of_cover !== null ? `${format.format(Number(row.days_of_cover))} ${copy.days}` : row.kg_on_hand === null ? copy.unknown : copy.noUsage]
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {editing === row.ingredient_id ? <form onSubmit={e => { e.preventDefault(); void save(); }}>
            <label>{copy.editKg}<input autoFocus type="number" required min="0" max="1000000" step=".001" value={count}
              onChange={e => setCount(e.target.value)} /></label>
            <button disabled={saveState === 'saving'}>{copy.save}</button>
            <button type="button" disabled={saveState === 'saving'} onClick={() => { setEditing(undefined); setSaveState('idle'); }}>{copy.cancel}</button>
            {saveState === 'error' && <span role="alert">{copy.editError}</span>}
          </form> : <button className="market-stock-edit" disabled={saveState === 'saving'} aria-label={`${copy.count} · ${name}`}
            onClick={() => { setEditing(row.ingredient_id); setCount(row.kg_on_hand ?? ''); setSaveState('idle'); }}>
            <Pencil size={14} aria-hidden="true" />{copy.addCount}</button>}
        </li>;
      })}</ul>
    </>}
  </section>;
}
