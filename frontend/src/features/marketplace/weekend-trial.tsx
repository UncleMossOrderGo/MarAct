import { useEffect, useState, type ReactNode } from 'react';
import { requestJson } from '../../shared/http';
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

export function WeekendTrial({ lots, budget, postcode, arrival, kg, loading, error, conditions, onReserve, hasCart, onCart }: Props) {
  const [publication, setPublication] = useState<Pick<MarketTodayData, 'trends' | 'run'>>();
  useEffect(() => {
    const controller = new AbortController();
    requestJson<Pick<MarketTodayData, 'trends' | 'run'>>('/api/shop/trends/today?locale=th', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPublication(data); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const valid = Number(budget) > 0 && Number.isInteger(Number(kg)) && Number(kg) > 0 && /^\d{5}$/.test(postcode) && Boolean(arrival);
  const liveTrends = publication?.run?.source === 'live' ? publication.trends : [];
  const choices = lots.filter(lot => !lot.misses.length && lot.kg && lot.total <= Number(budget))
    .map(lot => ({ lot, trend: liveTrends.find(t => t.ingredients.some(i => i.name_th && lot.name.includes(i.name_th))) }))
    .sort((a, b) => Number(Boolean(a.lot.is_sample)) - Number(Boolean(b.lot.is_sample)) ||
      Number(Boolean(b.trend)) - Number(Boolean(a.trend)) || a.lot.total - b.lot.total || a.lot.earliest.localeCompare(b.lot.earliest));
  const best = choices[0];
  const dateLabel = (value: string) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value));
  return <section className="weekend-trial">
    <h1>เมนูทดลองสุดสัปดาห์</h1>
    <p>เลือกผลไม้และสวนที่ส่งถึงร้านทัน ภายในงบรวมค่าส่ง</p>
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
