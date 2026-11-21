import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import {
  eligibleListings, type DailyImageResolver, type DailyLocale, type DailyRun, type DailyTrend,
  type MarketTodayData, type MarketTrendTab,
} from './market-daily-types';
import './market-today.css';
import { MarketTrial, TrialActivity } from './market-trial';
import { MarketSocialPreview } from './market-social-preview';
import { MarketTrendIngredients, type MarketTrendCartLine } from './market-trend-ingredients';

const copy = {
  en: {
    today: 'Today’s Trends', updated: 'Updated', cached: 'Cached trends', seeded: 'Demo trends',
    run: 'Run daily job', queued: 'Daily job queued', running: 'Checking trends…', published: 'Trends updated.',
    jobFailed: 'Could not update trends. Try again.', timeout: 'The trend update is taking longer than expected.',
    loading: 'Loading today’s trends…', retry: 'Retry', empty: 'No trends have been published yet.',
    menu: 'Menu idea', sources: 'Sources', evidence: 'Evidence', ingredient: 'Recommended ingredients',
    order: 'Order Ingredients', rising: 'Rising', peak: 'Peak', fading: 'Fading', new: 'New this week',
    jobDisabled: 'Manual runs are off in this environment.',
    listening: 'Scanning public food posts and matching ingredients…',
    kg: 'kg', fit: 'For your shop',
  },
  th: {
    today: 'เทรนด์วันนี้', updated: 'อัปเดต', cached: 'เทรนด์จากแคช', seeded: 'เทรนด์ตัวอย่าง',
    run: 'รันงานประจำวัน', queued: 'งานประจำวันอยู่ในคิว', running: 'กำลังตรวจสอบเทรนด์…', published: 'อัปเดตเทรนด์แล้ว',
    jobFailed: 'อัปเดตเทรนด์ไม่ได้ ลองอีกครั้ง', timeout: 'การอัปเดตเทรนด์ใช้เวลานานกว่าที่คาดไว้',
    loading: 'กำลังโหลดเทรนด์วันนี้…', retry: 'ลองอีกครั้ง', empty: 'ยังไม่มีเทรนด์ที่เผยแพร่',
    menu: 'ไอเดียเมนู', sources: 'แหล่งข้อมูล', evidence: 'หลักฐาน', ingredient: 'วัตถุดิบแนะนำ',
    order: 'สั่งวัตถุดิบ', rising: 'กำลังมาแรง', peak: 'ยอดนิยม', fading: 'ความนิยมลดลง', new: 'พบครั้งแรกในรอบสัปดาห์',
    jobDisabled: 'สภาพแวดล้อมนี้ปิดการรันด้วยตนเอง',
    listening: 'กำลังค้นหาโพสต์อาหารสาธารณะและจับคู่วัตถุดิบ…',
    kg: 'กก.', fit: 'เหมาะกับร้านของคุณ',
  },
} as const;

export type MarketDailyJobState = 'queued' | 'running' | 'published';
type DailyJobFeedback = MarketDailyJobState | 'failed' | 'timeout';
export type MarketTodayProps = {
  data: MarketTodayData | null;
  trialEnabled?: boolean;
  locale?: DailyLocale;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onTrendSelect: (slug: string, tab: MarketTrendTab) => void;
  onAddItems?: (lines: MarketTrendCartLine[]) => void;
  onAsk?: (focus: { type: 'trend' | 'ingredient'; id: string }) => void;
  manualJobDisabled?: boolean;
  dailyJob?: { run: (signal: AbortSignal, onStatus: (state: MarketDailyJobState) => void) => Promise<void> };
  resolveImage?: DailyImageResolver;
};

export function DailyRunDate({ run, locale }: { run: DailyRun; locale: DailyLocale }) {
  const labels = copy[locale];
  const publishedAt = run.finished_at ?? `${run.trend_date}T12:00:00+07:00`;
  const label = new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium', timeStyle: run.finished_at ? 'short' : undefined,
    timeZone: 'Asia/Bangkok',
  }).format(new Date(publishedAt));
  return (
    <p className="market-daily-date">
      {labels.updated} <time dateTime={run.finished_at ?? run.trend_date}>{label}</time>
      {run.source === 'seed' && <span className="market-daily-badge">{labels.seeded}</span>}
      {run.source !== 'seed' && run.status === 'fallback' && (
        <span className="market-daily-badge">{labels.cached}</span>
      )}
    </p>
  );
}

export function TrendBadges({ trend, locale }: { trend: DailyTrend; locale: DailyLocale }) {
  const labels = copy[locale];
  return (
    <div className="market-daily-badges">
      <span className={`market-daily-badge market-daily-badge--${trend.momentum}`}>{labels[trend.momentum]}</span>
      {trend.is_new && <span className="market-daily-badge market-daily-badge--new">{labels.new}</span>}
    </div>
  );
}

export function TrendSources({ trend, locale }: { trend: DailyTrend; locale: DailyLocale }) {
  const links = trend.sources.flatMap((source) => {
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
      return [{ ...source, host: url.hostname.replace(/^www\./, '') }];
    } catch { return []; }
  });
  if (links.length === 0) return null;
  return (
    <div className="market-daily-sources">
      <strong>{copy[locale].sources} ({links.length})</strong>
      <ul>
        {links.map(({ url, title, host }) => (
          <li key={url}><a href={url}><span>{title}</span>{title.replace(/^www\./, '') !== host && <small aria-hidden="true">{host}</small>}<ExternalLink size={14} aria-hidden="true" /></a></li>
        ))}
      </ul>
      <MarketSocialPreview sources={trend.sources} locale={locale} />
    </div>
  );
}

export function DailyImage({ imageKey, resolveImage, className, dish = false }: {
  imageKey?: string | null;
  resolveImage?: DailyImageResolver;
  className?: string;
  dish?: boolean;
}) {
  const src = resolveImage?.(imageKey);
  const [broken, setBroken] = useState<string>();
  if (!src || (dish && (!imageKey || src === broken || src === resolveImage?.()))) return null;
  return <img className={className} src={src} alt="" referrerPolicy="no-referrer"
    onError={({ currentTarget }) => {
      if (dish) setBroken(src);
      else if (resolveImage && currentTarget.src !== resolveImage()) currentTarget.src = resolveImage();
    }} />;
}

function TodaySkeleton({ locale }: { locale: DailyLocale }) {
  return (
    <div className="market-today-skeleton" role="status" aria-label={copy[locale].loading}>
      <div /><div /><div />
    </div>
  );
}

const jobTimeoutMs = 120_000;

export function MarketToday({
  data, trialEnabled, locale = 'th', loading, error, onRetry, onTrendSelect, onAddItems, onAsk, dailyJob, manualJobDisabled, resolveImage,
}: MarketTodayProps) {
  const labels = copy[locale];
  const [state, setState] = useState<DailyJobFeedback>();
  const pendingJob = useRef<AbortController | null>(null);
  const [choice, setChoice] = useState('');
  const top = data?.trends.slice(0, 3) ?? [];
  const featured = top.find(item => item.slug === choice) ?? top[0];
  const ingredients = featured?.ingredients.filter((ingredient) => eligibleListings(ingredient).length > 0) ?? [];

  useEffect(() => () => pendingJob.current?.abort(), []);

  async function runDailyJob() {
    if (pendingJob.current || !dailyJob) return;
    const controller = new AbortController();
    pendingJob.current = controller;
    setState('queued');
    const timeout = setTimeout(() => {
      controller.abort();
      pendingJob.current = null;
      setState('timeout');
    }, jobTimeoutMs);

    controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });

    try {
      await dailyJob.run(controller.signal, (status) => {
        if (!controller.signal.aborted) setState(status);
      });
      if (!controller.signal.aborted) setState('published');
    } catch {
      if (!controller.signal.aborted) setState('failed');
    } finally {
      clearTimeout(timeout);
      if (pendingJob.current === controller) pendingJob.current = null;
    }
  }

  const pending = state === 'queued' || state === 'running';
  const feedback = state === 'failed' ? labels.jobFailed : state && labels[state];
  return (
    <section className="market-today" aria-labelledby="market-today-title">
      <div className="market-today-header">
        <h1 id="market-today-title">{labels.today}</h1>
        {(dailyJob || manualJobDisabled) && (
          <div className="market-today-job">
            <button className="market-daily-secondary" type="button" disabled={pending || manualJobDisabled}
              onClick={() => void runDailyJob()}>
              <RefreshCw className={pending ? 'market-daily-spinning' : undefined} size={16} aria-hidden="true" />{labels.run}
            </button>
            {manualJobDisabled && <small>{labels.jobDisabled}</small>}
          </div>
        )}
      </div>
      {data?.run && <DailyRunDate run={data.run} locale={locale} />}
      {pending ? (
        <div className="market-daily-listening">
          <span role="status">{state === 'queued' ? labels.queued : labels.listening}</span>
          <div role="progressbar" aria-label={labels.running} className="market-daily-progress"><span /></div>
        </div>
      ) : feedback && <p role={state === 'failed' || state === 'timeout' ? 'alert' : 'status'}>{feedback}</p>}
      {error && <div className="market-daily-error"><p role="alert">{error}</p>
        {onRetry && <button type="button" onClick={onRetry}>{labels.retry}</button>}
      </div>}
      {!data && loading && <TodaySkeleton locale={locale} />}
      {!featured && !loading && !error && <p>{labels.empty}</p>}
      {featured && (
        <>
          <article className="market-today-feature" aria-label={featured.name}>
            {top.length > 1 && <div className="market-trend-choices" role="group" aria-label={locale === 'th' ? 'เทรนด์แนะนำ' : 'Ranked trends'}>
              {top.map(item => <button type="button" key={item.slug} aria-label={item.name} aria-pressed={item.slug === featured.slug}
                onClick={() => setChoice(item.slug)}>
                <DailyImage dish className="market-choice-photo" imageKey={item.image_key} resolveImage={resolveImage} />
                <span><strong>{item.name}</strong><small>{item.menu_idea}</small></span>
              </button>)}
            </div>}
            <DailyImage className="market-today-feature-photo"
              dish imageKey={featured.image_key} resolveImage={resolveImage} />
            <div className="market-today-feature-copy">
              <TrendBadges trend={featured} locale={locale} />
              <h2><button type="button" onClick={() => onTrendSelect(featured.slug, 'overview')}>{featured.name}</button></h2>
              <p>{featured.why_rising}</p>
              <p className="market-daily-fit"><strong>{labels.fit}</strong> {featured.why_fit}</p>
              <p className="market-daily-menu"><strong>{labels.menu}</strong> {featured.menu_idea}</p>
              <TrendSources trend={featured} locale={locale} />

              {onAsk && <button className="market-daily-secondary market-ask-trend" type="button"
                onClick={() => onAsk({ type: 'trend', id: featured.slug })}>
                {locale === 'th' ? 'ถามผู้ช่วย' : 'Ask agent'}
              </button>}
            </div>
            {trialEnabled && data && <MarketTrial key={data.shop.id + featured.slug} shop={data.shop.id} trend={featured} locale={locale} />}
          </article>
          {ingredients.length > 0 && (
            <div className="market-today-ingredients">
              <h2>{labels.ingredient}</h2>
              {onAddItems && <div className="market-today-desktop-order">
                <MarketTrendIngredients key={`${data?.shop.id}:${featured.slug}:${data?.run?.finished_at ?? ""}`} trend={featured} locale={locale}
                  onAddItems={onAddItems} resolveImage={resolveImage}
                  onAsk={onAsk ? (id) => onAsk({ type: 'ingredient', id }) : undefined} compact />
              </div>}
              <div className={onAddItems ? 'market-today-mobile-order' : undefined}>
                <ul>
                  {ingredients.map((ingredient, index) => {
                    const listing = eligibleListings(ingredient)[0];
                    return (
                      <li key={`${ingredient.ingredient_id ?? ingredient.name}-${index}`}>
                        <DailyImage className="market-today-ingredient-photo" imageKey={ingredient.image_key ?? ingredient.ingredient_id}
                          resolveImage={resolveImage} />
                        <span><strong>{ingredient.name}</strong><small>{listing.seller_name}</small></span>
                        <span>฿{listing.price_per_kg_thb} / {labels.kg}</span>
                        <span>{ingredient.suggested_kg} {labels.kg}</span>
                      </li>
                    );
                  })}
                </ul>
                <button className="market-daily-primary" type="button"
                  onClick={() => onTrendSelect(featured.slug, 'ingredients')}>
                  {labels.order}
                </button>
              </div>
            </div>
          )}
          {trialEnabled && data && <TrialActivity shop={data.shop.id} locale={locale} />}
        </>
      )}
    </section>
  );
}
