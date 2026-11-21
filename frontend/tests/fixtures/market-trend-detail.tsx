import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketTrendDetail } from '../../src/ideas/idea-a/market-trend-detail';
import '../../src/app/styles.css';
import '../../src/ideas/idea-a/market-design.css';
import { dailyFixture, dailyFixtureImage } from './market-daily-data';

function Fixture() {
  const [result, setResult] = useState('');
  return (
    <main>
      <MarketTrendDetail trend={dailyFixture.trends[0]} run={dailyFixture.run} locale="en"
        resolveImage={dailyFixtureImage} onBack={() => setResult('back')}
        onAddItems={(lines) => setResult(JSON.stringify(lines))} />
      <output aria-label="Cart payload">{result}</output>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
