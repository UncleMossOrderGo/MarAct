import { useState, type ReactNode } from 'react';
import { ArrowUpRight, House, Package, Search, ShoppingCart, UserRound } from 'lucide-react';
import { MarketBrand, marketplaceMascot } from './market-brand';
import './market-design.css';
import './market-shell.css';

export type MarketShop = {
  id: string;
  name: string;
  category: string;
  menu_tags: readonly string[];
};

const navigation = [
  ['marketplace', 'Marketplace', House],
  ['trends', 'Trends', ArrowUpRight],
  ['orders', 'Orders', Package],
  ['profile', 'Shop Profile', UserRound],
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
  shops, activeShopId, destination, cartCount, onShopChange, onNavigate, onOpenCart,
  showProfile = destination === 'profile', onSignOut, signingOut, fruitSearch, children,
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
            <MarketBrand />
            {navigation.map(([id, label, Icon]) => (
              <button key={id} type="button" aria-current={destination === id ? 'page' : undefined}
                onClick={() => onNavigate(id)}>
                <Icon size={20} aria-hidden="true" />
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
              {fruitSearch && (
                <div className="market-search">
                  <Search size={20} aria-hidden="true" />
                  <input type="search" aria-label="Search fruit"
                    placeholder="Search fruit" value={fruitSearch.value}
                    onChange={(event) => fruitSearch.onChange(event.currentTarget.value)} />
                </div>
              )}
              <div className="market-toolbar-actions">
                <button type="button" className="market-cart-control" onClick={onOpenCart}>
                  <ShoppingCart size={20} aria-hidden="true" />
                  Cart ({cartCount})
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
      ) : <>
        {signOut && <div className="market-toolbar market-welcome-toolbar">{signOut}</div>}
        <ShopPicker shops={shops} onSelect={onShopChange} />
      </>}
    </div>
  );
}
