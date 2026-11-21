import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';

import { commerceApi, type CommerceNotification, type Recipient } from './market-commerce-api';
import type { MarketLocale } from './market-locale';
import { marketOrderDate } from './market-order-history';
import './market-commerce.css';

const copy = {
  en: {
    title: 'Notifications', unread: 'unread', close: 'Close notifications', all: 'Mark all as read',
    unavailable: 'Could not load notifications.', empty: 'No notifications yet.',
  },
  th: {
    title: 'การแจ้งเตือน', unread: 'ยังไม่ได้อ่าน', close: 'ปิดการแจ้งเตือน', all: 'ทำเครื่องหมายว่าอ่านแล้วทั้งหมด',
    unavailable: 'ไม่สามารถโหลดการแจ้งเตือนได้', empty: 'ยังไม่มีการแจ้งเตือน',
  },
};

type MarketNotificationsProps = {
  locale: MarketLocale;
  recipientType: Recipient['recipient_type'];
  recipientId: string | null;
  onOpen: (notice: CommerceNotification) => void;
};

export function MarketNotifications(props: MarketNotificationsProps) {
  if (!props.recipientId) return null;
  return <NotificationBell key={`${props.recipientType}:${props.recipientId}`} {...props} id={props.recipientId} />;
}

function NotificationBell({ locale, recipientType, id, onOpen }: MarketNotificationsProps & { id: string }) {
  const words = copy[locale];
  const [data, setData] = useState<Awaited<ReturnType<typeof commerceApi.notifications>>>();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [marking, setMarking] = useState(false);
  const [revision, setRevision] = useState(0);
  const bell = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const recipient = { recipient_type: recipientType, recipient_id: id };
    let request: AbortController | undefined;
    function refresh() {
      if (document.visibilityState !== 'visible') {
        request?.abort();
        return;
      }
      if (request && !request.signal.aborted) return;
      const controller = new AbortController();
      request = controller;
      void commerceApi.notifications(recipient, controller.signal).then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setFailed(false);
        }
      }).catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      }).finally(() => {
        if (request === controller) request = undefined;
      });
    }
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      request?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [id, recipientType, revision]);

  const count = data?.unread_count ?? 0;
  function close() {
    setOpen(false);
    bell.current?.focus();
  }

  async function markAll() {
    if (marking) return;
    setMarking(true);
    try {
      await commerceApi.markAllRead({ recipient_type: recipientType, recipient_id: id });
      setRevision((previous) => previous + 1);
    } catch {
      setFailed(true);
    } finally {
      setMarking(false);
    }
  }

  function openNotice(notice: CommerceNotification) {
    close();
    if (!notice.read_at) {
      void commerceApi.markRead(notice.id, { recipient_type: recipientType, recipient_id: id }).then(() => {
        setRevision((previous) => previous + 1);
      }).catch(() => setFailed(true));
    }
    onOpen(notice);
  }

  return (
    <div className="market-notifications" onKeyDown={(event) => { if (open && event.key === 'Escape') close(); }}>
      <button type="button" className="market-notification-bell" ref={bell}
        aria-label={count ? `${words.title}: ${count} ${words.unread}` : words.title}
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell size={19} aria-hidden="true" />
        {count > 0 && <span aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <aside className="market-notification-popover" aria-label={words.title}>
          <div className="market-notification-heading">
            <h2>{words.title}</h2>
            <button type="button" onClick={close} aria-label={words.close}><X size={18} aria-hidden="true" /></button>
          </div>
          {count > 0 && (
            <button className="market-notification-mark" type="button" disabled={marking} onClick={() => void markAll()}>
              <CheckCheck size={16} aria-hidden="true" /> {words.all}
            </button>
          )}
          {failed && <p role="alert">{words.unavailable}</p>}
          {!failed && data?.notifications.length === 0 && <p>{words.empty}</p>}
          <ul>
            {data?.notifications.map((notice) => (
              <li key={notice.id}>
                <button type="button" data-unread={!notice.read_at} onClick={() => openNotice(notice)}>
                  <strong>{notice.title}</strong>
                  <span>{notice.body}</span>
                  <time dateTime={notice.created_at}>{marketOrderDate(notice.created_at, locale)}</time>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

export function MarketDailyNotificationBanner({ shopId, runDate, locale, hasRecommendations }: {
  shopId: string;
  runDate: string | null | undefined;
  locale: MarketLocale;
  hasRecommendations: boolean;
}) {
  if (!runDate || !hasRecommendations) return null;
  const bangkokDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' }).format(new Date());
  if (runDate !== bangkokDate) return null;
  const key = `maract.idea-a.daily-banner.${shopId}`;
  return <DailyBanner key={`${key}:${runDate}`} storageKey={key} runDate={runDate} locale={locale} />;
}

function DailyBanner({ storageKey, runDate, locale }: { storageKey: string; runDate: string; locale: MarketLocale }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === runDate);
  if (dismissed) return null;
  return (
    <div className="market-daily-notice">
      <Bell size={18} aria-hidden="true" />
      <strong>{locale === 'th' ? 'เทรนด์ใหม่ประจำวันนี้พร้อมแล้ว' : 'New trends ready for today'}</strong>
      <button type="button" aria-label={locale === 'th' ? 'ปิดข้อความเทรนด์' : 'Dismiss trend notice'} onClick={() => {
        localStorage.setItem(storageKey, runDate);
        setDismissed(true);
      }}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
