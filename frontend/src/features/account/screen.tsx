import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpLeft, Sprout, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import { requestJson, HttpError } from '../../shared/http';
import { MarketBrand } from '../shop/market-brand';
import '../shop/market-design.css';
import './style.css';

const accountApi = '/api/ideas/idea-c';
type Session = { buyer: string | null };

export function AccountPage() {
  const [account, setAccount] = useState<string | null>();
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    requestJson<Session>(accountApi + '/session', { signal: controller.signal, cache: 'no-store' })
      .then(({ buyer }) => setAccount(buyer))
      .catch(() => { if (!controller.signal.aborted) setError('โหลดบัญชีไม่ได้ โปรดลองอีกครั้ง'); });
    return () => controller.abort();
  }, [retry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const result = await requestJson<Session>(accountApi + '/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: String(form.get('name')).trim(), password: form.get('password'), register }),
      });
      setAccount(result.buyer);
    } catch (e) {
      setError(e instanceof HttpError && typeof e.detail === 'string' ? e.detail : 'เข้าสู่ระบบไม่ได้ โปรดลองอีกครั้ง');
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setError('');
    try {
      await requestJson(accountApi + '/logout', { method: 'POST' });
      try { sessionStorage.removeItem('maract.idea-c.cart.v1'); } catch { /* Storage may be disabled. */ }
      setRegister(false); setAccount(null);
    } catch { setError('ออกจากระบบไม่ได้ โปรดลองอีกครั้ง'); }
    finally { setBusy(false); }
  }

  return <main className="account-page" lang="th">
    <div className="account-card">
      <Link className="account-brand" to="/market" aria-label="MarAct ตลาด"><MarketBrand /></Link>
      {account === undefined ? <>
        {error ? <><p role="alert">{error}</p><button onClick={() => { setError(''); setRetry(retry + 1); }}>ลองอีกครั้ง</button></> :
          <p role="status">กำลังโหลดบัญชี…</p>}
      </> : account ? <>
        <p className="account-caption">{account}</p>
        <h1>เลือกบทบาท</h1>
        <div className="account-roles">
          <Link to="/market"><Store /><span><strong>ผู้ซื้อ</strong><small>เลือกผลผลิตและดูคำสั่งซื้อ</small></span><ArrowRight /></Link>
          <Link to="/market/farm"><Sprout /><span><strong>เกษตรกร</strong><small>จัดการสวน ลงขาย และรับการจอง</small></span><ArrowRight /></Link>
        </div>
        <button className="account-link" onClick={signOut} disabled={busy}>ออกจากระบบ</button>
        {error && <p role="alert">{error}</p>}
      </> : <>
        <h1>{register ? 'สร้างบัญชี MarAct' : 'เข้าสู่ระบบ MarAct'}</h1>
        <form onSubmit={submit}>
          <label>ชื่อบัญชี<input name="name" autoComplete="username" required maxLength={200} /></label>
          <label>รหัสผ่าน<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={8} maxLength={128} required /></label>
          {register && <small>ใช้รหัสผ่านอย่างน้อย 8 ตัวอักษร</small>}
          {error && <p role="alert">{error}</p>}
          <button className="account-primary" disabled={busy}>{busy ? 'กำลังดำเนินการ…' : register ? 'สร้างบัญชี' : 'เข้าสู่ระบบ'} <ArrowRight size={18} /></button>
        </form>
        <button className="account-link" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>
          {register ? 'มีบัญชีแล้ว · เข้าสู่ระบบ' : 'ยังไม่มีบัญชี · สร้างบัญชี'}
        </button>
        <Link className="account-guest" to="/market"><ArrowUpLeft size={16} />เข้าชมตลาด</Link>
      </>}
    </div>
  </main>;
}
