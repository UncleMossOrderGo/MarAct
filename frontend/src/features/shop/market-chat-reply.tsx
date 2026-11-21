import Markdown from 'react-markdown';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import type { DailyLocale } from './market-daily-types';

export type ToolActivity = { type: 'tool'; id: string; name: string; state: 'running' | 'done' | 'error' };

const names: Record<string, [string, string]> = {
  get_shop_profile: ['Shop profile', 'ข้อมูลร้าน'],
  get_shop_stock: ['Inventory check', 'ตรวจสต็อก'],
  get_usage: ['Ingredient usage', 'การใช้วัตถุดิบ'],
  get_today_trends: ['Today’s trends', 'เทรนด์วันนี้'],
  get_trend_detail: ['Trend research', 'ข้อมูลเทรนด์'],
  check_farm_lots: ['Checking farm prices and delivery', 'เช็กราคาและรอบส่งจากสวน'],
  compare_trial_lots: ['Trial lot comparison', 'เปรียบเทียบล็อตทดลอง'],
  search_listings: ['Supplier search', 'ค้นหาผู้ขาย'],
  get_orders: ['Order lookup', 'ค้นหาคำสั่งซื้อ'],
  propose_add_to_cart: ['Basket suggestion', 'วัตถุดิบแนะนำสำหรับตะกร้า'],
};

export function ChatToolActivity({ items, locale }: { items: ToolActivity[]; locale: DailyLocale }) {
  if (!items.length) return null;
  const th = locale === 'th';
  return <ul className="market-chat-activity" aria-label={th ? 'การใช้เครื่องมือ' : 'Tool activity'}>
    {items.map(({ id, name, state }) => {
      const Icon = state === 'running' ? LoaderCircle : state === 'done' ? Check : CircleAlert;
      const status = state === 'running' ? (th ? 'กำลังตรวจสอบ' : 'Checking')
        : state === 'done' ? (th ? 'เสร็จแล้ว' : 'Done') : (th ? 'ไม่สำเร็จ' : 'Unavailable');
      return <li key={id} data-state={state}><Icon size={14} aria-hidden="true" />
        {names[name]?.[th ? 1 : 0] ?? (th ? 'ข้อมูลร้าน' : 'Shop lookup')}<small>{status}</small></li>;
    })}
  </ul>;
}

export function ChatMarkdown({ answer, sources }: { answer: string; sources: readonly string[] }) {
  const allowed = new Set(sources.filter((source) => /^https?:\/\//i.test(source)));
  return <div className="market-chat-answer">
    <Markdown skipHtml allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'a', 'br', 'blockquote', 'h2', 'h3', 'h4']}
      unwrapDisallowed components={{ a: ({ href, children }) => href && allowed.has(href)
        ? <a href={href} rel="noopener noreferrer" target="_blank">{children}</a> : <>{children}</> }}>
      {answer}
    </Markdown>
  </div>;
}
