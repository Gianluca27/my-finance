import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Cache en memoria por endpoint (stale-while-revalidate): al volver a una
 * pestaña se muestra el último dato al instante y, si ya no está fresco,
 * se revalida en segundo plano. Las mutaciones invalidan por prefijo de clave.
 */
interface Entry {
  data: unknown;
  time: number;
}

const store = new Map<string, Entry>();

/** Ventana durante la cual un dato cacheado se considera fresco (no se re-consulta). */
const FRESH_MS = 30_000;

/** Invalida las entradas cuya clave empieza con `prefix` (sin argumento: todas). */
export function invalidate(prefix?: string): void {
  if (prefix === undefined) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function useCached<T>(key: string, fetcher: () => Promise<T>) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const initial = store.get(key);
  const [data, setData] = useState<T | null>(initial ? (initial.data as T) : null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      store.set(key, { data: result, time: Date.now() });
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }, [key]);

  useEffect(() => {
    const entry = store.get(key);
    setData(entry ? (entry.data as T) : null);
    setError(null);
    if (entry && Date.now() - entry.time < FRESH_MS) return;
    refresh();
  }, [key, refresh]);

  return { data, error, refresh };
}
