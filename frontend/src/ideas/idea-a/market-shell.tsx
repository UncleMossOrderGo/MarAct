import { useState, type ReactNode } from 'react';
import './market-shell.css';

export type MarketShop = {
  id: string;
  name: string;
  category: string;
  menu_tags: readonly string[];
};

const navigation = [
  ['marketplace', 'Marketplace'],
  ['trends', 'Trends'],
  ['orders', 'Orders'],
  ['profile', 'Shop Profile'],
] as const;

export type MarketDestination = typeof navigation[number][0];

type MarketShellProps = {
  shops: readonly MarketShop[];
  activeShopId: string | null;
  destination: MarketDestination;
  cartCount: number;
  onShopChange: (shopId: string) => void;
  onNavigate: (destination: MarketDestination) => void;
  onOpenCart: () => void;
  showProfile?: boolean;
  onSignOut?: () => void;
  signingOut?: boolean;
  children?: ReactNode;
};

const shopIcons: Readonly<Record<string, string>> = {
  'Smoothie Café': '🥤',
  Bakery: '🥐',
  'Café': '☕',
};

function ShopPicker({ shops, onSelect }: {
  shops: readonly MarketShop[];
  onSelect: (shopId: string) => void;
}) {
  const [selection, setSelection] = useState('');
  const selected = shops.find((shop) => shop.id === selection) ?? shops[0];

  return (
    <section className="market-welcome">
      <p className="market-brand">MarAct Market</p>
      <h1>Buy fresh fruit for your business</h1>
      <p>Compare suppliers and get recommendations for your menu.</p>
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
                {shopIcons[shop.name] && <span aria-hidden="true">{shopIcons[shop.name]}</span>}
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
  shops, activeShopId, destination, cartCount, onShopChange, onNavigate, onOpenCart,
  showProfile = destination === 'profile', onSignOut, signingOut, children,
}: MarketShellProps) {
  const shop = shops.find(({ id }) => id === activeShopId);

  const signOut = onSignOut && <button type="button" onClick={onSignOut} disabled={signingOut}>
    {signingOut ? 'Signing out…' : 'Sign out'}
  </button>;
  return (
    <div className="market-shell">
      {shop ? (
        <div className="market-layout">
          <nav aria-label="Marketplace navigation" className="market-navigation">
            <p className="market-brand">MarAct Market</p>
            {navigation.map(([id, label]) => (
              <button key={id} type="button" aria-current={destination === id ? 'page' : undefined}
                onClick={() => onNavigate(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="market-workspace">
            <div className="market-toolbar">
              <label>
                Active shop
                <select value={shop.id} onChange={(event) => onShopChange(event.currentTarget.value)}>
                  {shops.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <button type="button" onClick={onOpenCart}>Cart ({cartCount})</button>
              {signOut}
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
      ) : <>
        {signOut && <div className="market-toolbar market-welcome-toolbar">{signOut}</div>}
        <ShopPicker shops={shops} onSelect={onShopChange} />
      </>}
    </div>
  );
}
