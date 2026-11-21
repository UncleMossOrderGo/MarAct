import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { MarketAssistantPanel, type MarketAssistantProps } from './market-assistant';
import { MarketCart, useMarketCart, type MarketCartItem } from './market-cart';
import {
  MarketCheckout, MarketOrderConfirmation, useMarketCheckoutAttempts, type SavedMarketOrder,
} from './market-checkout';
import { MarketDailyNotificationBanner, MarketNotifications, MarketPayment, MarketSellerWorkspace } from './market-commerce';
import { commerceApi, type CommerceNotification } from './market-commerce-api';
import { ingredientImage, trendImage } from './market-ingredient-assets';
import { MarketIngredientCatalog, MarketIngredientProduct } from './market-ingredient-catalog';
import { marketCopy, useMarketLanguage, type MarketLocale } from './market-locale';
import { MarketOrderDetails, MarketOrderHistory } from './market-order-history';
import { MarketSettings } from './market-settings';
import { MarketShell, type MarketDestination } from './market-shell';
import { MarketStockDashboard } from './market-stock-dashboard';
import { MarketSkeleton } from './market-skeleton';
import { MarketToday, type MarketDailyJobState } from './market-today';
import { MarketTrendDetail } from './market-trend-detail';
import { dailyMarketplaceApi, waitForDailyPublication } from './marketplace-api';
import { useMarketplaceResource } from './marketplace-resource';

type View = { type: 'navigation' } | { type: 'trend'; slug: string; section: 'overview' | 'ingredients' }
  | { type: 'product'; id: string } | { type: 'checkout' }
  | { type: 'confirmation' | 'saved-order' | 'payment'; order: SavedMarketOrder };

const marketplacePath = '/market/shop';
const shopsLoader = (_key: string, signal: AbortSignal) => dailyMarketplaceApi.shops(signal);
const statusLoader = (_key: string, signal: AbortSignal) => dailyMarketplaceApi.jobStatus(signal);
const productLoader = (id: string, signal: AbortSignal) => dailyMarketplaceApi.listings({ ingredient_id: id }, signal);
function todayLoader(key: string, signal: AbortSignal) {
  const [shopId, locale] = JSON.parse(key) as [string, MarketLocale];
  return dailyMarketplaceApi.today(shopId, locale, signal);
}

export function ShopWorkspace() {
  const { locale, setLocale } = useMarketLanguage();
  const copy = marketCopy[locale];
  const location = useLocation();
  const go = useNavigate();
  const sellerMode = location.pathname === `${marketplacePath}/seller`;
  const [sellerId, setSellerId] = useState('');
  const [focusedSellerOrder, setFocusedSellerOrder] = useState<string>();
  const [destination, setDestination] = useState<MarketDestination>('today');
  const [view, setView] = useState<View>({ type: 'navigation' });
  const [cartOpen, setCartOpen] = useState(false);
  const assistantRequest = useRef(0);
  const [assistantFocus, setAssistantFocus] = useState<{
    focus: NonNullable<MarketAssistantProps['focused']>;
    request: number;
  }>();
  const [orderReadFailed, setOrderReadFailed] = useState(false);

  const shops = useMarketplaceResource('shops', shopsLoader);
  const defaultId = shops.data?.default_shop_id;
  const shop = shops.data?.shops.find(({ id }) => id === defaultId);
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
    setAssistantFocus(undefined);
    setView({ type: 'navigation' });
    setDestination(next);
  }

  function switchRole() {
    setFocusedSellerOrder(undefined);
    setCartOpen(false);
    navigate('today');
    go(sellerMode ? marketplacePath : `${marketplacePath}/seller`);
  }

  function addItems(lines: readonly MarketCartItem[]) {
    if (!shop || !lines.length) return;
    attempts.invalidate(shop.id);
    cart.addAll(lines);
    setCartOpen(true);
  }

  function orderPlaced(order: SavedMarketOrder) {
    cart.clearShop(order.shop_id);
    today.reload();
    orders.reload();
    if (shop?.id !== order.shop_id) return;
    setDestination('orders');
    setView({ type: canPay(order) ? 'payment' : 'confirmation', order });
  }

  const trendView = view.type === 'trend' ? view : null;
  const trend = trendView ? today.data?.trends.find(({ slug }) => slug === trendView.slug) : undefined;
  const order = 'order' in view ? view.order : undefined;
  const assistantPage: MarketAssistantProps['page'] = cartOpen ? 'cart'
    : view.type === 'payment' ? 'payment'
    : order ? 'order'
    : trendView ? (trendView.section === 'ingredients' ? 'ingredients' : 'trend')
    : view.type === 'product' ? 'marketplace'
    : destination === 'stock' || destination === 'orders' || destination === 'settings' || destination === 'marketplace' ? destination : 'today';
  const pageFocus: MarketAssistantProps['focused'] = order ? { type: 'order', id: order.id }
    : trendView ? { type: 'trend', id: trendView.slug }
    : view.type === 'product' ? { type: 'ingredient', id: view.id }
    : undefined;
  const demand = [...new Set(today.data?.trends.flatMap(({ ingredients }) =>
    ingredients.filter(({ ingredient_id }) => ingredient_id === null).map(({ name }) => name)) ?? [])];

  function askAgent(focus: NonNullable<MarketAssistantProps['focused']>) {
    setAssistantFocus({ focus, request: ++assistantRequest.current });
  }

  function selectDestination(next: MarketDestination) {
    if (next === 'marketplace') {
      go('/market');
      return;
    }
    if (sellerMode) go(marketplacePath);
    navigate(next);
  }

  async function openNotice(notice: CommerceNotification) {
    setOrderReadFailed(false);
    const orderId = new URL(notice.link, window.location.origin).searchParams.get('order')
      ?? notice.link.match(/\/orders\/([^/?#]+)/)?.[1];
    if (sellerMode) {
      setFocusedSellerOrder(orderId ?? undefined);
      return;
    }
    if (!orderId) {
      navigate('today');
      return;
    }
    try {
      const saved = await commerceApi.order(orderId);
      setDestination('orders');
      setView({ type: 'saved-order', order: saved });
    } catch {
      setOrderReadFailed(true);
    }
  }

  return (
    <MarketShell
      shops={shop ? [{ ...shop, menu_tags: [] }] : []}
      activeShopId={shop?.id ?? null}
      defaultShopId={defaultId ?? ''}
      locale={locale}
      destination={destination}
      cartCount={cart.items.length}
      singleShop
      hideCart={sellerMode}
      onNavigate={selectDestination}
      onOpenCart={() => setCartOpen(true)}
      toolbarActions={shop && <>
        {!sellerMode && <MarketAssistantPanel shopId={shop.id} locale={locale} page={assistantPage}
          focused={assistantFocus?.focus ?? pageFocus} openRequest={assistantFocus?.request}
          cart={cart.items} onAdd={(line) => addItems([line])} />}
        <button type="button" onClick={switchRole}>
          {sellerMode ? (locale === 'th' ? 'มุมมองร้านค้า' : 'View as shop')
            : (locale === 'th' ? 'มุมมองผู้ขาย' : 'View as seller')}
        </button>
        {(!sellerMode || sellerId) && <MarketNotifications locale={locale}
          recipientType={sellerMode ? 'seller' : 'shop'}
          recipientId={sellerMode ? sellerId : shop.id}
          onOpen={(notice) => void openNotice(notice)} />}
      </>}
    >
      {shops.loading && <MarketSkeleton label={copy.loading} />}
      {shops.failed && (
        <section><p role="alert">{copy.loadError}</p><button type="button" onClick={shops.reload}>{copy.retry}</button></section>
      )}
      {shops.data && !shop && <p>{locale === 'th' ? 'ยังไม่มีร้านค้าตัวอย่าง' : 'No demo shops are available.'}</p>}
      {sellerMode && shop && <MarketSellerWorkspace locale={locale} sellerId={sellerId}
        onSellerChange={(id) => { setSellerId(id); setFocusedSellerOrder(undefined); }}
        focusedOrderId={focusedSellerOrder} demand={demand} />}
      {shop && !sellerMode && <>
        {orderReadFailed && <p role="alert">{copy.loadError}</p>}
        {view.type === 'navigation' && destination === 'today' && <>
          <MarketDailyNotificationBanner shopId={shop.id} runDate={today.data?.run?.trend_date}
            hasRecommendations={!!today.data?.trends.length} locale={locale} />
          <MarketToday trialEnabled
            data={today.data ?? null}
            locale={locale}
            loading={today.loading}
            error={today.failed ? copy.loadError : undefined}
            onRetry={today.reload}
            dailyJob={jobStatus.data?.demo_enabled ? { run: refresh } : undefined}
            manualJobDisabled={jobStatus.data?.demo_enabled === false}
            onAddItems={addItems}
            resolveImage={trendImage}
            onAsk={askAgent}
            onTrendSelect={(slug, section) => setView({ type: 'trend', slug, section })}
          />
        </>}
        {trendView && (trend ? (
          <MarketTrendDetail
            key={trend.slug}
            trend={trend}
            run={today.data?.run ?? null}
            locale={locale}
            initialTab={trendView.section}
            resolveImage={trendImage}
            onAsk={(id) => askAgent({ type: 'ingredient', id })}
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
        {view.type === 'payment' && (
          <MarketPayment locale={locale} order={view.order}
            onOrderChange={(updated) => {
              setView({ type: 'payment', order: updated });
              orders.reload();
            }}
            onBack={() => setView({ type: 'saved-order', order: view.order })} />
        )}
        {view.type === 'saved-order' && (
          <section className="market-order-panel">
            <MarketOrderDetails order={view.order} locale={locale} />
            {canPay(view.order) && <button type="button" onClick={() => setView({ type: 'payment', order: view.order })}>
              {locale === 'th' ? 'ชำระเงินตัวอย่าง' : 'Demo payment'}
            </button>}
            <button type="button" onClick={() => navigate(destination)}>{copy[destination === 'settings' ? 'settings' : 'orders']}</button>
          </section>
        )}
        {view.type === 'navigation' && destination === 'stock' && (
          <MarketStockDashboard shopId={shop.id} locale={locale} cart={cart.items}
            onAdd={addItems} onAsk={(id) => askAgent({ type: 'ingredient', id })} />
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

function canPay(order: SavedMarketOrder): boolean {
  return (order.orders ?? [order]).some((item) => item.status === 'placed' && !!item.seller_id);
}
