import { useState } from 'react';
import { Minus, Plus, ShoppingCart } from 'lucide-react';
import type { DailyImageResolver, DailyIngredient, DailyLocale, DailyTrend } from './market-daily-types';
import { eligibleListings } from './market-daily-types';
import './market-trend-detail.css';

export const trendOrderCopy = {
  en: {
    back: 'Back to Trends', overview: 'Overview', ingredients: 'Ingredients', why: 'Why it’s rising',
    fit: 'For your shop', menu: 'Menu idea', order: 'Order Ingredients', compare: 'Compare sellers',
    inStock: 'in stock',
    quantity: 'Quantity', decrease: 'Decrease', increase: 'Increase', kg: 'kg',
    add: 'Add All to Cart', added: 'Ingredients added to cart.',
    empty: 'No ingredients listed.', select: 'Select', price: '/ kg',
  },
  th: {
    back: 'กลับไปที่เทรนด์', overview: 'ภาพรวม', ingredients: 'วัตถุดิบ', why: 'เหตุผลที่กำลังมาแรง',
    fit: 'เหมาะกับร้านของคุณ', menu: 'ไอเดียเมนู', order: 'สั่งวัตถุดิบ', compare: 'เปรียบเทียบผู้ขาย',
    inStock: 'ในสต็อก',
    quantity: 'จำนวน', decrease: 'ลด', increase: 'เพิ่ม', kg: 'กก.',
    add: 'เพิ่มทั้งหมดลงตะกร้า', added: 'เพิ่มวัตถุดิบลงตะกร้าแล้ว',
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

type Selection = { listingId?: string; quantity?: string; included?: boolean };

function maxQuantity(stock: number) {
  return Math.min(500, Math.floor(stock));
}

function ingredientRow(ingredient: DailyIngredient, selection: Selection | undefined) {
  const offers = eligibleListings(ingredient);
  const listing = offers.find(({ id }) => id === selection?.listingId) ?? offers[0];
  const max = maxQuantity(listing.stock_kg);
  const quantity = selection?.quantity ?? String(Math.min(max, Math.max(1, Math.floor(ingredient.suggested_kg))));
  const amount = Number(quantity);
  const valid = /^\d+$/.test(quantity) && amount >= 1 && amount <= max;
  return { ingredient, listing, max, quantity, amount, valid, included: selection?.included ?? true };
}

export function MarketTrendIngredients({ trend, locale, onAddItems, resolveImage, onAsk, compact = false }: {
  trend: DailyTrend;
  locale: DailyLocale;
  onAddItems: (lines: MarketTrendCartLine[]) => void;
  resolveImage?: DailyImageResolver;
  onAsk?: (id: string) => void;
  compact?: boolean;
}) {
  const labels = trendOrderCopy[locale];
  const [selections, setSelections] = useState<Record<number, Selection>>({});
  const [added, setAdded] = useState(false);
  const rows = trend.ingredients.filter((ingredient) => eligibleListings(ingredient).length > 0)
    .map((ingredient, index) => ingredientRow(ingredient, selections[index]));
  const selected = rows.filter(({ included }) => included);
  const canAdd = selected.length > 0 && selected.every(({ valid }) => valid);

  function change(index: number, update: Selection) {
    setSelections((current) => ({ ...current, [index]: { ...current[index], ...update } }));
    setAdded(false);
  }

  function addRows(rowsToAdd: typeof rows) {
    if (rowsToAdd.length === 0 || !rowsToAdd.every(({ valid }) => valid)) return;
    onAddItems(rowsToAdd.map(({ listing, ingredient, amount }) => ({
      listing_id: listing.id,
      qty_kg: amount,
      trend_slug: trend.slug,
      trend_label: trend.name,
      ingredient_name: ingredient.name,
      seller_name: listing.seller_name,
      price_per_kg_thb: listing.price_per_kg_thb,
      stock_kg: listing.stock_kg,
      image_url: resolveImage?.(ingredient.image_key ?? ingredient.ingredient_id),
    })));
    setAdded(true);
  }

  return (
    <div className={compact ? 'market-trend-ingredients--compact' : undefined}>
      {rows.length === 0 ? <p>{labels.empty}</p> : (
        <ul className="market-trend-ingredient-list">
          {rows.map(({ ingredient, listing, max, amount, quantity, valid, included }, index) => (
            <li key={`${ingredient.ingredient_id ?? ingredient.name}-${index}`}>
              {resolveImage ? <img className="market-trend-ingredient-photo"
                src={resolveImage(ingredient.image_key ?? ingredient.ingredient_id)} alt="" />
                : <div className="market-trend-ingredient-photo" aria-hidden="true" />}
              <div className="market-trend-ingredient-copy">
                <div className="market-trend-ingredient-name">
                  <h2>{ingredient.name}</h2>
                  {onAsk && ingredient.ingredient_id && <button type="button" className="market-ask-ingredient"
                    onClick={() => onAsk(ingredient.ingredient_id!)}
                    aria-label={locale === 'th' ? `ถามผู้ช่วยเรื่อง ${ingredient.name}` : `Ask agent about ${ingredient.name}`}>
                    {locale === 'th' ? 'ถามผู้ช่วย' : 'Ask agent'}
                  </button>}
                </div>
                <label className="market-trend-sellers">
                  {labels.compare}
                  <select value={listing.id} aria-label={`${labels.compare}: ${ingredient.name}`}
                    onChange={(event) => change(index, { listingId: event.currentTarget.value, quantity: undefined })}>
                    {eligibleListings(ingredient).map((offer) => (
                      <option key={offer.id} value={offer.id}>
                        {offer.seller_name} · ฿{offer.price_per_kg_thb} {labels.price}
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
                  {compact && <button type="button" className="market-daily-primary market-trend-add-one"
                    aria-label={locale === 'th' ? `เพิ่ม ${ingredient.name} ลงตะกร้า` : `Add ${ingredient.name} to cart`}
                    disabled={!valid} onClick={() => addRows([rows[index]])}>
                    <ShoppingCart size={16} aria-hidden="true" />
                  </button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="market-trend-add">
          <button className="market-daily-primary" type="button" disabled={!canAdd} onClick={() => addRows(selected)}>
            <ShoppingCart size={18} aria-hidden="true" />{labels.add}
          </button>
        </div>
      )}
      {added && <p role="status">{labels.added}</p>}
    </div>
  );
}
