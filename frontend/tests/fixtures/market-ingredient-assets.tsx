import { createRoot } from 'react-dom/client';
import { ingredientImage } from '../../src/features/shop/market-ingredient-assets';
import { marketCopy, useMarketLanguage } from '../../src/features/shop/market-locale';
import { featuredIngredientCopy } from './ingredient-copy';

const keys = [
  'pistachio-gelato', 'pistachio-paste', 'whipping-cream', 'milk', 'strawberry-shortcake', 'mango-smoothie',
  'blueberry', 'cream-cheese', 'butter', 'chocolate-chips', 'mango', 'unknown',
  'strawberry', 'banana', 'pineapple', 'flour', 'sugar', 'vanilla', 'cocoa',
  'matcha', 'orange', 'dragon-fruit', 'coconut', 'lemon', 'raspberry', 'avocado',
  'lychee', 'passion-fruit', 'yogurt', 'condensed-milk', 'almond', 'oat', 'honey', 'coffee', 'black-tea',
];

function Fixture() {
  const { locale, setLocale } = useMarketLanguage();
  const copy = marketCopy[locale];
  return (
    <main lang={locale} style={{ maxWidth: '100%' }}>
      <h1>{copy.today}</h1>
      <label>
        {copy.language}
        <select value={locale} onChange={(event) => setLocale(event.currentTarget.value === 'en' ? 'en' : 'th')}>
          <option value="th">ไทย</option>
          <option value="en">English</option>
        </select>
      </label>
      <p style={{ maxWidth: 180, overflowWrap: 'anywhere' }}>{featuredIngredientCopy[locale].longName}</p>
      {keys.map((key) => <img key={key} width={40} height={40} alt={key} src={ingredientImage(key)} />)}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
