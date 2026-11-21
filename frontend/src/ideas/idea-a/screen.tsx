import { useRef, useState } from 'react';

import { MarketCart, useMarketCart, type MarketCartItem } from './market-cart';
import {
  MarketCheckout, MarketOrderConfirmation, useMarketCheckoutAttempts, type SavedMarketOrder,
} from './market-checkout';
import { ingredientImage } from './market-ingredient-assets';
import { MarketIngredientCatalog, MarketIngredientProduct } from './market-ingredient-catalog';
import { marketCopy, useMarketLanguage, type MarketLocale } from './market-locale';
import { MarketOrderDetails, MarketOrderHistory } from './market-order-history';
import { MarketSettings } from './market-settings';
import { MarketShell, type MarketDestination } from './market-shell';
import { MarketSkeleton } from './market-skeleton';
import { MarketToday, type MarketDailyJobState } from './market-today';
import { MarketTrendDetail } from './market-trend-detail';
import { dailyMarketplaceApi, waitForDailyPublication } from './marketplace-api';
import { useMarketplaceResource } from './marketplace-resource';

type View = { type: 'navigation' } | { type: 'trend'; slug: string; section: 'overview' | 'ingredients' }
  | { type: 'product'; id: string } | { type: 'checkout' }
  | { type: 'confirmation' | 'saved-order'; order: SavedMarketOrder };

const shopKey = 'maract.idea-a.daily-shop';
const shopsLoader = (_key: string, signal: AbortSignal) => dailyMarketplaceApi.shops(signal);
const statusLoader = (_key: string, signal: AbortSignal) => dailyMarketplaceApi.jobStatus(signal);
const productLoader = (id: string, signal: AbortSignal) => dailyMarketplaceApi.listings({ ingredient_id: id }, signal);
function todayLoader(key: string, signal: AbortSignal) {
  const [shopId, locale] = JSON.parse(key) as [string, MarketLocale];
  return dailyMarketplaceApi.today(shopId, locale, signal);
}

export function IdeaA() {
  const { locale, setLocale } = useMarketLanguage();
  const copy = marketCopy[locale];
  const [selectedShop, setSelectedShop] = useState(() => localStorage.getItem(shopKey));
  const [destination, setDestination] = useState<MarketDestination>('today');
  const [view, setView] = useState<View>({ type: 'navigation' });
  const [cartOpen, setCartOpen] = useState(false);

  const shops = useMarketplaceResource('shops', shopsLoader);
  const defaultId = shops.data?.default_shop_id;
  const shop = shops.data?.shops.find(({ id }) => id === selectedShop)
    ?? shops.data?.shops.find(({ id }) => id === defaultId);
  const activeShop = useRef<string | null>(null);
  const today = useMarketplaceResource(shop ? JSON.stringify([shop.id, locale]) : null, todayLoader, true);
  const jobStatus = useMarketplaceResource('status', statusLoader, true);
  const orders = useMarketplaceResource(
    destination === 'orders' || destination === 'settings' ? shop?.id ?? null : null,
    dailyMarketplaceApi.orders,
  );
  const product = useMarketplaceResource(view.type === 'product' ? view.id : null, productLoader);
  const cart = useMarketCart(shop?.id ?? null);
  const attempts = useMarketCheckoutAttempts();
  async function refresh(signal: AbortSignal, report: (state: MarketDailyJobState) => void) {
    await waitForDailyPublication(signal, report);
    today.reload();
    jobStatus.reload();
  }

  function navigate(next: MarketDestination) {
    setView({ type: 'navigation' });
    setDestination(next);
  }

  function changeShop(id: string) {
    activeShop.current = id;
    localStorage.setItem(shopKey, id);
    setSelectedShop(id);
    setCartOpen(false);
    navigate('today');
  }

  function addItems(lines: readonly MarketCartItem[]) {
    if (!shop || !lines.length) return;
    attempts.invalidate(shop.id);
    cart.addAll(lines);
  }

  function orderPlaced(order: SavedMarketOrder) {
    cart.clearShop(order.shop_id);
    today.reload();
    orders.reload();
    if ((activeShop.current ?? shop?.id) !== order.shop_id) return;
    setDestination('orders');
    setView({ type: 'confirmation', order });
  }

  const trendView = view.type === 'trend' ? view : null;
  const trend = trendView ? today.data?.trends.find(({ slug }) => slug === trendView.slug) : undefined;

  return (
    <MarketShell
      shops={shops.data?.shops.map((item) => ({ ...item, menu_tags: [] })) ?? []}
      activeShopId={shop?.id ?? null}
      defaultShopId={defaultId ?? ''}
      locale={locale}
      destination={destination}
      cartCount={cart.items.length}
      onShopChange={changeShop}
      onNavigate={navigate}
      onOpenCart={() => setCartOpen(true)}
    >
      {shops.loading && <MarketSkeleton label={copy.loading} />}
      {shops.failed && (
        <section><p role="alert">{copy.loadError}</p><button type="button" onClick={shops.reload}>{copy.retry}</button></section>
      )}
      {shops.data && !shop && <p>{locale === 'th' ? 'ยังไม่มีร้านค้าตัวอย่าง' : 'No demo shops are available.'}</p>}
      {shop && <>
        {view.type === 'navigation' && destination === 'today' && (
          <MarketToday
            data={today.data ?? null}
            locale={locale}
            loading={today.loading}
            error={today.failed ? copy.loadError : undefined}
            onRetry={today.reload}
            dailyJob={jobStatus.data?.demo_enabled ? { run: refresh } : undefined}
            resolveImage={ingredientImage}
            onTrendSelect={(slug, section) => setView({ type: 'trend', slug, section })}
          />
        )}
        {trendView && (trend ? (
          <MarketTrendDetail
            key={trend.slug}
            trend={trend}
            run={today.data?.run ?? null}
            locale={locale}
            initialTab={trendView.section}
            resolveImage={ingredientImage}
            onAddItems={addItems}
            onBack={() => navigate('today')}
          />
        ) : today.loading ? <MarketSkeleton label={copy.loading} /> : (
          <section><p role="alert">{copy.loadError}</p><button type="button" onClick={() => navigate('today')}>{copy.today}</button></section>
        ))}
        {view.type === 'navigation' && destination === 'marketplace' && (
          <MarketIngredientCatalog
            locale={locale}
            loadListings={dailyMarketplaceApi.listings}
            imageFor={ingredientImage}
            onSelect={(id) => setView({ type: 'product', id })}
            onAdd={(line) => addItems([line])}
          />
        )}
        {view.type === 'product' && (product.loading ? <MarketSkeleton label={copy.loading} /> : product.failed ? (
          <section><p role="alert">{copy.loadError}</p><button type="button" onClick={product.reload}>{copy.retry}</button></section>
        ) : (
          <MarketIngredientProduct
            listings={product.data ?? []}
            locale={locale}
            imageFor={ingredientImage}
            onAdd={(line) => addItems([line])}
            onBack={() => navigate('marketplace')}
          />
        ))}
        {view.type === 'checkout' && (
          <MarketCheckout
            locale={locale}
            shopId={shop.id}
            lines={cart.items}
            attempts={attempts}
            onPlaceOrder={dailyMarketplaceApi.checkout}
            onPlaced={orderPlaced}
            onBack={() => { navigate('marketplace'); setCartOpen(true); }}
          />
        )}
        {view.type === 'confirmation' && (
          <MarketOrderConfirmation
            locale={locale}
            order={view.order}
            onViewOrders={() => navigate('orders')}
            onBackToTrends={() => navigate('today')}
          />
        )}
        {view.type === 'saved-order' && (
          <section className="market-order-panel">
            <MarketOrderDetails order={view.order} locale={locale} />
            <button type="button" onClick={() => navigate(destination)}>{copy[destination === 'settings' ? 'settings' : 'orders']}</button>
          </section>
        )}
        {view.type === 'navigation' && destination === 'orders' && (
          <MarketOrderHistory
            orders={orders.data?.orders ?? []} loading={orders.loading}
            error={orders.failed ? copy.loadError : undefined} locale={locale}
            onRetry={orders.reload}
            onSelectOrder={(order) => setView({ type: 'saved-order', order })}
          />
        )}
        {view.type === 'navigation' && destination === 'settings' && (
          <MarketSettings
            shop={shop} orders={orders.data?.orders ?? []} run={today.data?.run ?? null}
            locale={locale} onLocaleChange={setLocale}
            onSelectOrder={(order) => setView({ type: 'saved-order', order })}
          />
        )}
        {cartOpen && (
          <MarketCart
            locale={locale}
            items={cart.items}
            onQuantityChange={(id, quantity, slug) => {
              attempts.invalidate(shop.id);
              cart.setQuantity(id, quantity, slug);
            }}
            onRemove={(id, slug) => { attempts.invalidate(shop.id); cart.remove(id, slug); }}
            onCheckout={() => { setCartOpen(false); setView({ type: 'checkout' }); }}
            onClose={() => setCartOpen(false)}
          />
        )}
      </>}
    </MarketShell>
  );
}
