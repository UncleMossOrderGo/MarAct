import { useEffect, useRef, useState } from 'react';
import { getTrend } from './api';
import type { Fruit, FruitTrend } from './api';
import { copy, locales } from './language';
import type { Language } from './language';

function periodLabel({ start, end }: FruitTrend['observed_period'], format: Intl.DateTimeFormat, through: string) {
  return <><time dateTime={start}>{format.format(new Date(start))}</time> {through} <time dateTime={end}>{format.format(new Date(end))}</time></>;
}

function TrendDetails({ data, lang }: { data: FruitTrend; lang: Language }) {
  const { fruits, trend: text } = copy[lang];
  const signed = new Intl.NumberFormat(locales[lang], { signDisplay: 'exceptZero', maximumFractionDigits: 2 });
  const shortDate = new Intl.DateTimeFormat(locales[lang], { dateStyle: 'medium', timeZone: 'Asia/Bangkok' });
  return (
    <>
      <div className="buyer-intelligence__market-summary">
        <div>
          <p>{data.data_status === 'demo' ? text.synthetic : text.observedData}</p>
          <div className="buyer-intelligence__trend-title">
            <strong>{fruits[data.fruit]}</strong>
            <span className="buyer-intelligence__badge">{text.labels[data.trend_label]}</span>
          </div>
        </div>
        {data.score !== null && (
          <div className="buyer-intelligence__trend-score">
            <strong>{signed.format(data.score)}</strong>
            <span>{text.score}<br />{text.scale}</span>
          </div>
        )}
      </div>
      <p className="buyer-intelligence__period">
        {text.observedWeek} {periodLabel(data.observed_period, shortDate, text.through)}
        {' · '}{text.comparedWith} {periodLabel(data.comparison_period, shortDate, text.through)}
      </p>
      <div className="buyer-intelligence__table">
        <table aria-label={text.table}>
          <thead><tr><th scope="col">{text.signal}</th><th scope="col">{text.previous}</th><th scope="col">{text.observed}</th><th scope="col">{text.change}</th></tr></thead>
          <tbody>{data.signals.map((signal) => (
            <tr key={signal.metric}>
              <th scope="row">{text.metrics[signal.metric]}</th>
              <td>{signal.previous_value ?? text.missing}</td>
              <td>{signal.current_value ?? text.missing}</td>
              <td className={signal.week_over_week_pct !== null && signal.week_over_week_pct > 0
                ? 'buyer-intelligence__positive-change' : undefined}>
                {signal.week_over_week_pct === null ? text.unavailable : `${signed.format(signal.week_over_week_pct)}%`}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="buyer-intelligence__considerations">
        <h3>{text.considerations}</h3>
        <p>{data.explanation}</p>
        <p>{text.limitation}</p>
      </div>
      <details className="buyer-intelligence__sources">
        <summary>{text.sources}</summary>
        {data.signals.map((signal) => {
          const source = data.sources.find((entry) => entry.source_id === signal.source_id);
          return source && <p key={signal.metric}><strong>{text.metrics[signal.metric]}</strong> {source.metric_definition}
            {' · '}{source.name}, {source.geographic_scope} · {text.collected}{' '}
            <time dateTime={source.collected_at}>{shortDate.format(new Date(source.collected_at))}</time>
          </p>;
        })}
        {data.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
      </details>
    </>
  );
}

export function TrendDashboard({ fruit, lang }: { fruit: Fruit; lang: Language }) {
  const { fruits, trend: text, supplier, explanation } = copy[lang];
  const [result, setResult] = useState<{ data: FruitTrend } | { error: true }>();
  const [attempt, setAttempt] = useState(0);
  const [explaining, setExplaining] = useState(false);
  const [explained, setExplained] = useState(false);
  const [explanationError, setExplanationError] = useState(false);
  const explanationRequest = useRef<AbortController>(null);
  useEffect(() => () => explanationRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    getTrend(fruit, lang, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ error: true });
      });
    return () => controller.abort();
  }, [fruit, lang, attempt]);

  async function explainSignals() {
    if (explaining) return;
    const controller = new AbortController();
    explanationRequest.current = controller;
    setExplaining(true);
    setExplanationError(false);
    try {
      const data = await getTrend(fruit, lang, controller.signal, true);
      if (!controller.signal.aborted) {
        setResult({ data });
        setExplained(true);
      }
    } catch {
      if (!controller.signal.aborted) setExplanationError(true);
    } finally {
      if (!controller.signal.aborted) setExplaining(false);
    }
  }

  return (
    <section className="buyer-intelligence__panel" aria-labelledby="trend-heading">
      <div className="buyer-intelligence__panel-heading">
        <h2 id="trend-heading" tabIndex={-1}>{text.title}</h2>
        <p>{text.introduction}</p>
      </div>
      <div aria-live="polite" aria-busy={!result}>
        {!result && <p>{text.loading(fruits[fruit])}</p>}
        {result && 'data' in result && (
          <>
            <TrendDetails data={result.data} lang={lang} />
            {explained && <p className="buyer-intelligence__hint">
              {explanation[result.data.explanation_source]}
            </p>}
            {explanationError && <p role="alert">{supplier.explainError}</p>}
            {result.data.explanation_source !== 'openai' && (
              <button className="buyer-intelligence__explain" type="button" disabled={explaining} onClick={explainSignals}>
                {explaining ? supplier.preparingExplanation : text.explain}
              </button>
            )}
          </>
        )}
        {result && 'error' in result && (
          <>
            <p role="alert">{text.error}</p>
            <button type="button" onClick={() => { setResult(undefined); setAttempt(attempt + 1); }}>{text.retry}</button>
          </>
        )}
      </div>
    </section>
  );
}
