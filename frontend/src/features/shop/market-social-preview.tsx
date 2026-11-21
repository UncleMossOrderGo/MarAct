import { useState } from 'react';
import { Play, X } from 'lucide-react';
import type { DailyLocale, DailyTrend } from './market-daily-types';

function playerFor(link: string) {
  let url: URL;
  try { url = new URL(link); } catch { return; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  if (host === 'instagram.com') {
    const match = /^\/(p|reel)\/([\w-]+)\/?$/.exec(url.pathname);
    if (match) return { platform: 'Instagram', src: `https://www.instagram.com/${match[1]}/${match[2]}/embed/` };
  }
  if (host === 'tiktok.com') {
    const match = /^\/@[\w.]+\/video\/(\d{1,24})\/?$/.exec(url.pathname);
    if (match) return { platform: 'TikTok', src: `https://www.tiktok.com/player/v1/${match[1]}?autoplay=0` };
  }
}

export function MarketSocialPreview({ sources, locale }: { sources: DailyTrend['sources']; locale: DailyLocale }) {
  const [active, setActive] = useState('');
  const preview = sources.map((source) => playerFor(source.url)).find((item) => !!item);
  if (!preview) return null;
  const showing = active === preview.src;
  const title = locale === 'th' ? `ดูโพสต์จาก ${preview.platform}` : `View ${preview.platform} post`;
  return <div className="market-social-preview">
    <button type="button" className="market-daily-secondary" aria-expanded={showing}
      onClick={() => setActive(showing ? '' : preview.src)}>
      {showing ? <X size={15} /> : <Play size={15} />}
      {showing ? (locale === 'th' ? 'ปิดตัวอย่าง' : 'Close preview') : title}
    </button>
    {showing && <iframe src={preview.src} title={title} referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" allow="fullscreen" />}
  </div>;
}
