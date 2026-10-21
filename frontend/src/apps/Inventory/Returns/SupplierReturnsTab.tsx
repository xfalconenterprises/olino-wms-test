import { useEffect, useRef, useState } from 'react';
import { ScanLine, Printer, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../../../utils/api';
import { apiError, openPrintPage } from '../../../utils/printPage';
import { printTSPL } from '../../../utils/printer';
import { formatDateTime } from '../../../utils/format';

interface Scanned {
  id: string; batchCode: string; description: string; uom: string; quantity: number; status: string;
  locations: string[]; supplier: { id: string | null; name: string } | null;
}
interface Line { batch: Scanned; qty: string }
interface SavedReturn { id: string; returnNumber: string; lines: { quantity: number; remainingQty: number; batch: { batchCode: string; uom: string } }[] }
interface ListRow {
  id: string; returnNumber: string; createdAt: string; supplierName: string; reason: string;
  createdBy: { name: string }; lines: { quantity: number; batch: { uom: string } }[];
}

const SUPPLIER_REASONS: [string, string][] = [
  ['DEFECTIVE', 'Defective / damaged'], ['WRONG_ITEM', 'Wrong item'], ['SHORT_LENGTH', 'Short length'], ['EXCESS', 'Excess quantity'], ['OTHER', 'Other'],
];
const reasonLabel = (r: string) => SUPPLIER_REASONS.find(([k]) => k === r)?.[1] ?? r;
const unit = (uom: string) => ({ METERS: 'm', PCS: 'pcs', GROSS: 'gross', BOXES: 'boxes', PACKETS: 'packets' } as Record<string, string>)[uom] ?? uom.toLowerCase();
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export default function SupplierReturnsTab() {
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [scan, setScan] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedReturn | null>(null);
  const [list, setList] = useState<ListRow[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  const supplier = suppliers.find(s => s.id === supplierId) ?? null;
  const loadList = () => api.get('/api/returns/supplier').then(r => setList(r.data)).catch(() => {});
  useEffect(() => {
    api.get('/api/suppliers', { params: { status: 'ACTIVE' } }).then(r => setSuppliers(r.data)).catch(() => {});
    loadList();
  }, []);

  const mismatch = (b: Scanned) =>
    !!supplier && !!b.supplier && (b.supplier.id ? b.supplier.id !== supplier.id : b.supplier.name.toLowerCase() !== supplier.name.toLowerCase());

  const addScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim().toUpperCase();
    if (!code) return;
    setError(''); setSaved(null);
    if (lines.some(l => l.batch.batchCode === code)) { setError(`${code} is already in this return.`); setScan(''); return; }
    try {
      const { data } = await api.get(`/api/returns/supplier/lookup/${encodeURIComponent(code)}`);
      setLines(prev => [...prev, { batch: data, qty: fmt(data.quantity) }]);
      // The first roll tells us the supplier when none is chosen yet
      if (!supplierId && data.supplier) {
        const match = suppliers.find(s => (data.supplier.id ? s.id === data.supplier.id : s.name.toLowerCase() === data.supplier.name.toLowerCase()));
        if (match) setSupplierId(match.id);
      }
    } catch (err) {
      setError(apiError(err, 'Barcode not found'));
    } finally {
      setScan('');
      scanRef.current?.focus();
    }
  };

  const save = async () => {
    if (!supplier) { setError('Choose the supplier the goods go back to.'); return; }
    if (!reason) { setError('Choose the reason for the return.'); return; }
    if (lines.length === 0) { setError('Scan at least one roll or box.'); return; }
    const bad = lines.find(l => !(Number(l.qty) > 0) || Number(l.qty) > l.batch.quantity + 0.001);
    if (bad) { setError(`${bad.batch.batchCode}: enter a quantity between 0 and ${fmt(bad.batch.quantity)}.`); return; }
    const wrong = lines.find(l => mismatch(l.batch));
    if (wrong) { setError(`${wrong.batch.batchCode} came from ${wrong.batch.supplier!.name}, not ${supplier.name}.`); return; }

    setSaving(true); setError('');
    try {
      const { data } = await api.post('/api/returns/supplier', {
        supplierId: supplier.id, supplierName: supplier.name, reason, remarks,
        lines: lines.map(l => ({ batchCode: l.batch.batchCode, quantity: Number(l.qty) })),
      });
      setSaved(data);
      setLines([]); setReason(''); setRemarks('');
      loadList();
      await openPrintPage(`/api/returns/supplier/${data.id}/print`, 'return challan').catch(() => {});
      // Cut rolls get a remainder label before they go back to the shelf
      for (const l of data.lines.filter((x: SavedReturn['lines'][number]) => x.remainingQty > 0)) {
        await printTSPL(l.batch.batchCode, undefined, { quantity: l.remainingQty, isRemainder: true }).catch(() => {});
      }
    } catch (err) {
      setError(apiError(err, 'Could not save the return'));
    } finally {
      setSaving(false);
    }
  };

  const printChallan = (id: string) => openPrintPage(`/api/returns/supplier/${id}/print`, 'return challan').catch(err => setError(apiError(err, 'Could not print')));

  return (
    <div>
      {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

      {saved && (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={16} /> {saved.returnNumber} saved — send the printed return challan with the goods</strong>
            <button className="btn btn-secondary btn-sm" onClick={() => printChallan(saved.id)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Printer size={14} /> Print challan</button>
          </div>
          {saved.lines.some(l => l.remainingQty > 0) && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Cut rolls go back to put-away with a remainder label:
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {saved.lines.filter(l => l.remainingQty > 0).map(l => (
                  <button key={l.batch.batchCode} className="btn btn-secondary btn-sm" style={{ fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => printTSPL(l.batch.batchCode, undefined, { quantity: l.remainingQty, isRemainder: true }).catch(err => setError(apiError(err, 'Label printing failed')))}>
                    <Printer size={13} /> {l.batch.batchCode} · {fmt(l.remainingQty)} {unit(l.batch.uom)} left
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header"><h2 className="card-title">New return to supplier</h2></div>
        <div className="card-body">
          <div className="form-row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div className="form-group" style={{ flex: '1 1 260px' }}>
              <label className="form-label">Supplier <span className="required">*</span></label>
              <select className="form-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">Choose…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <form onSubmit={addScan} className="form-group" style={{ flex: '2 1 320px' }}>
              <label className="form-label">Scan rolls / boxes to return</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input ref={scanRef} className="form-input" value={scan} onChange={e => setScan(e.target.value)} placeholder="Scan barcode" style={{ fontFamily: 'monospace' }} />
                <button className="btn btn-secondary" type="submit"><ScanLine size={16} /></button>
              </div>
            </form>
          </div>

          {lines.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: 12 }}>
              <table className="table" style={{ width: '100%', fontSize: 13 }}>
                <thead><tr><th>Barcode</th><th>Item</th><th>From supplier</th><th>Location</th><th style={{ textAlign: 'right' }}>In stock</th><th style={{ width: 150 }}>Returning</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => {
                    const partial = Number(l.qty) > 0 && Number(l.qty) < l.batch.quantity - 0.001;
                    return (
                      <tr key={l.batch.batchCode} style={{ background: mismatch(l.batch) ? '#fef2f2' : undefined }}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.batch.batchCode}</td>
                        <td>{l.batch.description}{l.batch.status === 'QC_HOLD' && <span className="badge badge-warning" style={{ marginLeft: 6 }}>QC hold</span>}</td>
                        <td>
                          {l.batch.supplier?.name ?? <span style={{ color: 'var(--color-text-muted)' }}>Unknown</span>}
                          {mismatch(l.batch) && <div style={{ color: '#dc2626', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={12} /> Not this supplier</div>}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{l.batch.locations.join(', ') || 'Unplaced'}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(l.batch.quantity)} {unit(l.batch.uom)}</td>
                        <td>
                          <input type="number" className="form-input" min="0" max={l.batch.quantity} step={l.batch.uom === 'METERS' ? 'any' : 1}
                            value={l.qty} onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} style={{ height: 36 }} />
                          {partial && <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 2 }}>Cut piece: {fmt(l.batch.quantity - Number(l.qty))} {unit(l.batch.uom)} stays</div>}
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => setLines(prev => prev.filter((_, j) => j !== i))} style={{ padding: 4, color: '#dc2626' }} title="Remove"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="form-row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: '1 1 200px' }}>
              <label className="form-label">Reason <span className="required">*</span></label>
              <select className="form-select" value={reason} onChange={e => setReason(e.target.value)}>
                <option value="">Choose…</option>
                {SUPPLIER_REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: '2 1 280px' }}>
              <label className="form-label">Remarks</label>
              <input className="form-input" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. Colour bleeding on washing test" />
            </div>
            <button className="btn btn-primary" onClick={save} disabled={saving || lines.length === 0} style={{ height: 42, fontWeight: 700 }}>
              {saving ? <span className="spinner" /> : `Return ${lines.length || ''} item(s) & print challan`}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="card-title">Recent returns to suppliers</h2></div>
        {list.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--color-text-muted)' }}>No returns to suppliers yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', margin: 0, fontSize: 13 }}>
              <thead><tr><th>Return</th><th>Date</th><th>Supplier</th><th>Reason</th><th>Lines</th><th>Prepared by</th><th /></tr></thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.returnNumber}</td>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>{r.supplierName}</td>
                    <td>{reasonLabel(r.reason)}</td>
                    <td>{r.lines.length}</td>
                    <td>{r.createdBy.name}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => printChallan(r.id)} title="Print challan" style={{ padding: 4 }}><Printer size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
