import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { demoIdeas, ideaPath, ideas } from '../legacy/registry';
import { Marketplace } from '../features/marketplace/screen';
import './styles.css';
import { FarmerLogin } from '../features/farmer/FarmerLogin';
import { ProductHeader } from './ProductHeader';

import { Trends } from '../features/marketplace/Trends';
import './product.css';

const FarmerStudio = lazy(() => import('../features/farmer/FarmerStudio').then(module => ({ default: module.FarmerStudio })));
const FarmListings = lazy(() => import('../features/farmer/FarmListings').then(module => ({ default: module.FarmListings })));

function OldLink({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

function IdeaPage() {
  const { ideaId } = useParams();
  const navigate = useNavigate();
  const idea = ideas.find(({ id, status }) => id === ideaId && status !== 'retired');
  const selected = idea?.status === 'demo' ? idea.id : '';

  return (
    <>
      <ProductHeader />
      {idea && <header className="legacy-switch">
        <label>
          Idea
          <select value={selected} onChange={(event) => navigate(ideaPath(event.target.value))}>
            {!selected && <option value="" disabled>Choose a demo</option>}
            {demoIdeas.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </header>}
      <main>{idea ? <idea.Screen key={idea.id} /> : <h1>Idea unavailable</h1>}</main>
    </>
  );
}

function MarketRedirect({ copilot = false }: { copilot?: boolean }) {
  const { search, hash } = useLocation();
  const query = new URLSearchParams(search);
  if (copilot) query.set('copilot', '1');
  return <Navigate to={{ pathname: '/market', search: query.toString(), hash }} replace />;
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<MarketRedirect />} />
      <Route path="/market" element={<Marketplace />} />
      <Route path="/trends" element={<><ProductHeader/><main className="product-wide"><Trends/></main></>} />
      <Route path="/login" element={<><ProductHeader/><main className="product-wide"><FarmerLogin/></main></>} />
      <Route path="/farmer" element={<><ProductHeader/><main className="product-wide"><Suspense fallback={<p role="status">กำลังเปิดหน้าสวน…</p>}><FarmerStudio/></Suspense></main></>} />
      <Route path="/farms" element={<><ProductHeader/><main className="product-wide"><Suspense fallback={<p role="status">กำลังโหลดประกาศ…</p>}><FarmListings/></Suspense></main></>} />
      <Route path="/ideas/idea-d" element={<OldLink to="/farmer"/>} />
      <Route path="/ideas/idea-d/marketplace" element={<OldLink to="/farms"/>} />
      <Route path="/ideas/idea-b/trends" element={<OldLink to="/trends"/>} />
      <Route path="/ideas/idea-c" element={<MarketRedirect />} />
      <Route path="/ideas/idea-b" element={<MarketRedirect copilot />} />
      <Route path="/ideas/:ideaId/*" element={<IdeaPage />} />
      <Route path="*" element={<IdeaPage />} />
    </Routes>
  </BrowserRouter>,
);
