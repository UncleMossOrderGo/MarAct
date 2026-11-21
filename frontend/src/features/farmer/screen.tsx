import {useCallback, useEffect, useState} from 'react'
import type {FormEvent, ChangeEvent} from 'react'
import '@fontsource-variable/noto-sans-thai'
import { ArrowDown, ArrowUpRight, Boxes, ChevronDown, ImagePlus, MapPin, PencilLine, Send, SlidersHorizontal, Sparkles, Store, Truck } from 'lucide-react'
import { FarmOrders } from './farm-orders'
import { LinePanel } from './line-panel'
import './studio.css'

const api='/api/farmer'
const assets = {
  gold:new URL('./assets/product-mango-namdokmai-a.webp',import.meta.url).href,
  green:new URL('./assets/product-mango-khiaosawoei-b.webp',import.meta.url).href,
  orchard:new URL('./assets/cover-suan-lung-som.webp',import.meta.url).href,
  logo:new URL('./assets/logo-suan-lung-som.webp',import.meta.url).href
}
const photo=(id:string)=>id==='gold'||id==='green'?assets[id]:api+'/photos/'+id
type Profile={name:string;location:string;area:string;about:string}
type Fields={fruit:string;stock_kg:number|null;price:number|null;unit:string;kg_per_unit:number|null;min_kg:number|null;ready:string|null;area:string}
type Lot={id:string;fields:Fields;photos:string[];cover:number;available?:boolean}
type Draft=Lot&{history:{role:string;text:string}[];question:string}
type Farm={revision:number;profile:Profile;draft:Draft;listings:Lot[];missing:string[]}
type Action=(path:string,method:string,payload:object,ok?:string)=>Promise<boolean>
const labels:Record<keyof Fields,string>={fruit:'ชื่อผลไม้ / พันธุ์',stock_kg:'ปริมาณพร้อมขาย (กก.)',price:'ราคาขาย (บาท)',unit:'หน่วยขาย เช่น กก. หรือลัง',kg_per_unit:'น้ำหนักต่อหน่วย (กก.)',min_kg:'ขั้นต่ำต่อคำสั่งซื้อ (กก.)',ready:'เริ่มส่งได้วันที่',area:'พื้นที่จัดส่ง'}
const numberKeys=['stock_kg','price','kg_per_unit','min_kg']
const tabs=['โปรไฟล์สวน','จัดการสวน','ผู้ช่วยลงขาย'] as const
type Tab=typeof tabs[number]

function Summary({lot}:{lot:Lot}){
  return <dl className="summary">{Object.entries(labels).map(([key,label])=>{
    const value=lot.fields[key as keyof Fields]
    return <div key={key}><dt>{label}</dt><dd>{value??'—'}{value===''?'—':''}</dd></div>
  })}</dl>
}

function ImageStrip({lot,onCover}:{lot:Lot;onCover?:(i:number)=>void}){
  return <div className="strip">{lot.photos.map((key,i)=>onCover?
    <button key={key} type="button" className={lot.cover===i?'chosen':''} aria-pressed={lot.cover===i} onClick={()=>onCover(i)}><img src={photo(key)} alt={`สินค้า รูปที่ ${i+1}`}/>{lot.cover===i?'รูปปก':'ใช้เป็นปก'}</button>:
    <a key={key} href={photo(key)} target="_blank" rel="noreferrer"><img src={photo(key)} alt={`เปิดภาพสินค้า ${i+1}`}/></a>)}</div>
}

function Chat({farm,act}:{farm:Farm;act:Action}){
  const [message,setMessage]=useState('')
  async function submit(e:FormEvent){
    e.preventDefault()
    if(message.trim() && await act('/draft/chat','POST',{message:message.trim()}))setMessage('')
  }
  return <section className="panel chat-panel"><h2><span className="agent-icon"><Sparkles size={20}/></span>คุยกับผู้ช่วยลงขาย</h2>
    <div className="thread" aria-label="บทสนทนา">{farm.draft.history.length===0&&<p>วันนี้สวนมีผลไม้อะไรพร้อมขายครับ? บอกชื่อผลไม้ จำนวน และราคา หรือเพิ่มรูปก่อนได้เลย</p>}
    {farm.draft.history.map((m,i)=><p key={i} className={m.role==='user'?'bubble seller':'bubble'}><small>{m.role==='user'?'เจ้าของสวน':'ผู้ช่วย'}</small>{m.text}</p>)}</div>
    <form onSubmit={submit}><label>ข้อความถึงผู้ช่วย<textarea rows={3} maxLength={2000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="เช่น มะม่วงน้ำดอกไม้ 75 โล ขายโลละ 35 บาท"/></label><button className="primary" disabled={!message.trim()}><Send size={16}/>ส่งข้อความ</button></form>
  </section>
}

function DraftForm({farm,act}:{farm:Farm;act:Action}){
  const [fields,setFields]=useState(farm.draft.fields)

  return <form className="panel" onSubmit={e=>{e.preventDefault();void act('/draft','PUT',{fields,cover:farm.draft.cover},'บันทึกร่างแล้ว')}}><h2>กรอกรายละเอียดล็อต</h2>
    <div className="gridfields">{Object.entries(labels).map(([k,label])=>{
      const key=k as keyof Fields, numeric=numberKeys.includes(k)
      return <label key={k}>{label}<input type={numeric?'number':k==='ready'?'date':'text'} step={numeric?'any':undefined} min={numeric?'0.000001':undefined}
         value={fields[key]??''} maxLength={200} onChange={e=>setFields({...fields,[key]:numeric?(e.target.value?Number(e.target.value):null):k==='ready'?(e.target.value||null):e.target.value})}/></label>
    })}</div><button className="primary">บันทึกร่างจากแบบฟอร์ม</button></form>
}

function ProfileEditor({profile,act}:{profile:Profile;act:Action}){
  return <form className="panel" onSubmit={e=>{e.preventDefault();void act('/profile','PUT',{profile:Object.fromEntries(new FormData(e.currentTarget))},'บันทึกโปรไฟล์แล้ว')}}>
    <h2>ข้อมูลสวน</h2><div className="gridfields">{Object.entries({name:'ชื่อสวน',location:'ที่ตั้งสวน',area:'พื้นที่จัดส่ง',about:'แนะนำสวน'}).map(([k,v])=><label key={k}>{v}<input name={k} defaultValue={profile[k as keyof Profile]} required={k==='name'} maxLength={200}/></label>)}</div><button className="primary">บันทึกโปรไฟล์</button></form>
}

function fileData(file:File):Promise<string>{
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('อ่านรูปไม่สำเร็จ'));r.readAsDataURL(file)})
}

export function FarmerStudio(){
  const [farm,setFarm]=useState<Farm|null>(null),[tab,setTab]=useState<Tab>('โปรไฟล์สวน')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [manual,setManual]=useState(false),[detail,setDetail]=useState('')
  const refresh=useCallback(async(quiet=false)=>{
    if(!quiet)setError('')
    try{
      const r=await fetch(api+'/workspace',{cache:'no-store'})
      if(!r.ok)throw Error()
      const next:Farm=await r.json()
      setFarm(current=>current&&current.revision>=next.revision?current:next)
    }catch{if(!quiet)setError('โหลดข้อมูลสวนไม่ได้ กรุณาตรวจว่า backend เปิดอยู่แล้วลองอีกครั้ง')}
  },[])
  useEffect(()=>{void refresh()},[refresh])
  const watchDraft=!!farm&&!busy&&(tab==='โปรไฟล์สวน'||(tab==='ผู้ช่วยลงขาย'&&!manual))
  useEffect(()=>{
    if(!watchDraft)return
    const update=()=>{if(!document.hidden)void refresh(true)}
    window.addEventListener('focus',update)
    const timer=window.setInterval(update,10000)
    return ()=>{clearInterval(timer);window.removeEventListener('focus',update)}
  },[watchDraft,refresh])
  const act:Action=async(path,method,payload,ok)=>{
    if(!farm||busy)return false
    setBusy(true);setError('');setNotice('')
    try{
      const res=await fetch(api+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:farm.revision,...payload})})
      const body=await res.json()
      if(!res.ok)throw Error(typeof body.detail==='string'?body.detail:'กรุณาตรวจรูปแบบข้อมูลอีกครั้ง')
      setFarm(body);setNotice(ok||'อัปเดตร่างแล้ว');return true
    }catch(e){setError(e instanceof Error?e.message:'เชื่อมต่อไม่ได้');return false}finally{setBusy(false)}
  }
  async function upload(e:ChangeEvent<HTMLInputElement>){
    const files=Array.from(e.target.files||[]);e.target.value=''
    if(!files.length)return
    if(files.length+(farm?.draft.photos.length||0)>6||files.some(f=>f.size>4*1024*1024)){setError('เลือกได้รวม 6 รูป รูปละไม่เกิน 4 MB');return}
    try{await act('/draft/photos','POST',{images:await Promise.all(files.map(fileData))},'เพิ่มรูปในร่างแล้ว')}catch{setError('อ่านไฟล์ภาพไม่ได้')}
  }
  const d=farm?.draft
  const navIcons = [Store, SlidersHorizontal, Sparkles]
  return <div className="farmer" lang="th">
    <a className="skip" href="#farm-content">ข้ามไปที่เนื้อหา</a>
    <header className="mast"><div className="mast-inner">
      <nav aria-label="เมนูสวน">{tabs.map((t,i)=>{
        const Icon = navIcons[i]
        return <button key={t} aria-current={tab===t?'page':undefined} onClick={()=>{setTab(t);setDetail('')}}><Icon size={17}/>{t}</button>
      })}</nav>
      <div className="account"><img src={assets.logo} alt=""/><span>เจ้าของสวน<small>พื้นที่ทดลอง</small></span></div>
    </div></header>
    <div className="wrap" id="farm-content" tabIndex={-1}>
    {error&&<div role="alert" className="alert">{error} <button onClick={()=>void refresh()}>โหลดข้อมูลล่าสุด</button></div>}
    <div role="status" className="notice">{busy?'กำลังดำเนินการ…':notice}</div>
    {!farm||!d?<p>{error?'ยังไม่มีข้อมูลให้แสดง':'กำลังโหลดสวน…'}</p>:<fieldset disabled={busy}>
    {tab==='โปรไฟล์สวน'?<>
      <section className="farm-intro">
        <div className="farm-story">
          <p className="region"><MapPin size={16}/>{farm.profile.location||'โปรไฟล์เกษตรกร'}</p>
          <h1>{farm.profile.name}</h1>
          <p className="farm-about">{farm.profile.about}</p>
          <a className="harvest-link" href="#harvest">ดูผลผลิตจากสวน <ArrowDown size={17}/></a>
        </div>
        <img className="orchard" src={assets.orchard} alt="บรรยากาศแปลงมะม่วงในสวนตัวอย่าง" fetchPriority="high"/>
      </section>
      <div className="supply-strip">
        <div><Truck/><span><small>พื้นที่จัดส่งของสวน</small><strong>{farm.profile.area||'ยังไม่ระบุ'}</strong></span></div>
        <div><Boxes/><span><small>ล็อตพร้อมขาย</small><strong>{farm.listings.filter(l=>l.available).length} ล็อต</strong></span></div>
        <button onClick={()=>setTab('จัดการสวน')}><PencilLine size={16}/>จัดการข้อมูลสวน</button>
      </div>
      <a className="market-link" href={`/market?q=${encodeURIComponent(farm.profile.name)}`}>ดูประกาศในตลาดผลไม้ <ArrowUpRight size={16}/></a>
      <section id="harvest"><div className="heading"><div className="title-row"><h2>ผลผลิตจากสวน</h2><span className="count">{farm.listings.length}</span></div>
        <button className="primary" onClick={()=>{setManual(false);setTab('ผู้ช่วยลงขาย')}}><Sparkles size={17}/>ลงขายกับผู้ช่วย</button></div>
      <div className="lots">{farm.listings.map(l=><article key={l.id}>
        <div className="product-image">
          {l.photos.length?<img className="lotpic" src={photo(l.photos[l.cover])} alt={l.fields.fruit}/>:<div className="placeholder"><ImagePlus/>ยังไม่มีรูปผลผลิต</div>}
          <span className={'availability'+(l.available?' live':'')}>{l.available?'พร้อมขาย':'สินค้าหมด'}</span>
        </div>
        <div className="lotbody"><div className="product-title"><h3>{l.fields.fruit}</h3><p className="price"><strong>฿{l.fields.price}</strong> / {l.fields.unit}</p></div>
          <div className="terms"><span>พร้อมขาย <b>{l.fields.stock_kg} กก.</b></span><span>ขั้นต่ำ <b>{l.fields.min_kg==null?'ยังไม่ระบุ':l.fields.min_kg+' กก.'}</b></span></div>
          <p className="destination"><Truck size={16}/>{l.fields.area||'ยังไม่ระบุพื้นที่ส่ง'}</p>
          <button className="details" aria-expanded={detail===l.id} onClick={()=>setDetail(detail===l.id?'':l.id)}>{detail===l.id?'ปิดรายละเอียด':'ดูรายละเอียดล็อต'}<ChevronDown size={16}/></button>
          {detail===l.id&&<><Summary lot={l}/><ImageStrip lot={l}/></>}
        </div>
      </article>)}</div>
      {!farm.listings.length&&<p className="panel">ยังไม่มีผลผลิตที่ลงขาย</p>}</section>
    </>:tab==='จัดการสวน'?<>
      <div className="page-title"><p>{farm.profile.name} / จัดการสวน</p><h1>หลังร้านของสวน</h1></div><ProfileEditor profile={farm.profile} act={act}/><FarmOrders/><LinePanel/>
      <section className="panel"><div className="heading"><h2>สินค้าที่ลงขาย</h2><button onClick={()=>{setManual(true);setTab('ผู้ช่วยลงขาย')}}><PencilLine size={16}/>สร้างหรือแก้ร่าง</button></div>
      {farm.listings.map(l=><form key={l.id+farm.revision} className="stock" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void act('/listings/'+l.id+'/terms','PUT',{kg:Number(data.get('kg')),price:Number(data.get('price'))},'อัปเดตสินค้าแล้ว')}}><strong>{l.fields.fruit}</strong><label>สต็อก (กก.)<input name="kg" type="number" step="any" min="0" required defaultValue={l.fields.stock_kg??0}/></label><label>บาท/{l.fields.unit}<input name="price" type="number" step="any" min="0.000001" required defaultValue={l.fields.price??''}/></label><button>บันทึก</button></form>)}</section>
    </>:<>
      <div className="page-title"><p>{farm.profile.name} / ร่างประกาศ</p><h1>ผู้ช่วยลงขาย</h1>{!manual&&<button type="button" onClick={()=>void refresh()}>โหลดร่างล่าสุดจากเว็บและ LINE</button>}</div><div className="work"><div><div className="switch"><button aria-pressed={!manual} onClick={()=>setManual(false)}>คุยกับผู้ช่วย</button><button aria-pressed={manual} onClick={()=>setManual(true)}>กรอกเอง</button></div>
      {manual?<DraftForm key={d.id+JSON.stringify(d.fields)} farm={farm} act={act}/>:<Chat farm={farm} act={act}/>}
      <div className="panel upload"><h2><ImagePlus size={20}/>รูปสินค้า</h2><label className="file-picker"><ImagePlus aria-hidden="true"/><span>เลือกรูปจากเครื่อง<small>JPG, PNG หรือ WebP · สูงสุด 6 รูป</small></span><input aria-label="เลือกรูปจากเครื่อง" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={upload}/></label>
      <ImageStrip lot={d} onCover={i=>void act('/draft/cover','PUT',{cover:i},'เปลี่ยนรูปปกแล้ว')}/></div></div>
      <section className="panel preview"><small>ร่างประกาศ</small><h2>ตรวจสอบก่อนลงขาย</h2><Summary lot={d}/>{d.photos.length>0&&<img className="previewpic" src={photo(d.photos[d.cover])} alt="รูปปกที่จะเผยแพร่"/>}
      {(d.question||farm.missing[0])&&<p className="question">{d.question||farm.missing[0]}</p>}
      <button className="primary" disabled={!!d.question||farm.missing.length>0} onClick={async()=>{if(await act('/draft/'+d.id+'/publish','POST',{},'เผยแพร่ประกาศบนโปรไฟล์สวนแล้ว'))setTab('โปรไฟล์สวน')}}>ยืนยันลงขาย <ArrowUpRight size={17}/></button></section></div>
    </>}</fieldset>}</div></div>
}
