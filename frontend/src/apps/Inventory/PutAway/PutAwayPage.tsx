import { useRef, useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { formatTime } from '../../../utils/format';
import { 
  MapPin, 
  ScanLine, 
  CheckCircle2, 
  ArrowRight, 
  Layers, 
  Clock, 
  RefreshCw,
  AlertCircle,
  Check,
  Lock,
  Unlock,
  ArrowRightLeft
} from 'lucide-react';
import '../../../styles/components.css';

interface LocationSlot {
  id: string;
  code: string;
  type: string;
  level?: number;
  position?: number;
  bay?: { number: number; rack: { name: string } };
}

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
  status?: string;
  transactions?: { type: string; notes?: string; referenceId?: string }[];
  poLine?: {
    po?: {
      poNumber: string;
      supplierName: string;
    };
  } | null;
}

interface RecentPutAway {
  id: string;
  batchCode: string;
  locationCode: string;
  quantity: number;
  unit: string;
  itemType: string;
  timestamp: string;
}

type Step = 'scan-location' | 'scan-batch' | 'confirm';

export default function PutAwayPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Metrics Queue State
  const [pendingItems, setPendingItems] = useState<PendingBatch[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);

  // Scanner Mode State
  const [step, setStep] = useState<Step>('scan-location');
  const [locationInput, setLocationInput] = useState('');
  const [batchInput, setBatchInput] = useState('');
  const [scannedLocation, setScannedLocation] = useState<LocationSlot | null>(null);
  const [scannedBatch, setScannedBatch] = useState<PendingBatch | null>(null);
  const [putAwayQty, setPutAwayQty] = useState('');
  const [keepShelfLocked, setKeepShelfLocked] = useState<boolean>(() => {
    const saved = localStorage.getItem('putaway_shelf_locked');
    return saved !== null ? saved === 'true' : true;
  });

  useEffect(() => {
    localStorage.setItem('putaway_shelf_locked', String(keepShelfLocked));
  }, [keepShelfLocked]);

  // Status & Feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [recentPutAways, setRecentPutAways] = useState<RecentPutAway[]>([]);

  const locationInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Load pending unassigned batches to compute KPI counters
  const loadPendingQueue = () => {
    setLoadingQueue(true);
    api.get('/api/batches/pending-putaway')
      .then(res => setPendingItems(res.data || []))
      .catch(err => {
        console.error('Failed to load pending queue', err);
      })
      .finally(() => setLoadingQueue(false));
  };

  useEffect(() => {
    loadPendingQueue();
  }, []);

  // Handle URL query parameters (e.g. ?location=A-B1-L1-P1 or ?batch=SIY-001)
  useEffect(() => {
    const locationParam = searchParams.get('location');
    const batchParam = searchParams.get('batch');

    if (locationParam) {
      const loc = locationParam.toUpperCase().trim();
      setLocationInput(loc);
      api.get(`/api/locations/by-code/${encodeURIComponent(loc)}`)
        .then(res => {
          setScannedLocation(res.data);
          setStep('scan-batch');
          setTimeout(() => batchInputRef.current?.focus(), 150);
        })
        .catch(() => {});
    }

    if (batchParam) {
      const bCode = batchParam.toUpperCase().trim();
      setBatchInput(bCode);
    }
  }, [searchParams]);

  // Focus management based on current step
  useEffect(() => {
    if (step === 'scan-location') {
      setTimeout(() => locationInputRef.current?.focus(), 100);
    } else if (step === 'scan-batch') {
      setTimeout(() => batchInputRef.current?.focus(), 100);
    } else if (step === 'confirm') {
      setTimeout(() => confirmBtnRef.current?.focus(), 100);
    }
  }, [step]);

  // Aggregate pending stats
  const queueStats = useMemo(() => {
    let fabricLumps = 0;
    let fabricMeters = 0;
    let readyMadePacks = 0;
    let readyMadePcs = 0;
    let accessoryPacks = 0;
    let accessoryUnits = 0;

    for (const b of pendingItems) {
      if (b.itemType === 'FABRIC') {
        fabricLumps += 1;
        fabricMeters += b.unassignedQty;
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
      readyMadePacks,
      readyMadePcs: Math.round(readyMadePcs),
      accessoryPacks,
      accessoryUnits: Math.round(accessoryUnits),
    };
  }, [pendingItems]);

  const getUnitLabel = (item: { uom?: string | null; itemType?: string }) => {
    if (item.uom) return item.uom.toLowerCase();
    if (item.itemType === 'FABRIC') return 'm';
    if (item.itemType === 'READY_MADE') return 'pcs';
    return 'units';
  };

  // ─── Step 1: Confirm Location ──────────────────────────────────────────────
  const handleScanLocation = async () => {
    const loc = locationInput.trim().toUpperCase();
    if (!loc) return;

    setIsSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.get(`/api/locations/by-code/${encodeURIComponent(loc)}`);
      setScannedLocation(res.data);
      setStep('scan-batch');
    } catch {
      setError(`Location "${loc}" not found in system. Verify rack barcode.`);
      locationInputRef.current?.select();
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Step 2: Confirm Batch ─────────────────────────────────────────────────
  const handleScanBatch = async () => {
    const bCode = batchInput.trim().toUpperCase();
    if (!bCode) return;

    setIsSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.get(`/api/batches/by-code/${encodeURIComponent(bCode)}`);
      const batchData = res.data;
      if (batchData.status === 'OUT' || batchData.quantity <= 0) {
        setError(`Batch "${bCode}" is already depleted/stocked out.`);
        batchInputRef.current?.select();
        return;
      }

      const assigned = (batchData.batchLocations || []).reduce((s: number, bl: any) => s + bl.quantity, 0);
      const unassigned = Math.max(0, parseFloat((batchData.quantity - assigned).toFixed(2)));

      if (unassigned <= 0) {
        setError(`Batch "${bCode}" is already fully assigned to existing shelf locations.`);
        batchInputRef.current?.select();
        return;
      }

      const batchObj: PendingBatch = {
        ...batchData,
        assignedQty: assigned,
        unassignedQty: unassigned,
      };

      setScannedBatch(batchObj);
      setPutAwayQty(String(unassigned));
      setStep('confirm');
    } catch {
      // Check if operator accidentally or intentionally scanned a new shelf location barcode
      try {
        const locRes = await api.get(`/api/locations/by-code/${encodeURIComponent(bCode)}`);
        if (locRes.data && locRes.data.code) {
          setScannedLocation(locRes.data);
          setBatchInput('');
          setSuccess(`Active destination shelf switched to ${locRes.data.code} (Shelf is ${keepShelfLocked ? 'LOCKED' : 'UNLOCKED'})`);
          return;
        }
      } catch {
        // Not a location either
      }

      setError(`Batch / Roll "${bCode}" not found in inventory.`);
      batchInputRef.current?.select();
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Step 3: Execute Assignment ────────────────────────────────────────────
  const handleConfirmAssignment = async () => {
    if (!scannedLocation || !scannedBatch) return;

    const qty = parseFloat(putAwayQty);
    if (isNaN(qty) || qty <= 0) {
      setError('Please specify a valid positive quantity.');
      return;
    }

    if (qty > scannedBatch.unassignedQty + 0.001) {
      setError(`Cannot place ${qty}. Only ${scannedBatch.unassignedQty} left unplaced at dock.`);
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await api.post('/api/locations/assign', {
        batchCode: scannedBatch.batchCode,
        locationCode: scannedLocation.code,
        quantity: qty,
      });

      const unit = getUnitLabel(scannedBatch);
      setSuccess(`Placed ${qty} ${unit} of ${scannedBatch.batchCode} on shelf ${scannedLocation.code}`);

      // Record in recent session history
      setRecentPutAways(prev => [
        {
          id: Math.random().toString(),
          batchCode: scannedBatch.batchCode,
          locationCode: scannedLocation.code,
          quantity: qty,
          unit,
          itemType: scannedBatch.itemType,
          timestamp: formatTime(new Date()),
        },
        ...prev.slice(0, 9),
      ]);

      // Refresh KPI metrics
      loadPendingQueue();

      // Clear batch and return to appropriate step
      setScannedBatch(null);
      setBatchInput('');
      setPutAwayQty('');

      if (keepShelfLocked) {
        // Shelf stays locked! Ready for the next roll immediately
        setStep('scan-batch');
      } else {
        // Reset location as well
        setScannedLocation(null);
        setLocationInput('');
        setStep('scan-location');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to place item at location.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetLocation = () => {
    setScannedLocation(null);
    setLocationInput('');
    setStep('scan-location');
    setError('');
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 50 }}>
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <MapPin size={28} /> Put Away &amp; Shelf Assignment
          </h1>
          <p className="page-subtitle">Fast direct barcode scanner mode for warehouse floor put-away</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadPendingQueue}
            disabled={loadingQueue}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={loadingQueue ? 'spinner' : ''} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/batches')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-brand)', fontWeight: 600 }}
          >
            <Layers size={15} /> View Inbound Dock Queue &rarr;
          </button>
        </div>
      </div>

      {/* ─── Top KPI Banner ──────────────────────────────────────────────── */}
      {queueStats.totalLots === 0 && !loadingQueue ? (
        <div style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}>
          <CheckCircle2 size={24} color="#15803d" />
          <div>
            <div style={{ fontWeight: 700, color: '#166534', fontSize: 15 }}>
              All Inbound Stock Placed!
            </div>
            <div style={{ fontSize: 13, color: '#15803d' }}>
              The dock staging area is completely clear — 0 lumps, packs, or boxes waiting for shelf placement.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          <div className="card" style={{ padding: '12px 18px', borderLeft: '4px solid var(--color-brand)' }}>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontWeight: 600 }}>Awaiting Put-Away (Dock)</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text-main)', marginTop: 2 }}>
              {queueStats.totalLots} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)' }}>packages</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Across all categories
            </div>
          </div>
          <div className="card" style={{ padding: '12px 18px', borderLeft: '4px solid #0284c7' }}>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontWeight: 600 }}>Unplaced Fabric</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0369a1', marginTop: 2 }}>
              {queueStats.fabricLumps} <span style={{ fontSize: 12, fontWeight: 500 }}>{queueStats.fabricLumps === 1 ? 'lump' : 'lumps'}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {queueStats.fabricMeters} meters total
            </div>
          </div>
          <div className="card" style={{ padding: '12px 18px', borderLeft: '4px solid #16a34a' }}>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontWeight: 600 }}>Unplaced Ready-Made</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#15803d', marginTop: 2 }}>
              {queueStats.readyMadePacks} <span style={{ fontSize: 12, fontWeight: 500 }}>{queueStats.readyMadePacks === 1 ? 'pack' : 'packs'}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {queueStats.readyMadePcs} pieces total
            </div>
          </div>
          <div className="card" style={{ padding: '12px 18px', borderLeft: '4px solid #d97706' }}>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontWeight: 600 }}>Unplaced Accessories</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#b45309', marginTop: 2 }}>
              {queueStats.accessoryPacks} <span style={{ fontSize: 12, fontWeight: 500 }}>{queueStats.accessoryPacks === 1 ? 'pack' : 'packs'}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {queueStats.accessoryUnits} units total
            </div>
          </div>
        </div>
      )}

      {/* ─── Feedback Alerts ─────────────────────────────────────────────── */}
      {success && (
        <div className="alert alert-success" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={18} />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* ─── DIRECT SCANNER INTERFACE ────────────────────────────────────── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '28px 32px',
        boxShadow: 'var(--shadow-sm)',
        marginBottom: 24,
      }}>
        {/* Step Progress Indicators & Simple Shelf Lock Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {[
              { key: 'scan-location', label: '1. Scan Shelf Location' },
              { key: 'scan-batch', label: '2. Scan Roll / Batch' },
              { key: 'confirm', label: '3. Confirm Put-Away' },
            ].map((s, i) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {i > 0 && <ArrowRight size={14} color="var(--color-text-muted)" />}
                <span style={{
                  padding: '6px 16px',
                  borderRadius: 20,
                  fontSize: 12.5,
                  fontWeight: step === s.key ? 700 : 500,
                  background: step === s.key ? 'var(--color-brand)' : 'transparent',
                  color: step === s.key ? '#fff' : 'var(--color-text-muted)',
                  border: step === s.key ? 'none' : '1px solid var(--color-border)',
                }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          {/* Simple Lock / Unlock Icon Button */}
          <button
            type="button"
            onClick={() => setKeepShelfLocked(!keepShelfLocked)}
            className="btn btn-ghost btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 6,
              background: keepShelfLocked ? '#f0fdf4' : '#f8fafc',
              color: keepShelfLocked ? '#15803d' : '#6b7280',
              border: `1px solid ${keepShelfLocked ? '#86efac' : 'var(--color-border)'}`,
              cursor: 'pointer',
            }}
            title={keepShelfLocked ? "Shelf is locked (retains shelf for next roll). Click to unlock." : "Shelf is unlocked (resets after each roll). Click to lock."}
          >
            {keepShelfLocked ? <Lock size={15} color="#15803d" /> : <Unlock size={15} color="#6b7280" />}
            <span>{keepShelfLocked ? 'Shelf Locked' : 'Shelf Unlocked'}</span>
          </button>
        </div>

        {/* ─── STEP 1: Scan Target Shelf Location ──────────────────────────── */}
        {step === 'scan-location' && (
          <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--color-bg-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <ScanLine size={28} color="var(--color-brand)" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Scan Target Shelf Barcode</h2>
            <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', marginBottom: 20 }}>
              Scan rack position (e.g. <code>A-B1-L1-P1</code>) or floor bay (e.g. <code>FR-01</code>)
            </p>

            <form onSubmit={e => { e.preventDefault(); handleScanLocation(); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input
                ref={locationInputRef}
                className="form-input"
                placeholder="Scan Shelf Barcode..."
                value={locationInput}
                onChange={e => setLocationInput(e.target.value.toUpperCase())}
                style={{
                  height: 54,
                  fontSize: 18,
                  fontWeight: 700,
                  textAlign: 'center',
                  letterSpacing: 1.5,
                  fontFamily: 'monospace',
                }}
                autoFocus
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || !locationInput.trim()}
                style={{ height: 46, fontSize: 15, fontWeight: 700, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
              >
                {isSubmitting ? <span className="spinner" /> : <><Check size={16} /> Confirm Location</>}
              </button>
            </form>
          </div>
        )}

        {/* ─── STEP 2: Scan Batch / Roll Barcode ───────────────────────────── */}
        {step === 'scan-batch' && scannedLocation && (
          <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
            {/* Simple Active Shelf Bar with Lock/Unlock Icon */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              background: '#f8fafc',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '6px 14px',
              marginBottom: 20,
            }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Shelf:</span>
              <strong style={{ fontSize: 16, fontFamily: 'monospace', color: 'var(--color-text-main)' }}>
                {scannedLocation.code}
              </strong>

              {/* Simple Lock / Unlock Icon Toggle */}
              <button
                type="button"
                onClick={() => setKeepShelfLocked(!keepShelfLocked)}
                className="btn btn-ghost btn-sm"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 4,
                  background: keepShelfLocked ? '#dcfce7' : '#f3f4f6',
                  color: keepShelfLocked ? '#15803d' : '#6b7280',
                  border: `1px solid ${keepShelfLocked ? '#86efac' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                }}
                title={keepShelfLocked ? "Shelf is locked. Click to unlock." : "Shelf is unlocked. Click to lock."}
              >
                {keepShelfLocked ? <Lock size={13} color="#15803d" /> : <Unlock size={13} color="#6b7280" />}
                <span>{keepShelfLocked ? 'Locked' : 'Unlocked'}</span>
              </button>

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleResetLocation}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  padding: '3px 6px',
                }}
                title="Change shelf location"
              >
                <ArrowRightLeft size={13} /> Change
              </button>
            </div>

            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--color-bg-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <ScanLine size={28} color="var(--color-brand)" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Scan Roll / Batch Barcode</h2>
            <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', marginBottom: 20 }}>
              Scan the physical barcode on the arriving roll or box
            </p>

            <form onSubmit={e => { e.preventDefault(); handleScanBatch(); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input
                ref={batchInputRef}
                className="form-input"
                placeholder="Scan Roll Barcode..."
                value={batchInput}
                onChange={e => setBatchInput(e.target.value.toUpperCase())}
                style={{
                  height: 54,
                  fontSize: 18,
                  fontWeight: 700,
                  textAlign: 'center',
                  letterSpacing: 1.5,
                  fontFamily: 'monospace',
                }}
                autoFocus
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || !batchInput.trim()}
                style={{ height: 46, fontSize: 15, fontWeight: 700, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
              >
                {isSubmitting ? <span className="spinner" /> : <><Check size={16} /> Confirm Batch</>}
              </button>
            </form>
          </div>
        )}

        {/* ─── STEP 3: Confirm Placement ───────────────────────────────────── */}
        {step === 'confirm' && scannedLocation && scannedBatch && (
          <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Verify &amp; Confirm Placement</h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>
              Confirm shelf placement details and assign stock
            </p>

            {/* Target Shelf (with simple lock/unlock icon) and Batch Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ background: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Target Shelf
                  </span>
                  <button
                    type="button"
                    onClick={() => setKeepShelfLocked(!keepShelfLocked)}
                    className="btn btn-ghost btn-sm"
                    style={{ 
                      padding: '2px 6px', 
                      fontSize: 11, 
                      fontWeight: 600, 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 4, 
                      height: 22, 
                      color: keepShelfLocked ? '#15803d' : '#6b7280', 
                      background: keepShelfLocked ? '#dcfce7' : '#f3f4f6',
                      borderRadius: 4
                    }}
                    title="Click to toggle shelf lock"
                  >
                    {keepShelfLocked ? <Lock size={12} /> : <Unlock size={12} />}
                    <span>{keepShelfLocked ? 'Locked' : 'Unlocked'}</span>
                  </button>
                </div>
                <strong style={{ fontSize: 17, color: 'var(--color-text-main)', fontFamily: 'monospace' }}>
                  {scannedLocation.code}
                </strong>
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', textAlign: 'left' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 2 }}>
                  Batch / Roll
                </span>
                <strong style={{ fontSize: 17, color: 'var(--color-text-main)', fontFamily: 'monospace' }}>
                  {scannedBatch.batchCode}
                </strong>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
                  Available: {scannedBatch.unassignedQty} {getUnitLabel(scannedBatch)}
                </div>
              </div>
            </div>

            {/* Item Details Box */}
            <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 8, padding: '14px 18px', textAlign: 'left', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{scannedBatch.name || `${scannedBatch.brand || ''} ${scannedBatch.quality || ''}`.trim() || 'Item'}</strong>
                  {scannedBatch.status === 'PARTIALLY_USED' && (
                    <span className="badge badge-warning" style={{ fontSize: 11, padding: '2px 8px' }}>
                      Cut Remainder
                    </span>
                  )}
                </div>
                <span className={`badge ${scannedBatch.itemType === 'FABRIC' ? 'badge-primary' : scannedBatch.itemType === 'READY_MADE' ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: 11 }}>
                  {scannedBatch.itemType.replace(/_/g, ' ')}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                {scannedBatch.itemType === 'FABRIC' ? (
                  <>Shade: <strong>{scannedBatch.shade || '—'}</strong> · Quality: <strong>{scannedBatch.quality || '—'}</strong></>
                ) : scannedBatch.itemType === 'READY_MADE' ? (
                  <>Art No: <strong>{scannedBatch.artNo || '—'}</strong> · Size: <strong>{scannedBatch.size || '—'}</strong></>
                ) : (
                  <>Spec / Color: <strong>{scannedBatch.shade || '—'}</strong></>
                )}
                {scannedBatch.transactions?.[0]?.notes && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#b45309', fontWeight: 600 }}>
                    {scannedBatch.transactions[0].notes}
                  </div>
                )}
              </div>
            </div>

            {/* Quantity Input */}
            <div style={{ marginBottom: 24, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>
                  Quantity to Place ({getUnitLabel(scannedBatch)})
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPutAwayQty(String(scannedBatch.unassignedQty))}
                  style={{ fontSize: 11.5, padding: '2px 8px', color: 'var(--color-brand)', fontWeight: 600 }}
                >
                  Max ({scannedBatch.unassignedQty})
                </button>
              </div>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0.001"
                max={scannedBatch.unassignedQty}
                className="form-input"
                value={putAwayQty}
                onChange={e => setPutAwayQty(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConfirmAssignment()}
                style={{ height: 48, fontSize: 20, fontWeight: 800, textAlign: 'center' }}
                autoFocus
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setStep('scan-batch');
                  setScannedBatch(null);
                  setBatchInput('');
                }}
                style={{ padding: '0 20px', height: 46 }}
              >
                Back
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmAssignment}
                disabled={isSubmitting}
                style={{ padding: '0 32px', height: 46, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {isSubmitting ? <span className="spinner" /> : <><CheckCircle2 size={18} /> Confirm Put-Away</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── RECENT PUT-AWAYS IN THIS SESSION ────────────────────────────── */}
      {recentPutAways.length > 0 && (
        <div className="card" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={16} /> Recently Put Away in this Session
            </h3>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {recentPutAways.length} items placed
            </span>
          </div>

          <div className="table-wrapper" style={{ border: 'none' }}>
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Roll / Batch Code</th>
                  <th>Placed Shelf Location</th>
                  <th>Quantity Placed</th>
                  <th>Time</th>
                  <th style={{ textAlign: 'right' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentPutAways.map(r => (
                  <tr key={r.id}>
                    <td>
                      <code style={{ fontWeight: 700, color: 'var(--color-brand)' }}>{r.batchCode}</code>
                    </td>
                    <td>
                      <strong style={{ fontFamily: 'monospace', color: 'var(--color-text-main)' }}>{r.locationCode}</strong>
                    </td>
                    <td>
                      <strong>{r.quantity} {r.unit}</strong>
                    </td>
                    <td className="text-muted text-xs">{r.timestamp}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="badge badge-success" style={{ fontSize: 11 }}>
                        <Check size={11} style={{ marginRight: 4 }} /> Placed
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
