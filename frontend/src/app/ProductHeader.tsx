import { Link, useLocation } from 'react-router-dom';
import { ShoppingBasket, Store, Sprout, TrendingUp, ReceiptText } from 'lucide-react';
const mascot = new URL('../shared/brand/maract-mascot.webp', import.meta.url).href;

type MarketNav = {
  tab: string; count: number; select: (tab: string) => void;
};

export function ProductHeader({ market }: { market?: MarketNav }) {
  const { pathname } = useLocation();
  return <header className="site-mast">
    <Link className="site-brand" to="/market" aria-label="MarAct หน้าตลาด"><img src={mascot} alt="" width="42" height="42" /><span>MarAct</span></Link>
    <nav className="site-nav" aria-label="Marketplace">
      {market ? <button aria-pressed={market.tab === 'market'} onClick={() => market.select('market')}><Store size={16}/>เลือกผลผลิต</button> : <Link to="/market"><Store size={16}/>เลือกผลผลิต</Link>}
      <Link to="/trends" aria-current={pathname.endsWith('/trends') ? 'page' : undefined}><TrendingUp size={16}/>เทรนด์ผลไม้</Link>
      {market ? <button aria-pressed={market.tab === 'cart'} onClick={() => market.select('cart')}><ShoppingBasket size={17}/>ตะกร้า ({market.count})</button> : <Link to="/market#cart"><ShoppingBasket size={17}/>ตะกร้า</Link>}
      {market ? <button aria-pressed={market.tab === 'orders'} onClick={() => market.select('orders')}><ReceiptText size={16}/>คำสั่งซื้อ</button> : <Link to="/market#orders"><ReceiptText size={16}/>คำสั่งซื้อ</Link>}
    </nav>
    <Link className="site-grower" to="/farmer" aria-current={pathname === '/farmer' ? 'page' : undefined}><Sprout size={17}/>สวนของฉัน</Link>
  </header>;
}
