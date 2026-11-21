import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketNotifications, MarketPayment, MarketSellerWorkspace } from '../../src/ideas/idea-a/market-commerce';
import type { SavedMarketOrder } from '../../src/ideas/idea-a/market-checkout';
import '../../src/app/styles.css';

const initial: SavedMarketOrder = {
  id: 'checkout-a', shop_id: 'bakery', total_thb: '15.00', created_at: '2026-11-21T02:00:00Z',
  status: 'placed', items: [],
  orders: [
    { id: 'order-a', shop_id: 'bakery', seller_id: 'seller-a', seller_name: 'Fresh Orchard',
      total_thb: '12.00', created_at: '2026-11-21T02:00:00Z', status: 'placed', items: [] },
    { id: 'order-b', shop_id: 'bakery', seller_id: 'seller-b', seller_name: 'Dairy Lane',
      total_thb: '3.00', created_at: '2026-11-21T02:00:00Z', status: 'placed', items: [] },
  ],
};

function CommerceFixture() {
  const [buyer, setBuyer] = useState(true);
  const [seller, setSeller] = useState<string | null>(null);
  const [order, setOrder] = useState(initial);
  const [noticeLink, setNoticeLink] = useState('');
  return <main>
    <button type="button" onClick={() => setBuyer(!buyer)}>{buyer ? 'View as seller' : 'View as buyer'}</button>
    <MarketNotifications locale="en" recipientType={buyer ? 'shop' : 'seller'} recipientId={buyer ? 'bakery' : seller}
      onOpen={(notice) => setNoticeLink(notice.link)} />
    {noticeLink && <output>{noticeLink}</output>}
    {buyer ? <MarketPayment order={order} locale="en" onOrderChange={setOrder} onBack={() => setBuyer(false)} />
      : <MarketSellerWorkspace locale="en" sellerId={seller} onSellerChange={setSeller} demand={['Kataifi']} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<CommerceFixture />);
