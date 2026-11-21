import { useEffect, useState } from 'react';
import { HttpError, requestJson } from '../../shared/http';

type FarmOrder = {
  id: string; buyer: string; address: string; postcode: string; arrival: string;
  state: string; freight: number; total: number; payment: string;
  lines: { id: string; name: string; units: number; unit: string }[];
};
type Decision = 'accept' | 'reject';

const endpoint = '/api/farmer/orders';
const statuses: Record<string, string> = {
  pending: 'รอสวนยืนยัน', accepted: 'ยืนยันแล้ว', rejected: 'ปฏิเสธแล้ว',
  expired: 'หมดเวลายืนยัน', cancelled: 'ยกเลิกแล้ว', shipped: 'จัดส่งแล้ว',
  received: 'ผู้ซื้อได้รับแล้ว', cancel_requested: 'รออนุมัติยกเลิก',
};
const baht = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' });

function Reservation({ order, onUpdate }: { order: FarmOrder; onUpdate: () => void }) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  function choose(next: Decision) {
    setDecision(next);
    setMessage('');
    setNote('');
  }
  async function submit() {
    if (!decision || !note.trim() || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await requestJson(endpoint + '/' + encodeURIComponent(order.id) + '/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decision, note: note.trim() }),
      });
      setMessage(decision === 'accept' ? 'ยืนยันคำสั่งซื้อแล้ว' : 'ปฏิเสธคำสั่งซื้อแล้ว');
      setDecision(null);
      onUpdate();
    } catch (error) {
      if (error instanceof HttpError && [404, 409].includes(error.status)) {
        setMessage('คำสั่งซื้อเปลี่ยนสถานะแล้ว กำลังโหลดข้อมูลล่าสุด');
        setDecision(null);
        onUpdate();
      } else {
        setMessage(error instanceof HttpError && typeof error.detail === 'string'
          ? error.detail : 'บันทึกไม่สำเร็จ ลองอีกครั้ง');
      }
    } finally {
      setBusy(false);
    }
  }
  return <article className="farm-order">
    <div className="title-row"><h3>{order.buyer}</h3><span className="count">{statuses[order.state] ?? order.state}</span></div>
    <small>เลขที่ {order.id}</small>
    <ul>{order.lines.map(line => <li key={line.id}>{line.name} · {line.units} {line.unit}</li>)}</ul>
    <strong>{baht.format(order.total)}</strong> · ค่าส่ง {baht.format(order.freight)}
    <p>รับวันที่ <time dateTime={order.arrival}>{order.arrival}</time> · {order.address} {order.postcode}</p>
    {order.payment && <p>วิธีชำระเงิน · {order.payment}</p>}
    {order.state === 'pending' && (decision ?
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label>{decision === 'accept' ? 'วิธีชำระเงินสำหรับผู้ซื้อ' : 'เหตุผลที่ปฏิเสธ'}
          <textarea required autoFocus rows={2} maxLength={500} value={note} onChange={event => setNote(event.target.value)} disabled={busy} />
        </label>
        <button type="submit" className="primary" disabled={!note.trim() || busy}>
          {decision === 'accept' ? 'ส่งคำยืนยันให้ผู้ซื้อ' : 'ส่งเหตุผลให้ผู้ซื้อ'}
        </button>
        <button type="button" disabled={busy} onClick={() => setDecision(null)}>ย้อนกลับ</button>
      </form> :
      <div className="farm-order-actions">
        <button type="button" className="primary" onClick={() => choose('accept')}>รับคำสั่งซื้อ</button>
        <button type="button" onClick={() => choose('reject')}>ปฏิเสธ</button>
      </div>)}
    {message && <p role="status">{message}</p>}
  </article>;
}

export function FarmOrders() {
  const [orders, setOrders] = useState<FarmOrder[]>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    const sync = () => { if (!document.hidden) setRevision(value => value + 1); };
    const timer = window.setInterval(sync, 30000);
    window.addEventListener('focus', sync);
    return () => { clearInterval(timer); window.removeEventListener('focus', sync); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    requestJson<FarmOrder[]>(endpoint, { signal: controller.signal, cache: 'no-store' })
      .then(result => { if (!controller.signal.aborted) { setOrders(result); setError(''); } })
      .catch(() => { if (!controller.signal.aborted) setError('โหลดคำสั่งซื้อไม่สำเร็จ'); });
    return () => controller.abort();
  }, [revision]);
  return <section className="panel farm-orders" aria-labelledby="farm-orders-title">
    <div className="heading"><h2 id="farm-orders-title">คำสั่งซื้อจากตลาด</h2><button type="button" onClick={refresh}>อัปเดตคำสั่งซื้อ</button></div>
    {error && <p role="alert">{error}</p>}
    {!orders && !error && <p role="status">กำลังโหลดคำสั่งซื้อ…</p>}
    {orders?.length === 0 && <p>ยังไม่มีคำสั่งซื้อเข้ามาที่สวน</p>}
    {orders?.map(order => <Reservation key={order.id} order={order} onUpdate={refresh} />)}
  </section>;
}
