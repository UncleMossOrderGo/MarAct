import type { Fields, FarmLot as Lot } from './public-lots';

export const labels:Record<keyof Fields,string>={fruit:'ชื่อผลไม้ / พันธุ์',stock_kg:'ปริมาณพร้อมขาย (กก.)',price:'ราคาขาย (บาท)',unit:'หน่วยขาย เช่น กก. หรือลัง',kg_per_unit:'น้ำหนักต่อหน่วย (กก.)',min_kg:'ขั้นต่ำต่อคำสั่งซื้อ (กก.)',ready:'เริ่มส่งได้วันที่',area:'พื้นที่จัดส่ง'}

export function LotSummary({lot}:{lot:Lot}){
  return <dl className="summary">{Object.entries(labels).map(([key,label])=>{
    const value=lot.fields[key as keyof Fields]
    return <div key={key}><dt>{label}</dt><dd>{value??'—'}{value===''?'—':''}</dd></div>
  })}</dl>
}
