import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, CornerDownLeft, History, MessageCircle, Plus, Sparkles, Warehouse, X } from 'lucide-react';
import { requestJson } from '../../shared/http';
import type { MarketCartItem } from './market-cart';
import type { DailyLocale } from './market-daily-types';
import { ingredientImage } from './market-ingredient-assets';
import { ChatMarkdown, ChatToolActivity, type ToolActivity } from './market-chat-reply';
import { MarketVoiceInput } from './market-voice-input';
import './market-assistant.css';

type Page = 'today' | 'trend' | 'ingredients' | 'marketplace' | 'cart' | 'payment' | 'order' | 'orders' | 'stock' | 'settings';
type Focus = { type: 'trend' | 'ingredient' | 'order'; id: string };
type Thread = { id: string; title: string };
type CartAction = { type: 'add_to_cart'; image_key?: string } & MarketCartItem;
type Action = ToolActivity | CartAction | { type: 'source'; url: string; title: string };
type Turn = { request_id: string; question: string; answer: string; actions: Action[] };
type Stock = { ingredient_id: string; name_en: string; name_th: string; kg_on_hand: string | null; days_of_cover: string | null };
type Pending = { request_id: string; question: string; thread: Thread };

export type MarketAssistantProps = {
  shopId: string;
  locale: DailyLocale;
  page: Page;
  focused?: Focus;
  cart?: readonly MarketCartItem[];
  onAdd?: (line: MarketCartItem) => void;
  openRequest?: number;
  openQuestion?: string;
};

const labels = {
  en: {
    title: 'MarAct Assistant', open: 'Ask agent', close: 'Close assistant', new: 'New chat',
    stock: 'Shop stock', placeholder: 'Ask about your shop, trends, or orders', send: 'Send',
    loading: 'Thinking…', error: 'The agent is unavailable right now.', retry: 'Retry',
    loadError: 'Could not load conversations.', stockError: 'Could not load or save stock.',
    ingredient: 'Ingredient', kg: 'Kilograms on hand', save: 'Save stock',
    saved: 'Stock saved.', unknown: 'Stock not recorded', add: 'Add to cart', added: 'Added',
    sources: 'Sources', cover: 'Days of cover', recent: 'Recent chats', welcome: 'What’s on the menu?',
    greeting: 'Ask about today’s trends, what you have in stock, or ideas for your menu.',
    trendPrompts: ['Why is this trend rising?', 'Do I have enough stock for this trend?', 'Give me three menu ideas'],
    orderPrompt: 'What is the status of this order?',
    cartPrompt: 'Is this enough for a week?',
    stockPrompts: ['Which ingredients will run out first?', 'Plan my purchases for the next seven days'],
  },
  th: {
    title: 'ผู้ช่วย MarAct', open: 'ถามผู้ช่วย', close: 'ปิดผู้ช่วย', new: 'แชตใหม่',
    stock: 'สต็อกร้าน', placeholder: 'ถามเรื่องร้าน เทรนด์ หรือคำสั่งซื้อ', send: 'ส่ง',
    loading: 'กำลังคิด…', error: 'ผู้ช่วยไม่พร้อมใช้งานในขณะนี้', retry: 'ลองอีกครั้ง',
    loadError: 'ไม่สามารถโหลดบทสนทนาได้', stockError: 'ไม่สามารถโหลดหรือบันทึกสต็อกได้',
    ingredient: 'วัตถุดิบ', kg: 'สต็อกคงเหลือ (กก.)', save: 'บันทึกสต็อก',
    saved: 'บันทึกสต็อกแล้ว', unknown: 'ยังไม่บันทึกสต็อก', add: 'เพิ่มลงตะกร้า', added: 'เพิ่มแล้ว',
    sources: 'แหล่งข้อมูล', cover: 'จำนวนวันที่สต็อกเพียงพอ', recent: 'แชตล่าสุด', welcome: 'วันนี้อยากทำเมนูอะไร',
    greeting: 'ถามเกี่ยวกับเทรนด์วันนี้ สต็อกของร้าน หรือไอเดียเมนู',
    trendPrompts: ['ทำไมเทรนด์นี้กำลังมาแรง', 'สต็อกของฉันพอสำหรับเทรนด์นี้ไหม', 'ขอไอเดียเมนูสามอย่าง'],
    orderPrompt: 'คำสั่งซื้อนี้อยู่ในสถานะใด',
    cartPrompt: 'ปริมาณนี้พอใช้หนึ่งสัปดาห์ไหม',
    stockPrompts: ['วัตถุดิบไหนจะหมดก่อน', 'ช่วยวางแผนซื้อวัตถุดิบสำหรับเจ็ดวันข้างหน้า'],
  },
} as const;

const writeJson = (method: string, value?: object): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: value ? JSON.stringify(value) : undefined,
});
const storePath = (shopId: string) => `/api/shop/shops/${encodeURIComponent(shopId)}`;

async function readReply(
  response: Response,
  onText: (delta: string | null) => void,
  onActions: (actions: Action[]) => void,
  onTool: (activity: ToolActivity) => void,
) {
  if (!response.ok || !response.body) throw new Error('Assistant reply failed');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let done = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      buffer += part.value;
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const lines = frame.split('\n');
        const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
        const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
        if (!event || data === undefined) continue;
        if (event === 'error') throw new Error('Assistant unavailable');
        if (event === 'done') done = true;
        if (event === 'tool') onTool(JSON.parse(data) as ToolActivity);
        if (event === 'reset') onText(null);
        if (event === 'text') onText((JSON.parse(data) as { delta: string }).delta);
        if (event === 'actions') onActions(JSON.parse(data) as Action[]);
      }
    }
    if (!done) throw new Error('Assistant reply was interrupted');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function StockEditor({ shopId, locale }: { shopId: string; locale: DailyLocale }) {
  const copy = labels[locale];
  const prefix = storePath(shopId);
  const [items, setItems] = useState<Stock[]>([]);
  const [ingredient, setIngredient] = useState('');
  const [quantity, setQuantity] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ items: Stock[] }>(`${prefix}/stock`, { signal: controller.signal })
      .then(({ items: rows }) => {
        setItems(rows);
        setIngredient(rows[0]?.ingredient_id ?? '');
        setQuantity(rows[0]?.kg_on_hand ?? '');
        setStatus('ready');
      }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [prefix]);

  const current = items.find((item) => item.ingredient_id === ingredient);
  const valid = /^\d+(\.\d{1,3})?$/.test(quantity) && Number(quantity) <= 1_000_000;
  return <form className="market-chat-stock" onSubmit={(event) => {
    event.preventDefault();
    if (!current || !valid || status === 'saving') return;
    setStatus('saving');
    requestJson<{ kg_on_hand: string }>(`${prefix}/stock`, writeJson('PUT', { ingredient_id: ingredient, kg_on_hand: quantity }))
      .then(({ kg_on_hand }) => {
        setItems((rows) => rows.map((row) => row.ingredient_id === ingredient ? { ...row, kg_on_hand } : row));
        window.dispatchEvent(new Event('maract:stock-updated'));
        setStatus('saved');
      }).catch(() => setStatus('error'));
  }}>
    <label>{copy.ingredient}<select value={ingredient} disabled={status === 'saving'} onChange={(event) => {
      const id = event.currentTarget.value;
      setIngredient(id);
      setQuantity(items.find((row) => row.ingredient_id === id)?.kg_on_hand ?? '');
      setStatus('ready');
    }}>
      {items.map((row) => <option key={row.ingredient_id} value={row.ingredient_id}>
        {locale === 'th' ? row.name_th || row.name_en : row.name_en}
      </option>)}
    </select></label>
    <label>{copy.kg}<input type="number" min={0} max={1_000_000} step="0.001" value={quantity}
      placeholder={copy.unknown} onChange={(event) => setQuantity(event.currentTarget.value)} /></label>
    {current?.days_of_cover && <small>{copy.cover}: {current.days_of_cover}</small>}
    <button type="submit" disabled={!valid || !current || status === 'saving'}>{copy.save}</button>
    {status === 'saved' && <p role="status">{copy.saved}</p>}
    {status === 'error' && <p role="alert">{copy.stockError}</p>}
  </form>;
}

function ShopAssistant({ shopId, locale, page, focused, cart, onAdd, openRequest, openQuestion }: MarketAssistantProps) {
  const copy = labels[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const output = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const followOutput = useRef(true);
  const request = useRef<AbortController>(null);
  const running = useRef(false);
  const openSequence = useRef(0);
  const title = useId();
  const root = `${storePath(shopId)}/agent/threads`;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<Thread>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending>();
  const [activity, setActivity] = useState<ToolActivity[]>([]);
  const [partial, setPartial] = useState('');
  const [stock, setStock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  async function loadThreads(signal?: AbortSignal) {
    const result = await requestJson<{ threads: Thread[] }>(root, { signal });
    setThreads(result.threads);
  }

  function open() {
    if (dialog.current?.open) return;
    dialog.current?.showModal();
    setLoadFailed(false);
    void loadThreads().catch(() => setLoadFailed(true));
  }

  const askFromPage = useEffectEvent(() => {
    setStock(false);
    open();
    const question = focused?.type === 'order' ? copy.orderPrompt
      : focused?.type === 'ingredient' ? (locale === 'th' ? 'จากสต็อกและยอดใช้จริง ร้านควรซื้อวัตถุดิบนี้เพิ่มไหม?' : 'Given my stock and usage, should I buy more of this ingredient?')
      : (locale === 'th' ? 'เทรนด์นี้น่าลองสำหรับร้านไหม? ดูหลักฐาน วัตถุดิบที่มี และแนะนำขั้นตอนต่อไป' : 'Is this trend worth testing for my shop? Check the evidence and my stock, then suggest a next step.');
    void send(openQuestion ?? question);
  });
  useEffect(() => {
    if (!openRequest || openRequest === openSequence.current || busy) return;
    openSequence.current = openRequest;
    askFromPage();
  }, [openRequest, busy]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (output.current && followOutput.current) output.current.scrollTop = output.current.scrollHeight; }, [turns, partial, pending, activity]);

  function clearThread() {
    followOutput.current = true;
    request.current?.abort();
    setActive(undefined);
    setTurns([]);
    setPending(undefined);
    setPartial('');
    setActivity([]);
    setFailed(false);
    setDraft('');
  }

  async function switchThread(thread: Thread) {
    if (running.current) return;
    clearThread();
    setBusy(true);
    running.current = true;
    setLoadFailed(false);
    try {
      const { messages } = await requestJson<{ messages: Turn[] }>(`${root}/${encodeURIComponent(thread.id)}/messages`);
      setActive(thread);
      setTurns(messages);
    } catch {
      setLoadFailed(true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function send(question: string, retry?: Pending) {
    if (running.current || !question.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    running.current = true;
    setBusy(true);
    setFailed(false);
    setPartial('');
    setActivity([]);
    setDraft('');
    followOutput.current = true;
    let turn = retry;
    try {
      if (!turn) {
        const thread = active ?? await requestJson<Thread>(root, {
          ...writeJson('POST'), signal: controller.signal,
        });
        setActive(thread);
        turn = { request_id: crypto.randomUUID(), question: question.trim(), thread };
      }
      const sent = turn;
      setPending(sent);
      let answer = '';
      let actions: Action[] = [];
      const response = await fetch(`${root}/${encodeURIComponent(sent.thread.id)}/messages`, {
        ...writeJson('POST', {
          request_id: sent.request_id, message: sent.question, locale,
          page_context: { page, focused, cart: cart?.slice(0, 30).map(({ listing_id, qty_kg }) => ({ listing_id, qty_kg })) ?? [] },
        }),
        signal: controller.signal,
      });
      await readReply(response, (delta) => {
        answer = delta === null ? '' : answer + delta;
        setPartial(answer);
      }, (values) => { actions = values; }, (tool) => {
        setActivity((current) => current.some((item) => item.id === tool.id)
          ? current.map((item) => item.id === tool.id ? tool : item) : [...current, tool]);
      });
      setTurns((messages) => [...messages, { request_id: sent.request_id, question: sent.question, answer, actions }]);
      setPending(undefined);
      setPartial('');
      void loadThreads(controller.signal).catch(() => undefined);
    } catch {
      if (!controller.signal.aborted) {
        if (!turn) setDraft(question);
        setActivity((items) => items.map((item) => item.state === 'running' ? { ...item, state: 'error' } : item));
        setPartial('');
        setFailed(true);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const prompts = page === 'stock' ? copy.stockPrompts : page === 'order' ? [copy.orderPrompt] : page === 'cart' ? [copy.cartPrompt] : copy.trendPrompts;
  return <>
    <button className="market-chat-launch" type="button" onClick={open}>
      <MessageCircle size={20} aria-hidden="true" />{copy.open}
    </button>
    {createPortal(<dialog ref={dialog} lang={locale} className="market-chat" aria-labelledby={title}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="market-chat-body">
        <header className="market-chat-header"><span className="market-chat-avatar"><Sparkles size={22} aria-hidden="true" /></span><strong id={title}>{copy.title}</strong>
          <button type="button" onClick={() => dialog.current?.close()} aria-label={copy.close}><X size={19} /></button>
        </header>
        <div className="market-chat-top">
          <button type="button" disabled={busy} onClick={() => { clearThread(); setStock(false); }}>
            <Plus size={16} aria-hidden="true" />{copy.new}
          </button>
          <button type="button" aria-pressed={stock} onClick={() => setStock(!stock)}>
            <Warehouse size={16} aria-hidden="true" />{copy.stock}
          </button>
        </div>
        {threads.length > 0 && <details className="market-chat-history">
          <summary><History size={15} aria-hidden="true" />{copy.recent}<span>{threads.length}</span></summary>
          <div>
          {threads.map((thread) => <button key={thread.id} type="button" aria-pressed={active?.id === thread.id} disabled={busy}
            onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setStock(false); void switchThread(thread); }}>{thread.title || copy.new}</button>)}
          </div>
        </details>}
        {stock ? <StockEditor shopId={shopId} locale={locale} /> : <>
          <div className="market-chat-scroll" ref={output} onScroll={(event) => {
            const list = event.currentTarget;
            followOutput.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
          }} role="log" aria-live="polite">
            {loadFailed && <p role="alert">{copy.loadError}</p>}
            {turns.length === 0 && !pending && <div className="market-chat-greeting"><Sparkles size={26} aria-hidden="true" /><h2>{copy.welcome}</h2><p>{copy.greeting}</p>
              {(page === 'stock' || page === 'today') && <button type="button" className="market-brief-button" disabled={busy}
                onClick={() => void send(locale === 'th'
                  ? 'สรุปก่อนเปิดร้านจากข้อมูลล่าสุด: เช็กสต็อกที่ขาดใน 7 วัน เทรนด์ที่ทำขายได้หนึ่งรายการ และคำสั่งซื้อที่ต้องติดตาม ระบุหนึ่งสิ่งที่ควรทำก่อน พร้อมเสนอวัตถุดิบลงตะกร้าถ้าจำเป็น'
                  : 'Prepare my opening brief. Check this shop’s stock against seven-day usage, today’s most practical menu trend, and orders needing attention. Give me one priority and propose basket items only for verified shortages.')}>
                <Sparkles size={16} aria-hidden="true" />{locale === 'th' ? 'สรุปงานก่อนเปิดร้าน' : 'Prepare my opening brief'}
              </button>}</div>}
            {turns.map((turn) => <div className="market-chat-turn" key={turn.request_id}>
              <p className="market-chat-question">{turn.question}</p>
              <ChatToolActivity items={turn.actions.filter((action): action is ToolActivity => action.type === 'tool')} locale={locale} />
              <ChatMarkdown answer={turn.answer} sources={turn.actions.flatMap((action) => action.type === 'source' ? [action.url] : [])} />
              {onAdd && turn.actions.filter((action): action is CartAction => action.type === 'add_to_cart').map((action) => {
                const key = `${turn.request_id}:${action.listing_id}`;
                return <button key={key} type="button" disabled={added.has(key)} onClick={() => {
                  dialog.current?.close();
                  onAdd({ listing_id: action.listing_id, qty_kg: action.qty_kg,
                    ingredient_name: action.ingredient_name ?? action.fruit_name ?? '', seller_name: action.seller_name,
                    price_per_kg_thb: action.price_per_kg_thb, stock_kg: action.stock_kg,
                    image_url: ingredientImage(action.image_key),
                    trend_slug: action.trend_slug, trend_label: action.trend_label,
                  });
                  setAdded((current) => new Set(current).add(key));
                }}>{added.has(key) ? copy.added : `${copy.add} · ${action.ingredient_name} · ${action.qty_kg} kg`}</button>;
              })}
              {turn.actions.some((action) => action.type === 'source') && <ul aria-label={copy.sources}>
                {turn.actions.map((action) => action.type === 'source' && /^https?:\/\//i.test(action.url)
                  ? <li key={action.url}><a href={action.url} target="_blank" rel="noreferrer noopener">{action.title}</a></li>
                  : null)}
              </ul>}
            </div>)}
            {pending && <div className="market-chat-turn">
              <p className="market-chat-question">{pending.question}</p>
              <ChatToolActivity items={activity} locale={locale} />
              {partial && <ChatMarkdown answer={partial} sources={[]} />}
            </div>}
            {busy && !partial && !activity.some((item) => item.state === 'running') && <p className="market-chat-thinking" role="status"><span aria-hidden="true"><i/><i/><i/></span>{copy.loading}</p>}
            {failed && <div role="alert">{copy.error} {pending && <button type="button" onClick={() => void send(pending.question, pending)}>
              {copy.retry}</button>}</div>}
          </div>
          <div className="market-chat-prompts">{prompts.map((prompt) => <button key={prompt} type="button" disabled={busy}
            onClick={() => void send(prompt)}>{prompt}<CornerDownLeft size={13} aria-hidden="true" /></button>)}</div>
          <form className="market-chat-compose" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
            <textarea ref={composer} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }} aria-label={copy.placeholder} placeholder={copy.placeholder}
              maxLength={2000} rows={2} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
            <MarketVoiceInput key={active?.id ?? 'new'} shopId={shopId} locale={locale} disabled={busy}
              onTranscript={(text) => { setDraft((value) => [value, text].filter(Boolean).join(' ').slice(0, 2000)); composer.current?.focus(); }} />
            <button type="submit" aria-label={copy.send} disabled={busy || !draft.trim()}><ArrowUp size={20} /></button>
          </form>
        </>}
      </div>
    </dialog>, document.body)}
  </>;
}

export function MarketAssistantPanel(props: MarketAssistantProps) {
  return <ShopAssistant key={props.shopId} {...props} />;
}
