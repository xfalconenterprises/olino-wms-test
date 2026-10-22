import { useState, useEffect, useRef } from 'react';
import api from '../../../utils/api';
import { useAuth } from '../../../hooks/useAuth';
import { hasPermission } from '../../../utils/roles';
import { 
  LogOut, 
  Plus, 
  ArrowLeft,
  ArrowRight,
  Printer, 
  CheckCircle2, 
  Trash2, 
  AlertTriangle, 
  PackageCheck, 
  MapPin, 
  Scan, 
  Scissors, 
  X, 
  Clock, 
  Boxes,
  Package,
  ExternalLink,
  Users
} from 'lucide-react';
import { printTSPL } from '../../../utils/printer';
import { formatDateTime } from '../../../utils/format';
import { allowsDecimals, formatQty, formatTotals, unitLabel, uomOf } from '../../../utils/units';
import { QuickAddClientModal } from '../../../components/Common/QuickAddModals';
import '../../../styles/components.css';

interface DeliveryChallan {
  id: string;
  challanNumber: string;
  customerName: string;
  destination: string | null;
  status: 'DRAFT' | 'DISPATCHED' | 'CANCELLED';
  createdAt: string;
  _count?: { lines: number };
  lines?: DeliveryChallanLine[];
}

interface DeliveryChallanLine {
  id: string;
  batchId: string;
  quantity: number;
  isPartialCut: boolean;
  cutReference?: string | null;
  earmarkedFor?: string | null;
  earmarkOverride?: string | null;
  batch: {
    batchCode: string;
    quantity: number;
    itemType: 'FABRIC' | 'READY_MADE' | 'ACCESSORY';
    brand?: string | null;
    quality?: string | null;
    qualityName?: string | null;
    shade?: string | null;
    size?: string | null;
    name?: string | null;
    artNo?: string | null;
    category?: string | null;
    uom?: string | null;
    clientId?: string | null;
    clientName?: string | null;
  };
}

export default function ExitGatePage() {
  const scanInputRef = useRef<HTMLInputElement>(null);
  const cutInputRef = useRef<HTMLInputElement>(null);

  const [draftChallans, setDraftChallans] = useState<DeliveryChallan[]>([]);
  const [activeDC, setActiveDC] = useState<DeliveryChallan | null>(null);
  
  // New DC Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState('');
  const [newDestination, setNewDestination] = useState('');
  
  // Scanning state
  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');

  // Quantity / Partial Cut Modal
  const [scannedBatch, setScannedBatch] = useState<any | null>(null);
  const [cutMode, setCutMode] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [cutQty, setCutQty] = useState('');

  // Stock reserved for another client: only supervisors may release it, with a reason
  const { user } = useAuth();
  const canRelease = hasPermission(user, 'ops.release_earmark');
  const [releaseReason, setReleaseReason] = useState('');
  const [earmarkBlock, setEarmarkBlock] = useState<string | null>(null);
  useEffect(() => { setReleaseReason(''); setEarmarkBlock(null); }, [scannedBatch]);
  const reservedFor: string | null = (() => {
    if (earmarkBlock) return earmarkBlock;
    const client = scannedBatch?.clientName?.trim();
    if (!client || !activeDC?.customerName) return null;
    return client.toLowerCase() === activeDC.customerName.trim().toLowerCase() ? null : client;
  })();

  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Customer Directory for auto-suggest
  interface CustomerDirectoryEntry {
    customerName: string;
    destination: string | null;
    address?: string | null;
    phone?: string | null;
    code?: string | null;
    clientType?: string | null;
    clientId?: string;
  }
  const [customerDirectory, setCustomerDirectory] = useState<CustomerDirectoryEntry[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [printingBatch, setPrintingBatch] = useState<string | null>(null);

  // Quick Add Client Modal State
  const [showQuickAddClientModal, setShowQuickAddClientModal] = useState(false);
  const [quickClientInitial, setQuickClientInitial] = useState({ name: '', type: '', city: '' });

  const openQuickAddClient = (initialName?: string, initialType?: string) => {
    setQuickClientInitial({ name: initialName || newCustomer.trim(), type: initialType || '', city: newDestination.trim() });
    setShowQuickAddClientModal(true);
  };

  const handleQuickClientCreated = (newCli: any) => {
    const newEntry: CustomerDirectoryEntry = {
      customerName: newCli.name,
      destination: newCli.city || newCli.address || null,
      address: newCli.address || null,
      phone: newCli.phone || null,
      code: newCli.code || null,
      clientType: newCli.clientType || null,
      clientId: newCli.id
    };
    setCustomerDirectory(prev => [newEntry, ...prev.filter(c => c.customerName.toLowerCase() !== newCli.name.toLowerCase())]);
    setNewCustomer(newCli.name);
    setNewDestination(newCli.city || newCli.address || '');
    setSelectedCustomerId(newCli.id);
    setShowQuickAddClientModal(false);
  };

  useEffect(() => {
    fetchDraftChallans();
    fetchCustomerDirectory();
  }, []);

  const fetchCustomerDirectory = async () => {
    try {
      const res = await api.get('/api/delivery-challans/customers');
      setCustomerDirectory(res.data || []);
    } catch (e) {
      console.error('Failed to load customer directory:', e);
    }
  };

  const handlePrintSingleBatch = async (batchCode: string, remQty?: number) => {
    setPrintingBatch(batchCode);
    try {
      await printTSPL(batchCode, undefined, remQty !== undefined ? { quantity: remQty, isRemainder: true } : undefined);
      alert(`Remainder label ${remQty !== undefined ? `(${remQty} remaining) ` : ''}for ${batchCode} sent to thermal barcode printer!`);
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || 'Failed to print remainder label.');
    } finally {
      setPrintingBatch(null);
    }
  };

  const fetchDraftChallans = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/delivery-challans');
      const drafts = (res.data || []).filter((dc: DeliveryChallan) => dc.status === 'DRAFT');
      setDraftChallans(drafts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const resetScanState = () => {
    setScannedBatch(null);
    setScanCode('');
    setScanError('');
    setCutQty('');
    setCutMode('FULL');
    setSuccessMsg('');
  };

  const loadDC = async (id: string) => {
    resetScanState();
    try {
      const res = await api.get(`/api/delivery-challans/${id}`);
      setActiveDC(res.data);
      setTimeout(() => scanInputRef.current?.focus(), 150);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateDC = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.trim()) return;

    const match = customerDirectory.find(c => c.customerName.trim().toLowerCase() === newCustomer.trim().toLowerCase());
    const destinationToSend = newDestination.trim() || match?.destination || match?.address || undefined;

    try {
      const res = await api.post('/api/delivery-challans', {
        customerName: newCustomer.trim(),
        customerId: selectedCustomerId || match?.clientId || undefined,
        destination: destinationToSend
      });
      setShowNewModal(false);
      setNewCustomer('');
      setNewDestination('');
      setSelectedCustomerId(null);
      resetScanState();
      await loadDC(res.data.id);
    } catch (e) {
      console.error(e);
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanCode.trim().toUpperCase();
    if (!code || !activeDC) return;
    setScanError('');
    setScanning(true);

    try {
      const res = await api.get(`/api/batches/by-code/${encodeURIComponent(code)}`);
      const batch = res.data;
      
      if (batch.status === 'OUT' || batch.quantity <= 0) {
        setScanError(`SKU "${code}" is depleted / out of stock.`);
        setScanning(false);
        return;
      }

      if (batch.status === 'QC_HOLD') {
        setScanError(`Batch "${code}" is currently under QC Hold (Quarantine) and cannot be dispatched.`);
        setScanning(false);
        return;
      }

      if (activeDC.lines?.some(l => l.batch.batchCode === batch.batchCode)) {
        setScanError(`SKU "${code}" is already added to this Challan.`);
        setScanning(false);
        return;
      }

      // Open quantity modal
      setScannedBatch(batch);
      setCutMode('FULL');
      setCutQty(String(batch.quantity));
      setScanCode('');
      setTimeout(() => cutInputRef.current?.focus(), 150);
    } catch {
      setScanError(`SKU Code "${code}" not found in inventory.`);
    } finally {
      setScanning(false);
    }
  };

  const handleAddLine = async () => {
    if (!scannedBatch || !activeDC) return;
    const numQty = parseFloat(cutQty);
    if (isNaN(numQty) || numQty <= 0 || numQty > scannedBatch.quantity + 0.001) {
      setScanError('Please enter a valid quantity within available stock.');
      return;
    }

    setScanError('');
    try {
      await api.post(`/api/delivery-challans/${activeDC.id}/lines`, {
        batchCode: scannedBatch.batchCode,
        quantity: numQty,
        earmarkOverride: reservedFor ? releaseReason.trim() || undefined : undefined,
      });
      setScannedBatch(null);
      await loadDC(activeDC.id);
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.code === 'EARMARKED') setEarmarkBlock(data.reservedFor);
      setScanError(data?.error || 'Failed to add SKU to shipment');
    }
  };

  const handleRemoveLine = async (lineId: string) => {
    if (!activeDC) return;
    try {
      await api.delete(`/api/delivery-challans/${activeDC.id}/lines/${lineId}`);
      await loadDC(activeDC.id);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleDispatch = async () => {
    if (!activeDC || !window.confirm(`Are you sure you want to finalize dispatch for ${activeDC.challanNumber}?`)) return;
    setDispatching(true);
    try {
      await api.post(`/api/delivery-challans/${activeDC.id}/dispatch`);
      setSuccessMsg(`Successfully dispatched ${activeDC.challanNumber}!`);
      await loadDC(activeDC.id);
      fetchDraftChallans();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Dispatch failed');
    } finally {
      setDispatching(false);
    }
  };

  const handleDeleteDC = async (id: string, challanNumber: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete draft ${challanNumber}? Any scanned items will remain in inventory.`)) {
      return;
    }

    try {
      await api.delete(`/api/delivery-challans/${id}`);
      if (activeDC?.id === id) {
        setActiveDC(null);
        resetScanState();
      }
      fetchDraftChallans();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete draft challan');
    }
  };

  const handlePrintA4 = async () => {
    if (!activeDC) return;
    try {
      const printWindow = window.open('', '_blank', 'width=900,height=900');
      if (printWindow) {
        printWindow.document.write('<div style="font-family:sans-serif;padding:40px;text-align:center;color:#64748b;">Loading print preview...</div>');
      }
      const response = await api.get(`/api/delivery-challans/${activeDC.id}/print`, { responseType: 'text' });
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(response.data);
        printWindow.document.close();
      }
    } catch {
      alert('Failed to generate print document');
    }
  };

  const handlePrintPartialLabels = async () => {
    if (!activeDC) return;
    const partialLines = activeDC.lines?.filter(l => l.isPartialCut) || [];
    if (partialLines.length === 0) {
      alert("No partial cuts in this shipment!");
      return;
    }

    try {
      for (const line of partialLines) {
        const remQty = activeDC.status === 'DRAFT'
          ? Math.max(0, parseFloat((line.batch.quantity - line.quantity).toFixed(2)))
          : line.batch.quantity;
        await printTSPL(line.batch.batchCode, undefined, { quantity: remQty, isRemainder: true });
      }
      alert('Remainder roll label(s) sent to thermal barcode printer!');
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.error || err.message || 'Failed to print labels. Check printer network connection.');
    }
  };

  // Calculations for active DC
  // Fabric totals per unit (meters and kg are never added together)
  const fabricLines = activeDC?.lines?.filter(l => l.batch.itemType === 'FABRIC') || [];
  const totalFabricText = formatTotals(fabricLines.map(l => ({ uom: uomOf(l.batch), quantity: l.quantity })));
  const totalReadyMade = activeDC?.lines?.reduce((sum, l) => l.batch.itemType === 'READY_MADE' ? sum + l.quantity : sum, 0) || 0;
  const totalAccessories = activeDC?.lines?.reduce((sum, l) => l.batch.itemType === 'ACCESSORY' ? sum + l.quantity : sum, 0) || 0;
  const partialCutCount = activeDC?.lines?.filter(l => l.isPartialCut).length || 0;

  // ─── 1. PACKING / DISPATCH TERMINAL VIEW ───────────────────────────────────
  if (activeDC) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 0' }}>
        {/* Navigation & Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <button 
            className="btn btn-ghost" 
            onClick={() => { setActiveDC(null); resetScanState(); fetchDraftChallans(); }} 
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', fontWeight: 600 }}
          >
            <ArrowLeft size={16} /> Back to Dispatch Terminal
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {activeDC.status === 'DRAFT' && (
              <button
                className="btn btn-ghost"
                onClick={() => handleDeleteDC(activeDC.id, activeDC.challanNumber)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)', padding: '6px 12px', fontSize: 13, fontWeight: 600 }}
                title="Discard & Delete Draft Challan"
              >
                <Trash2 size={14} /> Delete Draft
              </button>
            )}
            <span className={`badge ${activeDC.status === 'DISPATCHED' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 13, padding: '6px 14px', fontWeight: 700 }}>
              {activeDC.status === 'DRAFT' ? 'DRAFT · PACKING' : 'DISPATCHED'}
            </span>
          </div>
        </div>

        {/* Challan Info Card */}
        <div style={{ 
          background: '#fff', 
          border: '1px solid var(--color-border)', 
          borderRadius: 'var(--radius-lg)', 
          padding: '20px 24px', 
          marginBottom: 20, 
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <code style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-brand)', background: 'var(--color-brand-faded)', padding: '3px 10px', borderRadius: 4 }}>
                {activeDC.challanNumber}
              </code>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)' }}>
              Customer: <span style={{ color: 'var(--color-brand)' }}>{activeDC.customerName}</span>
            </div>
            {activeDC.destination && (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <MapPin size={14} color="var(--color-brand)" /> Destination: {activeDC.destination}
              </div>
            )}
          </div>

          {/* Running Totals Stats */}
          <div style={{ display: 'flex', gap: 16, background: 'var(--color-bg-subtle)', padding: '12px 18px', borderRadius: 'var(--radius-md)' }}>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Packed Items</span>
              <strong style={{ fontSize: 18, color: 'var(--color-text-main)' }}>{activeDC.lines?.length || 0}</strong>
            </div>
            {fabricLines.length > 0 && (
              <div style={{ textAlign: 'center', borderLeft: '1px solid var(--color-border)', paddingLeft: 16 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Total Fabric</span>
                <strong style={{ fontSize: 18, color: 'var(--color-brand)' }}>{totalFabricText}</strong>
              </div>
            )}
            {totalReadyMade > 0 && (
              <div style={{ textAlign: 'center', borderLeft: '1px solid var(--color-border)', paddingLeft: 16 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Ready-Made</span>
                <strong style={{ fontSize: 18, color: 'var(--color-success)' }}>{totalReadyMade} pcs</strong>
              </div>
            )}
            {totalAccessories > 0 && (
              <div style={{ textAlign: 'center', borderLeft: '1px solid var(--color-border)', paddingLeft: 16 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Accessories</span>
                <strong style={{ fontSize: 18, color: '#d97706' }}>{totalAccessories} units</strong>
              </div>
            )}
          </div>
        </div>

        {/* Success Dispatch Alert with Action Buttons */}
        {successMsg && (
          <div className="alert alert-success" style={{ marginBottom: 20, padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={24} style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ fontSize: 15, display: 'block' }}>Shipment Finalized & Dispatched!</strong>
                <span style={{ fontSize: 13 }}>
                  Inventory quantities deducted and Delivery Challan recorded in registry.
                  {partialCutCount > 0 && (
                    <span style={{ display: 'block', marginTop: 4, color: '#047857', fontWeight: 600 }}>
                      Notice: {partialCutCount} remainder roll(s) moved to Inbound Dock / Put-Away queue. Re-shelf to original rack or cut-piece bin via Put Away.
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={handlePrintA4} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Printer size={16} /> Print A4 Challan
              </button>
              {partialCutCount > 0 && (
                <>
                  <button className="btn btn-secondary" onClick={handlePrintPartialLabels} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Printer size={16} /> Print Remainder Labels ({partialCutCount})
                  </button>
                  <a href="/put-away" className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                    <MapPin size={15} /> Put Away Remainder Rolls &rarr;
                  </a>
                </>
              )}
            </div>
          </div>
        )}

        {/* High-Visibility Barcode Scanner Bar */}
        {activeDC.status === 'DRAFT' && (
          <div style={{ 
            background: '#fff', 
            border: '1px solid var(--color-border)', 
            borderRadius: 'var(--radius-lg)', 
            padding: 20, 
            marginBottom: 24,
            boxShadow: 'var(--shadow-sm)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Scan size={18} color="var(--color-brand)" />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-main)' }}>
                Scan SKU Barcode to Pack Item
              </span>
            </div>
            <form onSubmit={handleScan} style={{ display: 'flex', gap: 10 }}>
              <input
                ref={scanInputRef}
                type="text"
                className="form-input"
                placeholder="Point barcode gun or type SKU Code (e.g. SIY-SUIT-NVY-0001)..."
                value={scanCode}
                onChange={e => { setScanCode(e.target.value); setScanError(''); }}
                disabled={scanning}
                style={{ 
                  height: 48, 
                  fontSize: 16, 
                  fontFamily: 'monospace', 
                  background: '#fff', 
                  border: '1px solid var(--color-border)',
                  paddingLeft: 16,
                  fontWeight: 600
                }}
                autoFocus
              />
              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={scanning || !scanCode.trim()} 
                style={{ height: 48, padding: '0 24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {scanning ? <span className="spinner" /> : <Plus size={18} />} {scanning ? 'Scanning...' : 'Add Item'}
              </button>
            </form>
            {scanError && (
              <div style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={15} /> {scanError}
              </div>
            )}
          </div>
        )}

        {/* Packed Items Table */}
        <div className="card" style={{ marginBottom: 24, boxShadow: 'var(--shadow-sm)' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Boxes size={18} color="var(--color-brand)" /> Packed Line Items ({activeDC.lines?.length || 0})
            </h3>
            {activeDC.status === 'DISPATCHED' && (
              <button className="btn btn-sm btn-secondary" onClick={handlePrintA4} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Printer size={14} /> Print Document
              </button>
            )}
          </div>
          
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>SKU Code</th>
                <th>Brand & Quality</th>
                <th>Color / Size</th>
                <th>Quantity to Ship</th>
                <th>Cut Status</th>
                {activeDC.status === 'DRAFT' && <th style={{ width: 60, textAlign: 'right' }}></th>}
              </tr>
            </thead>
            <tbody>
              {!activeDC.lines || activeDC.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 48 }}>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
                      No items packed yet. Scan physical SKU barcodes above to start packing.
                    </div>
                  </td>
                </tr>
              ) : (
                activeDC.lines.map((line, idx) => {
                  const lineUnit = unitLabel(uomOf(line.batch));
                  return (
                    <tr key={line.id}>
                      <td className="text-muted text-xs">{idx + 1}</td>
                      <td>
                        <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-brand)' }}>
                          {line.batch.batchCode}
                        </code>
                      </td>
                      <td>
                        <strong>{line.batch.name || line.batch.brand || 'Item'}</strong> {line.batch.quality ? `— ${line.batch.quality}` : ''}{line.batch.qualityName ? ` (${line.batch.qualityName})` : ''}
                        {line.earmarkOverride && (
                          <div style={{ marginTop: 3, fontSize: 11, color: '#92400e' }} title={line.earmarkOverride}>
                            Released from {line.earmarkedFor}: {line.earmarkOverride}
                          </div>
                        )}
                        {line.batch.clientName && (
                          <div style={{ marginTop: 3 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', background: '#eff6ff', padding: '1px 6px', borderRadius: 4, border: '1px solid #bfdbfe', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Users size={11} /> {line.batch.clientName}
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        {[line.batch.shade, line.batch.size && `Size ${line.batch.size}`].filter(Boolean).join(' · ')}
                      </td>
                      <td>
                        <strong style={{ fontSize: 14 }}>
                          {line.quantity} {lineUnit}
                        </strong>
                      </td>
                      <td>
                        {line.isPartialCut ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                                <Scissors size={12} /> Partial Cut
                              </span>
                              {line.cutReference && (
                                <span className="badge badge-info" style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>
                                  Piece: {line.cutReference}
                                </span>
                              )}
                            </div>
                            {(() => {
                              const remQty = activeDC.status === 'DRAFT'
                                ? Math.max(0, parseFloat((line.batch.quantity - line.quantity).toFixed(2)))
                                : line.batch.quantity;
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handlePrintSingleBatch(line.batch.batchCode, remQty)}
                                    disabled={printingBatch === line.batch.batchCode}
                                    title={`Print remainder barcode label (${remQty} ${lineUnit}) on thermal printer`}
                                    style={{ 
                                      fontSize: 11, 
                                      padding: '2px 7px', 
                                      display: 'inline-flex', 
                                      alignItems: 'center', 
                                      gap: 4, 
                                      color: 'var(--color-brand)',
                                      background: '#f8fafc',
                                      border: '1px solid #cbd5e1',
                                      borderRadius: 4,
                                      fontWeight: 600
                                    }}
                                  >
                                    <Printer size={12} /> Remainder Label ({remQty} {lineUnit})
                                  </button>
                                  <a
                                    href={`/api/labels/preview/${encodeURIComponent(line.batch.batchCode)}?quantity=${remQty}&isRemainder=true`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn-ghost btn-sm"
                                    title={`Preview & standard print remainder label (${remQty} ${lineUnit})`}
                                    style={{
                                      fontSize: 11,
                                      padding: '2px 6px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 3,
                                      color: 'var(--color-text-muted)',
                                      background: '#f8fafc',
                                      border: '1px solid #cbd5e1',
                                      borderRadius: 4,
                                      textDecoration: 'none'
                                    }}
                                  >
                                    <ExternalLink size={11} />
                                  </a>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <span className="badge badge-success" style={{ fontWeight: 600 }}>
                            Full Quantity
                          </span>
                        )}
                      </td>
                      {activeDC.status === 'DRAFT' && (
                        <td style={{ textAlign: 'right' }}>
                          <button 
                            className="btn btn-ghost btn-icon" 
                            onClick={() => handleRemoveLine(line.id)} 
                            title="Remove item from challan"
                            style={{ padding: 6 }}
                          >
                            <Trash2 size={16} color="var(--color-danger)" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Dispatch Action Button Bar */}
        {activeDC.status === 'DRAFT' && (
          <div style={{ 
            background: '#fff', 
            border: '1px solid var(--color-border)', 
            borderRadius: 'var(--radius-lg)', 
            padding: '16px 24px', 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <div style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>
              Ready to ship <strong>{activeDC.lines?.length || 0} items</strong> to <strong>{activeDC.customerName}</strong>
            </div>

            <button
              className="btn btn-primary"
              onClick={handleDispatch}
              disabled={dispatching || !activeDC.lines || activeDC.lines.length === 0}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                padding: '0 32px', 
                height: 48, 
                fontSize: 15, 
                fontWeight: 700 
              }}
            >
              {dispatching ? <><span className="spinner" /> Finalizing...</> : <><LogOut size={18} /> Finalize & Dispatch Shipment</>}
            </button>
          </div>
        )}

        {/* Modal: Full vs Partial Roll Cut Selector */}
        {scannedBatch && (
          <div className="modal-overlay" style={{ zIndex: 1000 }}>
            <div className="modal" style={{ maxWidth: 460 }}>
              <div className="modal-header">
                <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Scissors size={20} color="var(--color-brand)" /> Specify Dispatch Quantity
                </h3>
                <button className="btn btn-ghost btn-icon" onClick={() => setScannedBatch(null)}><X size={18} /></button>
              </div>

              <div className="modal-body">
                <div style={{ background: 'var(--color-bg-subtle)', padding: 14, borderRadius: 'var(--radius-md)', marginBottom: 18, fontSize: 13.5 }}>
                  <div style={{ marginBottom: 4 }}>
                    SKU: <code style={{ fontWeight: 700, color: 'var(--color-brand)' }}>{scannedBatch.batchCode}</code>
                  </div>
                  <div>
                    Product: <strong>{scannedBatch.name || scannedBatch.brand || 'Item'}</strong> {scannedBatch.quality ? `— ${scannedBatch.quality}` : ''}{scannedBatch.qualityName ? ` (${scannedBatch.qualityName})` : ''}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 14 }}>
                    Total In Stock: <strong style={{ color: 'var(--color-brand)' }}>
                      {formatQty(scannedBatch.quantity, uomOf(scannedBatch))}
                    </strong>
                  </div>
                </div>

                {scanError && <div className="alert alert-danger" style={{ marginBottom: 14, fontSize: 13 }}>{scanError}</div>}

                {/* Client Earmark Validation Alert */}
                {(() => {
                  const earmarkedClient = scannedBatch.clientName;
                  const isMatch = !reservedFor && earmarkedClient;
                  const isMismatch = !!reservedFor;

                  if (isMismatch) {
                    return (
                      <div style={{
                        marginBottom: 16,
                        padding: '12px 14px',
                        borderRadius: 8,
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        color: '#92400e',
                        fontSize: 13,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10
                      }}>
                        <AlertTriangle size={18} color="#b45309" style={{ marginTop: 2, flexShrink: 0 }} />
                        <div>
                          <strong style={{ display: 'block', color: '#b45309', marginBottom: 2 }}>
                            Reserved for another client
                          </strong>
                          This roll is reserved for <strong>{reservedFor}</strong>; this challan is for <strong>{activeDC.customerName}</strong>.
                          {canRelease ? (
                            <div style={{ marginTop: 8 }}>
                              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Reason for releasing it to {activeDC.customerName}</label>
                              <input className="form-input" value={releaseReason} onChange={e => setReleaseReason(e.target.value)}
                                placeholder="e.g. School A stock replaced by new order" style={{ height: 36, fontSize: 13 }} />
                            </div>
                          ) : (
                            <span style={{ display: 'block', fontSize: 12, marginTop: 6, color: '#78350f', fontWeight: 600 }}>
                              Ask a supervisor to release it, or use stock that is not reserved.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (isMatch) {
                    return (
                      <div style={{
                        marginBottom: 16,
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        color: '#166534',
                        fontSize: 12.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}>
                        <CheckCircle2 size={16} color="#16a34a" />
                        <span>
                          Matches Client Earmark: <strong>{earmarkedClient}</strong>
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div style={{
                      marginBottom: 16,
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      color: 'var(--color-text-muted)',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}>
                      <Users size={14} /> General Buffer / Free Stock (Not dedicated to any specific client)
                    </div>
                  );
                })()}

                {scannedBatch.itemType === 'FABRIC' && (
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                    <button
                      type="button"
                      className={`btn ${cutMode === 'FULL' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => { setCutMode('FULL'); setCutQty(String(scannedBatch.quantity)); }}
                      style={{ flex: 1, height: 40, fontWeight: 600 }}
                    >
                      Ship Full Roll ({formatQty(scannedBatch.quantity, uomOf(scannedBatch))})
                    </button>
                    <button
                      type="button"
                      className={`btn ${cutMode === 'PARTIAL' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => { setCutMode('PARTIAL'); setCutQty(''); setTimeout(() => cutInputRef.current?.focus(), 100); }}
                      style={{ flex: 1, height: 40, fontWeight: 600 }}
                    >
                      Cut Partial Length
                    </button>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 700 }}>
                    Quantity to Dispatch ({unitLabel(uomOf(scannedBatch))}) <span className="required">*</span>
                  </label>
                  <input
                    ref={cutInputRef}
                    type="number"
                    step={allowsDecimals(uomOf(scannedBatch)) ? 'any' : 1}
                    max={scannedBatch.quantity}
                    min={allowsDecimals(uomOf(scannedBatch)) ? 0.001 : 1}
                    className="form-input"
                    value={cutQty}
                    onChange={e => setCutQty(e.target.value)}
                    style={{ fontSize: 20, fontWeight: 700, height: 48 }}
                    autoFocus
                  />
                  <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                    {parseFloat(cutQty) < scannedBatch.quantity ? (
                      <span style={{ color: '#b45309', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Scissors size={14} /> Partial Cut: {formatQty(scannedBatch.quantity - (parseFloat(cutQty) || 0), uomOf(scannedBatch))} will remain in inventory (remainder barcode label will be generated).
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CheckCircle2 size={14} /> Full quantity will be dispatched and cleared from shelf.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setScannedBatch(null)}>Cancel</button>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  onClick={handleAddLine} 
                  disabled={!cutQty || parseFloat(cutQty) <= 0 || parseFloat(cutQty) > scannedBatch.quantity + 0.001
                    || (!!reservedFor && (!canRelease || releaseReason.trim().length < 5))}
                  style={{ fontWeight: 700, padding: '0 20px' }}
                >
                  Add to Shipment
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── 2. FLOOR DISPATCH TERMINAL (Active Drafts List) ───────────────────────
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 0' }}>
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LogOut size={28} /> Stock Out Dispatch Terminal
          </h1>
          <p className="page-subtitle">Floor packing station for customer dispatches and Delivery Challans</p>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={() => setShowNewModal(true)} 
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 22px', fontSize: 14, fontWeight: 700 }}
        >
          <Plus size={18} /> New Delivery Challan
        </button>
      </div>

      {/* Terminal Status / Drafts Card */}
      <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="var(--color-brand)" /> Active Draft Dispatches in Progress ({draftChallans.length})
          </h3>
        </div>

        {loading ? (
          <div className="loading-center" style={{ padding: 40 }}><span className="spinner spinner-lg" /></div>
        ) : draftChallans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 24px' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <PackageCheck size={36} color="var(--color-success)" />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--color-text-main)' }}>
              Dispatch Terminal is Clear!
            </h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14, maxWidth: 440, margin: '0 auto 20px', lineHeight: 1.5 }}>
              There are no active draft shipments currently being packed on the floor. Click below to start packing a new shipment.
            </p>
            <button 
              className="btn btn-primary" 
              onClick={() => setShowNewModal(true)} 
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 24px', height: 42, fontWeight: 700 }}
            >
              <Plus size={16} /> Start New Delivery Challan
            </button>
          </div>
        ) : (
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
            {draftChallans.map(dc => (
              <div 
                key={dc.id}
                style={{
                  background: '#fff',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 16,
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  boxShadow: 'var(--shadow-sm)'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-brand)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <code style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-brand)', background: 'var(--color-brand-faded)', padding: '3px 8px', borderRadius: 4 }}>
                      {dc.challanNumber}
                    </code>
                    <span className="badge badge-warning" style={{ fontWeight: 600, fontSize: 11 }}>
                      PACKING IN PROGRESS
                    </span>
                  </div>

                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)', marginBottom: 4 }}>
                    {dc.customerName}
                  </div>

                  {dc.destination && (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={14} color="var(--color-brand)" /> {dc.destination}
                    </div>
                  )}

                  <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 8 }}>
                    Started: {formatDateTime(dc.createdAt)}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Package size={15} /> {dc._count?.lines || 0} items packed
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button 
                      className="btn btn-ghost btn-icon" 
                      onClick={(e) => { e.stopPropagation(); handleDeleteDC(dc.id, dc.challanNumber); }}
                      title="Delete Draft Challan"
                      style={{ padding: 6, color: 'var(--color-danger)' }}
                    >
                      <Trash2 size={16} />
                    </button>
                    <button 
                      className="btn btn-primary" 
                      onClick={() => loadDC(dc.id)} 
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', height: 38, fontWeight: 700, fontSize: 13 }}
                    >
                      Open & Pack <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Create New Delivery Challan */}
      {showNewModal && (
        <div className="modal-overlay" style={{ zIndex: 1000 }} onClick={() => setShowNewModal(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={20} color="var(--color-brand)" /> Create New Delivery Challan
              </h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowNewModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleCreateDC}>
              <div className="modal-body">
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label" style={{ fontWeight: 700, marginBottom: 6 }}>
                    Customer / Client Name <span className="required">*</span>
                  </label>
                  
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input 
                      type="text" 
                      className="form-input" 
                      list="customer-directory-list"
                      value={newCustomer} 
                      onChange={e => {
                        const val = e.target.value;
                        setNewCustomer(val);
                        const match = customerDirectory.find(c => c.customerName.trim().toLowerCase() === val.trim().toLowerCase());
                        if (match) {
                          setSelectedCustomerId(match.clientId || null);
                          setNewDestination(match.destination || match.address || '');
                        } else {
                          setSelectedCustomerId(null);
                        }
                      }} 
                      placeholder="e.g. Al-Ameen School Uniforms, DPS"
                      style={{ height: 42, fontSize: 14, flex: 1 }}
                      required 
                      autoFocus 
                    />

                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => openQuickAddClient(newCustomer)}
                      style={{
                        height: 42,
                        width: 42,
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        borderRadius: 'var(--radius-md)',
                        background: '#f8fafc',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-brand)',
                      }}
                      title="Add New Client to Directory"
                    >
                      <Plus size={18} />
                    </button>
                  </div>

                  <datalist id="customer-directory-list">
                    {customerDirectory.map((c, idx) => (
                      <option key={idx} value={c.customerName}>
                        {c.destination ? `${c.customerName} (${c.destination})` : c.customerName}
                      </option>
                    ))}
                  </datalist>

                  {/* Warning: New Customer Alert with Quick Add Button */}
                  {newCustomer.trim() && !customerDirectory.some(c => c.customerName.trim().toLowerCase() === newCustomer.trim().toLowerCase()) && (
                    <div style={{
                      marginTop: 8,
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: '#fffbeb',
                      border: '1px solid #fef3c7',
                      color: '#b45309',
                      fontSize: 12.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertTriangle size={15} color="#d97706" style={{ flexShrink: 0 }} />
                        <span>New Client: <strong>"{newCustomer.trim()}"</strong> is not in directory.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openQuickAddClient(newCustomer.trim())}
                        className="btn btn-sm btn-secondary"
                        style={{ height: 26, padding: '0 8px', fontSize: 11, background: '#fff', whiteSpace: 'nowrap' }}
                      >
                        <Plus size={12} /> Add Client Details
                      </button>
                    </div>
                  )}

                  {/* Known Customer Match Badge */}
                  {newCustomer.trim() && customerDirectory.some(c => c.customerName.trim().toLowerCase() === newCustomer.trim().toLowerCase()) && (() => {
                    const matched = customerDirectory.find(c => c.customerName.trim().toLowerCase() === newCustomer.trim().toLowerCase());
                    return (
                      <div style={{
                        marginTop: 8,
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        color: '#15803d',
                        fontSize: 12,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <CheckCircle2 size={14} color="#16a34a" style={{ flexShrink: 0 }} />
                        <span>
                          Master Client {matched?.code ? `(${matched.code})` : ''} 
                          {matched?.clientType ? ` • ${matched.clientType}` : ''}
                          {matched?.destination ? ` • ${matched.destination}` : ''}
                          {matched?.phone ? ` • ${matched.phone}` : ''}
                        </span>
                      </div>
                    );
                  })()}
                </div>

              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowNewModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!newCustomer.trim()} style={{ fontWeight: 700, padding: '0 22px' }}>
                  Create Challan & Start Packing
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showQuickAddClientModal && (
        <QuickAddClientModal initialName={quickClientInitial.name} initialType={quickClientInitial.type} initialCity={quickClientInitial.city}
          onClose={() => setShowQuickAddClientModal(false)} onCreated={handleQuickClientCreated} />
      )}
    </div>
  );
}
