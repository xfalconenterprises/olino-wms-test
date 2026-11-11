import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiError } from '../../utils/printPage';
import { formatDateTime } from '../../utils/format';
import LoadMore from '../../components/Common/LoadMore';
import { PageTitle, isLocked, rupees, useCostApi, useLoadMore } from './shared';

// ─── Code Reader: a code from a label or the Inventory screen, back into rupees ──

export function CodeReaderPage() {
  const costApi = useCostApi();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const read = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setResult(null);
    try {
      const r = await costApi<{ price: number }>({ method: 'POST', url: '/api/accounts/decode', data: { code } });
      setResult({ ok: true, text: rupees(r.price) });
    } catch (err) {
      if (!isLocked(err)) setResult({ ok: false, text: apiError(err, 'Not a valid code') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle title="Code Reader" text="Type a code exactly as printed on a label or shown in Inventory. Decoy letters (letters that are not in the code word) are skipped. A Cost Code is the cost per unit; a Value (code) is quantity × cost." />
      <form onSubmit={read} className="card" style={{ padding: 20, maxWidth: 520 }}>
        <label className="form-label" htmlFor="code-reader">Code</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="code-reader" className="form-input" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
            placeholder="e.g. QXAEPZ" autoComplete="off" autoFocus style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2 }} />
          <button type="submit" className="btn btn-primary" disabled={busy || !code}>{busy ? <span className="spinner" /> : 'Read'}</button>
        </div>
        {result && (
          <div style={{ marginTop: 14, fontSize: result.ok ? 22 : 14, fontWeight: 700, color: result.ok ? undefined : 'var(--color-danger)' }}>{result.text}</div>
        )}
      </form>
    </>
  );
}

// ─── Change Log ─────────────────────────────────────────────────────────────

interface LogRow {
  id: string; poId: string | null; poNumber: string | null; lineLabel: string;
  oldPrice: number | null; newPrice: number | null; source: string; changedByName: string | null; changedAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  PO_CREATE: 'Entered on new PO', PO_EDIT: 'Changed on PO edit', COST_TAB: 'Changed in Cost Prices', ACCOUNTS: 'Changed in Accounts',
  CODE_SETTINGS: 'Secret code changed', DIRECT_INWARD: 'Direct Inward Excel', CLOSING_STOCK: 'Closing stock saved',
};

export function ChangeLogPage() {
  const costApi = useCostApi();
  const [error, setError] = useState('');
  const fetchRows = useCallback((range: { offset: number; limit: number }) =>
    costApi<{ total: number; logs: LogRow[] }>({ url: '/api/accounts/logs', params: range }), [costApi]);
  const list = useLoadMore(fetchRows, r => r.logs, err => { if (!isLocked(err)) setError(apiError(err, 'Failed to load the change log')); });
  const data = list.reply;

  return (
    <>
      <PageTitle title="Change Log" text="Costs that were changed or removed (old and new), changes to the secret code word, and closing stock saved: who did it and when." />
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 13, margin: 0, width: '100%' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th>When</th><th>Who</th><th>What</th><th>PO</th><th>Item</th>
                <th style={{ textAlign: 'right' }}>Old</th><th style={{ textAlign: 'right' }}>New</th>
              </tr>
            </thead>
            <tbody>
              {data && list.rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--color-text-muted)' }}>No changes yet.</td></tr>}
              {list.rows.map(r => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.changedAt)}</td>
                  <td>{r.changedByName}</td>
                  <td>{SOURCE_LABEL[r.source] ?? r.source}</td>
                  <td>{r.poId ? <Link to={`/purchase-orders/${r.poId}/view`}>{r.poNumber}</Link> : r.poNumber}</td>
                  <td>{r.lineLabel}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(r.oldPrice)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupees(r.newPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {data && <LoadMore shown={list.rows.length} total={list.total} hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} noun="changes" />}
    </>
  );
}
