import { UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { MarketBrand } from '../features/shop/market-brand';
import '../features/shop/market-design.css';
import './workspace-nav.css';

export function WorkspaceNav({ label, children }: { label: string; children: ReactNode }) {
  return <aside className="workspace-rail">
    <div className="workspace-rail-header"><MarketBrand /><Link className="workspace-account" to="/market/login" aria-label="บัญชีและบทบาท" title="บัญชีและบทบาท"><UserRound size={16} aria-hidden="true" /><span>บัญชี</span></Link></div>
    <nav aria-label={label}>{children}</nav>
  </aside>;
}
