import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ExternalLink, RefreshCw, ShoppingCart } from 'lucide-react';
import {
  eligibleListings, type DailyImageResolver, type DailyLocale, type DailyRun, type DailyTrend,
  type MarketTodayData, type MarketTrendTab,
} from './market-daily-types';
import './market-today.css';

const copy = {
  en: {
    today: 'Today’s Trends', updated: 'Updated', cached: 'Cached trends', seeded: 'Demo trends',
    run: 'Run daily job', queued: 'Daily job queued', running: 'Checking trends…', published: 'Trends updated.',
    jobFailed: 'Could not update trends. Try again.', timeout: 'The trend update is taking longer than expected.',
    loading: 'Loading today’s trends…', retry: 'Retry', empty: 'No trends have been published yet.',
    menu: 'Menu idea', sources: 'Sources', evidence: 'Evidence', ingredient: 'Recommended ingredients',
    order: 'Order Ingredients', more: 'More trends', rising: 'Rising', peak: 'Peak', fading: 'Fading', new: 'New',
    unavailable: 'Unavailable', kg: 'kg', fit: 'For your shop',
  },
  th: {
    today: 'เทรนด์วันนี้', updated: 'อัปเดต', cached: 'เทรนด์จากแคช', seeded: 'เทรนด์ตัวอย่าง',
    run: 'รันงานประจำวัน', queued: 'งานประจำวันอยู่ในคิว', running: 'กำลังตรวจสอบเทรนด์…', published: 'อัปเดตเทรนด์แล้ว',
    jobFailed: 'อัปเดตเทรนด์ไม่ได้ ลองอีกครั้ง', timeout: 'การอัปเดตเทรนด์ใช้เวลานานกว่าที่คาดไว้',
    loading: 'กำลังโหลดเทรนด์วันนี้…', retry: 'ลองอีกครั้ง', empty: 'ยังไม่มีเทรนด์ที่เผยแพร่',
    menu: 'ไอเดียเมนู', sources: 'แหล่งข้อมูล', evidence: 'หลักฐาน', ingredient: 'วัตถุดิบแนะนำ',
    order: 'สั่งวัตถุดิบ', more: 'เทรนด์เพิ่มเติม', rising: 'กำลังมาแรง', peak: 'ยอดนิยม', fading: 'ความนิยมลดลง', new: 'ใหม่',
    unavailable: 'ไม่มีสินค้า', kg: 'กก.', fit: 'เหมาะกับร้านของคุณ',
  },
} as const;

export type MarketDailyJobState = 'queued' | 'running' | 'published';
type DailyJobFeedback = MarketDailyJobState | 'failed' | 'timeout';
export type MarketTodayProps = {
  data: MarketTodayData | null;
  locale?: DailyLocale;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onTrendSelect: (slug: string, tab: MarketTrendTab) => void;
  dailyJob?: { run: (signal: AbortSignal, onStatus: (state: MarketDailyJobState) => void) => Promise<void> };
  resolveImage?: DailyImageResolver;
};

export function DailyRunDate({ run, locale }: { run: DailyRun; locale: DailyLocale }) {
  const labels = copy[locale];
  const day = new Date(`${run.trend_date}T12:00:00+07:00`);
  const label = new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium', timeZone: 'Asia/Bangkok',
  }).format(day);
  return (
    <p className="market-daily-date">
      <CalendarDays size={16} aria-hidden="true" />
      {labels.updated} <time dateTime={run.trend_date}>{label}</time>
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
  const links = trend.sources.filter(({ url }) => /^https?:\/\//i.test(url));
  if (links.length === 0) return null;
  return (
    <div className="market-daily-sources">
      <strong>{copy[locale].sources}</strong>
      <ul>
        {links.map(({ url, title }) => (
          <li key={url}><a href={url}>{title}<ExternalLink size={14} aria-hidden="true" /></a></li>
        ))}
      </ul>
    </div>
  );
}

export function DailyImage({ imageKey, resolveImage, className }: {
  imageKey?: string | null;
  resolveImage?: DailyImageResolver;
  className?: string;
}) {
  return resolveImage
    ? <img className={className} src={resolveImage(imageKey)} alt="" />
    : <div className={className} aria-hidden="true" />;
}

function TodaySkeleton({ locale }: { locale: DailyLocale }) {
  return (
    <div className="market-today-skeleton" role="status" aria-label={copy[locale].loading}>
      <div /><div /><div />
    </div>
  );
}

const jobTimeoutMs = 90_000;

export function MarketToday({
  data, locale = 'th', loading, error, onRetry, onTrendSelect, dailyJob, resolveImage,
}: MarketTodayProps) {
  const labels = copy[locale];
  const [state, setState] = useState<DailyJobFeedback>();
  const pendingJob = useRef<AbortController | null>(null);
  const [featured, ...more] = data?.trends ?? [];

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
        <div>
          <h1 id="market-today-title">{labels.today}</h1>
          {data && <p>{data.shop.name}</p>}
        </div>
        {dailyJob && (
          <button className="market-daily-secondary" type="button" disabled={pending} onClick={() => void runDailyJob()}>
            <RefreshCw size={16} aria-hidden="true" />{labels.run}
          </button>
        )}
      </div>
      {data?.run && <DailyRunDate run={data.run} locale={locale} />}
      {feedback && <p role={state === 'failed' || state === 'timeout' ? 'alert' : 'status'}>{feedback}</p>}
      {error && <div className="market-daily-error"><p role="alert">{error}</p>
        {onRetry && <button type="button" onClick={onRetry}>{labels.retry}</button>}
      </div>}
      {!data && loading && <TodaySkeleton locale={locale} />}
      {!featured && !loading && !error && <p>{labels.empty}</p>}
      {featured && (
        <>
          <article className="market-today-feature" aria-label={featured.name}>
            <DailyImage className="market-today-feature-photo" imageKey={featured.image_key} resolveImage={resolveImage} />
            <div className="market-today-feature-copy">
              <TrendBadges trend={featured} locale={locale} />
              <h2><button type="button" onClick={() => onTrendSelect(featured.slug, 'overview')}>{featured.name}</button></h2>
              <p>{featured.why_rising}</p>
              <p className="market-daily-fit"><strong>{labels.fit}</strong> {featured.why_fit}</p>
              <p className="market-daily-menu"><strong>{labels.menu}</strong> {featured.menu_idea}</p>
              <TrendSources trend={featured} locale={locale} />
            </div>
          </article>
          {featured.ingredients.length > 0 && (
            <div className="market-today-ingredients">
              <h2>{labels.ingredient}</h2>
              <ul>
                {featured.ingredients.map((ingredient, index) => {
                  const listing = eligibleListings(ingredient)[0];
                  return (
                    <li key={`${ingredient.ingredient_id ?? ingredient.name}-${index}`}>
                      <DailyImage className="market-today-ingredient-photo" imageKey={ingredient.image_key ?? ingredient.ingredient_id}
                        resolveImage={resolveImage} />
                      <span><strong>{ingredient.name}</strong>{listing && <small>{listing.seller_name}</small>}</span>
                      {listing ? <span>฿{listing.price_per_kg_thb} / {labels.kg}</span> : <small>{labels.unavailable}</small>}
                      {listing && <span>{ingredient.suggested_kg} {labels.kg}</span>}
                    </li>
                  );
                })}
              </ul>
              <button className="market-daily-primary" type="button"
                onClick={() => onTrendSelect(featured.slug, 'ingredients')}>
                <ShoppingCart size={18} aria-hidden="true" />{labels.order}
              </button>
            </div>
          )}
          {more.length > 0 && (
            <div className="market-today-more">
              <h2>{labels.more}</h2>
              <ul>
                {more.map((trend) => (
                  <li key={trend.slug}>
                    <button className="market-today-secondary-trend" type="button"
                      onClick={() => onTrendSelect(trend.slug, 'overview')}>
                      <DailyImage className="market-today-secondary-photo" imageKey={trend.image_key} resolveImage={resolveImage} />
                      <span>{trend.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
