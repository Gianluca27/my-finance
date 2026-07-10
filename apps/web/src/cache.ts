import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Cache por endpoint (stale-while-revalidate): al volver a una pestaña se
 * muestra el último dato al instante y, si ya no está fresco, se revalida en
 * segundo plano. Las mutaciones invalidan por prefijo de clave.
 *
 * Se persiste en sessionStorage para que un reload de la página también pinte
 * de inmediato con el último dato conocido (por pestaña; se limpia al cerrar).
 */
interface Entry {
  data: unknown;
  time: number;
}

const STORAGE_KEY = 'myfinance:cache:v1';

function loadPersisted(): Map<string, Entry> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, Entry>));
  } catch {
    return new Map();
  }
}

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(store)));
  } catch {
    // Cuota llena o modo privado: el cache sigue funcionando en memoria.
  }
}

const store = loadPersisted();

/** Requests en vuelo por clave, para no duplicar el mismo fetch (ej: prefetch + montaje). */
const inflight = new Map<string, Promise<unknown>>();

/** Ventana durante la cual un dato cacheado se considera fresco (no se re-consulta). */
const FRESH_MS = 30_000;

/**
 * Suscriptores por clave: cada `useCached` montado registra su refetch acá,
 * así una mutación que invalida la clave refresca la pantalla al instante
 * (sin esperar a un remount).
 */
const listeners = new Map<string, Set<() => void>>();

function subscribe(key: string, onInvalidate: () => void): () => void {
  let subs = listeners.get(key);
  if (!subs) {
    subs = new Set();
    listeners.set(key, subs);
  }
  subs.add(onInvalidate);
  return () => {
    subs.delete(onInvalidate);
    if (subs.size === 0) listeners.delete(key);
  };
}

function notify(prefix?: string): void {
  for (const [key, subs] of listeners) {
    if (prefix !== undefined && !key.startsWith(prefix)) continue;
    for (const onInvalidate of subs) onInvalidate();
  }
}

/**
 * Invalida las entradas cuya clave empieza con `prefix` (sin argumento: todas)
 * y dispara el refetch de los hooks montados que las consumen.
 */
export function invalidate(prefix?: string): void {
  if (prefix === undefined) {
    store.clear();
    inflight.clear();
  } else {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
    for (const key of inflight.keys()) {
      if (key.startsWith(prefix)) inflight.delete(key);
    }
  }
  persist();
  notify(prefix);
}

/**
 * Vacía el cache SIN notificar suscriptores: para cambios de sesión
 * (login/logout/401), donde refetchear con el token viejo o ausente solo
 * generaría requests espurios que terminan en 401.
 */
export function clear(): void {
  store.clear();
  inflight.clear();
  persist();
}

/**
 * Dispara el fetch de una clave por adelantado (ej: apenas se conoce el usuario,
 * antes de que monte la página que lo consume). Si el dato está fresco o ya hay
 * un request en vuelo, no hace nada. Los errores se descartan: la página que
 * consuma la clave va a reintentar y mostrar su propio error.
 */
export function prefetch<T>(key: string, fetcher: () => Promise<T>): void {
  const entry = store.get(key);
  if (entry && Date.now() - entry.time < FRESH_MS) return;
  if (inflight.has(key)) return;
  const p = fetcher()
    .then((data) => {
      // Si `invalidate` corrió mientras tanto (mutación), el resultado quedó viejo: no cachear.
      if (inflight.get(key) === p) {
        store.set(key, { data, time: Date.now() });
        persist();
      }
    })
    .catch(() => {})
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
}

export function useCached<T>(key: string, fetcher: () => Promise<T>) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const initial = store.get(key);
  const [data, setData] = useState<T | null>(initial ? (initial.data as T) : null);
  const [error, setError] = useState<string | null>(null);

  // Generación de fetch: si un invalidate dispara un refresh mientras otro
  // sigue en vuelo, la respuesta vieja (pre-mutación) se descarta.
  const genRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    try {
      const result = await fetcherRef.current();
      if (gen !== genRef.current) return;
      store.set(key, { data: result, time: Date.now() });
      persist();
      setData(result);
      setError(null);
    } catch (err) {
      if (gen !== genRef.current) return;
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }, [key]);

  // Refetch inmediato cuando una mutación invalida esta clave. El dato viejo
  // queda en pantalla mientras llega el nuevo (stale-while-revalidate).
  useEffect(() => subscribe(key, refresh), [key, refresh]);

  useEffect(() => {
    const entry = store.get(key);
    setData(entry ? (entry.data as T) : null);
    setError(null);
    if (entry && Date.now() - entry.time < FRESH_MS) return;
    // Si un prefetch ya está trayendo esta clave, esperarlo en vez de duplicar el request.
    const pending = inflight.get(key);
    if (pending) {
      let cancelled = false;
      pending.then(() => {
        if (cancelled) return;
        const fresh = store.get(key);
        if (fresh) {
          setData(fresh.data as T);
          setError(null);
        } else {
          // El prefetch falló o fue invalidado: reintentar con fetch propio.
          refresh();
        }
      });
      return () => {
        cancelled = true;
      };
    }
    refresh();
  }, [key, refresh]);

  return { data, error, refresh };
}
