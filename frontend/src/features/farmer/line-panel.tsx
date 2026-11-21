import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

const endpoint = '/api/farmer/line'

async function request(path: string, method = 'GET', body?: object) {
  const res = await fetch(endpoint + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  })
  const result = await res.json()
  if (!res.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'กรุณาลองใหม่')
  return result
}

export function LinePanel() {
  const [linked, setLinked] = useState<boolean | null>(null)
  const [pair, setPair] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function status() {
    try {
      const state = await request('/status')
      setLinked(state.linked)
      if (state.linked) setPair('')
      setErr('')
    } catch { setErr('อ่านสถานะ LINE ไม่สำเร็จ') }
  }
  useEffect(() => { void status() }, [])
  useEffect(() => {
    if (!pair) return
    const timer = window.setInterval(() => { void status() }, 4000)
    const expiry = window.setTimeout(() => { setPair(''); setErr('รหัสหมดอายุแล้ว ขอรหัสใหม่ได้ครับ') }, 600000)
    return () => { clearInterval(timer); clearTimeout(expiry) }
  }, [pair])
  async function action(path: string, method: string, body?: object) {
    setBusy(true); setErr('')
    try {
      const result = await request(path, method, body)
      if (path === '/open') { window.location.reload(); return }
      if (path === '/pair') { setCopied(false); setPair(result.message) }
      else { setLinked(result.linked); setPair('') }
    } catch (e) { setErr(e instanceof Error ? e.message : 'เชื่อมต่อไม่ได้') }
    finally { setBusy(false) }
  }
  function openFarm(e: FormEvent) {
    e.preventDefault()
    if (code.trim()) void action('/open', 'POST', { code: code.trim() })
  }
  return <section className="panel line-panel">
    <h2>เชื่อม LINE กับสวน</h2>
    <p role="status">{linked === null ? 'กำลังตรวจสถานะ…' : linked ? 'เชื่อมบัญชีแล้ว · ส่งรายละเอียดและรูปผลไม้ในแชตได้เลย' : 'ส่งรายละเอียดและรูปในแชต LINE ผู้ช่วยจะทวนร่างให้ตรวจทุกครั้งก่อนลงขาย'}</p>
    {err && <p role="alert" className="alert">{err}</p>}
    {linked === null && err && <button onClick={status}>ลองอีกครั้ง</button>}
    {linked === false && <button disabled={busy} onClick={() => action('/pair', 'POST')}>{pair ? 'สร้างรหัสใหม่' : 'สร้างรหัสเชื่อม LINE'}</button>}
    {pair && <div className="pair-code"><label>ส่งข้อความนี้ในแชตส่วนตัวกับ LINE OA ภายใน 10 นาที<input readOnly value={pair} onFocus={e => e.target.select()}/></label>
      <button onClick={async () => { try { await navigator.clipboard.writeText(pair); setCopied(true) } catch { setErr('เลือกข้อความด้านบนเพื่อคัดลอกด้วยตนเอง') } }}>{copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ'}</button></div>}
    {linked && <details><summary>จัดการการเชื่อมบัญชี</summary><p>เมื่อยกเลิกแล้ว ต้องขอรหัสใหม่เพื่อกลับมาลงขายจาก LINE</p>
      <button disabled={busy} onClick={() => action('/link', 'DELETE')}>ยืนยันยกเลิกการเชื่อม LINE</button></details>}
    <details><summary>เปิดสวนที่สร้างใน LINE</summary><form onSubmit={openFarm}>
      <label>พิมพ์ “เชื่อมเว็บ” ในแชตกับผู้ช่วย แล้วนำรหัสมาใส่ที่นี่<input value={code} maxLength={100} onChange={e => setCode(e.target.value)} autoComplete="off"/></label>
      <button disabled={busy || !code.trim()}>เปิดสวนจากรหัส</button></form></details>
  </section>
}
