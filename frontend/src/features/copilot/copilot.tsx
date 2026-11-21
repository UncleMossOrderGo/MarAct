import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowUp, ChevronRight, MessageCircle, Minus, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { requestJson } from '../../shared/http';
import type { Lot } from '../marketplace/types';
import { VoiceInput } from './VoiceInput';
import './copilot.css';

const mascot = new URL('../../shared/brand/maract-mascot.webp', import.meta.url).href;

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
  guest_mode?: boolean;
};

export function MarketCopilot({ open, onOpen, business, initialText, postcode, arrival, preference, deliveryFields, onClose, onApply, onBrowse }: {
  open: boolean;
  onOpen: () => void;
  business: string;
  initialText: string;
  postcode: string;
  arrival: string;
  preference: string;
  deliveryFields: ReactNode;
  onClose: () => void;
  onApply: (lots: Lot[]) => Promise<void>;
  onBrowse: (query: string) => void;
}) {
  const composer = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const prior = useRef<Criteria | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(initialText.slice(0, 600));
  const [turns, setTurns] = useState<{ question: string; reply: Reply; postcode: string; arrival: string }[]>([]);
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !dialog.current) return;
    const panel = dialog.current;
    const mobile = window.matchMedia('(max-width: 600px)');
    function showPanel() {
      panel.close();
      if (mobile.matches) panel.showModal();
      else panel.show();
      composer.current?.focus({ preventScroll: true });
    }
    showPanel();
    mobile.addEventListener('change', showPanel);
    return () => {
      mobile.removeEventListener('change', showPanel);
      panel.close();
      launcher.current?.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    if (open && thread.current) thread.current.scrollTop = turns.length || pending ? thread.current.scrollHeight : 0;
  }, [open, turns.length, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || pending) return;
    const question = text.trim();
    setSending(question);
    setText('');
    setPending(true);
    setError('');
    try {
      const reply = await requestJson<Reply>('/api/ideas/idea-c/copilot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question, postcode: /^\d{5}$/.test(postcode) ? postcode : null,
          arrival: arrival || null, preference, previous: prior.current,
          history: turns.slice(-8).map(({ question, reply }) => ({
            question,
            answer: [reply.message, ...reply.trends.map(t => t.fruit_name),
              ...reply.lots.map(l => l.name + ' · ' + l.farm), ...reply.groups.map(g => g.farm)]
              .join(' / ').slice(0, 1200),
          })),
        }),
      });
      if (reply.previous || reply.trends.length) prior.current = reply.previous;
      setTurns((current) => [...current, { question, reply, postcode, arrival }]);
    } catch {
      setText(question);
      setError('ส่งข้อความไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSending('');
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

  return <>
    <button type="button" ref={launcher} className="copilot-launch" hidden={open} onClick={onOpen}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'market-copilot' : undefined} aria-label="ผู้ช่วยจัดซื้อ AI · ถาม AI">
      <MessageCircle size={24} aria-hidden="true"/><span>ถาม AI</span>
    </button>
    {open && <dialog ref={dialog} id="market-copilot" className="market-copilot" aria-labelledby="market-copilot-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <img className="copilot-avatar" src={mascot} alt="" width="44" height="44"/>
      <div><h2 id="market-copilot-title">ผู้ช่วยจัดซื้อ MarAct</h2><p>ค้นหาล็อต · เทียบราคา · เช็กวันส่ง</p></div>
      <button type="button" onClick={onClose} aria-label="ย่อแชต" title="ย่อแชต"><Minus size={20}/></button>
    </header>
    <div className="market-copilot__thread" ref={thread} role="log" aria-label="บทสนทนา">
      {!turns.length && !sending && <div className="copilot-examples">
        <Sparkles size={23} aria-hidden="true"/>
        <p>วันนี้อยากได้ผลไม้อะไรเข้าร้านครับ?</p>
        <span>บอกชนิดผลไม้และจำนวนที่ต้องการได้เลย</span>
        {[business ? 'อยากเปิด' + business + ' ควรเลือกผลไม้จากสวนไหน?' : 'อยากเปิดร้านน้ำมะม่วงปั่น ควรเลือกมะม่วงแบบไหน?', 'หามะม่วง 50 กก. ราคาถูกที่สุด', 'ผลไม้อะไรกำลังเป็นกระแส'].map(question =>
          <button type="button" key={question} disabled={pending} onClick={() => { setText(question); composer.current?.focus(); }}>{question}<ChevronRight size={16}/></button>)}
      </div>}
      {turns.map(({ question, reply, postcode: checkedPostcode, arrival: checkedArrival }, index) => {
        const canApply = reply.delivery_confirmed && postcode === checkedPostcode && arrival === checkedArrival;
        return <div className="copilot-turn" key={index}>
          <p className="market-copilot__question">{question}</p>
          <div className="copilot-answer"><p>{reply.message}</p>
          <small>{reply.source === 'openai' ? 'ตีความคำขอด้วย OpenAI · ตรวจจากข้อมูลตลาด' : 'ค้นจากข้อมูลตลาดโดยตรง'}</small>
          {reply.guest_mode && <p><Link to="/market#buyer">เข้าสู่บัญชีผู้ซื้อ</Link> เพื่อให้ OpenAI ช่วยตีความคำถามตามโควตาของร้าน</p>}
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
          {reply.previous?.query && <Link className="copilot-farm-link" to={'/farms?' + new URLSearchParams({ q: reply.previous.query })}>ดูประกาศจากสวนสำหรับ “{reply.previous.query}”</Link>}
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
          </div>
        </div>;
      })}
      {sending && <p className="market-copilot__question">{sending}</p>}
      {pending && <p className="copilot-status" role="status">{sending ? 'กำลังดูข้อมูลตลาด…' : 'กำลังตรวจยอดกับสวน…'}</p>}
    </div>
    <fieldset className="copilot-shipping" aria-label="เงื่อนไขจัดส่ง" disabled={pending}>
      {deliveryFields}
    </fieldset>
    {error && <p className="copilot-error" role="alert">{error}</p>}
    <form onSubmit={submit}>
      <textarea ref={composer} aria-label="ข้อความถึงผู้ช่วย" placeholder="พิมพ์ถามผู้ช่วยจัดซื้อ…" id="market-copilot-message" value={text} maxLength={600} rows={1}
        onChange={event => setText(event.target.value)} readOnly={pending}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}/>
      {!pending && <VoiceInput onNotice={setError} onText={spoken => {
        setText(current => [current.trimEnd(), spoken].filter(Boolean).join(' ').slice(0, 600));
        composer.current?.focus();
      }}/>}
      <button type="submit" aria-label="ส่ง" disabled={pending || !text.trim()}><ArrowUp size={21}/></button>
    </form>
    </dialog>}
  </>;
}
