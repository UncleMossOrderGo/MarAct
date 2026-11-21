import {useState} from 'react';
import type {ReactNode, FormEvent} from 'react';
import {MessageCircle, ReceiptText, Store} from 'lucide-react';
import './buyer.css';

export type BuyerProfile = {business: string; postcode: string};
export function BuyerAccount({buyer, profile, accountForm, onSave, onChat, onOrders, onLogout}: {
  buyer: string; profile: BuyerProfile; accountForm: ReactNode;
  onSave: (value: BuyerProfile) => Promise<boolean>; onChat: () => void; onOrders: () => void; onLogout: () => void;
}) {
  const [business,setBusiness] = useState(profile.business);
  const [postcode,setPostcode] = useState(profile.postcode);
  const [saved,setSaved] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(await onSave({business: business.trim(), postcode}));
  }
  return <div className="buyer-account">
    <div className="buyer-intro"><Store size={26}/><h1>{buyer || 'บัญชีผู้ซื้อ'}</h1>
      <p>{buyer ? 'จัดการข้อมูลร้านและวางแผนซื้อผลไม้จากสวน' : 'สมัครหรือเข้าสู่ระบบเพื่อบันทึกข้อมูลร้านและติดตามคำสั่งซื้อ'}</p></div>
    {buyer ? <div className="buyer-columns"><form className="buyer-profile" onSubmit={submit}>
      <h2>ข้อมูลร้านของฉัน</h2><label>ร้านของคุณขายอะไร<input maxLength={160} value={business}
        placeholder="เช่น ร้านน้ำมะม่วงปั่น" onChange={e=>{setBusiness(e.target.value);setSaved(false);}}/></label>
      <label>รหัสไปรษณีย์ที่รับสินค้า<input inputMode="numeric" maxLength={5} pattern="[0-9]{5}" value={postcode}
        onChange={e=>{setPostcode(e.target.value.replace(/\D/g,''));setSaved(false);}}/></label>
      <button>บันทึกข้อมูลร้าน</button>{saved && <p role="status">บันทึกข้อมูลร้านแล้ว</p>}
    </form><div className="buyer-assist"><h2>วางแผนซื้อกับ AI</h2><p>คุยเรื่องเมนูที่อยากขาย แล้วเทียบสวน ปริมาณขั้นต่ำ และราคาของล็อตที่มีในตลาด</p>
      <button onClick={onChat}><MessageCircle size={18}/>คุยกับผู้ช่วยจัดซื้อ</button>
      <button onClick={onOrders}><ReceiptText size={18}/>ดูคำสั่งซื้อของร้าน</button>
      <button className="buyer-logout" onClick={onLogout}>ออกจากระบบ</button>
    </div></div> : accountForm}
  </div>;
}
