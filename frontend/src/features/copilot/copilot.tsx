import { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { requestJson } from '../../shared/http';
import type { Lot } from '../marketplace/types';
import './copilot.css';

type Criteria = { query: string; kg: number | null };
type Trend = {
  fruit_id: string;
  fruit_name: string;
  value: number | null;
  observation_window: string;
  source_name: string;
  caveat: string;
  buyer_fit_reasons: string[];
  market_context?: {
    status: 'available' | 'insufficient_evidence' | 'unavailable';
    summary: string | null;
    citations: { title: string; url: string }[];
  } | null;
};
type Reply = {
  message: string;
  source: 'openai' | 'deterministic';
  lots: Lot[];
  groups: { farm: string; lines: Lot[]; total: number | null; freight: number | null }[];
  trends: Trend[];
  tool_calls: { name: string; status: string }[];
  unfulfilled: string[];
  previous: Criteria | null;
  delivery_confirmed: boolean;
};

export function MarketCopilot({ postcode, arrival, preference, deliveryFields, onClose, onApply, onBrowse }: {
  postcode: string;
  arrival: string;
  preference: string;
  deliveryFields: ReactNode;
  onClose: () => void;
  onApply: (lots: Lot[]) => Promise<void>;
  onBrowse: (query: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const prior = useRef<Criteria | null>(null);
  const latest = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<{ question: string; reply: Reply; postcode: string; arrival: string }[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { latest.current?.scrollIntoView({ block: 'end' }); }, [turns.length, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || pending) return;
    const question = text.trim();
    setPending(true);
    setError('');
    try {
      const reply = await requestJson<Reply>('/api/ideas/idea-c/copilot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question, postcode: /^\d{5}$/.test(postcode) ? postcode : null,
          arrival: arrival || null, preference, previous: prior.current,
        }),
      });
      if (reply.previous) prior.current = reply.previous;
      setTurns((current) => [...current, { question, reply, postcode, arrival }]);
      setText('');
    } catch {
      setError('ส่งข้อความไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setPending(false);
    }
  }

  async function apply(lines: Lot[]) {
    setError('');
    setPending(true);
    try {
      await onApply(lines);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'กรุณาตรวจล็อตอีกครั้ง');
    } finally {
      setPending(false);
    }
  }

  return <dialog ref={dialog} className="market-copilot" aria-labelledby="market-copilot-title" onCancel={(event) => {
    event.preventDefault();
    if (!pending) onClose();
  }}>
    <header>
      <h2 id="market-copilot-title"><Sparkles size={20} aria-hidden="true" />ผู้ช่วยจัดซื้อ MarAct</h2>
      <button type="button" disabled={pending} onClick={onClose} aria-label="ปิดแชต"><X size={18} aria-hidden="true" /></button>
    </header>
    <fieldset disabled={pending}>{deliveryFields}</fieldset>
    <div className="market-copilot__thread" role="log" aria-label="บทสนทนา">
      {turns.length === 0 && <p>ลองถาม “หามะม่วง 50 กก. ราคาถูกที่สุด” หรือ “ผลไม้อะไรกำลังเป็นกระแส”</p>}
      {turns.map(({ question, reply, postcode: checkedPostcode, arrival: checkedArrival }, index) => {
        const canApply = reply.delivery_confirmed && postcode === checkedPostcode && arrival === checkedArrival;
        return <section key={index}>
          <p className="market-copilot__question">{question}</p>
          <p>{reply.message}</p>
          <small>{reply.source === 'openai' ? 'ตีความคำขอด้วย OpenAI · ตรวจจากข้อมูลตลาด' : 'ค้นจากข้อมูลตลาดโดยตรง'}</small>
          {reply.tool_calls.length > 0 && <details>
            <summary>เครื่องมือที่เรียก</summary>
            <ul>{reply.tool_calls.map((tool, index) => <li key={index}>{tool.name} · {tool.status}</li>)}</ul>
          </details>}
          {reply.lots.map((lot) => <article key={lot.id}>
            <strong>{lot.name} · {lot.farm}</strong>
            <p>{lot.units} {lot.unit} · ค่าสินค้า ฿{(lot.units * lot.price).toLocaleString('th-TH')}</p>
            {reply.delivery_confirmed && <p>ยอดส่งถึงเบื้องต้น ฿{lot.total.toLocaleString('th-TH')}</p>}
            {canApply && <button type="button" disabled={pending} onClick={() => void apply([lot])}>นำล็อตไปตะกร้า</button>}
          </article>)}
          {reply.groups.map((group) => <article key={group.farm}>
            <strong>{group.farm}</strong>
            <ul>{group.lines.map((lot) => <li key={lot.id}>{lot.name} · {lot.units} {lot.unit}</li>)}</ul>
            {group.total !== null && <p>รวมส่ง ฿{group.total.toLocaleString('th-TH')}</p>}
            {canApply && <button type="button" disabled={pending} onClick={() => void apply(group.lines)}>นำรายการสวนนี้ไปตะกร้า</button>}
          </article>)}
          {reply.unfulfilled.length > 0 && <p>ยังจัดไม่ได้ {reply.unfulfilled.join(', ')}</p>}
          {reply.trends.map((trend) => <article key={trend.fruit_id}>
            <strong>{trend.fruit_name}</strong>
            <p>{trend.value === null ? 'ข้อมูลความสนใจยังไม่เพียงพอ' : `ความสนใจเทียบสัปดาห์ก่อน ${trend.value > 0 ? '+' : ''}${trend.value}%`} · {trend.source_name} · {trend.observation_window}</p>
            {trend.buyer_fit_reasons.map((reason) => <p key={reason}>{reason}</p>)}
            <p>{trend.caveat}</p>
            {trend.market_context?.summary && <p>{trend.market_context.summary.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')}</p>}
            {trend.market_context && trend.market_context.status !== 'available' && <p>ยังไม่มีแหล่งข่าวที่ยืนยันได้ในรอบนี้</p>}
            {!!trend.market_context?.citations.length && <ul>{trend.market_context.citations.map((source, i) => <li key={i}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            </li>)}</ul>}
            <button type="button" onClick={() => onBrowse(trend.fruit_name)}>ดูล็อตในตลาด</button>
          </article>)}
        </section>;
      })}
      {pending && <p role="status">กำลังตรวจข้อมูล…</p>}
      <div ref={latest} />
    </div>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={submit}>
      <label htmlFor="market-copilot-message">ข้อความถึงผู้ช่วย</label>
      <textarea id="market-copilot-message" value={text} maxLength={600} rows={2}
        onChange={(event) => setText(event.target.value)} disabled={pending} />
      <button disabled={pending || !text.trim()}>ส่ง</button>
    </form>
  </dialog>;
}
