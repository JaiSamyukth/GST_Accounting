import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const tick = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const id = ++tick.current;
    const ctrl = new AbortController();
    setLoading(true);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        if (id === tick.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError" && id === tick.current) setError(e.message);
      })
      .finally(() => id === tick.current && setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => load(), [load]);
  return { data, error, loading, reload: load, setData };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Dev Caters GST`;
  }, [title]);
}
