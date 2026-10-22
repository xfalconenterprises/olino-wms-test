import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole, Unlock, Lock, Search, Pencil, Check, X, KeyRound, History, ListOrdered, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AxiosRequestConfig } from 'axios';
import api from '../../../utils/api';
import { apiError } from '../../../utils/printPage';
import { formatDate, formatDateTime } from '../../../utils/format';
import { formatQty, unitLabel } from '../../../utils/units';
import '../../../styles/components.css';

// Confidential cost prices. The tab opens only after the user re-enters their password, stays
// open for a few minutes, and locks again when they leave the page. Costs are entered on PO
// lines and can only be read here; labels show them as the secret code.

interface Unlock { token: string; expiresAt: number }

interface CostLine {
  id: string;
  poId: string; poNumber: string; supplierName: string; poDate: string; poStatus: string;
  itemType: string; description: string; uom: string;
  orderedQty: number; receivedQty: number; inStockQty: number;
  costPrice: number | null; code: string; stockValue: number | null; updatedAt: string | null;
}

interface CodeSettings { codeWord: string; repeatLetter: string; prefix: string; suffix: string }

interface LogRow {
  id: string; poId: string | null; poNumber: string | null; lineLabel: string;
  oldPrice: number | null; newPrice: number | null; source: string; changedByName: string | null; changedAt: string;
}

const rupees = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

const SOURCE_LABEL: Record<string, string> = {
  PO_CREATE: 'Entered on new PO', PO_EDIT: 'Changed on PO edit', COST_TAB: 'Changed here', CODE_SETTINGS: 'Code settings',
};
const SAMPLE_PRICES = [245, 180, 200, 1150];

export default function CostPricesPage() {
  const [unlock, setUnlock] = useState<Unlock | null>(null);
  const [lockMessage, setLockMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<'lines' | 'code' | 'log'>('lines');

  const lock = useCallback((message = '') => { setUnlock(null); setLockMessage(message); }, []);

  // Count down and lock when the time is up
  useEffect(() => {
    if (!unlock) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= unlock.expiresAt) lock('Locked again after a few minutes. Enter your password to continue.');
    }, 1000);
    return () => clearInterval(t);
  }, [unlock, lock]);

  /** Calls the cost API with the unlock token; a locked answer (423) locks the page. */
  const costApi = useCallback(async <T,>(config: AxiosRequestConfig): Promise<T> => {
    try {
      const res = await api.request<T>({ ...config, headers: { ...config.headers, 'X-Cost-Unlock': unlock?.token ?? '' } });
      return res.data;
    } catch (err: any) {
      if (err?.response?.status === 423) lock(err.response.data?.error);
      throw err;
    }
  }, [unlock, lock]);

  if (!unlock) return <LockScreen message={lockMessage} onUnlocked={u => { setUnlock(u); setLockMessage(''); setNow(Date.now()); }} />;

  const secondsLeft = Math.max(0, Math.round((unlock.expiresAt - now) / 1000));
  const tabButton = (id: typeof tab, label: string, Icon: typeof ListOrdered) => (
    <button type="button" onClick={() => setTab(id)} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-secondary'}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <div className="page-container" style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: '#fef3c7', padding: 8, borderRadius: 8, display: 'flex' }}><LockKeyhole size={28} color="#b45309" /></div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Cost Prices</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Confidential. Item cost per unit as entered on purchase orders. Labels show it only as the secret code.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Unlock size={14} /> Unlocked · locks in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => lock()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Lock size={15} /> Lock now
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabButton('lines', 'PO Line Costs', ListOrdered)}
        {tabButton('code', 'Secret Code', KeyRound)}
        {tabButton('log', 'Change Log', History)}
      </div>

      {tab === 'lines' && <LinesTab costApi={costApi} onSetCode={() => setTab('code')} />}
      {tab === 'code' && <CodeTab costApi={costApi} />}
      {tab === 'log' && <LogTab costApi={costApi} />}
    </div>
  );
}

type CostApi = <T>(config: AxiosRequestConfig) => Promise<T>;

function LockScreen({ message, onUnlocked }: { message: string; onUnlocked: (u: Unlock) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true); setError('');
    try {
      const res = await api.post('/api/cost-prices/unlock', { password });
      setPassword('');
      onUnlocked({ token: res.data.token, expiresAt: res.data.expiresAt });
    } catch (err) {
      setError(apiError(err, 'Could not unlock'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container" style={{ padding: '60px 24px', display: 'flex', justifyContent: 'center' }}>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 420, padding: 28, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', background: '#fef3c7', padding: 14, borderRadius: '50%', marginBottom: 12 }}>
          <LockKeyhole size={30} color="#b45309" />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px' }}>Cost Prices are locked</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 18px' }}>
          Enter your login password to view confidential cost prices. The page locks again after a few minutes or when you leave it.
        </p>
        {(error || message) && <div className={`alert ${error ? 'alert-danger' : 'alert-warning'}`} style={{ marginBottom: 14, textAlign: 'left' }}>{error || message}</div>}
        <input type="password" className="form-input" placeholder="Your password" value={password} onChange={e => setPassword(e.target.value)}
          autoFocus autoComplete="current-password" style={{ marginBottom: 12 }} />
        <button type="submit" className="btn btn-primary" disabled={busy || !password} style={{ width: '100%', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          {busy ? <span className="spinner" /> : <><Unlock size={15} /> Unlock</>}
        </button>
      </form>
    </div>
  );
}

function LinesTab({ costApi, onSetCode }: { costApi: CostApi; onSetCode: () => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [missing, setMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; summary: { stockValue: number; missingCount: number; codeWordSet: boolean }; lines: CostLine[] } | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await costApi({ url: '/api/cost-prices/lines', params: { search: query, missing: missing ? '1' : undefined, page } }));
    } catch (err: any) {
      if (err?.response?.status !== 423) setError(apiError(err, 'Failed to load cost prices'));
    }
  }, [costApi, query, missing, page]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    const value = editing.value.trim();
    if (!value && !window.confirm('Remove the cost price from this line?')) return;
    setSaving(true); setError('');
    try {
      await costApi({ method: 'PUT', url: `/api/cost-prices/lines/${editing.id}`, data: { costPrice: value || null } });
      setEditing(null);
      await load();
    } catch (err: any) {
      if (err?.response?.status !== 423) setError(apiError(err, 'Failed to save the cost price'));
    } finally {
      setSaving(false);
    }
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Stock value at cost</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{rupees(data.summary.stockValue)}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Rolls and packs in stock, from PO lines with a cost</div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>PO lines without a cost</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: data.summary.missingCount ? '#b45309' : '#166534' }}>{data.summary.missingCount}</div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={() => { setMissing(true); setPage(1); }}>Show them</button>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Secret code on labels</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6, color: data.summary.codeWordSet ? '#166534' : '#b45309' }}>
              {data.summary.codeWordSet ? 'Printing on labels' : 'Not set: labels print no code'}
            </div>
            {!data.summary.codeWordSet && <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={onSetCode}>Set the code word</button>}
          </div>
        </div>
      )}

      <form onSubmit={e => { e.preventDefault(); setQuery(search.trim()); setPage(1); }} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: 460 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--color-text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Search PO number, supplier, brand, quality, item…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-secondary">Search</button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={missing} onChange={e => { setMissing(e.target.checked); setPage(1); }} /> Only lines without a cost
        </label>
      </form>

      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 13, margin: 0, width: '100%' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th>PO</th>
                <th>Supplier</th>
                <th>Item</th>
                <th style={{ textAlign: 'right' }}>Ordered</th>
                <th style={{ textAlign: 'right' }}>In stock</th>
                <th style={{ textAlign: 'right', width: 190 }}>Cost / unit</th>
                <th>Code</th>
                <th style={{ textAlign: 'right' }}>Stock value</th>
              </tr>
            </thead>
            <tbody>
              {data?.lines.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--color-text-muted)' }}>No PO lines found.</td></tr>
              )}
              {data?.lines.map(l => (
                <tr key={l.id}>
                  <td>
                    <Link to={`/purchase-orders/${l.poId}/view`} style={{ fontWeight: 700 }}>{l.poNumber}</Link>
                    <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{formatDate(l.poDate)}</div>
                  </td>
                  <td>{l.supplierName}</td>
                  <td>{l.description}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatQty(l.orderedQty, l.uom)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{l.inStockQty > 0 ? formatQty(l.inStockQty, l.uom) : ''}</td>
                  <td style={{ textAlign: 'right' }}>
                    {editing?.id === l.id ? (
                      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <input type="number" className="form-input" style={{ width: 110, height: 32 }} step="0.01" min="0" autoFocus
                          value={editing.value} onChange={e => setEditing({ id: l.id, value: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setEditing(null); }} />
                        <button type="button" className="btn btn-ghost btn-icon" onClick={save} disabled={saving} title="Save"><Check size={16} color="#166534" /></button>
                        <button type="button" className="btn btn-ghost btn-icon" onClick={() => setEditing(null)} title="Cancel"><X size={16} /></button>
                      </div>
                    ) : (
                      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        {l.costPrice !== null
                          ? <strong>{rupees(l.costPrice)} <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>/ {unitLabel(l.uom)}</span></strong>
                          : <span style={{ color: '#b45309', fontSize: 12 }}>No cost</span>}
                        <button type="button" className="btn btn-ghost btn-icon" title="Change cost price"
                          onClick={() => setEditing({ id: l.id, value: l.costPrice !== null ? String(l.costPrice) : '' })}>
                          <Pencil size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>{l.code}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.stockValue ? rupees(l.stockValue) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 13 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></button>
          Page {page} of {pages}
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></button>
        </div>
      )}
    </>
  );
}

function CodeTab({ costApi }: { costApi: CostApi }) {
  const [form, setForm] = useState<CodeSettings>({ codeWord: '', repeatLetter: '', prefix: '', suffix: '' });
  const [saved, setSaved] = useState<CodeSettings | null>(null);
  const [preview, setPreview] = useState<{ price: number; code: string }[]>([]);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [decodeInput, setDecodeInput] = useState('');
  const [decoded, setDecoded] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    costApi<CodeSettings & { updatedAt: string | null }>({ url: '/api/cost-prices/settings' })
      .then(s => { const v = { codeWord: s.codeWord, repeatLetter: s.repeatLetter, prefix: s.prefix, suffix: s.suffix }; setForm(v); setSaved(s.codeWord ? v : null); })
      .catch(err => { if (err?.response?.status !== 423) setError(apiError(err, 'Failed to load the code settings')); });
  }, [costApi]);

  // Live preview of the codes these settings would print
  useEffect(() => {
    clearTimeout(timer.current);
    if (!form.codeWord) { setPreview([]); setPreviewError(''); return; }
    timer.current = setTimeout(() => {
      costApi<{ codes: { price: number; code: string }[] }>({ method: 'POST', url: '/api/cost-prices/preview', data: { settings: form, prices: SAMPLE_PRICES } })
        .then(r => { setPreview(r.codes); setPreviewError(''); })
        .catch(err => { setPreview([]); if (err?.response?.status !== 423) setPreviewError(apiError(err, '')); });
    }, 300);
    return () => clearTimeout(timer.current);
  }, [form, costApi]);

  const set = (key: keyof CodeSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value.toUpperCase().replace(key === 'codeWord' || key === 'repeatLetter' ? /[^A-Z]/g : /[^A-Z0-9]/g, '') }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saved && saved.codeWord !== form.codeWord &&
      !window.confirm('Labels already printed keep the code from the old word. Change the code word anyway?')) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const s = await costApi<CodeSettings>({ method: 'PUT', url: '/api/cost-prices/settings', data: form });
      setForm(s); setSaved(s); setSuccess('Saved. New labels will print codes with these settings.');
    } catch (err: any) {
      if (err?.response?.status !== 423) setError(apiError(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const decode = async (e: FormEvent) => {
    e.preventDefault();
    setDecoded('');
    try {
      const r = await costApi<{ price: number }>({ method: 'POST', url: '/api/cost-prices/decode', data: { code: decodeInput } });
      setDecoded(rupees(r.price));
    } catch (err: any) {
      if (err?.response?.status !== 423) setDecoded(apiError(err, 'Not a valid code'));
    }
  };

  const letters = form.codeWord.padEnd(10, ' ').slice(0, 10).split('');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
      <form onSubmit={save} className="card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Secret code word</h2>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
          10 letters, none repeated. They stand for the digits 1, 2, 3, 4, 5, 6, 7, 8, 9, 0. Costs are coded in whole rupees. Avoid well-known words.
        </p>
        {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
        {success && <div className="alert alert-success" style={{ marginBottom: 12 }}>{success}</div>}

        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Code word <span className="required">*</span></label>
          <input className="form-input" maxLength={10} value={form.codeWord} onChange={set('codeWord')} placeholder="10 different letters"
            style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 3 }} autoComplete="off" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4, marginBottom: 14, textAlign: 'center', fontFamily: 'monospace' }}>
          {letters.map((ch, i) => (
            <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 0', background: '#f8fafc' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{(i + 1) % 10}</div>
              <div style={{ fontWeight: 700 }}>{ch.trim() || '·'}</div>
            </div>
          ))}
        </div>
        <div className="form-row" style={{ marginBottom: 14 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Repeat letter <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span></label>
            <input className="form-input" maxLength={1} value={form.repeatLetter} onChange={set('repeatLetter')} placeholder="e.g. X" style={{ fontFamily: 'monospace' }} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Decoy before <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span></label>
            <input className="form-input" maxLength={3} value={form.prefix} onChange={set('prefix')} placeholder="e.g. Z" style={{ fontFamily: 'monospace' }} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Decoy after <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span></label>
            <input className="form-input" maxLength={3} value={form.suffix} onChange={set('suffix')} placeholder="e.g. Q" style={{ fontFamily: 'monospace' }} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
          The repeat letter is written when a digit repeats straight after itself (₹200 → one letter for 2, one for 0, then the repeat letter), so codes don't show doubled letters.
        </p>
        <button type="submit" className="btn btn-primary" disabled={saving || form.codeWord.length !== 10}>
          {saving ? <span className="spinner" /> : 'Save code settings'}
        </button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>How labels will look</h2>
          {previewError && <div className="alert alert-warning">{previewError}</div>}
          {!previewError && preview.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>Type a 10-letter code word to see examples.</p>}
          {preview.length > 0 && (
            <table className="table" style={{ fontSize: 13, margin: 0 }}>
              <thead><tr><th>Cost</th><th>Printed on label</th></tr></thead>
              <tbody>
                {preview.map(p => (
                  <tr key={p.price}><td>{rupees(p.price)}</td><td style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 2 }}>{p.code}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <form onSubmit={decode} className="card" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Read a code from a label</h2>
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 10px' }}>Uses the saved code word.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" value={decodeInput} onChange={e => setDecodeInput(e.target.value.toUpperCase())} placeholder="e.g. AEP" style={{ fontFamily: 'monospace' }} />
            <button type="submit" className="btn btn-secondary" disabled={!decodeInput.trim() || !saved}>Read</button>
          </div>
          {decoded && <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700 }}>{decoded}</div>}
        </form>
      </div>
    </div>
  );
}

function LogTab({ costApi }: { costApi: CostApi }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; logs: LogRow[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    costApi<{ total: number; pageSize: number; logs: LogRow[] }>({ url: '/api/cost-prices/logs', params: { page } })
      .then(setData)
      .catch(err => { if (err?.response?.status !== 423) setError(apiError(err, 'Failed to load the change log')); });
  }, [costApi, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 13, margin: 0, width: '100%' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th>When</th><th>Who</th><th>What</th><th>PO</th><th>Item</th>
                <th style={{ textAlign: 'right' }}>Old cost</th><th style={{ textAlign: 'right' }}>New cost</th>
              </tr>
            </thead>
            <tbody>
              {data?.logs.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--color-text-muted)' }}>No changes yet.</td></tr>}
              {data?.logs.map(r => (
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
      {data && pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 13 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></button>
          Page {page} of {pages}
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></button>
        </div>
      )}
    </>
  );
}
