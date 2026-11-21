import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { demoIdeas, ideaPath, ideas } from '../ideas/registry';
import { Marketplace } from '../features/marketplace/screen';
import './styles.css';

function IdeaPage() {
  const { ideaId } = useParams();
  const navigate = useNavigate();
  const idea = ideas.find(({ id, status }) => id === ideaId && status !== 'retired');
  const selected = idea?.status === 'demo' ? idea.id : '';

  return (
    <>
      <header>
        <strong>MarAct</strong>
        <label>
          Idea
          <select value={selected} onChange={(event) => navigate(ideaPath(event.target.value))}>
            {!selected && <option value="" disabled>Choose a demo</option>}
            {demoIdeas.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </header>
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
      <Route path="/market" element={<><header><strong>MarAct</strong></header><main><Marketplace /></main></>} />
      <Route path="/ideas/idea-c" element={<MarketRedirect />} />
      <Route path="/ideas/idea-b" element={<MarketRedirect copilot />} />
      <Route path="/ideas/:ideaId/*" element={<IdeaPage />} />
      <Route path="*" element={<IdeaPage />} />
    </Routes>
  </BrowserRouter>,
);
