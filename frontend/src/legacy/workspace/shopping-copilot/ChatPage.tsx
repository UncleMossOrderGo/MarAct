import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { locales } from '../language';
import type { Language } from '../language';
import { askCopilot } from './api';
import type { Chat, MarketContext, SearchInput } from './api';
import './chat-page.css';

const examples = {
  th: ['หามะม่วง 50 กก. ราคาถูกที่สุด', 'จัดตะกร้ามะม่วง 50 โล กล้วย 30 โล งบ 5,000', 'ผลไม้อะไรกำลังเป็นกระแสและเหมาะกับร้านผม'],
  en: ['Find the cheapest mangoes for 50 kg', 'Build a cart with mango 50 kg and banana 30 kg, budget 5000 THB', 'Which trending fruits fit my shop?'],
};

type Turn = { question: string; answer: Chat; lang: Language };

function CitedSummary({ context }: { context: MarketContext }) {
  const parts = (context.summary ?? '').split(/(\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return <p>{parts.map((part, index) => {
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    if (!link) return part;
    const source = context.citations.findIndex(({ url }) => url === link[2]);
    return source < 0 ? link[1] : <a key={index} href={context.citations[source].url}
      title={context.citations[source].title} target="_blank" rel="noreferrer">[{source + 1}]</a>;
  })}</p>;
}

function Answer({ answer, lang }: Pick<Turn, 'answer' | 'lang'>) {
  const thai = lang === 'th';
  const [accepted, setAccepted] = useState(false);
  const money = new Intl.NumberFormat(locales[lang], {
    style: 'currency', currency: 'THB', currencyDisplay: 'narrowSymbol',
  });
  const format = (value: string) => money.format(Number(value));
  const kg = thai ? 'กก.' : 'kg';
  const cart = answer.suggested_cart;

  return (
    <div className="copilot-chat__answer" lang={lang}>
      <strong className="copilot-chat__speaker">MarAct</strong>
      {answer.tool_calls.length > 0 ? (
        <details className="copilot-chat__tools" open>
          <summary>{thai ? 'เครื่องมือที่เรียก' : 'Tool calls'} <span>{answer.tool_calls.length}</span></summary>
          <ol>{answer.tool_calls.map((call, index) => <li key={index}>
            <span><code>{call.name}</code>{call.fruit_id && <> · {call.fruit_id}</>}</span>
            <span data-status={call.status}>{call.status === 'completed'
              ? (thai ? 'สำเร็จ' : 'Completed') : (thai ? 'ไม่สำเร็จ' : 'Failed')}</span>
          </li>)}</ol>
        </details>
      ) : <p className="copilot-chat__meta">{thai ? 'รอบนี้ไม่ได้เรียกเครื่องมือ' : 'No tool calls this turn.'}</p>}
      {answer.source === 'deterministic' && <p className="copilot-chat__meta">
        {thai ? 'คำตอบจากระบบสำรอง' : 'Built-in fallback response'}
      </p>}
      <p>{answer.message}</p>
      {[...answer.assumptions, ...answer.warnings].map((note, index) => <p className="copilot-chat__meta" key={index}>{note}</p>)}
      {answer.products.length > 0 && <div className="copilot-chat__cards">
        {answer.products.map((product) => <article key={product.listing_id}>
          <strong>{product.product_name}</strong>
          <p>{product.farm_name} · {format(product.unit_price_thb)}/{kg}</p>
          <p>{thai ? 'ขั้นต่ำ' : 'MOQ'} {product.minimum_order_kg} {kg} · {thai ? 'พร้อมขาย' : 'Available'} {product.available_kg} {kg}</p>
          {product.estimated_product_total_thb !== null && <p>
            {thai ? 'ค่าสินค้า' : 'Product subtotal'} {format(product.estimated_product_total_thb)}
          </p>}
          <p>{product.reasons.join(' ')}</p>
          {product.warnings.length > 0 && <p className="copilot-chat__meta">{product.warnings.join(' ')}</p>}
        </article>)}
      </div>}
      {cart && <article className="copilot-chat__card">
        <h3>{thai ? 'ตัวอย่างตะกร้า' : 'Cart preview'}</h3>
        <ul>{cart.line_items.map((item) => <li key={item.listing_id}>
          {item.product_name} · {item.farm_name} · {item.quantity_kg} {kg}
          {item.estimated_product_total_thb !== null && <> · {format(item.estimated_product_total_thb)}</>}
        </li>)}</ul>
        {cart.unfulfilled_items.map(({ item, reason }, index) => <p key={index}>{item.fruit_query} · {reason}</p>)}
        <p><strong>{thai ? 'รวมค่าสินค้า' : 'Product subtotal'} {format(cart.product_subtotal_thb)}</strong></p>
        {cart.remaining_product_budget_thb !== null && <p>{thai ? 'งบค่าสินค้าเหลือ' : 'Remaining product budget'} {format(cart.remaining_product_budget_thb)}</p>}
        <p>{thai ? 'ค่าขนส่ง' : 'Shipping'} {cart.shipping_total_thb === null
          ? (thai ? 'ยังไม่ทราบ' : 'Unknown') : format(cart.shipping_total_thb)}</p>
        {accepted ? <p role="status">{thai ? 'ยืนยันตัวอย่างบนหน้านี้แล้ว' : 'Preview accepted on this page.'}</p>
          : <button type="button" disabled={!cart.line_items.length} onClick={() => setAccepted(true)}>
            {thai ? 'ยืนยันตัวอย่างตะกร้า' : 'Accept cart preview'}
          </button>}
      </article>}
      {answer.trend_opportunities.map((trend) => <article className="copilot-chat__card" key={trend.fruit_id}>
        <h3>{trend.fruit_name}</h3>
        <p>{trend.source_name} · {trend.observation_window}</p>
        {trend.buyer_fit_reasons.length > 0 && <p>{trend.buyer_fit_reasons.join(' ')}</p>}
        <p>{trend.caveat}</p>
        {trend.market_context && <div className="copilot-chat__sources">
          <h4>{thai ? 'ข่าวและแหล่งอ้างอิง' : 'Market news and sources'}</h4>
          {trend.market_context.status === 'available' ? <>
            <CitedSummary context={trend.market_context} />
            <ol>{trend.market_context.citations.map((source, index) => <li key={index}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            </li>)}</ol>
          </> : <p>{thai ? 'ยังไม่มีข่าวที่ใช้อ้างอิงได้ในรอบนี้' : 'No citable news is available for this turn.'}</p>}
        </div>}
      </article>)}
    </div>
  );
}

export function ChatPage({ lang, onLanguageChange }: { lang: Language; onLanguageChange: (lang: Language) => void }) {
  const thai = lang === 'th';
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [error, setError] = useState(false);
  const [buyer, setBuyer] = useState('buyer_demo_1');
  const prior = useRef<SearchInput | null>(null);
  const conversation = useRef<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length || pending) latest.current?.scrollIntoView({ block: 'end' });
  }, [pending, turns.length]);

  function reset(nextBuyer = buyer) {
    setBuyer(nextBuyer);
    setTurns([]);
    setMessage('');
    setError(false);
    prior.current = null;
    conversation.current = null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || pending) return;
    const question = message.trim();
    setMessage('');
    setPendingQuestion(question);
    setPending(true);
    setError(false);
    try {
      const answer = await askCopilot(buyer, question, conversation.current, prior.current, lang);
      conversation.current = answer.conversation_id;
      if (answer.search_context) prior.current = answer.search_context;
      setTurns((current) => [...current, { question, answer, lang }]);
    } catch {
      setMessage(question);
      setError(true);
    } finally {
      setPending(false);
      requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    }
  }

  return (
    <div className="buyer-intelligence copilot-chat" lang={lang}>
      <div className="copilot-chat__bar">
        <h1>{thai ? 'ผู้ช่วยจัดซื้อผลไม้' : 'Shopping Copilot'}</h1>
        <div>
          <label>
            <span className="copilot-chat__sr">{thai ? 'โปรไฟล์ผู้ซื้อเดโม' : 'Demo buyer profile'}</span>
            <select value={buyer} disabled={pending} onChange={(event) => reset(event.target.value)}>
              <option value="buyer_demo_1">{thai ? 'ร้านสมูทตี้ · เดโม' : 'Smoothie shop · Demo'}</option>
              <option value="buyer_demo_2">{thai ? 'ร้านขายผลไม้ · เดโม' : 'Fruit retailer · Demo'}</option>
            </select>
          </label>
          <button type="button" disabled={pending} onClick={() => reset()}>{thai ? 'แชตใหม่' : 'New chat'}</button>
          <button type="button" lang={thai ? 'en' : 'th'} onClick={() => onLanguageChange(thai ? 'en' : 'th')}>
            {thai ? 'English' : 'ไทย'}
          </button>
        </div>
      </div>
      <div className="copilot-chat__thread">
        {!turns.length && !pending && <div className="copilot-chat__welcome">
          <h2>{thai ? 'วันนี้อยากจัดซื้ออะไร?' : 'What are you sourcing today?'}</h2>
          <p>{thai ? 'ค้นหาฟาร์ม เทียบราคา หรือวางตะกร้าจากแคตตาล็อกเดโม' : 'Find farms, compare prices, or plan a cart from the demo catalog.'}</p>
          <div className="copilot-chat__examples">
            {examples[lang].map((example) => <button key={example} type="button" onClick={() => {
              setMessage(example);
              input.current?.focus();
            }}>{example}</button>)}
          </div>
        </div>}
        <div role="log" aria-label={thai ? 'บทสนทนา' : 'Conversation'}>
          {turns.map((turn, index) => <div className="copilot-chat__turn" key={index}>
            <p className="copilot-chat__question">{turn.question}</p>
            <Answer answer={turn.answer} lang={turn.lang} />
          </div>)}
        </div>
        {pending && <div className="copilot-chat__turn">
          <p className="copilot-chat__question">{pendingQuestion}</p>
          <p className="copilot-chat__pending" role="status">
            {thai ? 'กำลังประมวลผลคำขอ…' : 'Working on your request…'}
          </p>
        </div>}
        <div className="copilot-chat__latest" ref={latest} />
      </div>
      <div className="copilot-chat__footer">
        {error && <p role="alert">{thai ? 'ส่งข้อความไม่ได้ ลองอีกครั้ง' : 'Could not send. Try again.'}</p>}
        <form onSubmit={submit}>
          <label className="copilot-chat__sr" htmlFor="copilot-chat-message">{thai ? 'ข้อความถึงผู้ช่วยจัดซื้อ' : 'Message the shopping copilot'}</label>
          <textarea id="copilot-chat-message" ref={input} value={message} disabled={pending} required maxLength={600} rows={2}
            placeholder={thai ? 'พิมพ์ข้อความ…' : 'Type a message…'}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && message.trim()) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }} />
          <button className="buyer-intelligence__primary" disabled={pending || !message.trim()}>
            {thai ? 'ส่ง' : 'Send'}
          </button>
        </form>
        <a href="/ideas/idea-b/workspace">{thai ? 'เปิดหน้าจัดซื้อแบบเดิม' : 'Open the procurement workspace'}</a>
      </div>
    </div>
  );
}
