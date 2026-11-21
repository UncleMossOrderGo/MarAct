import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { getRecommendations } from './api';
import type { Fruit, Order, OrderDraft, Preferences, Recommendations } from './api';
import { BuyerBrief } from './buyer-brief';
import { copy, locales } from './language';
import type { Language } from './language';

const demoPriorities: Record<keyof Preferences, string> = {
  price_weight: '45',
  quality_weight: '25',
  reliability_weight: '20',
  relationship_weight: '10',
};

const priorities = Object.keys(demoPriorities) as (keyof Preferences)[];

function bangkokDate(daysAhead = 0) {
  const instant = new Date(Date.now() + daysAhead * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  return ['year', 'month', 'day'].map((part) => parts.find(({ type }) => type === part)?.value).join('-');
}

function matchingFarms(result: Recommendations, lang: Language, currency: Intl.NumberFormat) {
  const text = copy[lang].supplier;
  const deliveryDate = new Intl.DateTimeFormat(locales[lang], { dateStyle: 'medium', timeZone: 'Asia/Bangkok' });
  const amount = (value: number | null) => value === null ? text.unknown : currency.format(value);
  return result.options.map((farm, index) => (
    <article className="buyer-intelligence__farm" key={farm.farm_id}>
      <div className="buyer-intelligence__farm-title">
        <div>
          <h4>{farm.farm_name}</h4>
          {farm.familiar && <span className="buyer-intelligence__badge">{text.familiar}</span>}
        </div>
        <span className="buyer-intelligence__match-score">#{index + 1} <span aria-hidden="true">·</span> {farm.score}/100 {text.fit}</span>
      </div>
      <div className="buyer-intelligence__landed" data-incomplete={farm.total_cost_thb === null}>
        <div><span>{text.estimatedTotal}</span><strong>{farm.total_cost_thb === null ? text.incomplete : amount(farm.total_cost_thb)}</strong></div>
        <div><span>{text.earliest}</span><strong><time dateTime={farm.availability.earliest_delivery}>
          {deliveryDate.format(new Date(farm.availability.earliest_delivery))}
        </time></strong></div>
      </div>
      <dl className="buyer-intelligence__quote">
        <div><dt>{text.unitPrice}</dt><dd>{amount(farm.unit_price_thb)}/{text.kg}</dd></div>
        <div><dt>{text.subtotal}</dt><dd>{amount(farm.subtotal_thb)}</dd></div>
        <div><dt>{text.shipping}</dt><dd>{amount(farm.estimated_shipping_thb)}</dd></div>
        <div><dt>{text.fees}</dt><dd>{amount(farm.estimated_fees_thb)}</dd></div>
        <div><dt>{text.orderRange}</dt><dd>{farm.availability.min_order_kg}–{farm.availability.stock_kg} {text.kg}</dd></div>
      </dl>
      <p className="buyer-intelligence__reason">{farm.reasons.join(' ')}</p>
      {farm.tradeoffs.length > 0 && <p><strong>{text.tradeoffs}</strong> {farm.tradeoffs.join(' ')}</p>}
      <small>{farm.provenance}</small>
    </article>
  ));
}

export function SupplierComparison({ fruit, onFruitChange, lang }: {
  fruit: Fruit; onFruitChange: (fruit: Fruit) => void; lang: Language;
}) {
  const { supplier: text, fruits, explanation } = copy[lang];
  const currency = new Intl.NumberFormat(locales[lang], { style: 'currency', currency: 'THB', currencyDisplay: 'narrowSymbol' });
  const date = new Intl.DateTimeFormat(locales[lang], { dateStyle: 'medium', timeZone: 'Asia/Bangkok' });
  const [quantity, setQuantity] = useState('100');
  const [delivery, setDelivery] = useState(() => bangkokDate(7));
  const [budget, setBudget] = useState('');
  const [preferences, setPreferences] = useState(demoPriorities);
  const [result, setResult] = useState<{ order: Order; data: Recommendations; lang: Language; explained?: boolean }>();
  const [error, setError] = useState<'compare' | 'explain'>();
  const [pending, setPending] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [priorityError, setPriorityError] = useState(false);
  const request = useRef<AbortController>(null);
  const fruitInput = useRef<HTMLSelectElement>(null);
  const priorityDetails = useRef<HTMLDetailsElement>(null);
  const priceInput = useRef<HTMLInputElement>(null);
  const submitted = result?.order;
  const draftChanged = submitted !== undefined && (
    Number(submitted.quantity_kg) !== Number(quantity)
    || submitted.delivery_by !== delivery
    || (submitted.max_total_thb === null ? null : Number(submitted.max_total_thb))
      !== (budget === '' ? null : Number(budget))
    || priorities.some((priority) => submitted.preferences[priority] !== Number(preferences[priority]))
  );

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    if (!result || result.lang === lang) return;
    const controller = new AbortController();
    getRecommendations(result.order, lang, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setResult({ order: result.order, data, lang });
        setError(undefined);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError('compare');
    });
    return () => controller.abort();
  }, [lang, result]);

  function changeFruit(next: Fruit) {
    request.current?.abort();
    setPending(false);
    setExplaining(false);
    setResult(undefined);
    setError(undefined);
    onFruitChange(next);
  }

  function applyDraft(draft: OrderDraft) {
    if (draft.fruit !== null && draft.fruit !== fruit) changeFruit(draft.fruit);
    if (draft.quantity_kg !== null) setQuantity(draft.quantity_kg);
    if (draft.delivery_by !== null) setDelivery(draft.delivery_by);
    if (draft.max_total_thb !== null) setBudget(draft.max_total_thb);
    setPreferences({
      price_weight: draft.preferences.price_weight ?? preferences.price_weight,
      quality_weight: draft.preferences.quality_weight ?? preferences.quality_weight,
      reliability_weight: draft.preferences.reliability_weight ?? preferences.reliability_weight,
      relationship_weight: draft.preferences.relationship_weight ?? preferences.relationship_weight,
    });
    setPriorityError(false);
    if (priorities.some((priority) => draft.preferences[priority] !== null) && priorityDetails.current) {
      priorityDetails.current.open = true;
    }
    fruitInput.current?.focus();
  }

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const weights = Object.fromEntries(priorities.map((priority) => [priority, Number(preferences[priority])])) as Preferences;
    if (!priorities.some((priority) => weights[priority] > 0)) {
      if (priorityDetails.current) priorityDetails.current.open = true;
      setPriorityError(true);
      priceInput.current?.focus();
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const order: Order = {
      buyer_id: 'demo-cafe-1',
      fruit,
      quantity_kg: quantity,
      delivery_by: delivery,
      max_total_thb: budget || null,
      preferences: weights,
    };
    setPending(true);
    setExplaining(false);
    setResult(undefined);
    setError(undefined);
    try {
      const data = await getRecommendations(order, lang, controller.signal);
      if (!controller.signal.aborted) setResult({ order, data, lang });
    } catch {
      if (!controller.signal.aborted) setError('compare');
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  async function explainResult() {
    if (!result || explaining) return;
    const controller = new AbortController();
    request.current = controller;
    setExplaining(true);
    setError(undefined);
    try {
      const data = await getRecommendations(result.order, lang, controller.signal, true);
      if (!controller.signal.aborted) setResult({ ...result, data, explained: true });
    } catch {
      if (!controller.signal.aborted) setError('explain');
    } finally {
      if (!controller.signal.aborted) setExplaining(false);
    }
  }

  return (
    <section className="buyer-intelligence__panel" aria-labelledby="supplier-heading">
      <div className="buyer-intelligence__panel-heading">
        <h2 id="supplier-heading" tabIndex={-1}>{text.title}</h2>
        <p>{text.introduction}</p>
      </div>
      <BuyerBrief onApply={applyDraft} lang={lang} />
      <form className="buyer-intelligence__form" onSubmit={compare}>
        <div className="buyer-intelligence__inputs">
          <label>{text.fruit}
            <select ref={fruitInput} value={fruit} onChange={(event) => changeFruit(event.target.value as Fruit)}>
              {Object.entries(fruits).map(([value, label]) =>
                <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>{text.quantity}
            <input type="number" min="0.01" max="99999.99" step="0.01" required
              value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </label>
          <div>
            <label>{text.deadline}
              <input type="date" lang={lang} min={bangkokDate()} required
                aria-describedby={lang === 'th' && delivery ? 'delivery-date-preview' : undefined}
                value={delivery} onChange={(event) => setDelivery(event.target.value)} />
            </label>
            {lang === 'th' && delivery && <time className="buyer-intelligence__date-preview"
              id="delivery-date-preview" dateTime={delivery}>{date.format(new Date(delivery))}</time>}
          </div>
          <label>{text.budget}
            <input type="number" min="0.01" max="99999999.99" step="0.01" placeholder={text.optional}
              value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
        </div>
        <details className="buyer-intelligence__priorities" ref={priorityDetails}>
          <summary>{text.priorities}</summary>
          <fieldset aria-label={text.priorities}>
            <p className="buyer-intelligence__hint">{text.weightHint}</p>
            {priorityError && <p id="ranking-priority-error" role="alert">{text.weightError}</p>}
            <div className="buyer-intelligence__inputs">
              {priorities.map((priority) => (
                <label key={priority}>{text.weights[priority]}
                  <input type="number" min="0" max="100" step="0.0001" required
                    ref={priority === 'price_weight' ? priceInput : undefined}
                    aria-describedby={priorityError ? 'ranking-priority-error' : undefined}
                    value={preferences[priority]} onChange={(event) => {
                      setPreferences({ ...preferences, [priority]: event.target.value });
                      setPriorityError(false);
                    }}
                    onInvalid={() => { if (priorityDetails.current) priorityDetails.current.open = true; }} />
                </label>
              ))}
            </div>
          </fieldset>
        </details>
        <button className="buyer-intelligence__primary" disabled={pending}>
          {pending ? text.comparing : <>{text.compare} <span aria-hidden="true">→</span></>}
        </button>
      </form>
      {(pending || (result && result.lang !== lang && !error)) && <p role="status">{text.comparing}</p>}
      {error && <p role="alert">{error === 'compare' ? text.compareError : text.explainError}</p>}
      {result?.lang === lang && (
        <div className="buyer-intelligence__results">
          <div className="buyer-intelligence__result-heading">
            <h3>{text.matches}</h3>
            <span className="buyer-intelligence__badge">{text.count(result.data.options.length)}</span>
          </div>
          <p>{fruits[result.order.fruit]} · {result.order.quantity_kg} {text.kg} · {text.deadline}{' '}
            <time dateTime={result.order.delivery_by}>{date.format(new Date(result.order.delivery_by))}</time>
            {result.order.max_total_thb && ` · ${text.max} ${currency.format(Number(result.order.max_total_thb))}`}
          </p>
          {draftChanged && <p className="buyer-intelligence__stale" role="status">
            {text.stale}
          </p>}
          <p>{result.data.explanation}</p>
          {result.explained && <p className="buyer-intelligence__hint">
            {explanation[result.data.explanation_source]}
          </p>}
          {!draftChanged && result.data.options.length > 0 && result.data.explanation_source !== 'openai' && (
            <button type="button" disabled={explaining} onClick={explainResult}>
              {explaining ? text.preparingExplanation : text.explain}
            </button>
          )}
          {matchingFarms(result.data, lang, currency)}
        </div>
      )}
    </section>
  );
}
