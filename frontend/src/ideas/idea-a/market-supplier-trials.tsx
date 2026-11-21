import { useState } from 'react';
import { requestJson } from '../../shared/http';
import type { DailyLocale } from './market-daily-types';
import { useMarketplaceResource } from './marketplace-resource';

type Terms = {
  price_per_kg_thb: string;
  id: string;
  name_en: string;
  name_th: string;
  stock_kg: number;
  min_kg: number;
  shipping_thb: string;
  lead_days: number;
};
type Request = {
  id: string;
  shop: string;
  name_en: string;
  name_th: string;
  qty_kg: number;
  needed_by: string;
  delivered_thb: string;
  match_ms: number;
};
const load = (seller: string, signal: AbortSignal) =>
  requestJson<{ listings: Terms[]; quotes: Request[] }>(
    `/api/ideas/idea-a/sellers/${encodeURIComponent(seller)}/trials`,
    { signal },
  );

export function SupplierTrials({ seller, locale }: { seller: string; locale: DailyLocale }) {
  const th = locale === 'th';
  const data = useMarketplaceResource(seller, load, true);
  const [id, setId] = useState('');
  const listing = data.data?.listings.find((l) => l.id === id) ?? data.data?.listings[0];
  return (
    <section className="market-order-panel">
      <h2>{th ? 'คำขอใบเสนอราคา' : 'Trial quote requests'}</h2>
      {data.failed && <button onClick={data.reload}>{th ? 'ลองอีกครั้ง' : 'Retry'}</button>}
      {data.data?.quotes.length === 0 && <p>{th ? 'ยังไม่มีคำขอ' : 'No requests yet.'}</p>}
      {data.data?.quotes.map((q) => (
        <p key={q.id}>
          <strong>{q.shop}</strong> · {th ? q.name_th : q.name_en} {q.qty_kg} kg · ฿{q.delivered_thb}
          <br />
          {th ? 'รับภายใน' : 'Receive by'} {q.needed_by}
        </p>
      ))}
      {listing && (
        <details>
          <summary>{th ? 'เงื่อนไขล็อตทดลอง' : 'Trial lot terms'}</summary>
          <label>
            {th ? 'วัตถุดิบ' : 'Ingredient'}{' '}
            <select value={listing.id} onChange={(e) => setId(e.target.value)}>
              {data.data?.listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {th ? l.name_th : l.name_en}
                </option>
              ))}
            </select>
          </label>
          <LotEditor key={listing.id} {...{ seller, listing, th }} reload={data.reload} />
        </details>
      )}
    </section>
  );
}
function LotEditor({
  seller,
  listing,
  th,
  reload,
}: {
  seller: string;
  listing: Terms;
  th: boolean;
  reload: () => void;
}) {
  const [state, setState] = useState('');
  return (
    <form
      className="supplier-trial-fields"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = Object.fromEntries([...new FormData(e.currentTarget)].map(([k, v]) => [k, Number(v)]));
        setState('saving');
        try {
          await requestJson(
            `/api/ideas/idea-a/sellers/${encodeURIComponent(seller)}/trial-lots/${encodeURIComponent(listing.id)}`,
            { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          );
          setState('saved');
          reload();
        } catch {
          setState('error');
        }
      }}
    >
      {(
        [
          ['price_per_kg_thb', th ? 'บาทต่อกิโลกรัม' : 'Price per kg (฿)'],
          ['stock_kg', th ? 'พร้อมขาย (กก.)' : 'Available kg'],
          ['min_kg', th ? 'ขั้นต่ำ (กก.)' : 'Minimum kg'],
          ['shipping_thb', th ? 'ค่าส่ง (บาท)' : 'Shipping (฿)'],
          ['lead_days', th ? 'วันนำส่ง' : 'Delivery days'],
        ] as const
      ).map(([k, label]) => (
        <label key={k}>
          {label}
          <input
            type="number"
            name={k}
            required
            min={k === 'min_kg' ? 1 : 0}
            step={k === 'shipping_thb' || k === 'price_per_kg_thb' ? '.01' : 1}
            defaultValue={listing[k]}
          />
        </label>
      ))}
      <button disabled={state === 'saving'}>{th ? 'ยืนยันข้อมูล' : 'Confirm supply'}</button>
      {state === 'saved' && <span role="status">{th ? 'บันทึกแล้ว' : 'Supply updated.'}</span>}
      {state === 'error' && (
        <span role="alert">{th ? 'บันทึกไม่ได้ ลองอีกครั้ง' : 'Could not save. Try again.'}</span>
      )}
    </form>
  );
}
