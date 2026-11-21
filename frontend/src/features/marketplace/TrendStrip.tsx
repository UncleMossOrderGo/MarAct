import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, ArrowRight } from 'lucide-react';
import { getTrend, type FruitTrend } from '../../legacy/workspace/api';

export function TrendStrip() {
  const [data, setData] = useState<FruitTrend>();
  useEffect(() => {
    const controller = new AbortController();
    getTrend('mango', 'th', controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  const latest = data?.signals.find(signal => signal.metric === 'social_mentions')?.week_over_week_pct;
  return <aside className="trend-strip"><TrendingUp size={22}/>
    <div><strong>จับตาเทรนด์ผลไม้</strong> <span>{typeof latest === 'number' && data
      ? `การพูดถึงมะม่วง ${latest > 0 ? '+' : ''}${latest}% เทียบสัปดาห์ก่อน · ${data.data_status === 'demo' ? 'ข้อมูลตัวอย่าง' : 'ข้อมูลที่สังเกตได้'}`
      : 'ดูสัญญาณจากยอดค้นหาและการพูดถึงผลไม้'}</span></div>
    <Link to="/trends">ดูเทรนด์ <ArrowRight size={16}/></Link>
  </aside>;
}
