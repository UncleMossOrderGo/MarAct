import { SupplierTrials } from './market-supplier-trials';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, PackageCheck, Store } from 'lucide-react';
import type { SavedMarketOrder } from './market-checkout';
import { commerceApi } from './market-commerce-api';
import type { MarketLocale } from './market-locale';
import { MarketOrderDetails } from './market-order-history';
import { useMarketplaceResource } from './marketplace-resource';
import './market-commerce.css';

const copy = {
  en: {
    title: 'Seller workspace', seller: 'Supplier', orders: 'Incoming orders',
    loading: 'Loading seller workspace…', error: 'Could not load the seller workspace.', retry: 'Retry',
    empty: 'No orders for this supplier yet.', noSellers: 'No suppliers are available yet.',
    confirm: 'Confirm order', confirming: 'Confirming order…', failed: 'Could not confirm the order. Try again.',
    confirmed: 'Order confirmed.', waiting: 'Waiting for the buyer’s demo payment.',
    demand: 'Ingredient demand', noDemand: 'No unmatched ingredients in the current trends.',
  },
  th: {
    title: 'พื้นที่ผู้ขาย', seller: 'ผู้จัดจำหน่าย', orders: 'คำสั่งซื้อที่ได้รับ',
    loading: 'กำลังโหลดพื้นที่ผู้ขาย…', error: 'ไม่สามารถโหลดพื้นที่ผู้ขายได้', retry: 'ลองอีกครั้ง',
    empty: 'ผู้จัดจำหน่ายนี้ยังไม่มีคำสั่งซื้อ', noSellers: 'ยังไม่มีผู้จัดจำหน่าย',
    confirm: 'ยืนยันคำสั่งซื้อ', confirming: 'กำลังยืนยันคำสั่งซื้อ…', failed: 'ไม่สามารถยืนยันคำสั่งซื้อได้ ลองอีกครั้ง',
    confirmed: 'ยืนยันคำสั่งซื้อแล้ว', waiting: 'กำลังรอการชำระเงินจำลองจากร้านค้า',
    demand: 'วัตถุดิบที่มีความต้องการ', noDemand: 'เทรนด์ปัจจุบันไม่มีวัตถุดิบที่ค้นหาไม่พบ',
  },
};
const sellerLoader = (_: string, signal: AbortSignal) => commerceApi.sellers(signal);
const orderLoader = (id: string, signal: AbortSignal) => commerceApi.sellerOrders(id, signal);

type SellerWorkspaceProps = {
  locale: MarketLocale;
  sellerId: string | null;
  onSellerChange: (id: string) => void;
  onOrdersChanged?: () => void;
  demand?: readonly string[];
  focusedOrderId?: string;
};

export function MarketSellerWorkspace({
  locale, sellerId, onSellerChange, onOrdersChanged, demand = [], focusedOrderId,
}: SellerWorkspaceProps) {
  const words = copy[locale];
  const sellers = useMarketplaceResource('sellers', sellerLoader, true);
  const selected = sellers.data?.sellers.find(({ id }) => id === sellerId) ?? sellers.data?.sellers[0];
  const selectedId = selected?.id;

  useEffect(() => {
    if (selectedId && selectedId !== sellerId) onSellerChange(selectedId);
  }, [selectedId, sellerId, onSellerChange]);

  return (
    <section className="market-checkout market-seller" aria-label={words.title} lang={locale}>
      <div className="market-seller-heading">
        <h1><Store size={24} aria-hidden="true" /> {words.title}</h1>
        {selected && (
          <label>{words.seller}
            <select value={selected.id} onChange={(event) => onSellerChange(event.currentTarget.value)}>
              {sellers.data?.sellers.map((seller) => <option value={seller.id} key={seller.id}>{seller.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {sellers.loading && <p role="status">{words.loading}</p>}
      {sellers.failed && (
        <div role="alert">
          <p>{words.error}</p>
          <button className="market-checkout-back" type="button" onClick={sellers.reload}>{words.retry}</button>
        </div>
      )}
      {!selected && !sellers.loading && !sellers.failed && <p>{words.noSellers}</p>}
      {selected && <SupplierTrials key={selected.id} seller={selected.id} locale={locale} />}
      <div className="market-seller-columns">
        <div>
          <h2>{words.orders}</h2>
          {selected && <IncomingOrders key={selected.id} sellerId={selected.id} locale={locale}
            onOrdersChanged={onOrdersChanged} focusedOrderId={focusedOrderId} />}
        </div>
        <aside className="market-order-panel market-seller-demand">
          <h2>{words.demand}</h2>
          {demand.length > 0 ? <ul>{[...new Set(demand)].map((name) => <li key={name}>{name}</li>)}</ul> : <p>{words.noDemand}</p>}
        </aside>
      </div>
    </section>
  );
}

function IncomingOrders({ sellerId, locale, onOrdersChanged, focusedOrderId }: {
  sellerId: string; locale: MarketLocale; onOrdersChanged?: () => void; focusedOrderId?: string;
}) {
  const words = copy[locale];
  const orders = useMarketplaceResource(sellerId, orderLoader, true);
  const [pendingId, setPendingId] = useState<string>();
  const [errorId, setErrorId] = useState<string>();
  const [confirmed, setConfirmed] = useState<SavedMarketOrder>();
  const request = useRef<AbortController | null>(null);
  const focusedOrder = useRef<HTMLElement | null>(null);
  const { reload } = orders;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (focusedOrderId) reload();
  }, [focusedOrderId, reload]);
  const loadedFocus = !orders.loading && orders.data?.orders.some(({ id }) => id === focusedOrderId);
  useEffect(() => {
    if (loadedFocus) focusedOrder.current?.focus();
  }, [loadedFocus, focusedOrderId]);

  async function confirm(order: SavedMarketOrder) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPendingId(order.id);
    setErrorId(undefined);
    try {
      const updated = await commerceApi.confirm(order.id, sellerId, controller.signal);
      if (updated.id !== order.id || (updated.seller_id && updated.seller_id !== sellerId)) throw new Error('Order mismatch');
      if (!controller.signal.aborted) {
        setConfirmed(updated);
        orders.reload();
        onOrdersChanged?.();
      }
    } catch {
      if (!controller.signal.aborted) setErrorId(order.id);
    } finally {
      if (!controller.signal.aborted) setPendingId(undefined);
      request.current = null;
    }
  }

  const visibleOrders = orders.data?.orders.map((order) => confirmed?.id === order.id ? confirmed : order);
  return (
    <>
      {orders.loading && !visibleOrders && <p role="status">{words.loading}</p>}
      {orders.failed && (
        <div role="alert">
          <p>{words.error}</p>
          <button className="market-checkout-back" type="button" onClick={orders.reload}>{words.retry}</button>
        </div>
      )}
      {visibleOrders?.length === 0 && <p>{words.empty}</p>}
      {visibleOrders?.map((order) => (
        <article className="market-order-panel" key={order.id} tabIndex={-1}
          ref={order.id === focusedOrderId ? focusedOrder : undefined}>
          <MarketOrderDetails order={order} locale={locale} />
          {order.status === 'paid' && (
            <button className="market-checkout-action" type="button" disabled={Boolean(pendingId)}
              onClick={() => void confirm(order)}>
              <PackageCheck size={16} aria-hidden="true" />
              {pendingId === order.id ? words.confirming : words.confirm}
            </button>
          )}
          {order.status === 'placed' && <p><AlertCircle size={16} aria-hidden="true" /> {words.waiting}</p>}
          {confirmed?.id === order.id && <p role="status">{words.confirmed}</p>}
          {errorId === order.id && <p className="market-checkout-error" role="alert">{words.failed}</p>}
        </article>
      ))}
    </>
  );
}
