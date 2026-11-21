import { HttpError, requestJson } from '../../shared/http';

export const marketplaceBase = '/api/ideas/idea-a';
export const sessionEnded = 'maract:idea-a-session-ended';
type Buyer = { email: string };

export const marketplaceSession = {
  current: (signal?: AbortSignal) => requestJson<Buyer>(`${marketplaceBase}/auth/session`, { signal }),
  login: (email: string, password: string) => requestJson<Buyer>(`${marketplaceBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }),
  async logout() {
    const response = await fetch(`${marketplaceBase}/auth/logout`, { method: 'POST' });
    if (!response.ok) throw new HttpError(response.status, 'Could not sign out.');
  },
};

export function checkMarketplaceSession(status: number) {
  if (status === 401) window.dispatchEvent(new Event(sessionEnded));
}

export async function marketplaceJson<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await requestJson<T>(path, options);
  } catch (error) {
    if (error instanceof HttpError && !options?.signal?.aborted) checkMarketplaceSession(error.status);
    throw error;
  }
}
