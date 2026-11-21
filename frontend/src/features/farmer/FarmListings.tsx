import { useState, useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ImagePlus, Truck } from 'lucide-react';
import { getPublishedFarms, matchesPublishedLot, publicPhoto, type PublicFarm } from './public-lots';
import { LotSummary } from './LotSummary';
import './studio.css';

export function FarmListings() {
  const [farms,setFarms]=useState<PublicFarm[]|null>(null)
  const [params,setParams]=useSearchParams()
  const {hash}=useLocation()
  const query=params.get('q')||'', selected=params.get('farm')||''
  const [error,setError]=useState(false)
  function filter(key: string, value: string) {
    const next=new URLSearchParams(params)
    if(value) next.set(key,value); else next.delete(key)
    setParams(next,{replace:true})
  }
  const loaded=!!farms
  useEffect(()=>{if(loaded && hash.startsWith('#lot-')) document.getElementById(hash.slice(1))?.focus()},[loaded,hash])
  useEffect(()=>{
    const ctrl=new AbortController()
    async function refresh(){
      try {
        const data=await getPublishedFarms(ctrl.signal)
        if(!ctrl.signal.aborted){setFarms(data);setError(false)}
      } catch {if(!ctrl.signal.aborted)setError(true)}
    }
    void refresh()
    const timer=window.setInterval(()=>{if(!document.hidden)void refresh()},10000)
    window.addEventListener('focus',refresh)
    return ()=>{ctrl.abort();clearInterval(timer);window.removeEventListener('focus',refresh)}
  },[])
  const lots=(farms||[]).filter(f=>!selected||String(f.farmId)===selected)
    .flatMap(f=>f.listings.map(lot=>({farm:f,lot}))).filter(({farm,lot})=>
      matchesPublishedLot(farm.profile.name,lot,query))
  return <div className="farmer" lang="th"><div className="wrap">
    <Link className="market-link" to="/market">← กลับตลาดผลไม้</Link>
    <div className="page-title"><h1>ตลาดผลไม้จากสวน</h1></div>
    <div className="panel market-filters">
      <label>ค้นหาผลไม้ พื้นที่จัดส่ง หรือชื่อสวนเต็ม<input type="search" value={query} onChange={e=>filter('q',e.target.value)} placeholder="เช่น มะม่วง หรือ ฉะเชิงเทรา"/></label>
      <label>เลือกสวน<select value={selected} onChange={e=>filter('farm',e.target.value)}><option value="">ทุกสวน</option>{farms?.map(f=><option key={f.farmId} value={f.farmId}>{f.profile.name}</option>)}</select></label>
    </div>
    {error&&<p className="alert" role="alert">โหลดข้อมูลตลาดไม่ได้ <button onClick={()=>window.location.reload()}>ลองอีกครั้ง</button></p>}
    {!farms&&!error&&<p role="status">กำลังโหลดผลผลิต…</p>}
    {farms&&<><p className="market-count" role="status">พบ {lots.length} ล็อต</p><div className="lots">{lots.map(({farm,lot})=>
      <article key={farm.farmId+'-'+lot.id} id={'lot-'+lot.id} tabIndex={-1}>
        <div className="product-image">{lot.photos.length?<img className="lotpic" src={publicPhoto(lot.photos[lot.cover])} alt={lot.fields.fruit}/>:<div className="placeholder"><ImagePlus/>ยังไม่มีรูปผลผลิต</div>}
          <span className={'availability'+(lot.available?' live':'')}>{lot.available?'พร้อมขาย':'สินค้าหมด'}</span></div>
        <div className="lotbody"><p>{farm.profile.name}{farm.profile.location?' · '+farm.profile.location:''}</p>
        <div className="product-title"><h2>{lot.fields.fruit}</h2><p className="price"><strong>฿{lot.fields.price}</strong> / {lot.fields.unit}</p></div>
        <p className="terms">พร้อมขาย {lot.fields.stock_kg} กก.</p><p className="destination"><Truck size={16}/>{lot.fields.area}</p>
        <details><summary>รายละเอียดล็อตและสวน</summary><p>{farm.profile.about}</p><LotSummary lot={lot}/>
          <Link className="market-link" to={'/market?' + new URLSearchParams({copilot:'1',brief:'ช่วยหาและเปรียบเทียบล็อต' + lot.fields.fruit + 'ที่สั่งซื้อได้ในตลาด'})}>เปรียบเทียบกับล็อตที่สั่งซื้อได้</Link>
          <div className="strip">{lot.photos.map((key,i)=><a href={publicPhoto(key)} key={key} target="_blank" rel="noreferrer"><img src={publicPhoto(key)} alt={'เปิดภาพสินค้า '+(i+1)}/></a>)}</div>
        </details></div>
      </article>)}</div>{!lots.length&&<p className="panel">{farms.length?'ลองเปลี่ยนคำค้นหรือเลือกสวนอื่น':'ยังไม่มีประกาศขายผลไม้'}</p>}</>}
  </div></div>
}
