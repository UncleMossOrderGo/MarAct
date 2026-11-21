import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Minus, Plus, ShoppingCart } from 'lucide-react';
import type { DailyImageResolver, DailyIngredient, DailyLocale, DailyRun, DailyTrend, MarketTrendTab } from './market-daily-types';
import { eligibleListings } from './market-daily-types';
import { DailyImage, DailyRunDate, TrendBadges, TrendSources } from './market-today';
import './market-trend-detail.css';

const copy = {
  en: {
    back: 'Back to Trends', overview: 'Overview', ingredients: 'Ingredients', why: 'Why it’s rising',
    fit: 'For your shop', menu: 'Menu idea', order: 'Order Ingredients', compare: 'Compare sellers',
    noListings: 'No matching listing.', outOfStock: 'Out of stock.', inStock: 'in stock',
    quantity: 'Quantity', decrease: 'Decrease', increase: 'Increase', kg: 'kg',
    add: 'Add All to Cart', skipped: 'Unavailable ingredients will be skipped.', added: 'Ingredients added to cart.',
    empty: 'No ingredients listed.', select: 'Select', price: '/ kg',
  },
  th: {
    back: 'กลับไปที่เทรนด์', overview: 'ภาพรวม', ingredients: 'วัตถุดิบ', why: 'เหตุผลที่กำลังมาแรง',
    fit: 'เหมาะกับร้านของคุณ', menu: 'ไอเดียเมนู', order: 'สั่งวัตถุดิบ', compare: 'เปรียบเทียบผู้ขาย',
    noListings: 'ไม่พบสินค้าที่ตรงกัน', outOfStock: 'สินค้าหมด', inStock: 'ในสต็อก',
    quantity: 'จำนวน', decrease: 'ลด', increase: 'เพิ่ม', kg: 'กก.',
    add: 'เพิ่มทั้งหมดลงตะกร้า', skipped: 'ระบบจะข้ามวัตถุดิบที่ไม่มีสินค้า', added: 'เพิ่มวัตถุดิบลงตะกร้าแล้ว',
    empty: 'ยังไม่มีรายการวัตถุดิบ', select: 'เลือก', price: '/ กก.',
  },
} as const;

export type MarketTrendCartLine = {
  listing_id: string;
  qty_kg: number;
  trend_slug: string;
  trend_label: string;
  ingredient_name: string;
  seller_name: string;
  price_per_kg_thb: string;
  stock_kg: number;
  image_url?: string;
};

type MarketTrendDetailProps = {
  trend: DailyTrend;
  run?: DailyRun | null;
  locale?: DailyLocale;
  initialTab?: MarketTrendTab;
  onBack: () => void;
  onAddItems: (lines: MarketTrendCartLine[]) => void;
  resolveImage?: DailyImageResolver;
};

type Selection = { listingId?: string; quantity?: string; included?: boolean };

function maxQuantity(stock: number) {
  return Math.min(500, Math.floor(stock));
}

function ingredientRow(ingredient: DailyIngredient, selection: Selection | undefined) {
  const offers = eligibleListings(ingredient);
  const listing = offers.find(({ id }) => id === selection?.listingId) ?? offers[0];
  const max = listing ? maxQuantity(listing.stock_kg) : 0;
  const quantity = selection?.quantity ?? String(Math.min(max, Math.max(1, Math.floor(ingredient.suggested_kg))));
  const amount = Number(quantity);
  const valid = /^\d+$/.test(quantity) && amount >= 1 && amount <= max;
  return { ingredient, listing, max, quantity, amount, valid, included: selection?.included ?? true };
}

const tabs = ['overview', 'ingredients'] as const;

function TrendDetail({
  trend, run, locale = 'th', initialTab = 'overview', onBack, onAddItems, resolveImage,
}: MarketTrendDetailProps) {
  const labels = copy[locale];
  const id = useId();
  const [tab, setTab] = useState<MarketTrendTab>(initialTab);
  const [selections, setSelections] = useState<Record<number, Selection>>({});
  const [added, setAdded] = useState(false);
  const tabElements = useRef<Partial<Record<MarketTrendTab, HTMLButtonElement>>>({});
  const rows = trend.ingredients.map((ingredient, index) => ingredientRow(ingredient, selections[index]));
  const hasUnavailable = rows.some(({ listing }) => !listing);
  const selected = rows.filter(({ included, listing }) => included && listing);
  const canAdd = selected.length > 0 && selected.every(({ valid }) => valid);

  function change(index: number, update: Selection) {
    setSelections((current) => ({ ...current, [index]: { ...current[index], ...update } }));
    setAdded(false);
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'overview'
      : event.key === 'End' ? 'ingredients'
      : tab === 'overview' ? 'ingredients' : 'overview';
    setTab(next);
    tabElements.current[next]?.focus();
  }

  function addAll() {
    if (!canAdd) return;
    onAddItems(selected.flatMap(({ listing, ingredient, amount }) => listing ? [{
      listing_id: listing.id,
      qty_kg: amount,
      trend_slug: trend.slug,
      trend_label: trend.name,
      ingredient_name: ingredient.name,
      seller_name: listing.seller_name,
      price_per_kg_thb: listing.price_per_kg_thb,
      stock_kg: listing.stock_kg,
      image_url: resolveImage?.(ingredient.image_key ?? ingredient.ingredient_id),
    }] : []));
    setAdded(true);
  }

  return (
    <section className="market-trend-detail" aria-labelledby={`${id}-name`}>
      <button type="button" className="market-daily-secondary" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" />{labels.back}
      </button>
      <DailyImage imageKey={trend.image_key} resolveImage={resolveImage} className="market-trend-detail-hero" />
      <h1 id={`${id}-name`}>{trend.name}</h1>
      <TrendBadges trend={trend} locale={locale} />
      {run && <DailyRunDate run={run} locale={locale} />}
      <div className="market-trend-tabs" role="tablist">
        {tabs.map((name) => (
          <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1} aria-controls={`${id}-panel-${name}`}
            ref={(node) => { if (node) tabElements.current[name] = node; }}
            onKeyDown={tabKey} onClick={() => setTab(name)}>
            {labels[name]}
          </button>
        ))}
      </div>
      <div className="market-trend-panel" role="tabpanel" id={`${id}-panel-overview`}
        aria-labelledby={`${id}-tab-overview`} hidden={tab !== 'overview'}>
        <dl className="market-trend-evidence">
          <div><dt>{labels.why}</dt><dd>{trend.why_rising}</dd></div>
          <div><dt>{labels.fit}</dt><dd>{trend.why_fit}</dd></div>
          <div><dt>{labels.menu}</dt><dd>{trend.menu_idea}</dd></div>
        </dl>
        <TrendSources trend={trend} locale={locale} />
        {rows.length > 0 && (
          <button className="market-daily-primary" type="button" onClick={() => {
            setTab('ingredients');
            tabElements.current.ingredients?.focus();
          }}>
            <ShoppingCart size={18} aria-hidden="true" />{labels.order}
          </button>
        )}
      </div>
      <div className="market-trend-panel" role="tabpanel" id={`${id}-panel-ingredients`}
        aria-labelledby={`${id}-tab-ingredients`} hidden={tab !== 'ingredients'}>
        {rows.length === 0 ? <p>{labels.empty}</p> : (
          <ul className="market-trend-ingredient-list">
            {rows.map(({ ingredient, listing, max, amount, quantity, valid, included }, index) => (
              <li key={`${ingredient.ingredient_id ?? ingredient.name}-${index}`}>
                <DailyImage className="market-trend-ingredient-photo"
                  imageKey={ingredient.image_key ?? ingredient.ingredient_id} resolveImage={resolveImage} />
                <div className="market-trend-ingredient-copy">
                  <h2>{ingredient.name}</h2>
                  {listing ? (
                    <>
                      <label className="market-trend-sellers">
                        {labels.compare}
                        <select value={listing.id} aria-label={`${labels.compare}: ${ingredient.name}`}
                          onChange={(event) => change(index, { listingId: event.currentTarget.value, quantity: undefined })}>
                          {ingredient.listings.map((offer) => (
                            <option key={offer.id} value={offer.id} disabled={offer.stock_kg < 1}>
                              {offer.seller_name} · ฿{offer.price_per_kg_thb} {labels.price}
                              {offer.stock_kg < 1 ? ` · ${labels.outOfStock}` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="market-trend-price"><strong>฿{listing.price_per_kg_thb} {labels.price}</strong>
                        <span>{listing.stock_kg} {labels.kg} {labels.inStock}</span>
                      </p>
                      <div className="market-trend-ingredient-controls">
                        <div className="market-trend-stepper">
                          <button type="button" aria-label={`${labels.decrease} ${ingredient.name}`}
                            disabled={!valid || amount <= 1}
                            onClick={() => change(index, { quantity: String(amount - 1) })}>
                            <Minus size={16} aria-hidden="true" />
                          </button>
                          <input type="number" min={1} max={max} step={1} inputMode="numeric" value={quantity}
                            aria-label={`${ingredient.name} ${labels.quantity} (${labels.kg})`} aria-invalid={!valid}
                            onChange={(event) => change(index, { quantity: event.currentTarget.value })} />
                          <button type="button" aria-label={`${labels.increase} ${ingredient.name}`}
                            disabled={!valid || amount >= max}
                            onClick={() => change(index, { quantity: String(amount + 1) })}>
                            <Plus size={16} aria-hidden="true" />
                          </button>
                        </div>
                        <label><input type="checkbox" checked={included}
                          aria-label={`${labels.select} ${ingredient.name}`}
                          onChange={(event) => change(index, { included: event.currentTarget.checked })} />
                        {labels.select}</label>
                      </div>
                    </>
                  ) : <p>{ingredient.ingredient_id ? labels.outOfStock : labels.noListings}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {hasUnavailable && <p className="market-trend-skipped">{labels.skipped}</p>}
        {rows.length > 0 && (
          <div className="market-trend-add">
            <button className="market-daily-primary" type="button" disabled={!canAdd} onClick={addAll}>
              <ShoppingCart size={18} aria-hidden="true" />{labels.add}
            </button>
          </div>
        )}
        {added && <p role="status">{labels.added}</p>}
      </div>
    </section>
  );
}

export function MarketTrendDetail(props: MarketTrendDetailProps) {
  return <TrendDetail key={`${props.trend.slug}:${props.initialTab ?? 'overview'}`} {...props} />;
}
