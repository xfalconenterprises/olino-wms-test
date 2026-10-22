import { useEffect, useState, useMemo, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../../utils/api';
import { 
  Layers, 
  Search, 
  RefreshCw, 
  MapPin, 
  CheckCircle2, 
  X, 
  AlertCircle, 
  ScanLine 
} from 'lucide-react';
import { formatDate } from '../../../utils/format';
import { formatTotals, unitLabel, uomOf } from '../../../utils/units';
import '../../../styles/components.css';

interface PendingBatch {
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
  assignedQty: number;
  unassignedQty: number;
  supplierBundle?: string | null;
  invoiceRef?: string | null;
  batchLocations: { location: { code: string }; quantity: number }[];
  poLine?: {
    po?: {
      poNumber: string;
      supplierName: string;
      targetClient?: string | null;
    };
  } | null;
  createdAt: string;
}

type ProductTab = 'ALL' | 'FABRIC' | 'READY_MADE' | 'ACCESSORY';

export default function BatchesPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Pending Dock Queue State
  const [pendingItems, setPendingItems] = useState<PendingBatch[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [dockSearch, setDockSearch] = useState('');
  const [dockTypeFilter, setDockTypeFilter] = useState<ProductTab>('ALL');

  // In-place Quick Put-Away Modal State
  const [selectedBatchForPutAway, setSelectedBatchForPutAway] = useState<PendingBatch | null>(null);
  const [targetLocationCode, setTargetLocationCode] = useState('');
  const [putAwayQty, setPutAwayQty] = useState('');
  const [isSubmittingPutAway, setIsSubmittingPutAway] = useState(false);
  const [putAwayError, setPutAwayError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  // Load pending dock items awaiting shelf placement
  const loadPending = () => {
    setLoadingPending(true);
    api.get('/api/batches/pending-putaway')
      .then(r => {
        setPendingItems(r.data || []);
      })
      .catch(err => {
        console.error('Failed to load pending dock queue', err);
      })
      .finally(() => setLoadingPending(false));
  };

  useEffect(() => { 
    loadPending(); 
  }, []);

  // Handle URL query parameters (e.g. ?batch=SIY-001)
  useEffect(() => {
    const batchParam = searchParams.get('batch');
    if (batchParam) {
      api.get(`/api/batches/by-code/${encodeURIComponent(batchParam.trim())}`)
        .then(res => {
          openPutAwayModal(res.data);
        })
        .catch(() => {});
    }
  }, [searchParams]);

  const openPutAwayModal = (item: PendingBatch) => {
    const totalPlaced = (item.batchLocations || []).reduce((s, bl) => s + bl.quantity, 0);
    const unassigned = Math.max(0, parseFloat((item.quantity - totalPlaced).toFixed(2)));
    setSelectedBatchForPutAway(item);
    setTargetLocationCode('');
    setPutAwayQty(String(unassigned > 0 ? unassigned : item.unassignedQty || item.quantity));
    setPutAwayError('');
  };

  const handleConfirmPutAway = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedBatchForPutAway) return;
    if (!targetLocationCode.trim()) {
      setPutAwayError('Please enter target shelf / location code (e.g. A-B1-L1-P1 or FR-01)');
      return;
    }
    const qty = parseFloat(putAwayQty);
    if (isNaN(qty) || qty <= 0) {
      setPutAwayError('Please enter a valid positive quantity');
      return;
    }

    setIsSubmittingPutAway(true);
    setPutAwayError('');
    try {
      const loc = targetLocationCode.trim().toUpperCase();
      await api.post('/api/locations/assign', {
        batchCode: selectedBatchForPutAway.batchCode,
        locationCode: loc,
        quantity: qty,
      });

      const unit = formatUnit(selectedBatchForPutAway);
      setToastMessage(`Placed ${qty} ${unit} of ${selectedBatchForPutAway.batchCode} on shelf ${loc}`);
      setTimeout(() => setToastMessage(''), 4500);
      setSelectedBatchForPutAway(null);

      // Refresh dock queue
      loadPending();
    } catch (err: any) {
      setPutAwayError(err.response?.data?.error || err.message || 'Failed to assign location');
    } finally {
      setIsSubmittingPutAway(false);
    }
  };

  // Filtered Dock Queue items
  const filteredPending = useMemo(() => {
    const q = dockSearch.trim().toLowerCase();
    return pendingItems.filter(item => {
      if (dockTypeFilter !== 'ALL' && item.itemType !== dockTypeFilter) return false;
      if (!q) return true;

      const codeMatch = item.batchCode.toLowerCase().includes(q);
      const brandMatch = (item.brand || '').toLowerCase().includes(q);
      const shadeMatch = (item.shade || '').toLowerCase().includes(q);
      const qualityMatch = (item.quality || '').toLowerCase().includes(q);
      const nameMatch = (item.name || '').toLowerCase().includes(q);
      const artNoMatch = (item.artNo || '').toLowerCase().includes(q);
      const poMatch = (item.poLine?.po?.poNumber || '').toLowerCase().includes(q);
      const supMatch = (item.poLine?.po?.supplierName || '').toLowerCase().includes(q);

      return codeMatch || brandMatch || shadeMatch || qualityMatch || nameMatch || artNoMatch || poMatch || supMatch;
    });
  }, [pendingItems, dockTypeFilter, dockSearch]);

  // Aggregate stats for Inbound Dock Queue
  const pendingStats = useMemo(() => {
    let fabricLumps = 0;
    let fabricMeters = 0;
    let fabricKg = 0;
    let readyMadePacks = 0;
    let readyMadePcs = 0;
    let accessoryPacks = 0;
    let accessoryUnits = 0;

    for (const b of pendingItems) {
      if (b.itemType === 'FABRIC') {
        fabricLumps += 1;
        if ((b.uom || '').toUpperCase() === 'KG') fabricKg += b.unassignedQty;
        else fabricMeters += b.unassignedQty;
      } else if (b.itemType === 'READY_MADE') {
        readyMadePacks += 1;
        readyMadePcs += b.unassignedQty;
      } else {
        accessoryPacks += 1;
        accessoryUnits += b.unassignedQty;
      }
    }

    return {
      totalLots: pendingItems.length,
      fabricLumps,
      fabricMeters: Math.round(fabricMeters * 10) / 10,
      fabricKg: Math.round(fabricKg * 100) / 100,
      readyMadePacks,
      readyMadePcs: Math.round(readyMadePcs),
      accessoryPacks,
      accessoryUnits: Math.round(accessoryUnits),
    };
  }, [pendingItems]);

  const formatUnit = (item: { uom?: string | null; itemType?: string }) => unitLabel(uomOf(item));

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* ─── Page Header ─────────────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={28} /> Inbound Dock Queue
          </h1>
          <p className="page-subtitle">Arrived stock awaiting warehouse shelf placement (Put-Away)</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={loadPending}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={loadingPending ? 'spinner' : ''} /> Refresh Queue
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/put-away')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <ScanLine size={16} /> Open Barcode Scanner &rarr;
          </button>
        </div>
      </div>

      {/* ─── Toast Alert ─────────────────────────────────────────────────── */}
      {toastMessage && (
        <div className="alert alert-success" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Summary KPI Cards for Dock Queue */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid var(--color-brand)' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Awaiting Put-Away (Dock)</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-text-main)', marginTop: 4 }}>
            {pendingStats.totalLots} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)' }}>packages</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
            Across all categories
          </div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #0284c7' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Unplaced Fabric</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0369a1', marginTop: 4 }}>
            {pendingStats.fabricLumps} <span style={{ fontSize: 13, fontWeight: 500 }}>{pendingStats.fabricLumps === 1 ? 'lump' : 'lumps'}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {pendingStats.fabricKg > 0 ? `${formatTotals([{ uom: 'METERS', quantity: pendingStats.fabricMeters }, { uom: 'KG', quantity: pendingStats.fabricKg }].filter(t => t.quantity > 0))} total` : `${pendingStats.fabricMeters} meters total`}
          </div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #16a34a' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Unplaced Ready-Made</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#15803d', marginTop: 4 }}>
            {pendingStats.readyMadePacks} <span style={{ fontSize: 13, fontWeight: 500 }}>{pendingStats.readyMadePacks === 1 ? 'pack' : 'packs'}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {pendingStats.readyMadePcs} pieces total
          </div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #d97706' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Unplaced Accessories</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#b45309', marginTop: 4 }}>
            {pendingStats.accessoryPacks} <span style={{ fontSize: 13, fontWeight: 500 }}>{pendingStats.accessoryPacks === 1 ? 'pack' : 'packs'}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {pendingStats.accessoryUnits} units total
          </div>
        </div>
      </div>

      {/* Sub-Filters Toolbar for Dock Queue */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ position: 'relative', width: 340 }}>
          <Search size={16} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search Batch, Brand, Shade, Art No, PO..."
            value={dockSearch}
            onChange={e => setDockSearch(e.target.value)}
            style={{ paddingLeft: 36, width: '100%', height: 38 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['ALL', 'FABRIC', 'READY_MADE', 'ACCESSORY'] as const).map(t => (
            <button
              key={t}
              className={`btn btn-sm ${dockTypeFilter === t ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDockTypeFilter(t)}
              style={{ fontSize: 12.5 }}
            >
              {t === 'ALL' ? 'All Types' : t === 'FABRIC' ? 'Fabric Lumps' : t === 'READY_MADE' ? 'Ready-Made' : 'Accessories'}
            </button>
          ))}
        </div>
      </div>

      {/* Inbound Dock Queue Table */}
      {loadingPending ? (
        <div className="loading-center"><span className="spinner spinner-lg" /></div>
      ) : filteredPending.length === 0 ? (
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="empty-state-icon"><CheckCircle2 size={48} color="var(--color-success)" /></div>
            <div className="empty-state-text">No items pending put-away at dock!</div>
            <p className="text-sm text-muted mt-2">
              All inwarded stock from Entry Gate has been placed on warehouse shelves.
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Batch / Roll Code</th>
                <th>Type</th>
                <th>Product / Details</th>
                <th>Shade / Art No / Size</th>
                <th>Unplaced Qty</th>
                <th>Origin (PO &amp; Supplier)</th>
                <th>Received Date</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPending.map(item => {
                const unit = formatUnit(item);
                return (
                  <tr key={item.id} className="hover-row">
                    <td>
                      <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-brand)' }}>
                        {item.batchCode}
                      </code>
                      {item.supplierBundle && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          Bundle: {item.supplierBundle}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${item.itemType === 'FABRIC' ? 'badge-primary' : item.itemType === 'READY_MADE' ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: 11 }}>
                        {item.itemType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      <strong>{item.name || `${item.brand || ''} ${item.quality || ''}`.trim() || 'Item'}</strong>
                      {item.category && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {item.category}
                        </div>
                      )}
                    </td>
                    <td>
                      {item.itemType === 'FABRIC' ? (
                        item.shade ? (
                          <span className="badge badge-neutral" style={{ fontSize: 11.5 }}>
                            {item.shade}
                          </span>
                        ) : null
                      ) : item.itemType === 'READY_MADE' ? (
                        <div style={{ fontSize: 12.5 }}>
                          {item.artNo && <span>Art: <strong>{item.artNo}</strong></span>}
                          {item.size && <span style={{ marginLeft: 6 }} className="badge badge-neutral">Sz: {item.size}</span>}
                          {item.shade && <span style={{ marginLeft: 6, color: 'var(--color-text-muted)' }}>({item.shade})</span>}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12.5 }}>
                          {item.shade && <span>{item.shade}</span>}
                          {item.size && <span style={{ marginLeft: 6 }} className="badge badge-neutral">{item.size}</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-brand)' }}>
                        {item.unassignedQty} <span style={{ fontSize: 12, fontWeight: 500 }}>{unit}</span>
                      </div>
                      {item.assignedQty > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          ({item.assignedQty} {unit} already placed)
                        </div>
                      )}
                    </td>
                    <td>
                      {item.poLine?.po ? (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.poLine.po.poNumber}</div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{item.poLine.po.supplierName}</div>
                        </div>
                      ) : (
                        <span className="text-muted" style={{ fontSize: 12 }}>Direct Receipt</span>
                      )}
                    </td>
                    <td className="text-muted text-xs">{formatDate(item.createdAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => openPutAwayModal(item)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <MapPin size={14} /> Put Away
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── IN-PLACE QUICK PUT-AWAY MODAL ────────────────────────────────────── */}
      {selectedBatchForPutAway && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 480,
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MapPin size={18} color="var(--color-brand)" />
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Assign Shelf Location</h3>
              </div>
              <button 
                className="btn btn-ghost" 
                onClick={() => setSelectedBatchForPutAway(null)} 
                style={{ padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmPutAway} style={{ padding: 20 }}>
              {putAwayError && (
                <div className="alert alert-danger" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={16} />
                  <span>{putAwayError}</span>
                </div>
              )}

              {/* Batch Info Card */}
              <div style={{ background: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <code style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-brand)' }}>{selectedBatchForPutAway.batchCode}</code>
                  <span className={`badge ${selectedBatchForPutAway.itemType === 'FABRIC' ? 'badge-primary' : 'badge-info'}`} style={{ fontSize: 10.5 }}>
                    {selectedBatchForPutAway.itemType}
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-main)' }}>
                  {selectedBatchForPutAway.name || `${selectedBatchForPutAway.brand || ''} ${selectedBatchForPutAway.quality || ''}`.trim() || 'Item'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {selectedBatchForPutAway.shade && <span>Shade: {selectedBatchForPutAway.shade} · </span>}
                  {selectedBatchForPutAway.artNo && <span>Art: {selectedBatchForPutAway.artNo} · </span>}
                  {selectedBatchForPutAway.size && <span>Size: {selectedBatchForPutAway.size} · </span>}
                  <span>Unplaced Balance: <strong>{selectedBatchForPutAway.unassignedQty || selectedBatchForPutAway.quantity} {formatUnit(selectedBatchForPutAway)}</strong></span>
                </div>
              </div>

              {/* Target Location Input */}
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Target Shelf Code *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. A-B1-L1-P1 or FR-01"
                  value={targetLocationCode}
                  onChange={e => setTargetLocationCode(e.target.value.toUpperCase())}
                  required
                  autoFocus
                  style={{ textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 600 }}
                />
                <span className="form-hint" style={{ fontSize: 11 }}>Scan rack location barcode or type location identifier</span>
              </div>

              {/* Quantity to Place */}
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>
                  Quantity to Place ({formatUnit(selectedBatchForPutAway)}) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  className="form-input"
                  value={putAwayQty}
                  onChange={e => setPutAwayQty(e.target.value)}
                  required
                  style={{ fontWeight: 600 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedBatchForPutAway(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingPutAway}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {isSubmittingPutAway ? <span className="spinner spinner-sm" /> : <MapPin size={15} />}
                  Confirm Placement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
