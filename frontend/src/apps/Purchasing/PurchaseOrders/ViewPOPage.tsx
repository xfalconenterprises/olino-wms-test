import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { 
  ArrowLeft, 
  Edit, 
  XCircle, 
  CheckCircle2, 
  Package, 
  Printer, 
  Trash2, 
  Lock, 
  Search, 
  Clock, 
  AlertCircle, 
  X, 
  Layers, 
  FileCheck, 
  Eye,
  Users,
  CornerDownRight
} from 'lucide-react';
import { formatDate } from '../../../utils/format';
import { allowsDecimals, fabricCategoryLabel, formatTotals, unitLabel, uomOf } from '../../../utils/units';
import { useAuth } from '../../../hooks/useAuth';
import { hasPermission } from '../../../utils/roles';
import '../../../styles/components.css';

interface POLine {
  id: string;
  orderedQty: number;
  receivedQty: number;
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
  allocations?: {
    id: string;
    clientName: string;
    allocatedQty: number;
    receivedQty: number;
    notes?: string | null;
  }[];
}

interface SupplierInfo { 
  id: string; 
  code: string; 
  name: string;
  gstin: string | null;
}

interface GRNInfo {
  id: string;
  grnNumber: string;
  invoiceRef: string | null;
  totalRolls: number;
  totalQuantity: number;
  status: string;
  createdAt: string;
  receivedBy?: { id: string; name: string } | null;
}

interface PO { 
  id: string; 
  poNumber: string; 
  supplierId?: string | null; 
  supplierName: string;
  supplier?: SupplierInfo | null;
  targetClient: string;
  notes: string; 
  status: string; 
  lines: POLine[]; 
  clientBreakdown?: Array<{
    clientName: string;
    allocatedQty: number;
    receivedQty: number;
    remainingQty: number;
    progress: number;
    uom: string;
  }>;
  grns?: GRNInfo[];
  expectedDate: string; 
  createdAt: string; 
}

export default function ViewPOPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [po, setPo] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Cancellation Modal State
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  // Line search and filtering
  const [lineSearch, setLineSearch] = useState('');
  const [lineFilter, setLineFilter] = useState<'ALL' | 'PENDING' | 'RECEIVED'>('ALL');

  const load = () => {
    setLoading(true);
    setError('');
    api.get(`/api/purchase-orders/${id}`)
       .then(r => setPo(r.data))
       .catch(err => {
         setError(err?.response?.data?.error || err?.message || 'Failed to load purchase order');
       })
       .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const sortedAndFilteredLines = useMemo(() => {
    if (!po?.lines) return [];
    let list = [...po.lines];
    const q = lineSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(l => {
        const brand = (l.brand || '').toLowerCase();
        const shade = (l.shade || '').toLowerCase();
        const quality = (l.quality || '').toLowerCase();
        const name = (l.name || '').toLowerCase();
        const artNo = (l.artNo || '').toLowerCase();
        const category = (l.category || '').toLowerCase();
        return brand.includes(q) || shade.includes(q) || quality.includes(q) || name.includes(q) || artNo.includes(q) || category.includes(q);
      });
    }

    if (lineFilter === 'PENDING') {
      list = list.filter(l => (l.orderedQty - l.receivedQty) > 0.001);
    } else if (lineFilter === 'RECEIVED') {
      list = list.filter(l => l.receivedQty >= l.orderedQty - 0.001 && l.orderedQty > 0);
    }

    return list;
  }, [po?.lines, lineSearch, lineFilter]);

  const handleOpenCancelModal = () => {
    setCancelReason('');
    setCancelError('');
    setShowCancelModal(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancelReason.trim()) {
      setCancelError('Please enter a cancellation note explaining why this order is cancelled.');
      return;
    }
    setCancelError('');
    setCancelling(true);
    try {
      await api.patch(`/api/purchase-orders/${id}`, { 
        status: 'CANCELLED',
        cancellationReason: cancelReason.trim()
      });
      setShowCancelModal(false);
      setCancelReason('');
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCancelError(msg || 'Failed to cancel Purchase Order');
    } finally {
      setCancelling(false);
    }
  };

  const handleDeletePO = async () => {
    if (!window.confirm('Are you sure you want to permanently DELETE this Purchase Order? This action cannot be undone.')) {
      return;
    }
    setError('');
    setSaving(true);
    try {
      await api.delete(`/api/purchase-orders/${id}`);
      navigate('/purchase-orders');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to delete PO');
      setSaving(false);
    }
  };

  const handlePrint = async () => {
    if (!po) return;
    try {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write('<div style="font-family:sans-serif;padding:40px;text-align:center;color:#64748b;">Loading document...</div>');
      }
      const response = await api.get(`/api/purchase-orders/${po.id}/print`, { responseType: 'text' });
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(response.data);
        printWindow.document.close();
      }
    } catch {
      alert('Failed to generate print document');
    }
  };

  const handlePrintGrn = async (grnId: string) => {
    try {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write('<div style="font-family:sans-serif;padding:40px;text-align:center;color:#64748b;">Loading Goods Receipt Note...</div>');
      }
      const response = await api.get(`/api/grn/${grnId}/print`, { responseType: 'text' });
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(response.data);
        printWindow.document.close();
      }
    } catch {
      alert('Failed to generate Goods Receipt Note document');
    }
  };

  // Prints the most recent GRN issued against this PO (GRNs are issued at the Entry Gate)
  const handlePrintLatestPoGrn = () => {
    const latest = po?.grns?.[0];
    if (latest) handlePrintGrn(latest.id);
  };

  if (loading) return <div className="loading-center"><span className="spinner spinner-lg" /></div>;
  if (error) {
    return (
      <div style={{ maxWidth: 540, margin: '80px auto', textAlign: 'center', padding: 24, background: '#fff', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ color: 'var(--color-danger)', fontSize: 16, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <AlertCircle size={20} /> Error Loading Purchase Order
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 20 }}>{error}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={() => load()}>Retry</button>
          <button className="btn btn-primary" onClick={() => navigate('/purchase-orders')}>Back to Purchase Orders</button>
        </div>
      </div>
    );
  }
  if (!po) return (
    <div style={{ maxWidth: 540, margin: '80px auto', textAlign: 'center', padding: 24, background: '#fff', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)', marginBottom: 8 }}>Purchase Order Not Found</div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 20 }}>The requested PO could not be located in the database.</p>
      <button className="btn btn-secondary" onClick={() => navigate('/purchase-orders')}>Back to Purchase Orders</button>
    </div>
  );

  const totalOrdered = po.lines ? po.lines.reduce((sum, l) => sum + (l.orderedQty || 0), 0) : 0;
  const totalReceived = po.lines ? po.lines.reduce((sum, l) => sum + (l.receivedQty || 0), 0) : 0;
  const totalBalance = Math.max(0, totalOrdered - totalReceived);
  const progressPct = totalOrdered > 0 ? Math.min(100, Math.round((totalReceived / totalOrdered) * 100)) : 0;

  const pendingCount = po.lines ? po.lines.filter(l => (l.orderedQty - l.receivedQty) > 0.001).length : 0;
  const fulfilledCount = po.lines ? po.lines.filter(l => l.receivedQty >= l.orderedQty - 0.001 && l.orderedQty > 0).length : 0;

  const isPending = po.status === 'PENDING';
  const isCancelled = po.status === 'CANCELLED';
  const isLocked = po.status === 'PARTIALLY_RECEIVED' || po.status === 'RECEIVED';
  const firstLine = po.lines?.[0];
  const isFabric = (firstLine?.itemType || 'FABRIC') === 'FABRIC';
  // Totals per unit: a fabric PO can mix meter and kg lines
  const lineTotals = (pick: (l: POLine) => number) => formatTotals((po.lines || []).map(l => ({ uom: uomOf(l), quantity: pick(l) })));
  const poUnits = new Set((po.lines || []).map(l => uomOf(l)));
  const singleUnit = poUnits.size === 1 ? [...poUnits][0] : null;

  const hasSize = po.lines?.some(l => Boolean(l.size));
  const hasArtNo = po.lines?.some(l => Boolean(l.artNo));

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header Bar */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button 
              className="btn btn-ghost btn-icon btn-sm" 
              onClick={() => navigate('/purchase-orders')} 
              title="Back to Purchase Orders"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <ArrowLeft size={18} />
            </button>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#f0fdf4', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Package size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--color-text-main)', fontFamily: 'monospace' }}>
                  {po.poNumber}
                </h1>
                <span className={`badge ${po.status === 'PARTIALLY_RECEIVED' ? 'badge-info' : po.status === 'RECEIVED' ? 'badge-success' : po.status === 'CANCELLED' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: 11.5, fontWeight: 700 }}>
                  {po.status.replace('_', ' ')}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Created on {formatDate(po.createdAt)} · {po.lines?.length || 0} Line Items
              </div>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button 
              className="btn btn-secondary btn-icon" 
              onClick={handlePrint} 
              title="Print Purchase Order"
            >
              <Printer size={18} />
            </button>

            {(po.grns?.length ?? 0) > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handlePrintLatestPoGrn}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  color: totalBalance > 0 ? '#b45309' : '#166534',
                  borderColor: totalBalance > 0 ? '#fde68a' : '#bbf7d0',
                  background: totalBalance > 0 ? '#fffbeb' : '#f0fdf4'
                }}
                title={totalBalance > 0 ? 'Print Partial Goods Receipt Note (GRN)' : 'Print Completed Goods Receipt Note (GRN)'}
              >
                <Printer size={15} /> {totalBalance > 0 ? 'Print Partial GRN' : 'Print Full GRN'}
              </button>
            )}

            {isPending && hasPermission(user, 'po.create') && (
              <>
                <button 
                  className="btn btn-primary btn-icon" 
                  onClick={() => navigate(`/purchase-orders/${po.id}/edit`)} 
                  title="Edit"
                >
                  <Edit size={18} />
                </button>
                <button 
                  className="btn btn-secondary btn-icon" 
                  onClick={handleOpenCancelModal} 
                  title="Cancel"
                  style={{ color: '#dc2626' }}
                >
                  <XCircle size={18} />
                </button>
                <button 
                  className="btn btn-danger btn-icon" 
                  onClick={handleDeletePO} 
                  disabled={saving} 
                  title="Delete"
                >
                  <Trash2 size={18} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 20 }}>{error}</div>}

      {/* Status Notice Banners */}
      {isLocked && (
        <div style={{
          marginBottom: 20,
          padding: '12px 16px',
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: 'var(--radius-md)',
          fontSize: 13,
          color: '#334155',
          lineHeight: 1.5,
          display: 'flex',
          gap: 10,
          alignItems: 'center'
        }}>
          <Lock size={16} color="var(--color-brand)" style={{ flexShrink: 0 }} />
          <span>
            <strong>Locked Order:</strong> Receiving has commenced at the Inbound Dock. Order lines and supplier information are locked from editing.
          </span>
        </div>
      )}

      {isCancelled && (
        <div style={{
          marginBottom: 20,
          padding: '14px 18px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 'var(--radius-md)',
          fontSize: 13,
          color: '#991b1b',
          lineHeight: 1.5,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start'
        }}>
          <XCircle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Cancelled Purchase Order</div>
            <div style={{ color: '#7f1d1d', marginTop: 2 }}>
              This purchase order was cancelled and is archived for audit purposes.
            </div>
            {po.notes && po.notes.includes('[Cancellation Reason:') && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#ffffff', borderRadius: 6, border: '1px solid #fca5a5', color: '#991b1b' }}>
                <span style={{ fontWeight: 700 }}>Cancellation Reason: </span>
                <span>{po.notes.split('[Cancellation Reason:')[1]?.replace(/\]/g, '').trim()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Executive Meta Grid (4 Clean ERP Metrics) */}
      <div className="card" style={{ padding: 20, marginBottom: 24, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {/* Supplier Info */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Supplier
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              {po.supplierName}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {po.supplier?.code && (
                <span style={{ fontFamily: 'monospace', fontSize: 11, background: '#ffffff', padding: '1px 6px', borderRadius: 4, border: '1px solid #cbd5e1', fontWeight: 600 }}>
                  {po.supplier.code}
                </span>
              )}
            </div>
          </div>

          {/* Expected Delivery Date */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Expected Delivery
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              {formatDate(po.expectedDate)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Order Date: {formatDate(po.createdAt)}
            </div>
          </div>

          {/* Client */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Client
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Users size={15} color="var(--color-brand)" />
              {po.clientBreakdown && po.clientBreakdown.length > 0
                ? po.clientBreakdown.map(c => c.clientName).join(', ')
                : (po.targetClient || 'General Warehouse Stock')}
            </div>
          </div>

          {/* Fulfillment Progress */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Fulfillment Progress
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: progressPct === 100 ? 'var(--color-success)' : 'var(--color-brand)' }}>
                {progressPct}% Received
              </span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
              {lineTotals(l => l.receivedQty)} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)' }}>of</span> {lineTotals(l => l.orderedQty)}
            </div>
            <div style={{ width: '100%', height: 6, background: '#cbd5e1', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ 
                height: '100%', 
                background: progressPct >= 100 ? 'var(--color-success)' : 'var(--color-brand)', 
                width: `${progressPct}%`,
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        </div>

        {/* Notes strip if present */}
        {po.notes && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0', fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: '#475569', marginRight: 6 }}>Notes:</span>
            <span style={{ color: '#334155' }}>{po.notes}</span>
          </div>
        )}
      </div>

      {/* Classic Line Items Data Table Card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        {/* Table Toolbar */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: '#fafafa' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>
              Order Line Items ({po.lines?.length || 0})
            </h2>
            
            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setLineFilter('ALL')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: lineFilter === 'ALL' ? 'var(--color-brand)' : '#ffffff',
                  color: lineFilter === 'ALL' ? '#ffffff' : 'var(--color-text-muted)',
                  border: '1px solid ' + (lineFilter === 'ALL' ? 'var(--color-brand)' : '#cbd5e1'),
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <Layers size={13} /> All ({po.lines?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setLineFilter('PENDING')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: lineFilter === 'PENDING' ? '#b45309' : '#ffffff',
                  color: lineFilter === 'PENDING' ? '#ffffff' : '#b45309',
                  border: '1px solid ' + (lineFilter === 'PENDING' ? '#b45309' : '#fcd34d'),
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <Clock size={13} /> Pending ({pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setLineFilter('RECEIVED')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: lineFilter === 'RECEIVED' ? '#16a34a' : '#ffffff',
                  color: lineFilter === 'RECEIVED' ? '#ffffff' : '#16a34a',
                  border: '1px solid ' + (lineFilter === 'RECEIVED' ? '#16a34a' : '#86efac'),
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <CheckCircle2 size={13} /> Received ({fulfilledCount})
              </button>
            </div>
          </div>

          {/* Quick Search */}
          <div style={{ position: 'relative', width: 260 }}>
            <Search size={14} color="var(--color-text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Filter shade, brand, art no..."
              value={lineSearch}
              onChange={e => setLineSearch(e.target.value)}
              style={{ paddingLeft: 30, height: 32, fontSize: 12.5, width: '100%', background: '#ffffff' }}
            />
          </div>
        </div>

        {/* Table Body */}
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 13.5, width: '100%', margin: 0 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ width: 44, textAlign: 'center' }}>#</th>
                <th>{isFabric ? 'Item / Category' : 'Item Name'}</th>
                <th>{isFabric ? 'Quality' : 'Specification'}</th>
                <th>{isFabric ? 'Shade' : 'Color'}</th>
                {hasSize && <th>Size</th>}
                {hasArtNo && <th>Art No</th>}
                <th style={{ textAlign: 'right' }}>Ordered</th>
                <th style={{ textAlign: 'right' }}>Received</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th style={{ textAlign: 'center', width: 120 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredLines.length === 0 ? (
                <tr>
                  <td colSpan={8 + (hasSize ? 1 : 0) + (hasArtNo ? 1 : 0)} style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--color-text-muted)' }}>
                    No items match the active search or filter.
                  </td>
                </tr>
              ) : (
                sortedAndFilteredLines.map((line, idx) => {
                  const ordered = Number(line?.orderedQty) || 0;
                  const received = Number(line?.receivedQty) || 0;
                  const balance = Math.max(0, ordered - received);
                  const isComplete = received >= ordered - 0.001 && ordered > 0;
                  const isPartial = received > 0 && !isComplete;
                  const itemType = line?.itemType || 'FABRIC';
                  const isLineFabric = itemType === 'FABRIC';
                  const lineUnit = unitLabel(uomOf(line));
                  const dp = allowsDecimals(uomOf(line)) ? 2 : 0;

                  return (
                    <tr key={line.id} className="hover-row">
                      <td style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {idx + 1}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
                          {line.brand || line.name || 'Item'}
                        </div>
                        {line.category && (
                          <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                            {isLineFabric ? fabricCategoryLabel(line.category) : line.category}
                          </div>
                        )}

                        {/* Client Planning Sub-lines (reply icon style, not boxy tags) */}
                        {line.allocations && line.allocations.length > 0 ? (
                          <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 4 }}>
                            {line.allocations.map((al, aIdx) => (
                              <div
                                key={al.id || aIdx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  fontSize: 12,
                                  color: '#475569'
                                }}
                                title={al.notes ? `Note: ${al.notes}` : undefined}
                              >
                                <CornerDownRight size={13} style={{ color: '#94a3b8', flexShrink: 0 }} />
                                <span style={{ fontWeight: 600, color: '#1e293b' }}>{al.clientName}</span>
                                <span style={{ color: 'var(--color-text-muted)', fontSize: 11.5 }}>
                                  ({Number(al.allocatedQty.toFixed(dp))} {lineUnit})
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : po.targetClient ? (
                          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', paddingLeft: 4 }}>
                            <CornerDownRight size={13} style={{ color: '#94a3b8', flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>{po.targetClient}</span>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {line.quality}
                        {line.qualityName && <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{line.qualityName}</div>}
                      </td>
                      <td>
                        {line.shade ? (
                          <span style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-brand)' }}>
                            {line.shade}
                          </span>
                        ) : null}
                      </td>
                      {hasSize && <td>{line.size}</td>}
                      {hasArtNo && <td><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{line.artNo}</span></td>}
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {Number(ordered.toFixed(dp))} {lineUnit}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: isComplete ? 'var(--color-success)' : isPartial ? '#0284c7' : 'var(--color-text-muted)' }}>
                        {Number(received.toFixed(dp))} {lineUnit}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: balance > 0 ? '#b45309' : 'var(--color-success)' }}>
                        {balance > 0 ? `${Number(balance.toFixed(dp))} ${lineUnit}` : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isComplete ? (
                          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600 }}>
                            <CheckCircle2 size={12} /> Received
                          </span>
                        ) : isPartial ? (
                          <span className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600 }}>
                            <Clock size={12} /> Partial
                          </span>
                        ) : (
                          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600 }}>
                            <AlertCircle size={12} /> Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {sortedAndFilteredLines.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                  <td colSpan={4 + (hasSize ? 1 : 0) + (hasArtNo ? 1 : 0)} style={{ padding: '12px 16px', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: '#334155' }}>
                    Summary Totals ({po.lines.length} lines)
                  </td>
                  <td style={{ textAlign: 'right', padding: '12px 16px', fontSize: 13.5, color: '#0f172a' }}>
                    {lineTotals(l => l.orderedQty)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '12px 16px', fontSize: 13.5, color: totalReceived >= totalOrdered ? 'var(--color-success)' : '#0284c7' }}>
                    {lineTotals(l => l.receivedQty)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '12px 16px', fontSize: 13.5, color: totalBalance > 0 ? '#b45309' : 'var(--color-success)' }}>
                    {totalBalance > 0 ? lineTotals(l => Math.max(0, l.orderedQty - l.receivedQty)) : '0'}
                  </td>
                  <td style={{ textAlign: 'center', padding: '12px 16px', fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: progressPct === 100 ? 'var(--color-success)' : 'var(--color-brand)' }}>
                      {progressPct}%
                    </span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Linked Goods Receipt Notes (GRN) Section */}
      <div className="card" style={{ padding: 0, marginBottom: 24, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileCheck size={18} color="var(--color-brand)" />
            <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--color-text-main)' }}>
              Goods Receipt Notes (GRN)
            </h3>
            {po.grns && po.grns.length > 0 && (
              <span className="badge badge-info" style={{ fontSize: 11, fontWeight: 700 }}>
                {po.grns.length} {po.grns.length === 1 ? 'Voucher' : 'Vouchers'}
              </span>
            )}
          </div>
          {po.grns && po.grns.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Inward delivery vouchers logged against this purchase order
            </span>
          )}
        </div>

        {!po.grns || po.grns.length === 0 ? (
          <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            No Goods Receipt Notes have been issued for this Purchase Order yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 13, width: '100%', margin: 0 }}>
              <thead>
                <tr style={{ background: '#ffffff', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ width: 140 }}>GRN Number</th>
                  <th style={{ width: 120 }}>Intake Date</th>
                  <th>Supplier Invoice</th>
                  <th style={{ textAlign: 'center', width: 90 }}>Rolls / Pcs</th>
                  <th style={{ textAlign: 'right', width: 130 }}>Quantity Received</th>
                  <th>Received By</th>
                  <th style={{ textAlign: 'center', width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {po.grns.map(grn => (
                  <tr key={grn.id} className="hover-row">
                    <td>
                      <button
                        className="btn btn-ghost"
                        onClick={() => navigate(`/inventory/grn/${grn.id}`)}
                        style={{
                          padding: 0,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          color: 'var(--color-brand)',
                          fontSize: 13,
                          textAlign: 'left'
                        }}
                      >
                        {grn.grnNumber}
                      </button>
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {formatDate(grn.createdAt)}
                    </td>
                    <td>
                      {grn.invoiceRef ? (
                        <span style={{ fontWeight: 600, color: '#334155' }}>{grn.invoiceRef}</span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>
                      {grn.totalRolls}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#065f46' }}>
                      {singleUnit ? `${Number(grn.totalQuantity.toFixed(allowsDecimals(singleUnit) ? 2 : 0))} ${unitLabel(singleUnit)}` : 'See GRN'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {grn.receivedBy?.name || 'Staff'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => navigate(`/inventory/grn/${grn.id}`)}
                          title="View GRN Details"
                          style={{ color: 'var(--color-brand)' }}
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => handlePrintGrn(grn.id)}
                          title="Print GRN Voucher"
                          style={{ color: '#0f172a' }}
                        >
                          <Printer size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancel Order Popup Screen */}
      {showCancelModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 8,
            width: '100%',
            maxWidth: 480,
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            overflow: 'hidden',
            border: '1px solid var(--color-border)'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #fee2e2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#fef2f2'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#991b1b', fontWeight: 700, fontSize: 16 }}>
                <XCircle size={20} color="#dc2626" />
                Cancel Purchase Order
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setShowCancelModal(false)}
                disabled={cancelling}
                style={{ color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 13.5, color: '#334155', marginBottom: 16, lineHeight: 1.5 }}>
                You are about to cancel purchase order <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>{po.poNumber}</strong> ({po.supplierName}). This will archive the order and prevent receiving.
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                  Reason for Cancellation <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={cancelReason}
                  onChange={e => {
                    setCancelReason(e.target.value);
                    if (cancelError) setCancelError('');
                  }}
                  placeholder="Please state why this order is being cancelled (e.g., supplier out of stock, client cancelled requirement, rate mismatch, revised PO...)"
                  style={{ width: '100%', resize: 'vertical', fontSize: 13, padding: '10px 12px', lineHeight: 1.4 }}
                  autoFocus
                />
              </div>

              {cancelError && (
                <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, color: '#991b1b', fontSize: 12.5 }}>
                  {cancelError}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--color-border)',
              background: '#f8fafc',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8
            }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCancelModal(false)}
                disabled={cancelling}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <ArrowLeft size={15} /> Keep Order
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmCancel}
                disabled={cancelling || !cancelReason.trim()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
              >
                {cancelling ? <span className="spinner" /> : <XCircle size={15} />} Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
