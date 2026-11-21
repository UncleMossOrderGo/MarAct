import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Image as ImageIcon } from 'lucide-react';
import { getPublishedFarms, matchesPublishedLot, publicPhoto, type PublicFarm } from '../farmer/public-lots';

export function FarmHarvest({ query }: { query: string }) {
  const [farms, setFarms] = useState<PublicFarm[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await getPublishedFarms(controller.signal);
        if (!controller.signal.aborted) { setFarms(data); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void load();
    window.addEventListener('focus', load);
    return () => { controller.abort(); window.removeEventListener('focus', load); };
  }, [retry]);
  const lots = (farms ?? []).flatMap(farm => farm.listings
    .filter(lot => lot.available && matchesPublishedLot(farm.profile.name, lot, query))
    .map(lot => ({ farm, lot })));
  const url = '/farms';
  return <section className="farm-harvest" aria-labelledby="harvest-title">
    <div className="harvest-head"><div><h2 id="harvest-title">ประกาศจากสวน</h2><p>ราคาและปริมาณที่เกษตรกรแจ้งผ่านเว็บและ LINE</p></div>
      <Link to={url + (query.trim() ? '?' + new URLSearchParams({ q: query }) : '')}>ดูประกาศทั้งหมด <ArrowUpRight size={16}/></Link></div>
    {error && <p role="alert">โหลดประกาศจากสวนไม่ได้ <button onClick={() => setRetry(retry + 1)}>ลองอีกครั้ง</button></p>}
    {!farms && !error && <p role="status">กำลังโหลดประกาศจากสวน…</p>}
    {farms && !lots.length && <p>{query.trim() ? 'ไม่มีประกาศจากสวนตรงกับคำค้นนี้' : 'ยังไม่มีประกาศที่พร้อมขาย'}</p>}
    <div className="farm-cards">{lots.slice(0, 3).map(({ farm, lot }) =>
      <Link key={farm.farmId + '-' + lot.id} className="farm-tile"
        to={url + '?' + new URLSearchParams({ farm: String(farm.farmId) }) + '#lot-' + encodeURIComponent(lot.id)}>
        {lot.photos[lot.cover] ? <img loading="lazy" width="130" height="105" src={publicPhoto(lot.photos[lot.cover])} alt=""/> : <span className="farm-no-photo"><ImageIcon size={24}/></span>}
        <div><small>{farm.profile.name}</small><h3>{lot.fields.fruit}</h3><strong>{lot.fields.price?.toLocaleString('th-TH')} บาท/{lot.fields.unit}</strong></div><ArrowUpRight size={17}/>
      </Link>)}</div>
  </section>;
}
