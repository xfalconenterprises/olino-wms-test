import { useState, type FormEvent } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import api from '../../../utils/api';
import { apiError } from '../../../utils/printPage';
import { allowsDecimals, fabricCategoryLabel, formatQty, unitLabel } from '../../../utils/units';
import SpecLine from '../../../components/Common/SpecLine';

// Report an item that is missing, short, wrong or damaged in a supplier bundle while receiving.
// Used by Stock In (supplier inbound) and Receive PO. The item comes from what is being received;
// the report stays open until the delivery's GRN is issued, which then carries it.

export interface DiscrepancyItem {
  poLineId?: string | null;   // when known, the server takes the item and unit from this PO line
  itemType: string;
  category?: string | null;
  brand?: string | null;
  quality?: string | null;
  qualityName?: string | null;
  shade?: string | null;
  size?: string | null;
  name?: string | null;
  artNo?: string | null;
  uom: string;
}

export interface DiscrepancyLineOption { id: string; label: string; item: DiscrepancyItem }

export interface GateDiscrepancy {
  id: string;
  bundleNumber: string;
  itemType?: string | null;
  category?: string | null;
  brand?: string | null;
  quality?: string | null;
  qualityName?: string | null;
  shade?: string | null;
  size?: string | null;
  name?: string | null;
  artNo?: string | null;
  uom?: string | null;
  issueType: string;
  expectedQty?: number | null;
  receivedQty?: number | null;
  notes?: string | null;
  invoiceRef?: string | null;
  po?: { poNumber: string } | null;
  reportedBy?: { name?: string };
  createdAt: string;
}

export const DISCREPANCY_TYPE_LABELS: Record<string, string> = {
  MISSING_FROM_BUNDLE: 'Missing from bundle',
  SHORT_QUANTITY: 'Short quantity',
  WRONG_ITEM_PACKED: 'Wrong item / shade / size',
  DAMAGED_DEFECTIVE: 'Damaged / defective',
};

// What the two quantities mean for each kind of issue
const QTY_LABELS: Record<string, { expected: string; received: string; hint: string }> = {
  MISSING_FROM_BUNDLE: { expected: 'Quantity missing (as per invoice / tag)', received: 'Received', hint: 'The item is not in the bundle at all.' },
  SHORT_QUANTITY: { expected: 'Quantity as per invoice / tag', received: 'Quantity actually measured', hint: 'The item is there but less than stated.' },
  WRONG_ITEM_PACKED: { expected: 'Quantity that should have come', received: 'Correct item received', hint: 'A different item, shade or size was packed instead.' },
  DAMAGED_DEFECTIVE: { expected: 'Quantity in the bundle', received: 'Quantity in good condition', hint: 'Stained, torn or otherwise not usable.' },
};

/** One line describing the item, with only the details that were entered. */
export function discrepancyItemText(d: Partial<Record<'itemType' | 'category' | 'brand' | 'quality' | 'qualityName' | 'shade' | 'size' | 'name' | 'artNo', string | null>>): string {
  if (d.itemType === 'FABRIC' || !d.itemType) {
    return [fabricCategoryLabel(d.category), [d.brand, d.quality].filter(Boolean).join(' '), d.qualityName, d.shade].filter(Boolean).join(' · ');
  }
  if (d.itemType === 'READY_MADE') return [d.name, d.artNo && `Art ${d.artNo}`, d.size && `Size ${d.size}`, d.shade].filter(Boolean).join(' · ');
  return [d.category, d.name, d.size, d.shade].filter(Boolean).join(' · ');
}

/** Shortage of a recorded discrepancy with its unit, e.g. "12.5 m". */
export function discrepancyShortText(d: GateDiscrepancy): string {
  const uom = d.uom || ((d.itemType || 'FABRIC') === 'FABRIC' ? 'METERS' : 'PCS');
  return formatQty(Math.max(0, (d.expectedQty ?? 0) - (d.receivedQty ?? 0)), uom);
}

export default function DiscrepancyModal({ supplierId, invoiceRef, item, lineOptions, defaultBundle = '', onClose, onSaved }: {
  supplierId: string;
  invoiceRef?: string;
  item?: DiscrepancyItem | null;             // the item being received; when missing, lineOptions are offered
  lineOptions?: DiscrepancyLineOption[];
  defaultBundle?: string;
  onClose: () => void;
  onSaved: (record: GateDiscrepancy) => void;
}) {
  const [lineId, setLineId] = useState('');
  const [bundleNumber, setBundleNumber] = useState(defaultBundle.trim());
  const [issueType, setIssueType] = useState('MISSING_FROM_BUNDLE');
  const [expectedQty, setExpectedQty] = useState('');
  const [receivedQty, setReceivedQty] = useState('0');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const chosen = item ?? lineOptions?.find(o => o.id === lineId)?.item ?? null;
  const uom = chosen?.uom ?? 'METERS';
  const decimals = allowsDecimals(uom);
  const labels = QTY_LABELS[issueType];
  const missing = issueType === 'MISSING_FROM_BUNDLE';
  const expected = parseFloat(expectedQty);
  const received = missing ? 0 : parseFloat(receivedQty) || 0;
  const short = Number.isFinite(expected) ? Math.max(0, expected - received) : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!chosen) return setError('Choose the item.');
    if (!bundleNumber.trim()) return setError('Enter the bundle number.');
    if (!Number.isFinite(expected) || expected <= 0) return setError('Enter the quantity as per the invoice or bundle tag.');
    if (!decimals && (!Number.isInteger(expected) || !Number.isInteger(received))) return setError(`Quantities in ${unitLabel(uom)} must be whole numbers.`);
    if (received >= expected) return setError('The quantity received must be less than expected; otherwise nothing is short.');

    setSaving(true);
    try {
      const res = await api.post('/api/purchase-orders/supplier-inbound/discrepancies', {
        supplierId,
        invoiceRef: invoiceRef?.trim() || undefined,
        bundleNumber: bundleNumber.trim(),
        ...(chosen.poLineId ? { poLineId: chosen.poLineId } : chosen),
        issueType,
        expectedQty: expected,
        receivedQty: received,
        notes: notes.trim() || undefined,
      });
      onSaved(res.data);
    } catch (err) {
      setError(apiError(err, 'Failed to record the discrepancy'));
    } finally {
      setSaving(false);
    }
  };

  const qtyInput = (value: string, onChange: (v: string) => void, disabled = false, required = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input type="number" className="form-input" style={{ height: 42 }} value={value} disabled={disabled} required={required}
        step={decimals ? 'any' : '1'} min="0" inputMode={decimals ? 'decimal' : 'numeric'} onChange={e => onChange(e.target.value)} />
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', minWidth: 26 }}>{unitLabel(uom)}</span>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1010, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 560, boxShadow: 'var(--shadow-xl)', overflow: 'hidden', maxHeight: '94vh', overflowY: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fffbeb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={20} color="#b45309" />
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#92400e' }}>Report Shortage / Discrepancy</h2>
              <div style={{ fontSize: 12, color: '#b45309' }}>Goes on the GRN of this delivery</div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ padding: 6 }}><X size={20} /></button>
        </div>

        <form onSubmit={submit} style={{ padding: 20 }}>
          {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

          {/* Item: the one being received, or chosen from the PO lines */}
          <div style={{ marginBottom: 14 }}>
            <label className="form-label">Item</label>
            {item ? (
              <div style={{ padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)', fontSize: 13 }}>
                <div style={{ fontWeight: 700 }}>{discrepancyItemText(item) || 'Item'}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  <SpecLine separator="·" separatorStyle={{ margin: '0 4px' }} specs={[['Art No', item.artNo], ['Size', item.size], ['Unit', unitLabel(item.uom)]]} />
                </div>
              </div>
            ) : (
              <select className="form-select" style={{ height: 42 }} value={lineId} onChange={e => setLineId(e.target.value)} required>
                <option value="">Choose the item…</option>
                {(lineOptions ?? []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="form-label">Bundle Number <span className="required">*</span></label>
              <input type="text" className="form-input" style={{ height: 42 }} value={bundleNumber} maxLength={50}
                onChange={e => setBundleNumber(e.target.value)} placeholder="e.g. B-12" required autoFocus={!defaultBundle} />
            </div>
            <div>
              <label className="form-label">Issue <span className="required">*</span></label>
              <select className="form-select" style={{ height: 42 }} value={issueType}
                onChange={e => { setIssueType(e.target.value); if (e.target.value === 'MISSING_FROM_BUNDLE') setReceivedQty('0'); }}>
                {Object.entries(DISCREPANCY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '-6px 0 14px' }}>{labels.hint}</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="form-label">{labels.expected} <span className="required">*</span></label>
              {qtyInput(expectedQty, setExpectedQty, false, true)}
            </div>
            <div>
              <label className="form-label">{labels.received}</label>
              {qtyInput(missing ? '0' : receivedQty, setReceivedQty, missing)}
            </div>
          </div>

          {short > 0 && (
            <div style={{ marginBottom: 14, background: '#fef3c7', padding: '10px 14px', borderRadius: 6, fontSize: 13, color: '#92400e', fontWeight: 700 }}>
              Short: {formatQty(short, uom)}
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <label className="form-label">Notes <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span></label>
            <textarea className="form-input" rows={2} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Tag says 3 rolls, found 2" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} style={{ height: 42 }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#b45309', borderColor: '#b45309', height: 42 }}>
              {saving ? <span className="spinner" /> : <AlertTriangle size={16} />} Record Discrepancy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
