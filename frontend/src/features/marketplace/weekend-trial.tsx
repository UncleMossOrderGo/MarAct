import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MarketAssistantPanel } from '../shop/market-assistant';
import { dailyMarketplaceApi, waitForDailyPublication } from '../shop/marketplace-api';
import { useMarketplaceResource } from '../shop/marketplace-resource';
import type { MarketTodayData } from '../shop/market-daily-types';
import type { Lot } from './types';

export function nextSaturday(now = new Date()) {
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const date = new Date(localDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

type Props = {
  lots: Lot[]; budget: string; postcode: string; arrival: string; kg: string;
  loading: boolean; error: string; conditions: ReactNode;
  onReserve: (lot: Lot) => void; hasCart: boolean; onCart: () => void;
};

const loadShops = (_: string, signal: AbortSignal) => dailyMarketplaceApi.shops(signal);
const loadToday = (id: string, signal: AbortSignal): Promise<MarketTodayData> => dailyMarketplaceApi.today(id, 'th', signal);
const loadJob = (_: string, signal: AbortSignal) => dailyMarketplaceApi.jobStatus(signal);

export function WeekendTrial({ lots, budget, postcode, arrival, kg, loading, error, conditions, onReserve, hasCart, onCart }: Props) {
  const shops = useMarketplaceResource('shops', loadShops);
  const shopId = shops.data?.default_shop_id;
  const today = useMarketplaceResource(shopId ?? null, loadToday, true);
  const job = useMarketplaceResource('job', loadJob);
  const publication = today.data;
  const [focus, setFocus] = useState({ slug: '', sequence: 0 });
  const [running, setRunning] = useState(false);
  const [jobError, setJobError] = useState(false);
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => () => attempt.current?.abort(), []);
  async function refresh() {
    if (attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setRunning(true);
    setJobError(false);
    try {
      await waitForDailyPublication(controller.signal, () => {});
      today.reload();
      job.reload();
    } catch {
      if (!controller.signal.aborted) setJobError(true);
    } finally {
      attempt.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }
  const valid = Number(budget) > 0 && Number.isInteger(Number(kg)) && Number(kg) > 0 && /^\d{5}$/.test(postcode) && Boolean(arrival);
  const liveTrends = publication?.run?.source === 'live' ? publication.trends : [];
  const choices = lots.filter(lot => !lot.misses.length && lot.kg && lot.total <= Number(budget))
    .map(lot => ({ lot, trend: liveTrends.find(t => t.ingredients.some(i => i.name_th && lot.name.includes(i.name_th))) }))
    .sort((a, b) => Number(Boolean(a.lot.is_sample)) - Number(Boolean(b.lot.is_sample)) ||
      Number(Boolean(b.trend)) - Number(Boolean(a.trend)) || a.lot.total - b.lot.total || a.lot.earliest.localeCompare(b.lot.earliest));
  const best = choices[0];
  const dateLabel = (value: string) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value));
  return <section className="weekend-trial">
    <div className="trial-title"><h1>เมนูทดลองสุดสัปดาห์</h1>
      {shopId && <MarketAssistantPanel shopId={shopId} locale="th" page="today"
        focused={focus.slug ? { type: 'trend', id: focus.slug } : undefined} openRequest={focus.sequence} />}
    </div>
    <p>เลือกผลไม้และสวนที่ส่งถึงร้านทัน ภายในงบรวมค่าส่ง</p>
    <section className="buyer-trends" aria-labelledby="buyer-trends-title">
      <div className="trial-title"><h2 id="buyer-trends-title">เทรนด์วันนี้สำหรับร้าน</h2>
        {job.data?.demo_enabled && <button onClick={refresh} disabled={running} type="button">{running ? 'กำลังค้นหาเทรนด์…' : 'ค้นหาเทรนด์ใหม่'}</button>}
      </div>
      {running && <progress aria-label="กำลังค้นหาเทรนด์" />}
      {jobError && <p role="alert">อัปเดตเทรนด์ไม่สำเร็จ โปรดลองอีกครั้ง</p>}
      {publication?.run && <small>{publication.run.source === 'live' ? 'จากการค้นเว็บ' : 'ข้อมูลตัวอย่าง'} · {dateLabel(publication.run.trend_date)}</small>}
      {(shops.failed || today.failed) ? <p role="alert">โหลดเทรนด์ไม่สำเร็จ <button onClick={() => { shops.reload(); today.reload(); }}>ลองอีกครั้ง</button></p>
        : !publication?.trends.length && <p role="status">{shops.loading || today.loading ? 'กำลังโหลดเทรนด์…' : 'ยังไม่มีเทรนด์ที่เผยแพร่'}</p>}
      <div className="buyer-trend-list">{publication?.trends.slice(0, 3).map(t => <article key={t.slug}>
        <h3>{t.name}</h3>
        <p>{t.menu_idea || t.why_rising}</p>
        {t.sources.filter(s => /^https?:\/\//.test(s.url)).slice(0, 1).map(s =>
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer">ดูแหล่งที่มา</a>)}
        <button type="button" onClick={() => setFocus(f => ({ slug: t.slug, sequence: f.sequence + 1 }))}>ถาม AI เรื่องเทรนด์นี้</button>
      </article>)}</div>
      <a href="/market/shop">ดูรายละเอียดเทรนด์และสต็อกร้าน →</a>
    </section>
    <div className="trial-conditions">{conditions}</div>
    {!valid ? <p>ระบุงบ จำนวนเต็มกิโลกรัม รหัสไปรษณีย์ และวันรับให้ครบ</p>
      : error ? <p role="alert">{error}</p> : loading ? <p role="status">กำลังเช็กราคาและรอบส่งของสวน…</p>
      : !best ? <p role="status">ยังไม่มีล็อตที่อยู่ในงบและส่งทัน ลองเปลี่ยนวันรับ จำนวน หรืองบทดลอง</p>
      : <article className="trial-pick">
        <div><p>เมนูที่แนะนำให้ลอง</p><h2>{best.trend?.name || 'สมูทตี' + best.lot.name}</h2>
        <p>{best.trend?.why_rising || 'ไอเดียเครื่องดื่มสำหรับทดลองขายจากผลไม้ที่จองได้ในงบ'}</p>
        {best.trend?.sources.filter(s => /^https?:\/\//.test(s.url)).slice(0, 1).map(s => <a href={s.url} key={s.url} target="_blank" rel="noreferrer">ดูที่มาของเทรนด์</a>)}</div>
        <div>{best.lot.cover_url?.startsWith('/api/farmer/marketplace/photos/') &&
          <img className="farm-lot-cover" src={best.lot.cover_url} alt={best.lot.name} />}
        <strong>{best.lot.name} · {best.lot.farm}</strong>{best.lot.is_sample && <small>ล็อตตัวอย่าง</small>}
        <p>ขั้นต่ำ {best.lot.minimum} {best.lot.unit} · ราคา ฿{best.lot.price}/{best.lot.unit}</p>
        <p>{best.lot.units} {best.lot.unit} · ยอดรวม ฿{best.lot.total.toLocaleString()} (ค่าส่ง ฿{best.lot.freight})</p>
        <p>รับได้ตามรอบวันที่ {dateLabel(arrival)} · เหลืองบ ฿{(Number(budget) - best.lot.total).toLocaleString()}</p>
        <button type="button" onClick={() => hasCart ? onCart() : onReserve(best.lot)}>{hasCart ? 'ตรวจตะกร้าที่มีอยู่' : 'ตรวจรายการและจองล็อตนี้'}</button></div>
      </article>}
  </section>;
}
