import { useState } from 'react';
import type { FormEvent } from 'react';
import { locales } from '../language';
import type { Language } from '../language';
import { askCopilot, findProducts, loadMarket, loadOpportunities, previewItem } from './api';
import type { Cart, MarketContext, Opportunity, Product, SearchInput, Sort } from './api';
import './shopping-copilot.css';

export function ShoppingCopilot({ lang }: { lang: Language }) {
  const thai = lang === 'th';
  const starter = thai ? 'จัดตะกร้ามะม่วง 50 โล กล้วย 30 โล งบ 5,000' : 'Build a cart with mango 50 kg, banana 30 kg, budget 5000 THB';
  const [buyer, setBuyer] = useState('buyer_demo_1');
  const [query, setQuery] = useState('');
  const [quantity, setQuantity] = useState('');
  const [deadline, setDeadline] = useState('');
  const [budget, setBudget] = useState('');
  const [sort, setSort] = useState<Sort>('relevance');
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<{ question: string; answer: string }[]>([]);
  const [conversation, setConversation] = useState<string | null>(null);
  const [prior, setPrior] = useState<SearchInput | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [trends, setTrends] = useState<Opportunity[] | null>(null);
  const [market, setMarket] = useState<{ fruit: string; context: MarketContext } | null>(null);
  const [trialQuantity, setTrialQuantity] = useState('');
  const money = new Intl.NumberFormat(locales[lang], {
    style: 'currency', currency: 'THB', currencyDisplay: 'narrowSymbol',
  });
  const date = new Intl.DateTimeFormat(locales[lang], { dateStyle: 'medium', timeZone: 'Asia/Bangkok' });
  const value = (amount: string) => money.format(Number(amount));

  function resetBuyer(next: string) {
    setBuyer(next);
    setConversation(null);
    setTurns([]);
    setMessage('');
    setPrior(null);
    setProducts([]);
    setCart(null);
    setAccepted(false);
    setNotice([]);
    setError(false);
    setTrends(null);
    setMarket(null);
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await searchFor(query);
  }

  async function searchFor(fruit: string) {
    const request = { buyer_id: buyer, fruit_query: fruit, quantity_kg: quantity || null,
      sort_by: sort, delivery_by: deadline || null, max_product_total_thb: budget || null };
    await run(async () => {
      const result = await findProducts(request, lang);
      setPrior(request);
      setProducts(result.items);
      setNotice([result.sort_basis === 'lowest_product_price'
        ? (thai ? 'เรียงตามราคาสินค้าต่อกิโล' : 'Sorted by product price per kg')
        : (thai ? 'จัดอันดับตามโปรไฟล์ร้านเดโม' : 'Ranked using the demo buyer profile'), ...result.warnings]);
    });
  }

  async function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    const question = message.trim();
    await run(async () => {
      const result = await askCopilot(buyer, question, conversation, prior, lang);
      setTurns((existing) => [...existing.slice(-3), { question, answer: result.message }]);
      setMessage('');
      setConversation(result.conversation_id);
      if (result.search_context) setPrior(result.search_context);
      setProducts(result.products);
      if (result.trend_opportunities.length > 0) setTrends(result.trend_opportunities);
      if (result.suggested_cart) {
        setCart(result.suggested_cart);
        setAccepted(false);
      }
      setNotice([...result.assumptions, ...result.warnings,
        ...(result.source === 'deterministic' ? [thai ? 'ใช้การช่วยค้นหาแบบพื้นฐาน' : 'Using built-in shopping assistance'] : [])]);
    });
  }

  return (
    <section className="buyer-intelligence__panel shopping-copilot" aria-labelledby="shopping-copilot-heading">
      <div className="buyer-intelligence__panel-heading">
        <h2 id="shopping-copilot-heading">{thai ? 'ผู้ช่วยจัดซื้อผลไม้' : 'Shopping Copilot'}</h2>
        <p>{thai ? 'บอกว่าต้องการซื้ออะไร ผู้ช่วยจะค้นจากแคตตาล็อกเดโมให้' : 'Tell the copilot what you need. It searches the demo catalog.'}</p>
      </div>
      <label className="shopping-copilot__profile">
        {thai ? 'โปรไฟล์ผู้ซื้อเดโม' : 'Demo buyer profile'}
        <select value={buyer} onChange={(event) => resetBuyer(event.target.value)} disabled={pending}>
          <option value="buyer_demo_1">{thai ? 'ร้านสมูทตี้' : 'Smoothie shop'}</option>
          <option value="buyer_demo_2">{thai ? 'ร้านขายผลไม้' : 'Fruit retailer'}</option>
        </select>
      </label>
      <form onSubmit={submitChat} className="buyer-intelligence__form shopping-copilot__brief">
        {turns.length > 0 && <div className="shopping-copilot__log" role="log"
          aria-label={thai ? 'บทสนทนากับผู้ช่วยจัดซื้อ' : 'Shopping conversation'}>
          {turns.map((turn, index) => <div key={index}>
            <p><strong>{thai ? 'คุณ' : 'You'}</strong> {turn.question}</p>
            <p>{turn.answer}</p>
          </div>)}
        </div>}
        <label htmlFor="shopping-message">{thai ? 'ถามผู้ช่วยจัดซื้อ' : 'Ask the shopping copilot'}</label>
        <textarea id="shopping-message" value={message} disabled={pending} onChange={(event) => setMessage(event.target.value)}
          maxLength={600} rows={3} required placeholder={starter} />
        <div className="shopping-copilot__actions">
          <button className="buyer-intelligence__primary" disabled={pending || !message.trim()}>
            {thai ? 'ส่งข้อความ' : 'Send message'}
          </button>
          {turns.length === 0 && <button type="button" disabled={pending} onClick={() => setMessage(starter)}>
            {thai ? 'ใช้ข้อความตัวอย่าง' : 'Use a sample message'}
          </button>}
        </div>
      </form>
      <details className="buyer-intelligence__brief shopping-copilot__manual">
        <summary>{thai ? 'ค้นหาและกรองเอง' : 'Search and filter manually'}</summary>
        <form onSubmit={submitSearch} className="buyer-intelligence__form">
          <div className="buyer-intelligence__inputs">
            <label>{thai ? 'ค้นหาผลไม้' : 'Search fruit'}
              <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} />
            </label>
            <label>{thai ? 'ปริมาณที่ต้องการ (กก.)' : 'Requested quantity (kg)'}
              <input type="number" min="0.01" max="99999.99" step="0.01"
                value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </label>
            <label>{thai ? 'ส่งภายในวันที่' : 'Deliver by'}
              <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
            </label>
            <label>{thai ? 'งบค่าสินค้า (บาท)' : 'Product budget (THB)'}
              <input type="number" min="0.01" max="99999999.99" step="0.01"
                value={budget} onChange={(event) => setBudget(event.target.value)} />
            </label>
          </div>
          <label className="shopping-copilot__profile">{thai ? 'เรียงสินค้า' : 'Sort listings'}
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="relevance">{thai ? 'แนะนำให้ร้านของคุณ' : 'Recommended for your business'}</option>
              <option value="lowest_product_price">{thai ? 'ราคาสินค้าต่อกิโลต่ำสุด' : 'Lowest product unit price'}</option>
            </select>
          </label>
          <button disabled={pending}>{thai ? 'ค้นหาจากแคตตาล็อก' : 'Search the catalog'}</button>
        </form>
      </details>
      {pending && <p role="status">{thai ? 'กำลังตรวจข้อมูลแคตตาล็อก…' : 'Checking the catalog…'}</p>}
      {error && <p role="alert">{thai ? 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่' : 'Could not complete the request. Try again.'}</p>}
      {notice.length > 0 && <div className="shopping-copilot__notice" aria-live="polite">
        {notice.map((line, index) => <p key={index}>{line}</p>)}
      </div>}
      {products.length > 0 && <div className="shopping-copilot__products">
        {products.map((product) => <article className="buyer-intelligence__farm" key={product.listing_id}>
          <h3>{product.product_name}</h3>
          <p>{product.farm_name}</p>
          <p><strong>{value(product.unit_price_thb)}</strong> / {thai ? 'กก.' : 'kg'}</p>
          <p>{thai ? 'ขั้นต่ำ' : 'MOQ'} {product.minimum_order_kg} · {thai ? 'พร้อมขาย' : 'Available'} {product.available_kg} {thai ? 'กก.' : 'kg'}</p>
          <p>{thai ? 'ส่งได้เร็วสุด' : 'Earliest delivery'} {date.format(new Date(product.earliest_delivery))}</p>
          {product.estimated_product_total_thb !== null &&
            <p>{thai ? 'รวมค่าสินค้า' : 'Product total'} {value(product.estimated_product_total_thb)}</p>}
          {product.estimated_shipping_thb !== null &&
            <p>{thai ? 'ค่าขนส่งประมาณ' : 'Estimated shipping'} {value(product.estimated_shipping_thb)}</p>}
          <p>{product.reasons.join(' ')}</p>
          {product.warnings.length > 0 && <p>{product.warnings.join(' ')}</p>}
        </article>)}
      </div>}
      <details className="buyer-intelligence__brief shopping-copilot__trends" open={trends !== null || undefined}>
        <summary>{thai ? 'แนวโน้มที่เหมาะกับร้าน' : 'Trends for your business'}</summary>
        <button disabled={pending} onClick={() => run(async () => setTrends((await loadOpportunities(buyer, lang)).opportunities))}>
          {thai ? 'โหลดโอกาสจากแนวโน้ม' : 'Load trend opportunities'}
        </button>
        {trends?.length === 0 && <p>{thai ? 'ยังไม่มีแนวโน้มที่เชื่อมกับรายการพร้อมขาย' : 'No trends match available products.'}</p>}
        {trends && trends.length > 0 && (
          <label className="shopping-copilot__profile">{thai ? 'ปริมาณทดลองสั่ง (กก.)' : 'Trial quantity (kg)'}
            <input type="number" min="0.01" max="99999.99" step="0.01" value={trialQuantity}
              onChange={(event) => setTrialQuantity(event.target.value)} />
          </label>
        )}
        {trends?.map((trend) => <article className="buyer-intelligence__farm" key={trend.fruit_id}>
          <h3>{trend.fruit_name}</h3>
          <p>{{
            rising: thai ? 'ความสนใจเพิ่มขึ้น' : 'Rising interest',
            steady: thai ? 'ความสนใจทรงตัว' : 'Steady interest',
            falling: thai ? 'ความสนใจลดลง' : 'Falling interest',
            insufficient_data: thai ? 'ข้อมูลไม่พอสรุปแนวโน้ม' : 'Insufficient data for a trend',
          }[trend.direction]}</p>
          <p>{thai ? 'ความสนใจจากการค้นหา' : 'Search interest'} {trend.value === null ? '—' : `${trend.value}%`}</p>
          <p>{trend.observation_window} {thai ? 'เทียบกับ' : 'vs.'} {trend.comparison_window}</p>
          <p>{trend.source_name} · {date.format(new Date(trend.observed_at))}</p>
          {trend.buyer_fit_reasons.length > 0 && <p>{trend.buyer_fit_reasons.join(' ')}</p>}
          <p>{trend.caveat}</p>
          <div className="shopping-copilot__actions">
            <button disabled={pending} onClick={() => { setQuery(trend.fruit_name); void searchFor(trend.fruit_id); }}>
              {thai ? 'ดูรายการพร้อมขาย' : 'View available listings'}
            </button>
            <button disabled={pending || !(Number(trialQuantity) >= .01 && Number(trialQuantity) <= 99999.99)}
              onClick={() => run(async () => {
                setCart(await previewItem(buyer, trend.fruit_id, trialQuantity, lang, budget));
                setAccepted(false);
              })}>{thai ? 'ดูตัวอย่างตะกร้าทดลอง' : 'Preview a trial cart'}</button>
            <button disabled={pending} onClick={() => run(async () => {
              setMarket({ fruit: trend.fruit_id, context: (await loadMarket(trend.fruit_id, lang)).market_context });
            })}>{thai ? 'ค้นข่าวประกอบ' : 'Search market context'}</button>
          </div>
          {market?.fruit === trend.fruit_id && <div className="shopping-copilot__notice">
            <h4>{thai ? 'บริบทจากเว็บ ไม่รวมในคะแนนเดโม' : 'Web context, separate from the demo score'}</h4>
            {market.context.status === 'available' ? <>
              <p>{market.context.summary?.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')}</p>
              <ul>{market.context.citations.map((citation, index) =>
                <li key={index}><a href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a></li>)}</ul>
            </> : <p>{thai ? 'ยังไม่มีแหล่งข่าวที่ใช้อ้างอิงได้ในขณะนี้' : 'Citable web context is currently unavailable.'}</p>}
          </div>}
        </article>)}
      </details>
      {cart && <div className="shopping-copilot__cart">
        <h3>{thai ? 'ตัวอย่างตะกร้า' : 'Suggested cart'}</h3>
        <ul>{cart.line_items.map((item) => <li key={item.listing_id}>
          {item.product_name} · {item.farm_name} · {item.quantity_kg} {thai ? 'กก.' : 'kg'} · {value(item.estimated_product_total_thb ?? '0')}
        </li>)}</ul>
        {cart.unfulfilled_items.length > 0 && <>
          <h4>{thai ? 'รายการที่ยังจัดไม่ได้' : 'Unfulfilled items'}</h4>
          <ul>{cart.unfulfilled_items.map(({ item, reason }, index) => <li key={index}>{item.fruit_query} · {reason}</li>)}</ul>
        </>}
        <p><strong>{thai ? 'รวมค่าสินค้า' : 'Product subtotal'} {value(cart.product_subtotal_thb)}</strong></p>
        <p>{thai ? 'ค่าขนส่งรวม' : 'Shipping'} {cart.shipping_total_thb === null
          ? (thai ? 'ยังไม่ทราบ' : 'Unknown') : value(cart.shipping_total_thb)}</p>
        {cart.remaining_product_budget_thb !== null &&
          <p>{thai ? 'งบค่าสินค้าเหลือ' : 'Remaining product budget'} {value(cart.remaining_product_budget_thb)}</p>}
        {cart.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        {accepted ? <>
          <p role="status">{thai ? 'ยืนยันตัวอย่างบนหน้านี้แล้ว' : 'Preview accepted on this page.'}</p>
          <button onClick={() => setAccepted(false)}>{thai ? 'กลับไปทบทวนตัวอย่าง' : 'Review preview again'}</button>
        </> : (
          <button disabled={!cart.line_items.length || pending} onClick={() => setAccepted(true)}>
            {thai ? 'ยืนยันตัวอย่างตะกร้า' : 'Accept cart preview'}
          </button>
        )}
      </div>}
    </section>
  );
}
