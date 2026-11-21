import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, CalendarDays, Check, ChevronDown, LogOut, Package, RefreshCw, Sprout, Store, Truck } from 'lucide-react';
import { LotPhoto } from './LotPhoto';
import type { Order } from './types';
import './orders.css';

const labels: Record<string, string> = {
  pending: 'รอสวนยืนยัน', accepted: 'สวนยืนยันแล้ว', shipped: 'จัดส่งแล้ว', received: 'ได้รับสินค้าแล้ว',
  expired: 'หมดเวลายืนยัน', rejected: 'สวนปฏิเสธ', cancelled: 'ยกเลิกแล้ว', cancel_requested: 'รอสวนอนุมัติยกเลิก',
  open: 'รอสวนตอบ', replied: 'สวนตอบแล้ว', escalated: 'ส่งต่อผู้ดูแลแล้ว', resolved: 'ปิดเรื่องแล้ว',
  cancel: 'ยกเลิก', ask_cancel: 'ขอยกเลิก', receive: 'ยืนยันรับสินค้า', report: 'แจ้งปัญหา', escalate: 'ส่งต่อผู้ดูแล',
  accept: 'สวนยืนยัน', reject: 'สวนปฏิเสธ', ship: 'จัดส่ง', approve_cancel: 'อนุมัติยกเลิก', deny_cancel: 'ปฏิเสธการยกเลิก',
  reply: 'คำตอบจากสวน', resolve: 'ผลจากผู้ดูแล', refund: 'การคืนเงิน',
};
const stages = ['pending', 'accepted', 'shipped', 'received'];
const stageNames = ['รอยืนยัน', 'สวนยืนยัน', 'ส่งสินค้า', 'รับสินค้า'];
const day = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const baht = (n: number) => '฿' + n.toLocaleString('th-TH');
const examples: Order[] = [
  { id: 'DEMO-001', farm: 'สวนรุ่งอรุณ', state: 'shipped', arrival: '2026-11-24', expires: '',
    lines: [{ id: 'mango-east', name: 'มะม่วงน้ำดอกไม้', units: 20, unit: 'กก.', price: 45, requested_kg: 20 }],
    freight: 80, total: 980, payment: '', refund: '', issue: '', events: [] },
  { id: 'DEMO-002', farm: 'สวนริมคลอง', state: 'accepted', arrival: '2026-11-25', expires: '',
    lines: [{ id: 'passion-east', name: 'เสาวรส', units: 10, unit: 'กก.', price: 60, requested_kg: 10 }],
    freight: 60, total: 660, payment: '', refund: '', issue: '', events: [] },
];
type OrderAction = (id: string, action: string, note: string) => Promise<boolean>;

function actionsFor(order: Order) {
  const actions: string[] = [];
  if (order.state === 'pending') actions.push('cancel');
  if (order.state === 'accepted') actions.push('ask_cancel');
  if (order.state === 'shipped') actions.push('receive');
  if (!['pending', 'expired', 'rejected'].includes(order.state) && (!order.issue || order.issue === 'resolved')) actions.push('report');
  if (['open', 'replied'].includes(order.issue)) actions.push('escalate');
  return actions;
}

function OrderCard({ order, onAction }: { order: Order; onAction?: OrderAction }) {
  const [note, setNote] = useState('');
  const stage = stages.indexOf(order.state);
  const actions = onAction ? actionsFor(order) : [];
  return <article className="order-slip">
    <div className="slip-top">
      <small>{onAction ? 'คำสั่งซื้อ' : 'ตัวอย่าง'} #{order.id.slice(0, 8).toUpperCase()}</small>
      <h3><span><Sprout size={18} aria-hidden="true"/>{order.farm}</span><span className="order-sr"> · </span>
        <span className="slip-state" data-state={order.state}>{order.state === 'shipped' && <Truck size={15} aria-hidden="true"/>}{labels[order.state] ?? order.state}</span></h3>
    </div>
    <div className="slip-lines">{order.lines.map(line => <div className="slip-line" key={line.id}>
      <LotPhoto id={line.id} name={line.name} compact/>
      <div><strong>{line.name}</strong><small>{line.units} {line.unit} × {baht(line.price)}</small></div>
      <b>{baht(line.price * line.units)}</b>
    </div>)}</div>
    {stage >= 0 && <ol className="slip-progress" aria-label="ขั้นตอนการจัดส่ง">{stages.map((value, i) =>
      <li key={value} data-done={i <= stage} aria-current={stage === i ? 'step' : undefined}>
        <i aria-hidden="true">{i <= stage && <Check size={11} strokeWidth={3}/>}</i>{stageNames[i]}
      </li>)}</ol>}
    <div className="slip-total">
      <div><small><CalendarDays size={15} aria-hidden="true"/>นัดรับสินค้า</small><strong>{day.format(new Date(order.arrival))}</strong></div>
      <div><small>ยอดรวมส่ง</small><b>{baht(order.total)}</b></div>
    </div>
    <details className="slip-details"><summary>รายละเอียดคำสั่งซื้อ <ChevronDown size={16}/></summary>
      <div><p>เลขที่คำสั่งซื้อ {order.id}</p><p>ค่าสินค้า {baht(order.total - order.freight)} · ค่าจัดส่ง {baht(order.freight)}</p>
        {order.state === 'pending' && order.expires && <p>รอยืนยันถึง {new Date(order.expires).toLocaleString('th-TH')}</p>}
        {order.payment && <p>วิธีชำระตรงกับสวน · {order.payment}</p>}
        {order.events.map((event, i) => <p key={i}>{labels[event.action] ?? event.action} {event.note}</p>)}
      </div>
    </details>
    {order.issue && <p className="slip-notice">เรื่องที่แจ้ง · {labels[order.issue] ?? order.issue}</p>}
    {order.refund && <p className="slip-notice">สถานะคืนเงิน · {order.refund}</p>}
    {onAction && actions.length > 0 && <div className="slip-actions">
      <label>รายละเอียดเพิ่มเติม<input maxLength={500} value={note} onChange={e => setNote(e.target.value)}/></label>
      {actions.map(action => <button type="button" key={action} disabled={action === 'report' && !note.trim()}
        onClick={async () => { if (await onAction(order.id, action, note)) setNote(''); }}>{labels[action]}</button>)}
    </div>}
  </article>;
}

export function ShopOrders({ buyer, orders, status, accountForm, onRefresh, onLogout, onBrowse, onAction }: {
  buyer: string; orders: Order[]; status: 'loading' | 'ready' | 'error'; accountForm: ReactNode;
  onRefresh: () => void; onLogout: () => void; onBrowse: () => void; onAction: OrderAction;
}) {
  const preview = status === 'ready' && !orders.length;
  return <div className="shop-orders">
    <div className="orders-title">
      <div><h1>คำสั่งซื้อของร้าน</h1><p>{buyer ? <><Store size={17} aria-hidden="true"/>{buyer}</> : 'ติดตามผลผลิตจากสวน ตั้งแต่ยืนยันคำสั่งซื้อจนถึงวันรับสินค้า'}</p></div>
      {buyer ? <div className="orders-tools"><button onClick={onRefresh}><RefreshCw size={16}/>อัปเดตสถานะ</button><button onClick={onLogout}><LogOut size={16}/>ออกจากระบบ</button></div>
        : preview && <a className="order-login-link" href="#shop-signin" onClick={e => { e.preventDefault(); document.querySelector<HTMLInputElement>('#shop-signin input')?.focus(); }}>เข้าสู่บัญชีร้าน <ArrowRight size={16}/></a>}
    </div>
    {status === 'loading' && <p role="status">กำลังโหลดคำสั่งซื้อ…</p>}
    {status === 'error' && <div className="orders-empty" role="alert"><p>โหลดคำสั่งซื้อไม่สำเร็จ</p><button onClick={onRefresh}>ลองอีกครั้ง</button></div>}
    {status === 'ready' && <>
      {buyer && preview && <div className="orders-empty"><Package size={22}/><div><strong>ยังไม่มีคำสั่งซื้อ</strong><p>เมื่อยืนยันการสั่งซื้อแล้ว ติดตามสถานะของแต่ละสวนได้ที่นี่</p></div><button onClick={onBrowse}>ไปเลือกผลผลิต <ArrowRight size={16}/></button></div>}
      <div className={'orders-layout' + (!buyer ? ' with-account' : '')}>
        <div className="orders-list">
          <div className="orders-list-heading"><h2>{preview ? 'ตัวอย่างคำสั่งซื้อ' : 'รายการสั่งซื้อ'}</h2>
            {preview ? <span>ข้อมูลจำลอง</span> : <span>{orders.length} รายการ</span>}</div>
          {(preview ? examples : orders).map(order => <OrderCard key={order.id} order={order} onAction={preview ? undefined : onAction}/>)}
        </div>
        {!buyer && <aside id="shop-signin" className="order-account">
          <div className="order-account-photo" role="img" aria-label="สวนมะม่วง"/>{accountForm}
        </aside>}
      </div>
    </>}
  </div>;
}
