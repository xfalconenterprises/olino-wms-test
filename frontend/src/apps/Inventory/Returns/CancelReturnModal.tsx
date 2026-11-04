import { useState, type FormEvent } from 'react';
import { Ban, X } from 'lucide-react';
import api from '../../../utils/api';
import { apiError } from '../../../utils/printPage';

// Cancelling a return entered by mistake (supervisors). The return stays on record marked cancelled;
// a customer return's rolls leave stock, a supplier return's goods go back on their rolls.

const REASONS = ['Entered by mistake', 'Wrong challan or roll', 'Entered twice'];

export default function CancelReturnModal({ kind, ret, onClose, onCancelled }: {
  kind: 'customer' | 'supplier';
  ret: { id: string; returnNumber: string };
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) { setError('Say why the return is being cancelled.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post(`/api/returns/${kind}/${ret.id}/cancel`, { reason: reason.trim() });
      onCancelled();
    } catch (err) {
      setError(apiError(err, 'The return could not be cancelled.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
      <form onSubmit={submit} style={{ background: '#fff', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 480, boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ban size={18} /> Cancel return · <code>{ret.returnNumber}</code>
          </h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ padding: 4, color: 'var(--color-text-muted)' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>
          {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}
          <div className="alert alert-warning" style={{ marginBottom: 14, fontSize: 13.5 }}>
            {kind === 'customer'
              ? 'The rolls this return created leave stock, and the challan quantity can be returned again. Their labels should be thrown away.'
              : 'The goods go back on their rolls and show in Put Away to be shelved again. The challan is marked cancelled.'}
          </div>
          <label className="form-label">Reason <span className="required">*</span></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {REASONS.map(r => (
              <button key={r} type="button" className={`btn btn-sm ${reason === r ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <input className="form-input" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} placeholder="Or type the reason" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 12, marginTop: 16, borderTop: '1px solid var(--color-border)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Keep it</button>
            <button type="submit" className="btn btn-danger" disabled={saving}>{saving ? <span className="spinner" /> : 'Cancel return'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
