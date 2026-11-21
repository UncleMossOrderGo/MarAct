import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { HttpError } from '../../shared/http';
import { marketplaceSession, sessionEnded } from './marketplace-session';
import './marketplace-sign-in.css';

type SessionState = 'loading' | 'signed-out' | 'signed-in' | 'unavailable';

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      await marketplaceSession.login(email, password);
      setPassword('');
      onSignedIn();
    } catch {
      setPassword('');
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return <section className="market-sign-in" aria-labelledby="market-sign-in-heading">
    <div className="market-sign-in__panel">
      <p className="market-sign-in__brand">MarAct</p>
      <h1 id="market-sign-in-heading">Sign in to the marketplace</h1>
      <form onSubmit={submit} aria-busy={pending}>
        <label>Email
          <input type="email" autoComplete="username" required value={email}
            onChange={(event) => setEmail(event.currentTarget.value)} />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" required value={password}
            onChange={(event) => setPassword(event.currentTarget.value)} />
        </label>
        {failed && <p role="alert">Could not sign in. Check your email and password.</p>}
        <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  </section>;
}

export function MarketplaceSessionGate({ onClear, children }: {
  onClear: () => void;
  children: (signOut: () => void, signingOut: boolean) => ReactNode;
}) {
  const [state, setState] = useState<SessionState>('loading');
  const [signingOut, setSigningOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  useEffect(() => {
    if (state !== 'loading' && state !== 'signed-in') return;
    const controller = new AbortController();
    const end = () => {
      onClear();
      setState('signed-out');
    };
    const check = () => {
      void marketplaceSession.current(controller.signal).then(() => {
        if (!controller.signal.aborted && state === 'loading') setState('signed-in');
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof HttpError && error.status === 401) end();
        else if (state === 'loading') setState('unavailable');
      });
    };

    window.addEventListener(sessionEnded, end);
    if (state === 'loading') check();
    window.addEventListener('focus', check);
    const timer = state === 'signed-in' ? window.setInterval(check, 30_000) : undefined;
    return () => {
      controller.abort();
      window.removeEventListener(sessionEnded, end);
      window.removeEventListener('focus', check);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [state, onClear]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setLogoutFailed(false);
    try {
      await marketplaceSession.logout();
      onClear();
      setState('signed-out');
    } catch {
      setLogoutFailed(true);
    } finally {
      setSigningOut(false);
    }
  }

  if (state === 'loading') return <p role="status">Checking your session…</p>;
  if (state === 'unavailable') return <section>
    <p role="alert">Could not check your session.</p>
    <button type="button" onClick={() => setState('loading')}>
      Retry
    </button>
  </section>;
  if (state === 'signed-out') return <SignIn onSignedIn={() => {
    setLogoutFailed(false);
    setState('signed-in');
  }} />;
  return <>
    {logoutFailed && <p role="alert">Could not sign out. Try again.</p>}
    {children(() => void signOut(), signingOut)}
  </>;
}
