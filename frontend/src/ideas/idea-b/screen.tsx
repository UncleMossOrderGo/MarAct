import { useState } from 'react';
import { RecordsScreen } from '../../shared/RecordsScreen';
import type { Fruit } from './api';
import { copy } from './language';
import type { Language } from './language';
import { SupplierComparison } from './supplier-comparison';
import { TrendDashboard } from './trend-dashboard';
import './styles.css';

const producePhoto = new URL('./procurement-produce.webp', import.meta.url).href;
const languageKey = 'maract.idea-b.language';

function readLanguage(): Language {
  try {
    return localStorage.getItem(languageKey) === 'en' ? 'en' : 'th';
  } catch {
    return 'th';
  }
}

export function IdeaB() {
  const [fruit, setFruit] = useState<Fruit>('mango');
  const [lang, setLang] = useState(readLanguage);
  const text = copy[lang];

  function changeLanguage(next: Language) {
    setLang(next);
    try {
      localStorage.setItem(languageKey, next);
    } catch {
      // The current page still works when browser storage is unavailable.
    }
  }

  return (
    <div className="buyer-intelligence" lang={lang}>
      <div className="buyer-intelligence__hero">
        <img className="buyer-intelligence__hero-image" src={producePhoto} alt="" fetchPriority="high" />
        <div className="buyer-intelligence__hero-content">
          <div className="buyer-intelligence__hero-top">
            <span className="buyer-intelligence__demo">{text.demo}</span>
            <div className="buyer-intelligence__language" role="group" aria-label={text.language}>
              <button type="button" lang="th" aria-pressed={lang === 'th'} onClick={() => changeLanguage('th')}>ไทย</button>
              <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => changeLanguage('en')}>English</button>
            </div>
          </div>
          <h1>{text.title}</h1>
          <p>{text.introduction}</p>
          <nav aria-label={text.workspace}>
            <a href="#supplier-heading">{text.supplier.compare} <span aria-hidden="true">↓</span></a>
            <a href="#trend-heading">{text.marketSignals} <span aria-hidden="true">↗</span></a>
          </nav>
        </div>
      </div>
      <div className="buyer-intelligence__workspace">
        <SupplierComparison fruit={fruit} onFruitChange={setFruit} lang={lang} />
        <TrendDashboard key={`${fruit}:${lang}`} fruit={fruit} lang={lang} />
      </div>
      <div className="buyer-intelligence__records" lang="en">
        <RecordsScreen title="Starter records" endpoint="/api/ideas/idea-b/records" />
      </div>
    </div>
  );
}
