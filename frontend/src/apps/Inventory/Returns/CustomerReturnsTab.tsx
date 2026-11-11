import { useEffect, useState } from 'react';
import { Search, Printer, CheckCircle2, Ban } from 'lucide-react';
import api from '../../../utils/api';
import { apiError, openPrintPage } from '../../../utils/printPage';
import { autoPrintReceivedLabel, printTSPL } from '../../../utils/printer';
import TouchChoice from './TouchChoice';
import CancelReturnModal from './CancelReturnModal';
import { CameraScanButton } from '../../../components/Common/CameraScan';
import { useAuth } from '../../../hooks/useAuth';
import { hasPermission } from '../../../utils/roles';
import { formatDate, formatDateTime } from '../../../utils/format';
import { allowsDecimals, unitLabel as unit } from '../../../utils/units';
import AutoPrintSwitch from '../../../components/Common/AutoPrintSwitch';

interface DcLine {
  dcLineId: string; batchCode: string; cutReference: string | null; itemType: string; description: string;
  uom: string; shipped: number; returned: number; returnable: number;
}
interface Lookup { dc: { id: string; challanNumber: string; customerName: string; destination: string | null; dispatchedAt: string }; lines: DcLine[] }
interface RowInput { qty: string; condition: 'GOOD' | 'DAMAGED'; notes: string }
interface SavedReturn { id: string; returnNumber: string; lines: { condition: string; quantity: number; batch: { batchCode: string; uom: string } }[] }
interface ListRow {
  id: string; returnNumber: string; createdAt: string; customerName: string; reason: string;
  dc: { challanNumber: string }; createdBy: { name: string }; lines: { quantity: number; condition: string; batch: { uom: string } }[];
  cancelledAt?: string | null; cancelledByName?: string | null; cancelReason?: string | null;
}

export const CUSTOMER_REASONS: [string, string][] = [
  ['SIZE_EXCHANGE', 'Size exchange'], ['DEFECTIVE', 'Defective / damaged'], ['WRONG_ITEM', 'Wrong item'], ['EXCESS', 'Excess quantity'], ['OTHER', 'Other'],
];
const reasonLabel = (r: string) => CUSTOMER_REASONS.find(([k]) => k === r)?.[1] ?? r;
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const CONDITIONS = [['GOOD', 'Good'], ['DAMAGED', 'Damaged']] as const;

export default function CustomerReturnsTab() {
  const [dcInput, setDcInput] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [rows, setRows] = useState<Record<string, RowInput>>({});
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedReturn | null>(null);
  const [list, setList] = useState<ListRow[]>([]);
  const [cancelling, setCancelling] = useState<ListRow | null>(null);
  const { user } = useAuth();
  const canCancel = hasPermission(user, 'inv.adjustments');
  const [search, setSearch] = useState('');

  const loadList = (q = search) => api.get('/api/returns/customer', { params: { search: q || undefined } }).then(r => setList(r.data)).catch(() => {});
  useEffect(() => { loadList(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const find = async (e?: React.FormEvent, scanned = dcInput) => {
    e?.preventDefault();
    if (!scanned.trim()) return;
    setError(''); setSaved(null);
    try {
      const { data } = await api.get(`/api/returns/customer/lookup/${encodeURIComponent(scanned.trim())}`);
      setLookup(data);
      setRows(Object.fromEntries(data.lines.map((l: DcLine) => [l.dcLineId, { qty: '', condition: 'GOOD', notes: '' }])));
      setReason(''); setRemarks('');
    } catch (err) {
      setLookup(null);
      setError(apiError(err, 'Challan not found'));
    }
  };

  const setRow = (id: string, patch: Partial<RowInput>) => setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const save = async () => {
    if (!lookup) return;
    const lines = lookup.lines
      .filter(l => Number(rows[l.dcLineId]?.qty) > 0)
      .map(l => ({ dcLineId: l.dcLineId, quantity: Number(rows[l.dcLineId].qty), condition: rows[l.dcLineId].condition, notes: rows[l.dcLineId].notes }));
    if (!reason) { setError('Choose the reason for the return.'); return; }
    if (lines.length === 0) { setError('Enter the quantity returned on at least one line.'); return; }
    const over = lookup.lines.find(l => Number(rows[l.dcLineId]?.qty) > l.returnable + 0.001);
    if (over) { setError(`${over.cutReference || over.batchCode}: only ${fmt(over.returnable)} ${unit(over.uom)} can be returned.`); return; }

    setSaving(true); setError('');
    try {
      const { data } = await api.post('/api/returns/customer', { dcId: lookup.dc.id, reason, remarks, lines });
      setSaved(data);
      setLookup(null); setDcInput('');
      loadList();
      // New labels for the returned goods (follows "Auto print on receipt"), one after another
      // and without holding up the screen; the worker can reprint from the buttons above
      void (async () => {
        for (const l of data.lines) await autoPrintReceivedLabel(l.batch.batchCode, setError);
      })();
    } catch (err) {
      setError(apiError(err, 'Could not save the return'));
    } finally {
      setSaving(false);
    }
  };

  const printReceipt = (id: string) => openPrintPage(`/api/returns/customer/${id}/print`, 'return receipt').catch(err => setError(apiError(err, 'Could not print')));
  const printLabel = (code: string) => printTSPL(code).catch(err => setError(apiError(err, 'Label printing failed')));

  return (
    <div>
      {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

      {saved && (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={16} /> Return {saved.returnNumber} saved</strong>
            <button className="btn btn-secondary" onClick={() => printReceipt(saved.id)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Printer size={14} /> Print receipt
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            New labels — stick them on the returned goods:
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {saved.lines.map(l => (
                <button key={l.batch.batchCode} className="btn btn-secondary" onClick={() => printLabel(l.batch.batchCode)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'monospace' }}>
                  <Printer size={13} /> {l.batch.batchCode} · {fmt(l.quantity)} {unit(l.batch.uom)} · {l.condition === 'GOOD' ? 'to put-away' : 'QC hold'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="card-title">New customer return</h2>
          <AutoPrintSwitch />
        </div>
        <div className="card-body">
          <form onSubmit={find} style={{ display: 'flex', gap: 8, marginBottom: lookup ? 16 : 0, flexWrap: 'wrap' }}>
            <input className="form-input" value={dcInput} onChange={e => setDcInput(e.target.value)} placeholder="Scan or type the delivery challan number, e.g. DC-2026-0012"
              style={{ flex: '1 1 320px', minHeight: 48, fontFamily: 'monospace' }} autoFocus />
            <CameraScanButton title="Scan the challan with the camera" onScan={code => { setDcInput(code); find(undefined, code); }} />
            <button className="btn btn-primary" type="submit" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 48 }}><Search size={18} /> Find challan</button>
          </form>

          {lookup && (
            <>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, marginBottom: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 'var(--radius)' }}>
                <span>Challan <strong style={{ fontFamily: 'monospace' }}>{lookup.dc.challanNumber}</strong></span>
                <span>Customer <strong>{lookup.dc.customerName}</strong></span>
                <span>Dispatched <strong>{formatDate(lookup.dc.dispatchedAt)}</strong></span>
                {lookup.dc.destination && <span>To <strong>{lookup.dc.destination}</strong></span>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {lookup.lines.map(l => {
                  const row = rows[l.dcLineId];
                  const none = l.returnable <= 0;
                  return (
                    <div key={l.dcLineId} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 14, opacity: none ? 0.55 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{l.description}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{l.cutReference || l.batchCode}</div>
                        </div>
                        <div style={{ fontSize: 13, textAlign: 'right' }}>
                          Shipped <strong>{fmt(l.shipped)} {unit(l.uom)}</strong>
                          {l.returned > 0 && <div style={{ color: 'var(--color-text-muted)' }}>Already returned {fmt(l.returned)} {unit(l.uom)}</div>}
                        </div>
                      </div>
                      {none ? <div style={{ fontSize: 13, marginTop: 8 }}>All returned</div> : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginTop: 12 }}>
                          <div>
                            <label className="form-label">Returning now ({unit(l.uom)})</label>
                            <input type="number" className="form-input" min="0" max={l.returnable} step={allowsDecimals(l.uom) ? 'any' : 1} inputMode={allowsDecimals(l.uom) ? 'decimal' : 'numeric'}
                              value={row?.qty ?? ''} onChange={e => setRow(l.dcLineId, { qty: e.target.value })} placeholder={`Up to ${fmt(l.returnable)}`} style={{ minHeight: 48 }} />
                          </div>
                          <div>
                            <label className="form-label">Condition</label>
                            <TouchChoice label="Condition" options={CONDITIONS} value={row?.condition ?? 'GOOD'} onChange={condition => setRow(l.dcLineId, { condition })} />
                          </div>
                          <div>
                            <label className="form-label">Note</label>
                            <input className="form-input" value={row?.notes ?? ''} onChange={e => setRow(l.dcLineId, { notes: e.target.value })} style={{ minHeight: 48 }} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 14 }}>
                <label className="form-label">Reason <span className="required">*</span></label>
                <TouchChoice label="Reason" options={CUSTOMER_REASONS} value={reason} onChange={setReason} />
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">Remarks</label>
                <input className="form-input" value={remarks} onChange={e => setRemarks(e.target.value)} style={{ minHeight: 48 }} />
              </div>
              <button className="btn btn-primary" onClick={save} disabled={saving} style={{ width: '100%', minHeight: 54, fontWeight: 700, fontSize: 15, marginTop: 14, justifyContent: 'center' }}>
                {saving ? <span className="spinner" /> : 'Receive return & print labels'}
              </button>
              <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '10px 0 0' }}>
                Each returned piece gets a new label. Good goods go to the put-away queue; damaged goods are held for inspection (QC hold).
              </p>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="card-title">Recent customer returns</h2>
          <input className="form-input" value={search} onChange={e => { setSearch(e.target.value); loadList(e.target.value); }} placeholder="Search return, customer or challan" style={{ width: 280 }} />
        </div>
        {list.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--color-text-muted)' }}>No customer returns yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', margin: 0, fontSize: 13 }}>
              <thead><tr><th>Return</th><th>Date</th><th>Customer</th><th>Against</th><th>Reason</th><th>Lines</th><th>Received by</th><th /></tr></thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                      {r.returnNumber}
                      {r.cancelledAt && <div><span className="badge badge-danger" title={`${r.cancelledByName}: ${r.cancelReason}`}>Cancelled</span></div>}
                    </td>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>{r.customerName}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.dc.challanNumber}</td>
                    <td>{reasonLabel(r.reason)}</td>
                    <td>{r.lines.length}{r.lines.some(l => l.condition === 'DAMAGED') && <span className="badge badge-warning" style={{ marginLeft: 6 }}>damaged</span>}</td>
                    <td>{r.createdBy.name}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => printReceipt(r.id)} title="Print receipt" aria-label="Print receipt" style={{ minWidth: 44, minHeight: 44 }}><Printer size={18} /></button>
                      {canCancel && !r.cancelledAt && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setCancelling(r)} title="Cancel this return" aria-label="Cancel this return" style={{ minWidth: 44, minHeight: 44, color: '#dc2626' }}><Ban size={18} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {cancelling && (
        <CancelReturnModal kind="customer" ret={cancelling} onClose={() => setCancelling(null)}
          onCancelled={() => { setCancelling(null); loadList(); }} />
      )}
    </div>
  );
}
