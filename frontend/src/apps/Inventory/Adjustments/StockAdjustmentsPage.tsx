import { useState, useRef } from 'react';
import api from '../../../utils/api';
import { allowsDecimals, unitLabel, uomOf } from '../../../utils/units';
import { SlidersHorizontal, Search, CheckCircle2 } from 'lucide-react';
import '../../../styles/components.css';

interface StockItem {
  id: string;
  batchCode: string;
  itemType: 'FABRIC' | 'READY_MADE' | 'ACCESSORY';
  category?: string | null;
  brand?: string | null;
  quality?: string | null;
  shade?: string | null;
  size?: string | null;
  name?: string | null;
  artNo?: string | null;
  uom?: string | null;
  quantity: number;
  status: string;
  batchLocations: { location: { code: string }; quantity: number }[];
}

export default function StockAdjustmentsPage() {
  const scanInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const [skuInput, setSkuInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [item, setItem] = useState<StockItem | null>(null);

  // Adjustment Form
  const [newQty, setNewQty] = useState('');
  const [reason, setReason] = useState('Physical Audit Count Correction');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState<string | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = skuInput.trim().toUpperCase();
    if (!code) return;

    setSearching(true);
    setSearchError('');
    setSuccess(null);
    setItem(null);

    try {
      const res = await api.get(`/api/batches/by-code/${encodeURIComponent(code)}`);
      if (res.data.status === 'OUT' || res.data.quantity <= 0) {
        setSearchError(`Batch Code "${code}" is already Stocked Out (depleted / 0 quantity available).`);
        return;
      }
      setItem(res.data);
      setNewQty(String(res.data.quantity));
      setTimeout(() => qtyInputRef.current?.focus(), 100);
    } catch {
      setSearchError(`Batch Code "${code}" not found in inventory.`);
    } finally {
      setSearching(false);
    }
  };

  const formatUnit = (i: StockItem) => unitLabel(uomOf(i));

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    const parsedQty = parseFloat(newQty);
    if (isNaN(parsedQty) || parsedQty < 0) {
      setSubmitError('Please enter a valid non-negative quantity.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    setSuccess(null);

    try {
      const res = await api.post('/api/transactions/adjust', {
        batchCode: item.batchCode,
        newQuantity: parsedQty,
        reason,
        notes: notes.trim() || undefined,
      });

      const delta = parsedQty - item.quantity;
      const unit = formatUnit(item);
      setSuccess(
        `Successfully adjusted ${item.batchCode} from ${item.quantity} ${unit} to ${parsedQty} ${unit} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ${unit}). Audit log updated.`
      );
      setItem(res.data.batch);
      setNotes('');
    } catch (err: any) {
      setSubmitError(err.response?.data?.error || 'Failed to apply adjustment.');
    } finally {
      setSubmitting(false);
    }
  };

  const isFabric = item?.itemType === 'FABRIC';
  const unit = item ? formatUnit(item) : '';

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SlidersHorizontal size={28} /> Stock Adjustments &amp; Reconciliation
          </h1>
          <p className="page-subtitle">Supervisor tool to adjust quantities for damage, roll defects, or physical audits</p>
        </div>
      </div>

      {/* Success Banner */}
      {success && (
        <div className="alert alert-success" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={20} style={{ flexShrink: 0 }} />
          <span>{success}</span>
        </div>
      )}

      {/* Lookup Card */}
      <div style={{ background: '#fff', padding: 22, borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 24, boxShadow: 'var(--shadow-sm)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={18} color="var(--color-brand)" /> Search or Scan Batch Code
        </h3>
        <form onSubmit={handleLookup} style={{ display: 'flex', gap: 10 }}>
          <input
            ref={scanInputRef}
            type="text"
            className="form-input"
            placeholder="Scan barcode or type Batch Code (e.g. SIY-SUIT-NVY04-001)..."
            value={skuInput}
            onChange={e => { setSkuInput(e.target.value.toUpperCase()); setSearchError(''); }}
            style={{ flex: 1, fontFamily: 'monospace', fontSize: 16, height: 44, padding: '0 16px' }}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={searching || !skuInput.trim()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 20px', height: 44, fontWeight: 600 }}>
            {searching ? <span className="spinner" /> : <Search size={16} />} {searching ? 'Searching...' : 'Find Item'}
          </button>
        </form>
        {searchError && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 8, fontWeight: 500 }}>{searchError}</div>}
      </div>

      {/* Adjustment Details Form */}
      {item && (
        <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Item Details: <code style={{ color: 'var(--color-brand)', fontSize: 16 }}>{item.batchCode}</code>
              </h3>
            </div>
            <span className={`badge ${item.status === 'IN_STOCK' ? 'badge-success' : 'badge-warning'}`}>
              {item.status.replace('_', ' ')}
            </span>
          </div>

          <div className="card-body">
            {/* Specs Grid */}
            <div style={{ background: 'var(--color-bg-subtle)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 13.5 }}>
              <div>
                <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: 12 }}>Product</span>
                <strong>{item.name || item.brand || 'Item'}</strong>
              </div>
              {(isFabric ? item.quality : item.quality || item.category) && (
                <div>
                  <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: 12 }}>{isFabric ? 'Quality' : 'Fabric / Spec'}</span>
                  <strong>{isFabric ? item.quality : item.quality || item.category}</strong>
                </div>
              )}
              {(item.shade || item.size) && (
                <div>
                  <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: 12 }}>{isFabric ? 'Shade' : 'Color · Size'}</span>
                  <strong>{[item.shade, item.size && `Size ${item.size}`].filter(Boolean).join(' · ')}</strong>
                </div>
              )}
              <div>
                <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: 12 }}>Current Shelf Location</span>
                <strong>
                  {item.batchLocations.length === 0 ? (
                    <span style={{ color: '#b45309' }}>Unassigned (Dock)</span>
                  ) : (
                    item.batchLocations.map(l => l.location.code).join(', ')
                  )}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: 12 }}>Current System Stock</span>
                <strong style={{ fontSize: 16, color: 'var(--color-brand)' }}>{item.quantity} {unit}</strong>
              </div>
            </div>

            {submitError && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{submitError}</div>}

            <form onSubmit={handleAdjust}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label className="form-label" style={{ fontWeight: 700 }}>
                    Corrected Physical Quantity ({unit}) <span className="required">*</span>
                  </label>
                  <input
                    ref={qtyInputRef}
                    type="number"
                    inputMode="decimal"
                    step={allowsDecimals(uomOf(item)) ? 'any' : 1}
                    min="0"
                    className="form-input"
                    value={newQty}
                    onChange={e => setNewQty(e.target.value)}
                    style={{ fontSize: 20, fontWeight: 700, height: 48 }}
                    required
                  />
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    Enter 0 to mark item as fully depleted/disposed.
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontWeight: 700 }}>
                    Adjustment Reason <span className="required">*</span>
                  </label>
                  <select
                    className="form-select"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    style={{ height: 48, fontWeight: 600 }}
                    required
                  >
                    <option value="Physical Audit Count Correction">Physical Audit Count Correction</option>
                    <option value="Damage / Quality Rejection">Damage / Quality Rejection</option>
                    <option value="Cutting Loss / Defect Scrap">Cutting Loss / Defect Scrap</option>
                    <option value="Supplier Invoice Measurement Mismatch">Supplier Measurement Mismatch</option>
                    <option value="Inventory Write-Off">Inventory Write-Off</option>
                    <option value="Other">Other Reason</option>
                  </select>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label">Supervisor Remarks / Justification</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Optional detailed remarks explaining the discrepancy..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  style={{ height: 40 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 24px', height: 44, fontWeight: 700 }}
                >
                  {submitting ? <><span className="spinner" /> Applying...</> : <><CheckCircle2 size={16} /> Apply Stock Adjustment</>}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => { setItem(null); setSkuInput(''); setSuccess(null); }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
