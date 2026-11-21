import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { interpretBrief } from './api';
import type { Interpretation, OrderDraft } from './api';
import { copy } from './language';
import type { Language } from './language';

export function BuyerBrief({ onApply, lang }: { onApply: (draft: OrderDraft) => void; lang: Language }) {
  const text = copy[lang].brief;
  const [brief, setBrief] = useState('');
  const [result, setResult] = useState<{ data: Interpretation; lang: Language }>();
  const [pending, setPending] = useState(false);
  const [applied, setApplied] = useState(false);
  const [acceptedPartialDraft, setAcceptedPartialDraft] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function draftOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brief.trim() || pending) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setResult(undefined);
    setApplied(false);
    setAcceptedPartialDraft(false);
    setError(false);
    try {
      const data = await interpretBrief(brief.trim(), lang, controller.signal);
      if (!controller.signal.aborted) setResult({ data, lang });
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const current = result?.lang === lang ? result.data : undefined;
  const draft = current?.draft;
  const needsReview = Boolean(draft?.unsupported_constraints.length);
  return (
    <details className="buyer-intelligence__brief">
      <summary>{text.title}</summary>
      <form className="buyer-intelligence__form" onSubmit={draftOrder}>
        <label htmlFor="buyer-brief">{text.label}</label>
        <textarea id="buyer-brief" value={brief} maxLength={500} rows={3} required disabled={pending}
          placeholder={text.example}
          onChange={(event) => {
            setBrief(event.target.value);
            setResult(undefined);
            setApplied(false);
            setError(false);
          }} />
        <button disabled={pending || !brief.trim()}>{text.submit}</button>
      </form>
      {pending && <p role="status">{text.pending}</p>}
      {error && <p role="alert">{text.error}</p>}
      {current && <p>{current.message}</p>}
      {result && !current && !applied && <p>{text.redraft}</p>}
      {draft && needsReview && (
        <div>
          <p><strong>{text.constraints}</strong></p>
          <ul>{draft.unsupported_constraints.map((constraint, index) => <li key={index}>{constraint}</li>)}</ul>
          {!applied && <label>
            <input type="checkbox" checked={acceptedPartialDraft}
              onChange={(event) => setAcceptedPartialDraft(event.target.checked)} />
            {text.accept}
          </label>}
        </div>
      )}
      {draft && !applied && (
        <button className="buyer-intelligence__explain" type="button" disabled={needsReview && !acceptedPartialDraft}
          onClick={() => { onApply(draft); setApplied(true); }}>{text.apply}</button>
      )}
      {applied && <p role="status">{text.applied}</p>}
    </details>
  );
}
