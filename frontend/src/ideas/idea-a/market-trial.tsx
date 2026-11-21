import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../shared/http';
import { useMarketplaceResource } from './marketplace-resource';
import type { DailyLocale, DailyTrend } from './market-daily-types';
import './market-trial.css';
import { MarketVoiceInput } from './market-voice-input';

type Lot = {
  ingredient_id: string;
  name_en: string;
  name_th: string;
  listing_id: string;
  supplier: string;
  area: string;
  min_kg: number;
  stock_kg: number;
  price_per_kg_thb: string;
  shipping_thb: string;
  total: string;
  arrival: string;
  confirmed_at: string;
  reasons: string[];
};
type Limits = { qty: string; budget: string; needed_by: string };
const api = '/api/ideas/idea-a';
const readLots = (path: string, signal: AbortSignal) => requestJson<Lot[]>(path, { signal });
const words = {
  en: {
    trial: 'Trial lot for Bangkok',
    ingredient: 'Ingredient',
    qty: 'Trial kg',
    budget: 'Budget (฿)',
    needed: 'Receive by',
    skip: 'Skip this trial',
    absent: 'No supplier has confirmed delivery terms for this ingredient.',
    request: 'Request a quote',
    sent: 'Quote request in supplier inbox',
    loading: 'Checking suppliers…',
    error: 'Could not check supplier terms.',
    retry: 'Retry',
    fee: 'shipping',
    min: 'minimum',
    due: 'Estimated delivery',
    confirmed: 'Supply updated',
    changed: 'Check current supplier terms and try again.',
    example: 'Demo supplier terms',
    evidence: 'Sources',
    pending: 'Sending…',
    other: 'Other suppliers',
    invalid: 'Enter a budget, whole kilograms and a delivery date.',
  },
  th: {
    trial: 'ล็อตทดลองส่งกรุงเทพฯ',
    ingredient: 'วัตถุดิบ',
    qty: 'จำนวนทดลอง (กก.)',
    budget: 'งบประมาณ (บาท)',
    needed: 'รับของภายใน',
    skip: 'ข้ามล็อตนี้',
    absent: 'ยังไม่มีผู้ขายยืนยันเงื่อนไขส่งวัตถุดิบนี้',
    request: 'ขอใบเสนอราคา',
    sent: 'ส่งคำขอไปยังกล่องข้อความผู้ขายแล้ว',
    loading: 'กำลังตรวจสอบผู้ขาย…',
    error: 'โหลดเงื่อนไขผู้ขายไม่ได้',
    retry: 'ลองอีกครั้ง',
    fee: 'ค่าส่ง',
    min: 'ขั้นต่ำ',
    due: 'คาดว่าจะได้รับ',
    confirmed: 'อัปเดตสินค้า',
    changed: 'ตรวจสอบเงื่อนไขล่าสุดแล้วลองอีกครั้ง',
    example: 'ข้อมูลผู้ขายสำหรับเดโม',
    evidence: 'แหล่งข้อมูล',
    pending: 'กำลังส่ง…',
    other: 'ผู้ขายรายอื่น',
    invalid: 'กรอกงบ จำนวนกิโลกรัมเต็ม และวันที่รับของ',
  },
};
const reason: Record<string, [string, string]> = {
  stock: ['Insufficient stock', 'สต็อกไม่พอ'],
  minimum: ['Below minimum lot', 'ต่ำกว่าขั้นต่ำ'],
  budget: ['Over budget', 'เกินงบ'],
  late: ['Arrives too late', 'ส่งไม่ทัน'],
  stale: ['Supplier must reconfirm stock', 'รอผู้ขายยืนยันสต็อก'],
};
const day = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
function limits(shop: string): Limits {
  const initial = { qty: '1', budget: '500', needed_by: day(new Date(Date.now() + 3 * 86400000)) };
  try {
    const saved = JSON.parse(localStorage.getItem('maract.trial.' + shop) ?? 'null');
    return saved
      ? {
          qty: String(saved.qty || 1),
          budget: String(saved.budget || 500),
          needed_by: saved.needed_by >= day(new Date()) ? saved.needed_by : initial.needed_by,
        }
      : initial;
  } catch {
    return initial;
  }
}

export function MarketTrial({
  shop,
  trend,
  locale,
}: {
  shop: string;
  trend: DailyTrend;
  locale: DailyLocale;
}) {
  const t = words[locale];
  const ingredients = trend.ingredients.filter((i) => i.ingredient_id);
  const [selected, setSelected] = useState('auto');
  const ingredient = ingredients.find((i) => i.ingredient_id === selected) ?? ingredients[0];
  const [prefs, setPrefs] = useState(() => limits(shop));
  const [brief, setBrief] = useState('');
  const [reading, setReading] = useState<'idle' | 'pending' | 'error'>('idle');
  const start = useRef(performance.now());
  const [visit] = useState(() => crypto.randomUUID());
  async function applyBrief() {
    setReading('pending');
    try {
      const fields = await requestJson<{
        qty: number | null;
        budget: number | null;
        needed_by: string | null;
      }>(api + '/shops/' + encodeURIComponent(shop) + '/trial-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: brief }),
      });
      const next = {
        qty: String(fields.qty ?? prefs.qty),
        budget: String(fields.budget ?? prefs.budget),
        needed_by: fields.needed_by ?? prefs.needed_by,
      };
      setPrefs(next);
      try {
        localStorage.setItem('maract.trial.' + shop, JSON.stringify(next));
      } catch {
        /* local draft */
      }
      setReading('idle');
      setBrief('');
    } catch {
      setReading('error');
    }
  }
  const valid =
    Number(prefs.budget) > 0 &&
    Number(prefs.budget) <= 1000000 &&
    Number.isInteger(Number(prefs.qty)) &&
    Number(prefs.qty) >= 1 &&
    Number(prefs.qty) <= 500 &&
    prefs.needed_by >= day(new Date());
  const query = new URLSearchParams({ ...prefs, trend: trend.slug, ingredient: selected });
  const path =
    ingredient && valid ? api + '/shops/' + encodeURIComponent(shop) + '/trial-lots?' + query : null;
  const lots = useMarketplaceResource(path, readLots, true);
  const reload = lots.reload;
  useEffect(() => {
    if (!path) return;
    const refresh = () => {
      if (!document.hidden) reload();
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [path, reload]);
  function change(key: keyof Limits, value: string) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    if (next.qty && next.budget && next.needed_by) {
      try {
        localStorage.setItem('maract.trial.' + shop, JSON.stringify(next));
      } catch {
        /* View remains usable. */
      }
    }
  }
  return (
    <section className="market-trial">
      <h3>{t.trial}</h3>
      {!ingredient ? (
        <p>
          {t.skip}. {t.absent}
        </p>
      ) : !valid ? (
        <p>{t.invalid}</p>
      ) : lots.failed ? (
        <p role="alert">
          {t.error} <button onClick={reload}>{t.retry}</button>
        </p>
      ) : !lots.data ? (
        <p role="status">{t.loading}</p>
      ) : (
        <TrialResult
          key={path + '|' + lots.data[0]?.listing_id + '|' + lots.data[0]?.total}
          {...{
            shop,
            locale,
            visit,
            start: start.current,
            params: query.toString(),
            lots: lots.data,
            reload,
          }}
        />
      )}
      {ingredient && (
        <div className="market-trial-inputs">
          <label>
            {t.ingredient}
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="auto">{locale === 'th' ? 'เลือกล็อตที่เหมาะ' : 'Match a trial lot'}</option>
              {ingredients.map((i) => (
                <option key={i.ingredient_id} value={i.ingredient_id!}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.qty}
            <input
              type="number"
              min="1"
              max="500"
              value={prefs.qty}
              onChange={(e) => change('qty', e.target.value)}
            />
          </label>
          <label>
            {t.budget}
            <input
              type="number"
              min=".01"
              max="1000000"
              step=".01"
              value={prefs.budget}
              onChange={(e) => change('budget', e.target.value)}
            />
          </label>
          <label>
            {t.needed}
            <input
              type="date"
              min={day(new Date())}
              value={prefs.needed_by}
              onChange={(e) => change('needed_by', e.target.value)}
            />
          </label>
        </div>
      )}
      {ingredient && (
        <details className="market-trial-brief">
          <summary>{locale === 'th' ? 'บอกเงื่อนไขการซื้อ' : 'Describe your trial'}</summary>
          <label>
            {locale === 'th' ? 'เงื่อนไขการซื้อ' : 'Buying brief'}
            <textarea
              maxLength={1500}
              value={brief}
              disabled={reading === 'pending'}
              placeholder={
                locale === 'th'
                  ? 'อยากลอง 2 กก. งบ 500 บาท รับก่อนวันศุกร์'
                  : 'Two kilograms, up to ฿500, by Friday'
              }
              onChange={(e) => setBrief(e.target.value)}
            />
          </label>
          <MarketVoiceInput
            shopId={shop}
            locale={locale}
            disabled={reading === 'pending'}
            onTranscript={(s) => setBrief((v) => (v + ' ' + s).trim().slice(0, 1500))}
          />
          <button
            type="button"
            onClick={() => void applyBrief()}
            disabled={!brief.trim() || reading === 'pending'}
          >
            {locale === 'th' ? 'ใช้เงื่อนไขนี้' : 'Apply limits'}
          </button>
          {reading === 'error' && (
            <p role="alert">
              {locale === 'th'
                ? 'อ่านเงื่อนไขไม่ได้ กรอกในช่องด้านบนได้เลย'
                : 'Could not read the brief. Enter the limits above.'}
            </p>
          )}
        </details>
      )}
    </section>
  );
}

function TrialResult({
  shop,
  locale,
  visit,
  start,
  params,
  lots,
  reload,
}: {
  shop: string;
  visit: string;
  locale: DailyLocale;
  start: number;
  params: string;
  lots: Lot[];
  reload: () => void;
}) {
  const t = words[locale];
  const [state, setState] = useState<'idle' | 'pending' | 'sent' | 'error'>('idle');
  const id = useRef<string | null>(null);
  const [elapsed] = useState(() => Math.min(2147483647, Math.round(performance.now() - start)));
  const [best, ...others] = lots;
  const eligibleId = best && !best.reasons.length ? best.listing_id : undefined;
  useEffect(() => {
    if (!eligibleId) return;
    const fields = Object.fromEntries(new URLSearchParams(params));
    void requestJson(api + '/shops/' + encodeURIComponent(shop) + '/trial-matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, qty: Number(fields.qty), match_ms: elapsed, id: visit }),
    }).catch(() => undefined);
  }, [eligibleId, elapsed, params, shop, visit]);
  const money = (n: string) =>
    new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-TH', {
      style: 'currency',
      currency: 'THB',
      maximumFractionDigits: 2,
    }).format(Number(n));
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-GB', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'short',
    }).format(new Date(value));
  async function send() {
    if (!best || state === 'pending') return;
    setState('pending');
    id.current ??= crypto.randomUUID();
    const body = Object.fromEntries(new URLSearchParams(params));
    try {
      await requestJson(api + '/shops/' + encodeURIComponent(shop) + '/trial-quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          ingredient: best.ingredient_id,
          qty: Number(body.qty),
          listing_id: best.listing_id,
          expected_total: best.total,
          match_ms: elapsed,
          id: id.current,
        }),
      });
      setState('sent');
    } catch {
      setState('error');
    }
  }
  function detail(lot: Lot) {
    return (
      <div className="market-trial-lot">
        <strong>
          {locale === 'th' ? lot.name_th : lot.name_en} · {lot.supplier}
        </strong>{' '}
        <span>{lot.area}</span>
        <p>
          <strong>{money(lot.total)}</strong> ({new URLSearchParams(params).get('qty')} kg × {money(lot.price_per_kg_thb)}/kg + {t.fee} {money(lot.shipping_thb)}) · {t.min} {lot.min_kg} kg
        </p>
        <p>
          {t.due} {date(lot.arrival)} · {t.confirmed} {date(lot.confirmed_at)}
        </p>
        {lot.reasons.length > 0 && (
          <p>{lot.reasons.map((r) => reason[r]?.[locale === 'th' ? 1 : 0]).join(', ')}</p>
        )}
      </div>
    );
  }
  return (
    <div>
      {(!best || best.reasons.length > 0) && <strong>{t.skip}</strong>}
      {best ? detail(best) : <p>{t.absent}</p>}
      {best && best.reasons.length === 0 && (
        <button
          type="button"
          className="market-daily-primary"
          disabled={state === 'pending' || state === 'sent'}
          onClick={() => void send()}
        >
          {state === 'sent' ? t.sent : state === 'pending' ? t.pending : t.request}
        </button>
      )}
      {state === 'error' && (
        <p role="alert">
          {t.changed} <button onClick={reload}>{t.retry}</button>
        </p>
      )}
      {others.length > 0 && (
        <details>
          <summary>
            {t.other} ({others.length})
          </summary>
          {others.map((l) => (
            <div key={l.listing_id}>{detail(l)}</div>
          ))}
        </details>
      )}
      {best && <small>{t.example}</small>}
    </div>
  );
}

type Activity = { matches: number; quotes: number; median_ms: number | null };
const readActivity = (shop: string, signal: AbortSignal) =>
  requestJson<Activity>(api + '/shops/' + encodeURIComponent(shop) + '/trial-activity', { signal });

export function TrialActivity({ shop, locale }: { shop: string; locale: DailyLocale }) {
  const [open,setOpen]=useState(false);
  const activity=useMarketplaceResource(open ? shop : null,readActivity);
  const th=locale==='th';
  return <details className="market-trial-activity" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>{th?'ผลการจับคู่ล็อตทดลอง':'Trial activity'}</summary>
    {activity.loading && <p role="status">{th?'กำลังโหลด…':'Loading…'}</p>}
    {activity.failed && <button onClick={activity.reload}>{th?'ลองอีกครั้ง':'Retry'}</button>}
    {activity.data && <dl>
      <div><dt>{th?'พบล็อตตามเงื่อนไข':'Trials with a match'}</dt><dd>{activity.data.matches}</dd></div>
      <div><dt>{th?'เวลามัธยฐานที่ใช้หาล็อต':'Median time to match'}</dt><dd>{activity.data.median_ms===null?'—':(activity.data.median_ms/1000).toFixed(1)+(th?' วินาที':' s')}</dd></div>
      <div><dt>{th?'คำขอใบเสนอราคา':'Quote requests'}</dt><dd>{activity.data.quotes}</dd></div>
    </dl>}
  </details>;
}
