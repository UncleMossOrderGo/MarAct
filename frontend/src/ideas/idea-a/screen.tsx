import { useRef, useState } from 'react';
import { MarketCart, useMarketCart } from './market-cart';
import {
  MarketCheckout, MarketOrderConfirmation, MarketOrders, useMarketCheckoutAttempts,
  type SavedMarketOrder,
} from './market-checkout';
import { MarketProduct } from './market-product';
import { MarketShell, type MarketDestination } from './market-shell';
import { marketplaceApi, openMarketplaceExplanations, type FeedItem } from './marketplace-api';
import { MarketplaceFeed } from './marketplace-feed';
import { marketplaceFruitImage } from './marketplace-fruit-images';
import { useMarketplaceResource } from './marketplace-resource';
import { MarketplaceTrends } from './marketplace-trends';

type View = { type: 'navigation' } | { type: 'product'; item: FeedItem } |
  { type: 'checkout' } | { type: 'order'; order: SavedMarketOrder };
const activeShopStorage = 'maract.idea-a.shop';
const loadShops = (_: string, signal: AbortSignal) => marketplaceApi.shops(signal);
const loadTrends = (_: string, signal: AbortSignal) => marketplaceApi.trends(signal);

export function IdeaA() {
  const [shopId, setShopId] = useState(() => sessionStorage.getItem(activeShopStorage));
  const activeShop = useRef(shopId);
  const [destination, setDestination] = useState<MarketDestination>('marketplace');
  const [view, setView] = useState<View>({ type: 'navigation' });
  const [cartOpen, setCartOpen] = useState(false);

  const shops = useMarketplaceResource('shops', loadShops);
  const shop = shops.data?.shops.find(({ id }) => id === shopId);
  const feed = useMarketplaceResource(shop?.id ?? null, marketplaceApi.feed);
  const trends = useMarketplaceResource(shop ? 'latest' : null, loadTrends);
  const orders = useMarketplaceResource(destination === 'orders' ? shop?.id ?? null : null, marketplaceApi.orders);
  const cart = useMarketCart(shop?.id ?? null);
  const attempts = useMarketCheckoutAttempts();

  function navigate(next: MarketDestination) {
    setView({ type: 'navigation' });
    setDestination(next);
  }

  function changeShop(id: string) {
    activeShop.current = id;
    sessionStorage.setItem(activeShopStorage, id);
    setShopId(id);
    setCartOpen(false);
    navigate('marketplace');
  }

  async function refreshTrends() {
    const result = await marketplaceApi.refreshTrends();
    trends.reload();
    feed.reload();
    if (result.status === 'error') throw new Error('Could not refresh trends.');
  }

  function showOrder(order: SavedMarketOrder) {
    setDestination('orders');
    setView({ type: 'order', order });
  }

  function orderPlaced(order: SavedMarketOrder) {
    cart.clearShop(order.shop_id);
    feed.reload();
    if (activeShop.current !== order.shop_id) return;
    orders.reload();
    showOrder(order);
  }

  if (shops.loading) return <p role="status">Loading shops…</p>;
  if (shops.failed) {
    return <section>
      <p role="alert">Could not load the shops.</p>
      <button type="button" onClick={shops.reload}>Retry loading shops</button>
    </section>;
  }

  return (
    <MarketShell
      shops={shops.data?.shops ?? []}
      activeShopId={shop?.id ?? null}
      destination={destination}
      cartCount={cart.items.length}
      onShopChange={changeShop}
      onNavigate={navigate}
      onOpenCart={() => setCartOpen(true)}
    >
      {shop && <>
        {view.type === 'product' && (
          <MarketProduct
            fruit={view.item.fruit}
            listings={view.item.listings}
            suggestedKg={view.item.suggested_kg}
            trendName={view.item.trend_name}
            imageUrl={marketplaceFruitImage(view.item.fruit)}
            onAdd={(line) => {
              const existing = cart.items.find(({ listing_id }) => listing_id === line.listing_id);
              if (!existing || existing.qty_kg < Math.min(500, line.stock_kg)) attempts.invalidate(shop.id);
              cart.add(line);
            }}
            onBack={() => navigate('marketplace')}
          />
        )}
        {view.type === 'checkout' && (
          <MarketCheckout
            shopId={shop.id}
            lines={cart.items}
            attempts={attempts}
            onPlaceOrder={marketplaceApi.checkout}
            onPlaced={orderPlaced}
            onBack={() => { navigate('marketplace'); setCartOpen(true); }}
          />
        )}
        {view.type === 'order' && (
          <MarketOrderConfirmation order={view.order} onViewOrders={() => navigate('orders')} />
        )}
        {view.type === 'navigation' && (destination === 'marketplace' || destination === 'trends') && (
          <MarketplaceTrends
            trends={trends.data ?? null}
            view={destination === 'trends' ? 'full' : 'strip'}
            loading={trends.loading}
            error={trends.failed ? 'Could not load trends.' : undefined}
            onRefresh={refreshTrends}
            onViewTrends={() => navigate('trends')}
          />
        )}
        {view.type === 'navigation' && destination === 'marketplace' && (
          <MarketplaceFeed
            shop={shop}
            feed={feed.data ?? null}
            loading={feed.loading}
            error={feed.failed ? 'Could not load recommendations.' : undefined}
            onSelectFruit={({ id }) => {
              const item = feed.data?.items.find(({ fruit }) => fruit.id === id);
              if (item) setView({ type: 'product', item });
            }}
            openExplanations={openMarketplaceExplanations}
            onObsolete={feed.reload}
          />
        )}
        {view.type === 'navigation' && destination === 'orders' && (
          <MarketOrders
            orders={orders.data?.orders ?? []}
            loading={orders.loading}
            error={orders.failed ? 'Could not load order history.' : undefined}
            onRetry={orders.reload}
            onSelectOrder={showOrder}
          />
        )}
        {cartOpen && (
          <MarketCart
            items={cart.items}
            onQuantityChange={(id, quantity) => {
              const previous = cart.items.find(({ listing_id }) => listing_id === id);
              if (previous && previous.qty_kg !== quantity) attempts.invalidate(shop.id);
              cart.setQuantity(id, quantity);
            }}
            onRemove={(id) => { attempts.invalidate(shop.id); cart.remove(id); }}
            onCheckout={() => { setCartOpen(false); setView({ type: 'checkout' }); }}
            onClose={() => setCartOpen(false)}
          />
        )}
      </>}
    </MarketShell>
  );
}
