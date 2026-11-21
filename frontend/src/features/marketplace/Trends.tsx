import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react';
import { TrendDashboard } from '../../legacy/workspace/trend-dashboard';
import type { Fruit } from '../../legacy/workspace/api';

const fruitNames = { mango: 'มะม่วง', pineapple: 'สับปะรด' } as const;

export function Trends() {
  const [params, setParams] = useSearchParams();
  const fruit: Fruit = params.get('fruit') === 'pineapple' ? 'pineapple' : 'mango';
  const name = fruitNames[fruit];
  return <div className="trend-page">
    <div className="trend-lead"><div><h1>เทรนด์ผลไม้</h1><p>เทียบความสนใจในการค้นหาและการพูดถึง ก่อนเลือกผลไม้เข้าร้าน</p></div>
      <Link to="/ideas/idea-b/workspace#supplier-heading">เปรียบเทียบสวน <ArrowDownRight size={18}/></Link>
    </div>
    <div className="trend-fruits" role="group" aria-label="เลือกผลไม้เพื่อดูเทรนด์">
      {(['mango', 'pineapple'] as const).map(key => <button key={key} aria-pressed={key === fruit} onClick={() => setParams({ fruit: key })}>{fruitNames[key]}</button>)}
    </div>
    <div className="buyer-intelligence"><TrendDashboard key={fruit} fruit={fruit} lang="th"/></div>
    <div className="trend-actions"><Link to={'/market?' + new URLSearchParams({ q: name })}>ค้นหา{name}ในตลาด <ArrowUpRight size={18}/></Link>
      <Link to={'/market?' + new URLSearchParams({copilot: '1', brief: 'ช่วยหา' + name + 'ที่เหมาะกับร้านของฉัน'})}><Sparkles size={16}/>ถามผู้ช่วยเรื่อง{name}</Link></div>
  </div>;
}
