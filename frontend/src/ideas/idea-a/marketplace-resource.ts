import { useCallback, useEffect, useState } from 'react';

type Result<T> = {
  key: string;
  attempt: number;
  data?: T;
  failed?: boolean;
};

export function useMarketplaceResource<T>(
  key: string | null,
  load: (key: string, signal: AbortSignal) => Promise<T>,
  keepSaved = false,
) {
  const [result, setResult] = useState<Result<T>>();
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    load(key, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ key, attempt, data });
    }).catch(() => {
      if (!controller.signal.aborted) setResult((previous) => ({
        key, attempt, failed: true,
        data: keepSaved && previous?.key === key ? previous.data : undefined,
      }));
    });
    return () => controller.abort();
  }, [key, load, attempt, keepSaved]);

  const current = result?.key === key && result.attempt === attempt ? result : undefined;
  const data = current?.data ?? (keepSaved && result?.key === key ? result.data : undefined);
  return { data, failed: current?.failed ?? false, loading: key !== null && !current, reload };
}
