import { useState, type ReactNode } from 'react';
import { ArrowUpRight, House, Package, Search, Settings, ShoppingBag, ShoppingCart, UserRound } from 'lucide-react';
import { MarketBrand, marketplaceMascot } from './market-brand';
import { marketCopy, type MarketLocale } from './market-locale';
import './market-design.css';
import './market-shell.css';

export type MarketShop = {
  id: string;
  name: string;
  category: string;
  menu_tags: readonly string[];
};

const legacyNavigation = [
  ['marketplace', 'Marketplace', House],
  ['trends', 'Trends', ArrowUpRight],
  ['orders', 'Orders', Package],
  ['profile', 'Shop Profile', UserRound],
] as const;

const dailyNavigation = [
  ['today', House],
  ['marketplace', ShoppingBag],
  ['orders', Package],
  ['settings', Settings],
] as const;
const mobileDailyLabels: Record<MarketLocale, Record<typeof dailyNavigation[number][0], string>> = {
  th: { today: 'เทรนด์', marketplace: 'ตลาด', orders: 'คำสั่งซื้อ', settings: 'ตั้งค่า' },
  en: { today: 'Trends', marketplace: 'Market', orders: 'Orders', settings: 'Settings' },
};

export type MarketDestination = typeof legacyNavigation[number][0] | typeof dailyNavigation[number][0];

type MarketShellProps = {
  shops: readonly MarketShop[];
  activeShopId: string | null;
  defaultShopId?: string;
  locale?: MarketLocale;
  destination: MarketDestination;
  cartCount: number;
  onShopChange: (shopId: string) => void;
  onNavigate: (destination: MarketDestination) => void;
  onOpenCart: () => void;
  showProfile?: boolean;
  onSignOut?: () => void;
  signingOut?: boolean;
  fruitSearch?: { value: string; onChange: (value: string) => void };
  children?: ReactNode;
};

function ShopPicker({ shops, onSelect }: {
  shops: readonly MarketShop[];
  onSelect: (shopId: string) => void;
}) {
  const [selection, setSelection] = useState('');
  const selected = shops.find((shop) => shop.id === selection) ?? shops[0];

  return (
    <section className="market-welcome">
      <img className="market-welcome-mascot" src={marketplaceMascot} alt="" width={120} height={120} />
      <h1>Fruit marketplace</h1>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (selected) onSelect(selected.id);
      }}>
        <fieldset>
          <legend>Choose your shop</legend>
          <div className="market-shop-options">
            {shops.map((shop) => (
              <label key={shop.id} className="market-shop-option">
                <input
                  type="radio"
                  name="market-shop"
                  value={shop.id}
                  checked={selected?.id === shop.id}
                  onChange={() => setSelection(shop.id)}
                />
                {shop.name}
              </label>
            ))}
          </div>
        </fieldset>
        {selected ? <button className="market-primary">Continue</button> : <p>No demo shops are available.</p>}
      </form>
    </section>
  );
}

export function MarketShell({
  shops, activeShopId, defaultShopId, locale = 'th', destination, cartCount, onShopChange, onNavigate, onOpenCart,
  showProfile = destination === 'profile', onSignOut, signingOut, fruitSearch, children,
}: MarketShellProps) {
  const shop = shops.find(({ id }) => id === activeShopId)
    ?? shops.find(({ id }) => id === defaultShopId);
  const daily = defaultShopId !== undefined;
  const copy = marketCopy[daily ? locale : 'en'];
  const navigation = daily
    ? dailyNavigation.map(([id, Icon]) => [id, copy[id], Icon, mobileDailyLabels[locale][id]] as const)
    : legacyNavigation;

  const signOut = onSignOut && <button type="button" onClick={onSignOut} disabled={signingOut}>
    {signingOut ? 'Signing out…' : 'Sign out'}
  </button>;
  return (
    <div className={daily ? 'market-shell market-shell--daily' : 'market-shell'} lang={daily ? locale : undefined}>
      {shop ? (
        <div className="market-layout">
          <nav aria-label={copy.navigation} className="market-navigation">
            <MarketBrand />
            {navigation.map(([id, label, Icon, shortLabel]) => (
              <button key={id} type="button" aria-current={destination === id ? 'page' : undefined}
                aria-label={shortLabel ? label : undefined}
                onClick={() => onNavigate(id)}>
                <Icon size={20} aria-hidden="true" />
                {shortLabel ? <>
                  <span className="market-nav-wide-label">{label}</span>
                  <span className="market-nav-short-label">{shortLabel}</span>
                </> : label}
              </button>
            ))}
          </nav>
          <div className="market-workspace">
            <div className="market-toolbar">
              {daily && <div className="market-mobile-brand"><MarketBrand /></div>}
              <label>
                {copy.activeShop}
                <select value={shop.id} onChange={(event) => onShopChange(event.currentTarget.value)}>
                  {shops.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              {fruitSearch && (
                <div className="market-search">
                  <Search size={20} aria-hidden="true" />
                  <input type="search" aria-label={daily ? copy.search : 'Search fruit'}
                    placeholder={daily ? copy.search : 'Search fruit'} value={fruitSearch.value}
                    onChange={(event) => fruitSearch.onChange(event.currentTarget.value)} />
                </div>
              )}
              <div className="market-toolbar-actions">
                <button type="button" className="market-cart-control" onClick={onOpenCart}>
                  <ShoppingCart size={20} aria-hidden="true" />
                  {copy.cart} ({cartCount})
                </button>
                {signOut}
              </div>
            </div>
            {showProfile && (
              <section className="market-profile">
                <h1>{shop.name}</h1>
                <p>{shop.category}</p>
                <h2>Menu tags</h2>
                {shop.menu_tags.length > 0 ? (
                  <ul>{shop.menu_tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
                ) : <p>No menu tags yet.</p>}
              </section>
            )}
            {children}
          </div>
        </div>
      ) : daily ? <div className="market-workspace">{children}</div> : <>
        {signOut && <div className="market-toolbar market-welcome-toolbar">{signOut}</div>}
        <ShopPicker shops={shops} onSelect={onShopChange} />
      </>}
    </div>
  );
}
