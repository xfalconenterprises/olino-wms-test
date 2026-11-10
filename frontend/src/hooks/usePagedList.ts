import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../utils/api';
import { apiError } from '../utils/printPage';

// Long lists come from the server 50 rows at a time; "Load more" adds the next 50
export const PAGE_SIZE = 50;

/** A value that follows `value` once it has stopped changing for `ms` (typing in a search box). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * A list loaded a page at a time. `params` holds the filters and search (sent to the server, which
 * searches every row); when they change the list starts again from the top. Anything the server
 * sends beside the rows (counts for tabs) arrives in `extra`.
 */
export function usePagedList<T, X = Record<string, unknown>>(url: string, params: Record<string, unknown>, enabled = true) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [extra, setExtra] = useState<X | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);   // answers to older requests (filters changed meanwhile) are ignored
  const key = JSON.stringify(params);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(url, { params: { ...JSON.parse(key), limit: PAGE_SIZE, offset: 0 } });
      if (id !== latest.current) return;
      const { rows: first, total: count, hasMore: more, ...rest } = data;
      setRows(first);
      setTotal(count);
      setHasMore(more);
      setExtra(rest as X);
    } catch (err) {
      if (id === latest.current) setError(apiError(err, 'Could not load the list.'));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [url, key]);

  useEffect(() => { if (enabled) reload(); }, [reload, enabled]);

  const loadMore = useCallback(async () => {
    const id = ++latest.current;
    setLoadingMore(true);
    try {
      const { data } = await api.get(url, { params: { ...JSON.parse(key), limit: PAGE_SIZE, offset: rows.length } });
      if (id !== latest.current) return;
      setRows(prev => [...prev, ...data.rows]);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (err) {
      if (id === latest.current) setError(apiError(err, 'Could not load more.'));
    } finally {
      setLoadingMore(false);
    }
  }, [url, key, rows.length]);

  return { rows, total, hasMore, extra, loading, loadingMore, error, loadMore, reload };
}
