import { HttpError, requestJson } from '../../shared/http';
import type { SavedMarketOrder } from './market-checkout';

const api = '/api/ideas/idea-a';
const part = encodeURIComponent;

export type CommerceOrder = SavedMarketOrder;
export type CheckoutGroup = SavedMarketOrder & { orders?: SavedMarketOrder[] | null };
export type CommerceSeller = { id: string; name: string; area?: string };
export type Recipient = { recipient_type: 'shop' | 'seller'; recipient_id: string };
export type CommerceNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
};
type Notifications = { notifications: CommerceNotification[]; unread_count: number };

function post(data: object, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal };
}

async function markNotification(path: string, recipient: Recipient) {
  const response = await fetch(path, post(recipient));
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new HttpError(response.status, body?.detail);
  }
}

export const commerceApi = {
  order: (id: string, signal?: AbortSignal) =>
    requestJson<SavedMarketOrder>(`${api}/orders/${part(id)}`, { signal }),
  sellers: (signal?: AbortSignal) => requestJson<{ sellers: CommerceSeller[] }>(`${api}/sellers`, { signal }),
  sellerOrders: (id: string, signal?: AbortSignal) =>
    requestJson<{ orders: SavedMarketOrder[] }>(`${api}/sellers/${part(id)}/orders`, { signal }),
  pay: (id: string, shopId: string, signal?: AbortSignal) =>
    requestJson<SavedMarketOrder>(`${api}/orders/${part(id)}/pay`, post({ shop_id: shopId }, signal)),
  confirm: (id: string, sellerId: string, signal?: AbortSignal) =>
    requestJson<SavedMarketOrder>(`${api}/orders/${part(id)}/confirm`, post({ seller_id: sellerId }, signal)),
  notifications: (recipient: Recipient, signal?: AbortSignal) =>
    requestJson<Notifications>(`${api}/notifications?${new URLSearchParams(recipient)}`, { signal }),
  markRead: (id: string, recipient: Recipient) => markNotification(`${api}/notifications/${part(id)}/read`, recipient),
  markAllRead: (recipient: Recipient) => markNotification(`${api}/notifications/read-all`, recipient),
};
