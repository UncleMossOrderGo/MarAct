import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Sprout } from 'lucide-react';

import { FARMER_API } from './public-lots';

type Mode = 'login' | 'register' | 'line';

export function FarmerLogin() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function switchMode(next: Mode) {
    setMode(next); setError(''); setPassword(''); setCode('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const isLine = mode === 'line';
      const response = await fetch(FARMER_API + '/' + (isLine ? 'line/open' : 'profile-session'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isLine ? { code: code.trim() } : { name: name.trim(), password, register: mode === 'register' }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw Error(typeof data.detail === 'string' ? data.detail : 'กรุณาตรวจข้อมูลแล้วลองอีกครั้ง');
      }
      navigate('/farmer', { replace: true });
    } catch (err) {
      setError(err instanceof TypeError ? 'เชื่อมต่อระบบไม่ได้ กรุณาลองอีกครั้ง' : err instanceof Error ? err.message : 'เข้าสู่ระบบไม่ได้');
    } finally { setBusy(false); }
  }

  const title = mode === 'register' ? 'สร้างบัญชีสวน' : mode === 'line' ? 'เปิดสวนด้วย LINE' : 'เข้าสู่ระบบสวน';
  return <div className="login-page"><div className="login-orchard" aria-hidden="true"/>
    <section className="login-form"><Sprout size={30} aria-hidden="true"/><h1>{title}</h1>
      <p>{mode === 'line' ? 'พิมพ์ “เชื่อมเว็บ” ในแชต LINE ของ MarAct แล้วนำรหัสที่ได้รับมากรอก' : mode === 'register' ? 'ใช้บัญชีเดียวเพื่อซื้อผลไม้และจัดการสวน' : 'เข้าสู่โปรไฟล์สวนเพื่อดูผลผลิตและแก้ร่างที่คุยไว้กับผู้ช่วย'}</p>
      <form onSubmit={submit}><fieldset disabled={busy}>
        {mode === 'line' ? <label>รหัสจาก LINE<input required maxLength={100} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} /></label> : <>
          <label>ชื่อบัญชีสวน<input required maxLength={100} autoComplete="username" value={name} onChange={e => setName(e.target.value)} /></label>
          <label>รหัสผ่าน<input required minLength={8} maxLength={128} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
        </>}
        {error && <p role="alert">{error}</p>}
        <button className="login-submit">{busy ? 'กำลังดำเนินการ…' : title}<ArrowRight size={17}/></button>
      </fieldset></form>
      <div className="login-links">
        {mode !== 'login' && <button disabled={busy} onClick={() => switchMode('login')}>ใช้ชื่อบัญชีและรหัสผ่าน</button>}
        {mode !== 'line' && <button disabled={busy} onClick={() => switchMode('line')}>ใช้รหัสจาก LINE</button>}
        {mode === 'login' && <button disabled={busy} onClick={() => switchMode('register')}>สร้างบัญชีสวน</button>}
      </div><Link to="/market">กลับตลาดผลไม้</Link>
    </section></div>;
}
