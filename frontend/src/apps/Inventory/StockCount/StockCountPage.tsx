import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, ScanLine, Trash2, CheckCircle2, RotateCcw, AlertTriangle, XCircle } from 'lucide-react';
import api from '../../../utils/api';
import { useAuth } from '../../../hooks/useAuth';
import { hasPermission } from '../../../utils/roles';
import { apiError } from '../../../utils/printPage';
import { formatDateTime } from '../../../utils/format';
import '../../../styles/components.css';

interface CountLocation { id: string; code: string; type: string; countedAt: string | null; countedBy: string | null; entryCount: number }
interface CountDetail {
  id: string; countNumber: string; scopeLabel: string; status: 'OPEN' | 'COMPLETED' | 'CANCELLED'; wholeWarehouse: boolean;
  notes: string | null; createdAt: string; closedAt: string | null;
  createdBy: { name: string }; closedBy: { name: string } | null;
  resultSummary: Record<string, number> | null;
  locations: CountLocation[];
}
interface Entry { id: string; quantity: number; batch: { batchCode: string; description: string; unit: string; uom: string } }
interface ActiveLocation { code: string; type: string; countedAt: string | null; countedBy: string | null; entries: Entry[] }
interface PendingItem { batchCode: string; description: string; unit: string; uom: string; labelQty: number; usedUp: boolean }

type LineType = 'MATCH' | 'QTY_CHANGE' | 'MOVED' | 'MISSING' | 'FOUND';
type Resolution = 'APPLY' | 'WRITE_OFF' | 'UNPLACE' | 'MOVE_HERE' | 'ADD' | 'SKIP';
interface Place { code: string; quantity: number }
interface ReviewLine {
  batchId: string; batchCode: string; description: string; unit: string; status: string; systemQty: number;
  type: LineType; expected: Place[]; counted: Place[]; elsewhere: Place[]; unplaced: number;
  resolutions: Resolution[]; defaultResolution: Resolution; conflict: boolean;
}
interface Review {
  finishedLocations: number; unfinishedLocations: number; conflicts: number;
  summary: Record<LineType, number>; lines: ReviewLine[];
}

const TYPE_INFO: Record<LineType, { label: string; badge: string }> = {
  MISSING: { label: 'Missing', badge: 'badge-danger' },
  FOUND: { label: 'Found', badge: 'badge-brand' },
  QTY_CHANGE: { label: 'Quantity differs', badge: 'badge-warning' },
  MOVED: { label: 'Moved', badge: 'badge-info' },
  MATCH: { label: 'Match', badge: 'badge-success' },
};

const resolutionLabel = (r: Resolution, line: ReviewLine) => ({
  APPLY: 'Apply the count',
  WRITE_OFF: 'Write off (stock is gone)',
  UNPLACE: 'Keep stock, send to put-away',
  MOVE_HERE: `Move here (remove from ${line.elsewhere.map(p => p.code).join(', ')})`,
  ADD: 'Add it here',
  SKIP: 'Skip (no change)',
}[r]);

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const sum = (p: Place[]) => p.reduce((t, x) => t + x.quantity, 0);
const places = (p: Place[]) => p.length ? p.map(x => `${x.code} (${fmt(x.quantity)})`).join(', ') : '—';

// What approving a line would change in the batch quantity
function stockChange(line: ReviewLine, r: Resolution): number {
  if (r === 'SKIP') return 0;
  const expected = sum(line.expected), counted = sum(line.counted);
  if (line.type === 'QTY_CHANGE' || line.type === 'MOVED') return counted - expected;
  if (line.type === 'MISSING') return r === 'WRITE_OFF' ? -expected : 0;
  if (line.type === 'FOUND') return Math.max(0, counted - (line.unplaced + (r === 'MOVE_HERE' ? sum(line.elsewhere) : 0)));
  return 0;
}

export default function StockCountPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canApprove = hasPermission(user, 'inv.adjustments');

  const [count, setCount] = useState<CountDetail | null>(null);
  const [tab, setTab] = useState<'COUNT' | 'REVIEW'>('COUNT');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [locInput, setLocInput] = useState('');
  const [active, setActive] = useState<ActiveLocation | null>(null);
  const [itemInput, setItemInput] = useState('');
  const [pending, setPending] = useState<PendingItem | null>(null);
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);

  const [review, setReview] = useState<Review | null>(null);
  const [choices, setChoices] = useState<Record<string, Resolution>>({});
  const [showMatches, setShowMatches] = useState(false);
  const [approving, setApproving] = useState(false);

  const locRef = useRef<HTMLInputElement>(null);
  const itemRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const loadCount = () => api.get(`/api/stock-counts/${id}`).then(r => setCount(r.data)).catch(err => setError(apiError(err, 'Could not load the count')));
  useEffect(() => { loadCount(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadReview = async () => {
    try {
      const { data } = await api.get(`/api/stock-counts/${id}/review`);
      setReview(data);
      setChoices(Object.fromEntries(data.lines.map((l: ReviewLine) => [l.batchId, l.defaultResolution])));
    } catch (err) {
      setError(apiError(err, 'Could not load the review'));
    }
  };
  useEffect(() => { if (tab === 'REVIEW') loadReview(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOpen = count?.status === 'OPEN';
  const done = count?.locations.filter(l => l.countedAt).length ?? 0;

  // ── Counting ──
  const openLocation = async (code: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setError(''); setNotice(''); setPending(null);
    try {
      const { data } = await api.get(`/api/stock-counts/${id}/locations/${encodeURIComponent(clean)}`);
      setActive({ ...data.location, entries: data.entries });
      setLocInput('');
      setTimeout(() => (data.location.countedAt ? locRef : itemRef).current?.focus(), 50);
    } catch (err) {
      setError(apiError(err, 'Location not found'));
      setLocInput('');
    }
  };

  const refreshActive = async (code: string) => {
    const { data } = await api.get(`/api/stock-counts/${id}/locations/${encodeURIComponent(code)}`);
    setActive({ ...data.location, entries: data.entries });
  };

  const scanItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = itemInput.trim().toUpperCase();
    if (!code || !active) return;
    setError(''); setNotice('');
    try {
      const { data } = await api.get(`/api/stock-counts/${id}/lookup/${encodeURIComponent(code)}`);
      const existing = active.entries.find(en => en.batch.batchCode === data.batchCode);
      setPending(data);
      setQty(fmt(existing ? existing.quantity : data.labelQty));
      setItemInput('');
      setTimeout(() => { qtyRef.current?.focus(); qtyRef.current?.select(); }, 50);
    } catch (err) {
      setError(apiError(err, 'Barcode not found'));
      setItemInput('');
    }
  };

  const saveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending || !active) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/api/stock-counts/${id}/locations/${encodeURIComponent(active.code)}/entries`, { batchCode: pending.batchCode, quantity: Number(qty) });
      if (data.warning) setNotice(`${pending.batchCode}: ${data.warning}`);
      setPending(null);
      await refreshActive(active.code);
      setTimeout(() => itemRef.current?.focus(), 50);
    } catch (err) {
      setError(apiError(err, 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = async (entryId: string) => {
    if (!active) return;
    try {
      await api.delete(`/api/stock-counts/${id}/locations/${encodeURIComponent(active.code)}/entries/${entryId}`);
      await refreshActive(active.code);
    } catch (err) {
      setError(apiError(err, 'Could not remove'));
    }
  };

  const finishLocation = async () => {
    if (!active) return;
    if (active.entries.length === 0 && !window.confirm(`Nothing was scanned on ${active.code}. Finish it as empty?`)) return;
    setBusy(true); setError('');
    try {
      await api.post(`/api/stock-counts/${id}/locations/${encodeURIComponent(active.code)}/finish`);
      setNotice(`${active.code} finished with ${active.entries.length} item(s). Scan the next location.`);
      setActive(null); setPending(null);
      await loadCount();
      setTimeout(() => locRef.current?.focus(), 50);
    } catch (err) {
      setError(apiError(err, 'Could not finish the location'));
    } finally {
      setBusy(false);
    }
  };

  const reopenLocation = async () => {
    if (!active) return;
    try {
      await api.post(`/api/stock-counts/${id}/locations/${encodeURIComponent(active.code)}/reopen`);
      await refreshActive(active.code);
      await loadCount();
      setTimeout(() => itemRef.current?.focus(), 50);
    } catch (err) {
      setError(apiError(err, 'Could not reopen'));
    }
  };

  // ── Approval ──
  const approve = async () => {
    if (!review) return;
    const changing = review.lines.filter(l => l.type !== 'MATCH' && !l.conflict && choices[l.batchId] !== 'SKIP').length;
    const msg = `Apply ${changing} correction(s) to stock and close ${count?.countNumber}?`
      + (review.unfinishedLocations ? `\n\n${review.unfinishedLocations} location(s) were not counted and will not be changed.` : '')
      + (review.conflicts ? `\n${review.conflicts} item(s) moved after counting and will be skipped.` : '');
    if (!window.confirm(msg)) return;
    setApproving(true); setError('');
    try {
      const { data } = await api.post(`/api/stock-counts/${id}/approve`, { resolutions: choices });
      setNotice(`Approved: ${data.applied} correction(s) applied, ${data.skipped} skipped${data.conflicts ? `, ${data.conflicts} need a recount` : ''}.`);
      setTab('COUNT');
      await loadCount();
    } catch (err) {
      setError(apiError(err, 'Approval failed'));
    } finally {
      setApproving(false);
    }
  };

  const cancelCount = async () => {
    if (!window.confirm(`Cancel ${count?.countNumber}? Nothing counted will be applied.`)) return;
    try {
      await api.post(`/api/stock-counts/${id}/cancel`);
      await loadCount();
    } catch (err) {
      setError(apiError(err, 'Could not cancel'));
    }
  };

  if (!count) {
    return <div className="loading-center" style={{ minHeight: 300 }}>{error ? <div className="alert alert-danger">{error}</div> : <span className="spinner spinner-lg" />}</div>;
  }

  const visibleLines = review?.lines.filter(l => showMatches || l.type !== 'MATCH') ?? [];

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/inventory/stock-counts')} style={{ marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ArrowLeft size={14} /> All counts
      </button>

      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardCheck size={26} /> {count.countNumber}
            <span className={`badge ${count.status === 'OPEN' ? 'badge-warning' : count.status === 'COMPLETED' ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: 12 }}>
              {count.status === 'OPEN' ? 'Open' : count.status === 'COMPLETED' ? 'Completed' : 'Cancelled'}
            </span>
          </h1>
          <p className="page-subtitle">
            {count.scopeLabel} · {done}/{count.locations.length} locations counted · started {formatDateTime(count.createdAt)} by {count.createdBy.name}
            {count.notes && <> · {count.notes}</>}
          </p>
        </div>
        {isOpen && canApprove && (
          <button className="btn btn-secondary btn-sm" onClick={cancelCount} style={{ color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
            <XCircle size={14} /> Cancel count
          </button>
        )}
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}
      {notice && <div className="alert alert-success" style={{ marginBottom: 14 }}>{notice}</div>}

      {count.status === 'COMPLETED' && count.resultSummary && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <span>Approved {count.closedAt && formatDateTime(count.closedAt)} by <strong>{count.closedBy?.name}</strong></span>
            <span>Corrections applied: <strong>{count.resultSummary.applied}</strong></span>
            <span>Skipped: <strong>{count.resultSummary.skipped}</strong></span>
            <span>Needed recount: <strong>{count.resultSummary.conflicts}</strong></span>
            <span>Added: <strong style={{ color: '#047857' }}>+{fmt(count.resultSummary.unitsAdded)}</strong></span>
            <span>Removed: <strong style={{ color: '#dc2626' }}>−{fmt(count.resultSummary.unitsRemoved)}</strong></span>
            <span>Moved: <strong>{count.resultSummary.moved}</strong></span>
          </div>
        </div>
      )}

      {isOpen && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
          {([['COUNT', 'Count'], ['REVIEW', 'Review & approve']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, marginBottom: -1,
              borderBottom: tab === key ? '2px solid var(--color-brand)' : '2px solid transparent',
              color: tab === key ? 'var(--color-brand)' : 'var(--color-text-muted)', fontWeight: tab === key ? 700 : 500,
            }}>{label}</button>
          ))}
        </div>
      )}

      {tab === 'COUNT' ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Counting */}
          {isOpen && (
            <div className="card" style={{ flex: '1 1 460px', minWidth: 0 }}>
              <div className="card-body">
                <form onSubmit={e => { e.preventDefault(); openLocation(locInput); }} style={{ marginBottom: 14 }}>
                  <label className="form-label">1. Scan the location barcode</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input ref={locRef} autoFocus className="form-input" value={locInput} onChange={e => setLocInput(e.target.value)}
                      placeholder="e.g. A-B1-L1-P1" style={{ height: 42, fontSize: 15, fontFamily: 'monospace' }} />
                    <button className="btn btn-secondary" type="submit"><ScanLine size={16} /></button>
                  </div>
                </form>

                {active ? (
                  <div style={{ border: '1.5px solid var(--color-brand)', borderRadius: 'var(--radius)', padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>COUNTING</div>
                        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace' }}>{active.code}</div>
                      </div>
                      {active.countedAt ? (
                        <div style={{ textAlign: 'right' }}>
                          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={12} /> Finished</span>
                          <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>{active.countedBy} · {formatDateTime(active.countedAt)}</div>
                          <button className="btn btn-ghost btn-sm" onClick={reopenLocation} style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <RotateCcw size={13} /> Count again
                          </button>
                        </div>
                      ) : (
                        <span className="badge badge-warning">{active.entries.length} item(s) scanned</span>
                      )}
                    </div>

                    {!active.countedAt && (
                      pending ? (
                        <form onSubmit={saveEntry} style={{ background: '#f8fafc', borderRadius: 'var(--radius)', padding: 12, marginBottom: 12 }}>
                          <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>{pending.batchCode}</div>
                          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>{pending.description}</div>
                          {pending.usedUp && <div style={{ fontSize: 12.5, color: '#b45309', marginBottom: 8 }}>The system shows this item as used up. Count it anyway; it will be reviewed.</div>}
                          <label className="form-label">2. Quantity found ({pending.unit})</label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input ref={qtyRef} type="number" step={pending.uom === 'METERS' ? 'any' : 1} min="0" className="form-input" value={qty}
                              onChange={e => setQty(e.target.value)} style={{ height: 42, fontSize: 16, fontWeight: 700 }} />
                            <button className="btn btn-primary" type="submit" disabled={busy} style={{ whiteSpace: 'nowrap' }}>Save (Enter)</button>
                            <button className="btn btn-ghost" type="button" onClick={() => { setPending(null); itemRef.current?.focus(); }}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <form onSubmit={scanItem} style={{ marginBottom: 12 }}>
                          <label className="form-label">2. Scan each roll / box on this location</label>
                          <input ref={itemRef} className="form-input" value={itemInput} onChange={e => setItemInput(e.target.value)}
                            placeholder="Scan barcode" style={{ height: 42, fontSize: 15, fontFamily: 'monospace' }} />
                        </form>
                      )
                    )}

                    {active.entries.length > 0 && (
                      <table className="table" style={{ width: '100%', fontSize: 13, marginBottom: 12 }}>
                        <thead><tr><th>Barcode</th><th>Item</th><th style={{ textAlign: 'right' }}>Counted</th><th /></tr></thead>
                        <tbody>
                          {active.entries.map(en => (
                            <tr key={en.id}>
                              <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{en.batch.batchCode}</td>
                              <td>{en.batch.description}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(en.quantity)} {en.batch.unit}</td>
                              <td style={{ width: 40 }}>
                                {!active.countedAt && (
                                  <button className="btn btn-ghost btn-sm" onClick={() => removeEntry(en.id)} title="Remove" style={{ padding: 4, color: '#dc2626' }}><Trash2 size={14} /></button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {!active.countedAt && (
                      <button className="btn btn-primary" onClick={finishLocation} disabled={busy} style={{ width: '100%', height: 42, fontWeight: 700 }}>
                        3. Finish {active.code}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13.5, background: '#f8fafc', borderRadius: 'var(--radius)' }}>
                    Scan a location to start counting it, or pick one from the list.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Locations */}
          <div className="card" style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div className="card-header"><h2 className="card-title">Locations ({done}/{count.locations.length})</h2></div>
            <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 520, overflowY: 'auto' }}>
              {count.locations.map(l => (
                <button key={l.id} onClick={() => isOpen && openLocation(l.code)} disabled={!isOpen} title={l.countedAt ? `Counted by ${l.countedBy}` : 'Not counted yet'} style={{
                  fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '5px 8px', borderRadius: 6, cursor: isOpen ? 'pointer' : 'default',
                  border: `1px solid ${active?.code === l.code ? 'var(--color-brand)' : l.countedAt ? '#86efac' : 'var(--color-border)'}`,
                  background: l.countedAt ? '#f0fdf4' : '#fff', color: l.countedAt ? '#166534' : 'var(--color-text-main)',
                }}>
                  {l.code}{l.countedAt ? ` ✓${l.entryCount ? ` ${l.entryCount}` : ''}` : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Review */
        <div className="card">
          <div className="card-body">
            {!review ? (
              <div className="loading-center" style={{ minHeight: 160 }}><span className="spinner spinner-lg" /></div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {(['MISSING', 'FOUND', 'QTY_CHANGE', 'MOVED', 'MATCH'] as LineType[]).map(t => (
                    <span key={t} className={`badge ${TYPE_INFO[t].badge}`} style={{ fontSize: 12 }}>{TYPE_INFO[t].label}: {review.summary[t]}</span>
                  ))}
                </div>
                {review.unfinishedLocations > 0 && (
                  <div className="alert alert-warning" style={{ fontSize: 13, marginBottom: 12 }}>
                    {review.unfinishedLocations} location(s) are not finished yet. Only finished locations are compared, and the rest will not be changed.
                  </div>
                )}
                {review.conflicts > 0 && (
                  <div className="alert alert-warning" style={{ fontSize: 13, marginBottom: 12, display: 'flex', gap: 8 }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                    <span>{review.conflicts} item(s) were moved, cut or adjusted after their location was counted. They will be skipped; use "Count again" on those locations.</span>
                  </div>
                )}

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showMatches} onChange={e => setShowMatches(e.target.checked)} /> Show matching items too
                </label>

                {visibleLines.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    {review.finishedLocations === 0 ? 'No location has been finished yet.' : 'Everything counted matches the system.'}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table" style={{ width: '100%', fontSize: 13 }}>
                      <thead>
                        <tr><th>Result</th><th>Barcode</th><th>Item</th><th>System</th><th>Counted</th><th style={{ textAlign: 'right' }}>Stock change</th><th>Action</th></tr>
                      </thead>
                      <tbody>
                        {visibleLines.map(l => {
                          const r = choices[l.batchId] ?? l.defaultResolution;
                          const change = l.conflict ? 0 : stockChange(l, r);
                          return (
                            <tr key={l.batchId} style={{ background: l.conflict ? '#fffbeb' : undefined }}>
                              <td><span className={`badge ${TYPE_INFO[l.type].badge}`}>{TYPE_INFO[l.type].label}</span></td>
                              <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.batchCode}</td>
                              <td>{l.description}</td>
                              <td style={{ fontSize: 12.5 }}>
                                {places(l.expected)}
                                {l.type === 'FOUND' && (
                                  <div style={{ color: 'var(--color-text-muted)' }}>
                                    {l.elsewhere.length > 0 ? `Recorded on ${places(l.elsewhere)}` : l.unplaced > 0 ? `Unplaced (${fmt(l.unplaced)} ${l.unit})` : l.status === 'OUT' ? 'Recorded as used up' : 'Not recorded anywhere'}
                                  </div>
                                )}
                              </td>
                              <td style={{ fontSize: 12.5 }}>{places(l.counted)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700, color: change > 0 ? '#047857' : change < 0 ? '#dc2626' : 'var(--color-text-muted)' }}>
                                {change > 0 ? '+' : change < 0 ? '−' : ''}{fmt(Math.abs(change))} {l.unit}
                              </td>
                              <td>
                                {l.conflict ? (
                                  <span style={{ fontSize: 12.5, color: '#b45309', fontWeight: 600 }}>Changed after counting — recount</span>
                                ) : l.resolutions.length > 0 ? (
                                  <select className="form-select" value={r} disabled={!canApprove}
                                    onChange={e => setChoices(prev => ({ ...prev, [l.batchId]: e.target.value as Resolution }))}
                                    style={{ height: 34, fontSize: 12.5, minWidth: 210 }}>
                                    {l.resolutions.map(opt => <option key={opt} value={opt}>{resolutionLabel(opt, l)}</option>)}
                                  </select>
                                ) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
                  {!canApprove && <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>A supervisor with Stock Adjustments access approves the count.</span>}
                  {canApprove && (
                    <button className="btn btn-primary" onClick={approve} disabled={approving || review.finishedLocations === 0}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                      {approving ? <span className="spinner" /> : <CheckCircle2 size={16} />} Approve & apply corrections
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
