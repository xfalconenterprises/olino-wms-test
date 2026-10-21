import { useState } from 'react';
import api from '../../../utils/api';
import { ArrowRightLeft, Search, MapPin, CheckCircle2, ShieldAlert } from 'lucide-react';
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

export default function StockRelocationPage() {
  const [skuInput, setSkuInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [item, setItem] = useState<StockItem | null>(null);

  // Transfer Form
  const [fromLocation, setFromLocation] = useState('');
  const [targetLocation, setTargetLocation] = useState('');
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
      if (res.data.batchLocations?.length > 0) {
        setFromLocation(res.data.batchLocations[0].location.code);
      } else {
        setFromLocation('');
      }
    } catch {
      setSearchError(`Batch Code "${code}" not found in inventory.`);
    } finally {
      setSearching(false);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    if (!targetLocation.trim()) {
      setSubmitError('Please enter or scan a destination location code.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    setSuccess(null);

    const qty = item.quantity;

    try {
      await api.post('/api/transactions/transfer', {
        batchCode: item.batchCode,
        fromLocationCode: fromLocation.trim() || undefined,
        toLocationCode: targetLocation.trim().toUpperCase(),
        quantity: qty,
      });

      const unit = formatUnit(item);
      setSuccess(
        `Successfully moved ${qty} ${unit} of ${item.batchCode} from ${fromLocation || 'Dock (Unassigned)'} to ${targetLocation.toUpperCase()}.`
      );
      setItem(null);
      setSkuInput('');
      setTargetLocation('');
    } catch (err: any) {
      setSubmitError(err.response?.data?.error || 'Failed to relocate stock.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatUnit = (i: StockItem) => {
    if (i.uom) return i.uom.toLowerCase();
    if (i.itemType === 'FABRIC') return 'm';
    if (i.itemType === 'READY_MADE') return 'pcs';
    return 'units';
  };

  const unit = item ? formatUnit(item) : '';

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={28} /> Stock Relocation (Shelf Transfer)
          </h1>
          <p className="page-subtitle">Transfer physical stock between racks, bays, and warehouse locations</p>
        </div>
      </div>

      {/* Success Banner */}
      {success && (
        <div className="alert alert-success" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={20} style={{ flexShrink: 0 }} />
          <span>{success}</span>
        </div>
      )}

      {/* Search Batch Bar */}
      <div style={{ background: '#fff', padding: 22, borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 24, boxShadow: 'var(--shadow-sm)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={18} color="var(--color-brand)" /> Scan or Enter Batch Code to Relocate
        </h3>
        <form onSubmit={handleLookup} style={{ display: 'flex', gap: 10 }}>
          <input
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

      {/* Relocation Card */}
      {item && (
        <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="card-header">
            <h3 className="card-title">
              Relocate Batch: <code style={{ color: 'var(--color-brand)', fontSize: 16 }}>{item.batchCode}</code>
            </h3>
          </div>

          <div className="card-body">
            {/* Info bar */}
            <div style={{ background: 'var(--color-bg-subtle)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12, display: 'block' }}>Product</span>
                <strong>{item.name || `${item.brand || ''} ${item.quality || ''}`.trim() || 'Item'}</strong>
                {item.shade && <span style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block' }}>Shade: {item.shade}</span>}
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12, display: 'block' }}>Total Quantity</span>
                <strong style={{ color: 'var(--color-brand)', fontSize: 15 }}>{item.quantity} {unit}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12, display: 'block' }}>Current Location</span>
                <strong>
                  {item.batchLocations.length === 0 ? (
                    <span style={{ color: '#b45309' }}>Dock (Unassigned)</span>
                  ) : (
                    item.batchLocations.map(l => `${l.location.code} (${l.quantity} ${unit})`).join(', ')
                  )}
                </strong>
              </div>
              {item.status === 'QC_HOLD' && (
                <div style={{ width: '100%', marginTop: 8 }}>
                  <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px' }}>
                    <ShieldAlert size={14} /> Under QC Hold (Quarantine)
                  </span>
                </div>
              )}
            </div>

            {submitError && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{submitError}</div>}

            <form onSubmit={handleTransfer}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div>
                  <label className="form-label" style={{ fontWeight: 700 }}>Source Location (From)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={fromLocation}
                    onChange={e => setFromLocation(e.target.value.toUpperCase())}
                    placeholder="e.g. A-B1-L1-P1 (leave empty if Dock)"
                    style={{ height: 44, fontFamily: 'monospace', fontWeight: 600 }}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontWeight: 700 }}>Destination Location (To) <span className="required">*</span></label>
                  <input
                    type="text"
                    className="form-input"
                    value={targetLocation}
                    onChange={e => setTargetLocation(e.target.value.toUpperCase())}
                    placeholder="Scan or enter target shelf (e.g. A-B2-L1-P1)"
                    style={{ height: 44, fontFamily: 'monospace', fontWeight: 600 }}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label className="form-label" style={{ fontWeight: 700 }}>Relocation Quantity</label>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: 'var(--color-bg-subtle)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  maxWidth: 360
                }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-brand)' }}>
                    {item.quantity} {unit}
                  </span>
                  <span className="badge badge-info" style={{ fontSize: 12, fontWeight: 600 }}>
                    Whole Unit Relocation
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                  Whole unit relocation is enforced to preserve 1-to-1 barcode tracking across shelf racks.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 28px', height: 48, fontWeight: 700 }}
                >
                  {submitting ? <><span className="spinner" /> Moving...</> : <><ArrowRightLeft size={16} /> Confirm Relocation</>}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => { setItem(null); setSkuInput(''); }}
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
