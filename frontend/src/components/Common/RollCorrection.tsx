import { useState, type FormEvent } from 'react';
import { CheckCircle2, PencilLine, Printer, Undo2, X } from 'lucide-react';
import api from '../../utils/api';
import { apiError } from '../../utils/printPage';
import { printTSPL } from '../../utils/printer';
import { allowsDecimals, unitLabel } from '../../utils/units';

// Fixing a receiving mistake on one roll: the wrong quantity typed, or a roll that should not have
// been received at all. The server moves the roll, its shelves, the PO and the GRN together and
// keeps a record of who changed what and why.

export interface CorrectableRoll {
  id: string;
  batchCode: string;
  quantity: number;          // what was received
  uom?: string | null;
  grnId?: string | null;
  grnNumber?: string | null;
}

const QUANTITY_REASONS = ['Typing mistake', 'Re-measured', 'Supplier tag was wrong'];
const UNDO_REASONS = ['Received by mistake', 'Entered twice', 'Wrong PO or item'];

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A warning when a typed quantity is far off the rolls already received on the same item. */
export function unusualQuantityMessage(quantity: number, others: number[], uom?: string | null): string | null {
  const known = others.filter(n => n > 0).sort((a, b) => a - b);
  if (known.length === 0 || !(quantity > 0)) return null;
  const mid = Math.floor(known.length / 2);
  const median = known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  const unit = unitLabel(uom);
  const around = allowsDecimals(uom) ? round(median) : Math.round(median);
  if (quantity < median * 0.5) return `${quantity} ${unit} is much less than the other rolls on this item (around ${around} ${unit}). Is it correct?`;
  if (quantity > median * 2) return `${quantity} ${unit} is much more than the other rolls on this item (around ${around} ${unit}). Is it correct?`;
  return null;
}

export function RollCorrectionModal({ roll, onClose, onDone }: {
  roll: CorrectableRoll;
  onClose: () => void;
  /** Called once the correction is saved, so the page can update its figures. */
  onDone: (result: { undone: boolean; quantity: number }) => void;
}) {
  const unit = unitLabel(roll.uom);
  const [mode, setMode] = useState<'quantity' | 'undo'>('quantity');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ undone: boolean; quantity: number } | null>(null);
  const [printNote, setPrintNote] = useState('');
  const canUndo = !roll.grnId;

  const switchMode = (next: 'quantity' | 'undo') => { setMode(next); setReason(''); setError(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const why = reason.trim();
    if (mode === 'quantity') {
      const qty = Number(quantity);
      if (!quantity.trim() || !Number.isFinite(qty) || qty <= 0) { setError('Enter the quantity that really arrived.'); return; }
      if (!allowsDecimals(roll.uom) && !Number.isInteger(qty)) { setError(`${unit} must be a whole number.`); return; }
      if (round(qty) === round(roll.quantity)) { setError(`${roll.batchCode} is already recorded as ${roll.quantity} ${unit}.`); return; }
    }
    if (!why) { setError(mode === 'quantity' ? 'Say why it is being corrected.' : 'Say why the receipt is being undone.'); return; }

    setSaving(true);
    try {
      if (mode === 'quantity') {
        const qty = Number(quantity);
        await api.post(`/api/receipt-corrections/${roll.id}/quantity`, { quantity: qty, reason: why });
        setSaved({ undone: false, quantity: qty });
        onDone({ undone: false, quantity: qty });
      } else {
        await api.post(`/api/receipt-corrections/${roll.id}/undo`, { reason: why });
        setSaved({ undone: true, quantity: 0 });
        onDone({ undone: true, quantity: 0 });
      }
    } catch (err) {
      setError(apiError(err, 'The correction could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const reprint = async () => {
    setPrintNote('');
    try {
      await printTSPL(roll.batchCode);
      setPrintNote('New label sent to the printer.');
    } catch (err: any) {
      setPrintNote(err?.response?.data?.error || err?.message || 'The label could not be printed. Check the printer in Settings.');
    }
  };

  const chips = mode === 'quantity' ? QUANTITY_REASONS : UNDO_REASONS;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1150, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 500, boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <PencilLine size={18} /> Fix receipt · <code>{roll.batchCode}</code>
          </h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ padding: 4, color: 'var(--color-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {saved ? (
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
              <CheckCircle2 size={22} color="#16a34a" />
              <div style={{ fontSize: 14, color: '#166534' }}>
                {saved.undone
                  ? <>Receipt of <strong>{roll.batchCode}</strong> undone. The PO balance is open again; throw away its label.</>
                  : <><strong>{roll.batchCode}</strong> corrected from {roll.quantity} to <strong>{saved.quantity} {unit}</strong>.{roll.grnNumber && <> {roll.grnNumber} now shows it as an amendment.</>}</>}
              </div>
            </div>
            {printNote && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>{printNote}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              {!saved.undone && (
                <button type="button" className="btn btn-secondary" onClick={reprint} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Printer size={16} /> Reprint label
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ padding: 20 }}>
            {canUndo && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button type="button" className={`btn ${mode === 'quantity' ? 'btn-primary' : 'btn-secondary'}`} style={{ flex: 1 }} onClick={() => switchMode('quantity')}>
                  Correct quantity
                </button>
                <button type="button" className={`btn ${mode === 'undo' ? 'btn-danger' : 'btn-secondary'}`} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => switchMode('undo')}>
                  <Undo2 size={15} /> Undo receipt
                </button>
              </div>
            )}

            {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

            {mode === 'quantity' ? (
              <>
                <div style={{ fontSize: 13.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                  Recorded as <strong style={{ color: '#0f172a' }}>{roll.quantity} {unit}</strong>
                  {roll.grnNumber && <> on {roll.grnNumber}</>}.
                </div>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label">Quantity that really arrived ({unit}) <span className="required">*</span></label>
                  <input type="number" inputMode="decimal" min="0" step={allowsDecimals(roll.uom) ? 'any' : '1'} className="form-input"
                    value={quantity} onChange={e => setQuantity(e.target.value)} autoFocus style={{ fontSize: 18, fontWeight: 700 }} />
                </div>
              </>
            ) : (
              <div className="alert alert-warning" style={{ marginBottom: 14, fontSize: 13.5 }}>
                {roll.batchCode} ({roll.quantity} {unit}) leaves stock and its quantity comes off the PO. Its label should be thrown away.
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 6 }}>
              <label className="form-label">Reason <span className="required">*</span></label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {chips.map(c => (
                  <button key={c} type="button" className={`btn btn-sm ${reason === c ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setReason(c)}>{c}</button>
                ))}
              </div>
              <input type="text" className="form-input" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} placeholder="Or type the reason" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 12, marginTop: 10, borderTop: '1px solid var(--color-border)' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className={`btn ${mode === 'undo' ? 'btn-danger' : 'btn-primary'}`} disabled={saving}>
                {saving ? <span className="spinner" /> : mode === 'undo' ? 'Undo receipt' : 'Save correction'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
