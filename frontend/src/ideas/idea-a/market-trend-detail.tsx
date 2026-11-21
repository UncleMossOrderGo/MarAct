import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { eligibleListings } from './market-daily-types';
import type { DailyImageResolver, DailyLocale, DailyRun, DailyTrend, MarketTrendTab } from './market-daily-types';
import { MarketTrendIngredients, trendOrderCopy, type MarketTrendCartLine } from './market-trend-ingredients';
export type { MarketTrendCartLine } from './market-trend-ingredients';
import { DailyImage, DailyRunDate, TrendBadges, TrendSources } from './market-today';
import './market-trend-detail.css';

type MarketTrendDetailProps = {
  trend: DailyTrend;
  run?: DailyRun | null;
  locale?: DailyLocale;
  initialTab?: MarketTrendTab;
  onBack: () => void;
  onAddItems: (lines: MarketTrendCartLine[]) => void;
  onAsk?: (id: string) => void;
  resolveImage?: DailyImageResolver;
};

const tabs = ['overview', 'ingredients'] as const;

function TrendDetail({
  trend, run, locale = 'th', initialTab = 'overview', onBack, onAddItems, onAsk, resolveImage,
}: MarketTrendDetailProps) {
  const labels = trendOrderCopy[locale];
  const id = useId();
  const hasIngredients = trend.ingredients.some((ingredient) => eligibleListings(ingredient).length > 0);
  const [tab, setTab] = useState<MarketTrendTab>(hasIngredients ? initialTab : 'overview');
  const tabElements = useRef<Partial<Record<MarketTrendTab, HTMLButtonElement>>>({});

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'overview'
      : event.key === 'End' ? 'ingredients'
      : tab === 'overview' ? 'ingredients' : 'overview';
    setTab(next);
    tabElements.current[next]?.focus();
  }

  return (
    <section className="market-trend-detail" aria-labelledby={`${id}-name`}>
      <button type="button" className="market-daily-secondary" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" />{labels.back}
      </button>
      <DailyImage dish imageKey={trend.image_key} resolveImage={resolveImage} className="market-trend-detail-hero" />
      <h1 id={`${id}-name`}>{trend.name}</h1>
      <TrendBadges trend={trend} locale={locale} />
      {run && <DailyRunDate run={run} locale={locale} />}
      {hasIngredients && <div className="market-trend-tabs" role="tablist">
        {tabs.map((name) => (
          <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1} aria-controls={`${id}-panel-${name}`}
            ref={(node) => { if (node) tabElements.current[name] = node; }}
            onKeyDown={tabKey} onClick={() => setTab(name)}>
            {labels[name]}
          </button>
        ))}
      </div>}
      <div className="market-trend-panel" role="tabpanel" id={`${id}-panel-overview`}
        aria-labelledby={hasIngredients ? `${id}-tab-overview` : `${id}-name`} hidden={tab !== 'overview'}>
        <dl className="market-trend-evidence">
          <div><dt>{labels.why}</dt><dd>{trend.why_rising}</dd></div>
          <div><dt>{labels.fit}</dt><dd>{trend.why_fit}</dd></div>
          <div><dt>{labels.menu}</dt><dd>{trend.menu_idea}</dd></div>
        </dl>
        <TrendSources trend={trend} locale={locale} />
        {hasIngredients && (
          <button className="market-daily-primary" type="button" onClick={() => {
            setTab('ingredients');
            tabElements.current.ingredients?.focus();
          }}>
            <ShoppingCart size={18} aria-hidden="true" />{labels.order}
          </button>
        )}
      </div>
      <div className="market-trend-panel" role="tabpanel" id={`${id}-panel-ingredients`}
        aria-labelledby={`${id}-tab-ingredients`} hidden={tab !== 'ingredients'}>
        <MarketTrendIngredients trend={trend} locale={locale} onAddItems={onAddItems} resolveImage={resolveImage} onAsk={onAsk} />
      </div>
    </section>
  );
}

export function MarketTrendDetail(props: MarketTrendDetailProps) {
  return <TrendDetail key={`${props.trend.slug}:${props.initialTab ?? 'overview'}`} {...props} />;
}
