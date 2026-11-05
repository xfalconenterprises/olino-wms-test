import { useRef, useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { formatTime } from '../../../utils/format';
import { formatTotals, unitLabel, uomOf } from '../../../utils/units';
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
import SpecLine from '../../../components/Common/SpecLine';
import { CameraScanButton } from '../../../components/Common/CameraScan';
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
  qualityName?: string | null;
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
  // Locked: the shelf stays chosen for the next roll. Every newly scanned shelf starts unlocked.
  const [keepShelfLocked, setKeepShelfLocked] = useState(false);

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

  const getUnitLabel = (item: { uom?: string | null; itemType?: string }) => unitLabel(uomOf(item));

  // ─── Step 1: Confirm Location ──────────────────────────────────────────────
  const handleScanLocation = async (scanned = locationInput) => {
    const loc = scanned.trim().toUpperCase();
    if (!loc) return;

    setIsSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.get(`/api/locations/by-code/${encodeURIComponent(loc)}`);
      setScannedLocation(res.data);
      setKeepShelfLocked(false);
      setStep('scan-batch');
    } catch {
      setError(`Location "${loc}" not found in system. Verify rack barcode.`);
      locationInputRef.current?.select();
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Step 2: Confirm Batch ─────────────────────────────────────────────────
  const handleScanBatch = async (scanned = batchInput) => {
    const bCode = scanned.trim().toUpperCase();
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
          setKeepShelfLocked(false);
          setBatchInput('');
          setSuccess(`Shelf changed to ${locRes.data.code}`);
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

  // The scanner types into whichever box has focus, so it goes straight back to the scan box
  const toggleShelfLock = () => {
    setKeepShelfLocked(locked => !locked);
    if (step === 'scan-batch') batchInputRef.current?.focus();
    else if (step === 'confirm') confirmBtnRef.current?.focus();
  };

  const handleResetLocation = () => {
    setKeepShelfLocked(false);
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
              {queueStats.fabricKg > 0 ? `${formatTotals([{ uom: 'METERS', quantity: queueStats.fabricMeters }, { uom: 'KG', quantity: queueStats.fabricKg }].filter(t => t.quantity > 0))} total` : `${queueStats.fabricMeters} meters total`}
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
      <div className="card putaway-panel">
        {/* Steps: what has been scanned so far */}
        <ol className="putaway-steps">
          {([
            { key: 'scan-location', label: 'Scan shelf', value: scannedLocation?.code },
            { key: 'scan-batch', label: 'Scan roll', value: step === 'confirm' ? scannedBatch?.batchCode : undefined },
            { key: 'confirm', label: 'Confirm', value: undefined },
          ] as const).map((s, i, all) => {
            const current = all.findIndex(x => x.key === step);
            const state = i < current ? 'is-done' : i === current ? 'is-current' : '';
            return (
              <li key={s.key} className={`putaway-step ${state}`}>
                <span className="putaway-step-dot">{i < current ? <Check size={16} /> : i + 1}</span>
                <span className="putaway-step-text">
                  {s.label}
                  {i < current && s.value && <strong>{s.value}</strong>}
                </span>
              </li>
            );
          })}
        </ol>

        {/* The chosen shelf, with lock and change, once one has been scanned */}
        {step !== 'scan-location' && scannedLocation && (
          <>
            <div className="putaway-shelf">
              <div className="putaway-shelf-code">
                <MapPin size={20} />
                <span>Shelf</span>
                <strong>{scannedLocation.code}</strong>
              </div>
              <div className="putaway-shelf-actions">
                <button type="button" className={`btn putaway-lock${keepShelfLocked ? ' is-on' : ''}`} aria-pressed={keepShelfLocked}
                  onClick={toggleShelfLock}>
                  {keepShelfLocked ? <Lock size={16} /> : <Unlock size={16} />}
                  {keepShelfLocked ? 'Shelf locked' : 'Lock shelf'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleResetLocation}>
                  <ArrowRightLeft size={16} /> Change shelf
                </button>
              </div>
            </div>
            <p className="putaway-shelf-hint">
              {keepShelfLocked
                ? `Locked: after each roll, the next one goes to ${scannedLocation.code} without scanning the shelf again.`
                : 'Lock the shelf to place several rolls on it without scanning it each time.'}
            </p>
          </>
        )}

        {/* ─── STEP 1: Scan the shelf ───────────────────────────────────────── */}
        {step === 'scan-location' && (
          <form className="putaway-scan" onSubmit={e => { e.preventDefault(); handleScanLocation(); }}>
            <div className="putaway-scan-icon"><ScanLine size={30} /></div>
            <h2>Scan the shelf barcode</h2>
            <p>Rack position like <code>A-B1-L1-P1</code>, or floor spot like <code>FR-01</code></p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={locationInputRef}
                className="form-input putaway-input"
                placeholder="Shelf barcode"
                aria-label="Shelf barcode"
                value={locationInput}
                onChange={e => setLocationInput(e.target.value.toUpperCase())}
                autoComplete="off"
                autoFocus
              />
              <CameraScanButton size={60} title="Scan the shelf with the camera"
                onScan={code => { setLocationInput(code.toUpperCase()); handleScanLocation(code); }} />
            </div>
            <button type="submit" className="btn btn-primary putaway-go" disabled={isSubmitting || !locationInput.trim()}>
              {isSubmitting ? <span className="spinner" /> : <><Check size={18} /> Confirm shelf</>}
            </button>
          </form>
        )}

        {/* ─── STEP 2: Scan the roll ────────────────────────────────────────── */}
        {step === 'scan-batch' && scannedLocation && (
          <form className="putaway-scan" onSubmit={e => { e.preventDefault(); handleScanBatch(); }}>
            <div className="putaway-scan-icon"><ScanLine size={30} /></div>
            <h2>Scan the roll barcode</h2>
            <p>The barcode label on the roll, pack or box</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={batchInputRef}
                className="form-input putaway-input"
                placeholder="Roll barcode"
                aria-label="Roll barcode"
                value={batchInput}
                onChange={e => setBatchInput(e.target.value.toUpperCase())}
                autoComplete="off"
                autoFocus
              />
              <CameraScanButton size={60} title="Scan the roll with the camera"
                onScan={code => { setBatchInput(code.toUpperCase()); handleScanBatch(code); }} />
            </div>
            <button type="submit" className="btn btn-primary putaway-go" disabled={isSubmitting || !batchInput.trim()}>
              {isSubmitting ? <span className="spinner" /> : <><Check size={18} /> Confirm roll</>}
            </button>
          </form>
        )}

        {/* ─── STEP 3: Confirm ──────────────────────────────────────────────── */}
        {step === 'confirm' && scannedLocation && scannedBatch && (
          <div className="putaway-confirm">
            <div className="putaway-route">
              <div className="putaway-route-item">
                <span>Roll</span>
                <strong>{scannedBatch.batchCode}</strong>
                <small>{scannedBatch.unassignedQty} {getUnitLabel(scannedBatch)} to place</small>
              </div>
              <ArrowRight size={22} className="putaway-route-arrow" />
              <div className="putaway-route-item">
                <span>Shelf</span>
                <strong>{scannedLocation.code}</strong>
              </div>
            </div>

            {/* Item Details Box */}
            <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '14px 18px', textAlign: 'left', marginBottom: 18 }}>
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
                <SpecLine separator="·" separatorStyle={{ margin: '0 4px' }} specs={scannedBatch.itemType === 'FABRIC' ? [
                  ['Shade', scannedBatch.shade],
                  ['Quality', scannedBatch.quality],
                  ['Quality Name', scannedBatch.qualityName],
                ] : scannedBatch.itemType === 'READY_MADE' ? [
                  ['Art No', scannedBatch.artNo],
                  ['Size', scannedBatch.size],
                ] : [
                  ['Spec / Color', scannedBatch.shade],
                ]} />
                {scannedBatch.transactions?.[0]?.notes && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#b45309', fontWeight: 600 }}>
                    {scannedBatch.transactions[0].notes}
                  </div>
                )}
              </div>
            </div>

            {/* Quantity Input */}
            <div style={{ marginBottom: 20, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>
                  Quantity to place ({getUnitLabel(scannedBatch)})
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPutAwayQty(String(scannedBatch.unassignedQty))}
                  style={{ fontSize: 12.5, padding: '2px 10px', color: 'var(--color-brand)', fontWeight: 600 }}
                >
                  Place all ({scannedBatch.unassignedQty} {getUnitLabel(scannedBatch)})
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

            <div className="putaway-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setStep('scan-batch');
                  setScannedBatch(null);
                  setBatchInput('');
                }}
              >
                Back
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmAssignment}
                disabled={isSubmitting}
              >
                {isSubmitting ? <span className="spinner" /> : <><CheckCircle2 size={18} /> Confirm put-away</>}
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
