import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { 
  ArrowLeft, 
  Printer, 
  FileCheck, 
  AlertTriangle, 
  Layers, 
  Barcode
} from 'lucide-react';
import { formatDate } from '../../../utils/format';
import '../../../styles/components.css';

interface GRNLine {
  id: string;
  itemType: string;
  brand: string | null;
  quality: string | null;
  shade: string | null;
  category: string | null;
  size: string | null;
  name: string | null;
  artNo: string | null;
  uom: string;
  invoicedQty: number | null;
  receivedQty: number;
  shortageQty: number;
  rollsCount: number;
  notes: string | null;
}

interface BatchItem {
  id: string;
  batchCode: string;
  itemType: string;
  brand: string | null;
  quality: string | null;
  shade: string | null;
  size: string | null;
  quantity: number;
  uom: string;
  supplierBundle: string | null;
}

interface DiscrepancyItem {
  id: string;
  bundleNumber: string;
  issueType: string;
  expectedQty: number | null;
  receivedQty: number | null;
  notes: string | null;
}

interface GRNDetail {
  id: string;
  grnNumber: string;
  supplierName: string;
  supplier?: { id: string; code: string; name: string; address: string | null; gstin: string | null } | null;
  poId: string | null;
  poNumber: string | null;
  po?: { id: string; poNumber: string; expectedDate: string; targetClient: string | null; status: string } | null;
  invoiceRef: string | null;
  invoiceDate: string | null;
  totalRolls: number;
  totalQuantity: number;
  status: string;
  remarks: string | null;
  receivedBy?: { id: string; name: string; username: string } | null;
  createdAt: string;
  lines: GRNLine[];
  batches: BatchItem[];
  discrepancies: DiscrepancyItem[];
}

export default function ViewGRNPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [grn, setGrn] = useState<GRNDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'ITEMS' | 'ROLLS'>('ITEMS');

  const loadGRN = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/api/grn/${id}`);
      setGrn(res.data);
    } catch (err: any) {
      console.error('Failed to load GRN', err);
      setError('Failed to retrieve Goods Receipt Note details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGRN();
  }, [id]);

  const handlePrint = async () => {
    if (!id) return;
    try {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write('<div style="font-family:sans-serif;padding:40px;text-align:center;color:#64748b;">Loading Goods Receipt Note...</div>');
      }
      const response = await api.get(`/api/grn/${id}/print`, { responseType: 'text' });
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(response.data);
        printWindow.document.close();
      }
    } catch {
      alert('Failed to generate Goods Receipt Note document');
    }
  };

  if (loading) {
    return <div className="loading-center"><span className="spinner spinner-lg" /></div>;
  }

  if (!grn) {
    return <div className="loading-center">Goods Receipt Note not found</div>;
  }

  const hasShortages = grn.lines.some(l => (l.shortageQty || 0) > 0.01) || grn.discrepancies.length > 0;
  const isFabric = grn.lines.some(l => l.itemType === 'FABRIC' || (l.uom || '').toLowerCase().startsWith('m'));
  const isReadyMade = !isFabric && grn.lines.some(l => l.itemType === 'READY_MADE' || (l.uom || '').toLowerCase().startsWith('p'));

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header Bar */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button 
              className="btn btn-ghost btn-icon btn-sm" 
              onClick={() => navigate('/inventory/grn')} 
              title="Back to GRN Register"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <ArrowLeft size={18} />
            </button>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#f0fdf4', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileCheck size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--color-text-main)', fontFamily: 'monospace' }}>
                  {grn.grnNumber}
                </h1>
                <span className="badge badge-success" style={{ fontSize: 11.5, fontWeight: 700 }}>
                  {grn.status}
                </span>
                {hasShortages && (
                  <span className="badge badge-warning" style={{ fontSize: 11.5, fontWeight: 700 }}>
                    Shortage Logged
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Intake on {formatDate(grn.createdAt)} · Received by {grn.receivedBy?.name || 'Staff'}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button 
              className="btn btn-primary" 
              onClick={handlePrint} 
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
            >
              <Printer size={16} /> Print GRN Voucher
            </button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 20 }}>{error}</div>}

      {/* 4-Metric Meta Grid */}
      <div className="card" style={{ padding: 20, marginBottom: 24, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {/* Supplier Info */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Supplier / Mill
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              {grn.supplierName}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {grn.supplier?.code && (
                <span style={{ fontFamily: 'monospace', fontSize: 11, background: '#ffffff', padding: '1px 6px', borderRadius: 4, border: '1px solid #cbd5e1', fontWeight: 600 }}>
                  {grn.supplier.code}
                </span>
              )}
            </div>
            {grn.supplier?.gstin && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                GSTIN: {grn.supplier.gstin}
              </div>
            )}
          </div>

          {/* Supplier Invoice / Delivery Details */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Supplier Invoice
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
              Invoice No: <strong>{grn.invoiceRef || '—'}</strong>
            </div>
            {grn.invoiceDate && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Invoice Date: {formatDate(grn.invoiceDate)}
              </div>
            )}
          </div>

          {/* Linked Purchase Order */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Linked Purchase Order
            </div>
            {grn.poNumber ? (
              <div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => grn.poId && navigate(`/purchase-orders/${grn.poId}/view`)}
                  style={{ padding: 0, fontWeight: 700, fontFamily: 'monospace', color: '#1d4ed8', fontSize: 14 }}
                >
                  {grn.poNumber}
                </button>
                {grn.po?.targetClient && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    Client: {grn.po.targetClient}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>
                Direct Mill Inward (No PO linked)
              </div>
            )}
          </div>

          {/* Volume Summary */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Accepted Volume
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#065f46' }}>
              {isFabric
                ? `${grn.totalQuantity.toFixed(1)} meters`
                : isReadyMade
                  ? `${Math.round(grn.totalQuantity)} pieces`
                  : `${grn.totalQuantity} units`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              {isFabric
                ? `${grn.totalRolls} total rolls / lumps registered`
                : `${grn.lines.length} line items accepted`}
            </div>
          </div>
        </div>

        {grn.remarks && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0', fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: '#475569', marginRight: 6 }}>Gate Remarks:</span>
            <span style={{ color: '#334155' }}>{grn.remarks}</span>
          </div>
        )}
      </div>

      {/* Discrepancy & Shortage Alert Card */}
      {hasShortages && (
        <div style={{
          marginBottom: 24,
          padding: '14px 18px',
          background: '#fffbeb',
          border: '1.5px solid #fde68a',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#92400e', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            <AlertTriangle size={18} color="#b45309" />
            Official Discrepancy &amp; Shortage Notice
          </div>
          <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.4, marginBottom: 12 }}>
            Shortages or damaged pieces were detected against Supplier Invoice <strong>{grn.invoiceRef || '—'}</strong> during gate intake. 
            Use these numbers for vendor debit notes and shortage reconciliation:
          </div>

          <table className="table" style={{ width: '100%', fontSize: 12, margin: 0, background: '#ffffff', borderRadius: 4, overflow: 'hidden' }}>
            <thead>
              <tr style={{ background: '#fef3c7' }}>
                <th>Bundle / Bale</th>
                <th>Issue Type</th>
                <th style={{ textAlign: 'right' }}>Expected</th>
                <th style={{ textAlign: 'right' }}>Received</th>
                <th style={{ textAlign: 'right', color: '#b91c1c' }}>Shortage</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {grn.discrepancies.map(d => {
                const claimed = d.expectedQty || 0;
                const found = d.receivedQty || 0;
                const short = Math.max(0, claimed - found);

                return (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 700 }}>{d.bundleNumber || 'Unbundled'}</td>
                    <td style={{ color: '#b45309', fontWeight: 600 }}>{d.issueType.replace(/_/g, ' ')}</td>
                    <td style={{ textAlign: 'right' }}>{claimed ? claimed.toFixed(1) : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{found.toFixed(1)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>
                      {short > 0 ? `-${short.toFixed(1)}` : 'Defective'}
                    </td>
                    <td style={{ color: '#475569' }}>{d.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab Switcher: Line Items vs Barcode Appendix */}
      <div style={{
        background: '#ffffff',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '6px',
        display: 'inline-flex',
        gap: 4,
        marginBottom: 16,
      }}>
        <button
          type="button"
          onClick={() => setActiveTab('ITEMS')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            background: activeTab === 'ITEMS' ? 'var(--color-brand)' : 'transparent',
            color: activeTab === 'ITEMS' ? '#ffffff' : 'var(--color-text-muted)',
            fontWeight: 600,
            fontSize: 12.5,
            cursor: 'pointer'
          }}
        >
          <Layers size={14} /> Item Lines ({grn.lines?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ROLLS')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            background: activeTab === 'ROLLS' ? 'var(--color-brand)' : 'transparent',
            color: activeTab === 'ROLLS' ? '#ffffff' : 'var(--color-text-muted)',
            fontWeight: 600,
            fontSize: 12.5,
            cursor: 'pointer'
          }}
        >
          <Barcode size={14} /> {isFabric ? 'Individual Rolls' : 'Individual Barcodes'} ({grn.batches?.length || 0})
        </button>
      </div>

      {/* Tab Content: Item Lines */}
      {activeTab === 'ITEMS' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ overflowX: 'auto' }}>
            {isFabric ? (
              /* ─── Fabric Table ─── */
              <table className="table" style={{ fontSize: 13, width: '100%', margin: 0 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ width: 40, textAlign: 'center' }}>#</th>
                    <th>Fabric Category</th>
                    <th>Brand</th>
                    <th>Quality</th>
                    <th>Shade</th>
                    <th style={{ textAlign: 'center', width: 75 }}>Rolls</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Billed (m)</th>
                    <th style={{ textAlign: 'right', width: 120 }}>Received (m)</th>
                    <th style={{ textAlign: 'right', width: 100 }}>Shortage</th>
                  </tr>
                </thead>
                <tbody>
                  {grn.lines.map((line, idx) => {
                    const isShort = (line.shortageQty || 0) > 0.01;
                    return (
                      <tr key={line.id} className="hover-row">
                        <td style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                        <td><strong>{line.category || 'Fabric'}</strong></td>
                        <td>{line.brand || '—'}</td>
                        <td>{line.quality || '—'}</td>
                        <td>
                          {line.shade ? (
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-brand)' }}>
                              {line.shade}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{line.rollsCount || 1}</td>
                        <td style={{ textAlign: 'right' }}>
                          {(line.invoicedQty || line.receivedQty).toFixed(1)} m
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                          {line.receivedQty.toFixed(1)} m
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isShort ? (
                            <span className="badge badge-danger" style={{ fontWeight: 700, fontSize: 11 }}>
                              -{line.shortageQty.toFixed(1)} m
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                    <td colSpan={5} style={{ padding: '12px 16px', textTransform: 'uppercase', fontSize: 12, color: '#334155' }}>
                      Total Accepted ({grn.lines.length} items)
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                      {grn.totalRolls} rolls
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 16px', fontSize: 13.5, color: '#065f46' }}>
                      {grn.totalQuantity.toFixed(1)} m
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 16px', fontSize: 13.5, color: '#065f46' }}>
                      {grn.totalQuantity.toFixed(1)} m
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 16px', fontSize: 12, color: hasShortages ? '#b91c1c' : '#16a34a' }}>
                      {hasShortages ? 'Shortage Recorded' : 'Verified'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            ) : isReadyMade ? (
              /* ─── Ready-Made Table ─── */
              <table className="table" style={{ fontSize: 13, width: '100%', margin: 0 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ width: 40, textAlign: 'center' }}>#</th>
                    <th>Item Name</th>
                    <th>Category</th>
                    <th>Art No</th>
                    <th>Color</th>
                    <th style={{ textAlign: 'center', width: 75 }}>Size</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Billed (Pcs)</th>
                    <th style={{ textAlign: 'right', width: 120 }}>Received (Pcs)</th>
                    <th style={{ textAlign: 'right', width: 100 }}>Shortage</th>
                  </tr>
                </thead>
                <tbody>
                  {grn.lines.map((line, idx) => {
                    const isShort = (line.shortageQty || 0) > 0;
                    return (
                      <tr key={line.id} className="hover-row">
                        <td style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                        <td><strong>{line.name || line.brand || 'Item'}</strong></td>
                        <td>{line.category || '—'}</td>
                        <td>{line.artNo || '—'}</td>
                        <td>{line.shade || '—'}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{line.size || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {Math.round(line.invoicedQty || line.receivedQty)} pcs
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                          {Math.round(line.receivedQty)} pcs
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isShort ? (
                            <span className="badge badge-danger" style={{ fontWeight: 700, fontSize: 11 }}>
                              -{Math.round(line.shortageQty)} pcs
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                    <td colSpan={6} style={{ padding: '12px 16px', textTransform: 'uppercase', fontSize: 12, color: '#334155' }}>
                      Total Accepted ({grn.lines.length} items)
                    </td>
                    <td colSpan={2} style={{ textAlign: 'right', padding: '12px 16px', fontSize: 13.5, color: '#065f46' }}>
                      {Math.round(grn.totalQuantity)} pieces
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 16px', fontSize: 12, color: hasShortages ? '#b91c1c' : '#16a34a' }}>
                      {hasShortages ? 'Shortage Recorded' : 'Verified'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              /* ─── Accessories Table ─── */
              <table className="table" style={{ fontSize: 13, width: '100%', margin: 0 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ width: 40, textAlign: 'center' }}>#</th>
                    <th>Item Name</th>
                    <th>Specification</th>
                    <th>Color</th>
                    <th style={{ textAlign: 'center', width: 75 }}>Size</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Billed</th>
                    <th style={{ textAlign: 'right', width: 120 }}>Received</th>
                    <th style={{ textAlign: 'right', width: 100 }}>Shortage</th>
                  </tr>
                </thead>
                <tbody>
                  {grn.lines.map((line, idx) => {
                    const isShort = (line.shortageQty || 0) > 0;
                    const uom = line.uom || '';
                    return (
                      <tr key={line.id} className="hover-row">
                        <td style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                        <td><strong>{line.name || line.brand || 'Accessory'}</strong></td>
                        <td>{line.quality || '—'}</td>
                        <td>{line.shade || '—'}</td>
                        <td style={{ textAlign: 'center' }}>{line.size || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {line.invoicedQty || line.receivedQty} {uom}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                          {line.receivedQty} {uom}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isShort ? (
                            <span className="badge badge-danger" style={{ fontWeight: 700, fontSize: 11 }}>
                              -{line.shortageQty} {uom}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                    <td colSpan={5} style={{ padding: '12px 16px', textTransform: 'uppercase', fontSize: 12, color: '#334155' }}>
                      Total Accepted ({grn.lines.length} items)
                    </td>
                    <td colSpan={2} style={{ textAlign: 'right', padding: '12px 16px', fontSize: 13.5, color: '#065f46' }}>
                      {grn.totalQuantity} units
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 16px', fontSize: 12, color: hasShortages ? '#b91c1c' : '#16a34a' }}>
                      {hasShortages ? 'Shortage Recorded' : 'Verified'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Tab Content: Barcode Appendix */}
      {activeTab === 'ROLLS' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5, width: '100%', margin: 0 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ width: 40, textAlign: 'center' }}>#</th>
                  <th>Barcode</th>
                  <th>{isFabric ? 'Bundle / Bale No' : 'Bundle / Box No'}</th>
                  <th>{isFabric ? 'Brand' : 'Item Name'}</th>
                  <th>{isFabric ? 'Quality' : 'Specification'}</th>
                  <th>{isFabric ? 'Shade' : 'Color'}</th>
                  {!isFabric && <th>Size</th>}
                  <th style={{ textAlign: 'right' }}>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {grn.batches.map((b, i) => (
                  <tr key={b.id} className="hover-row">
                    <td style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{i + 1}</td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-brand)' }}>
                        {b.batchCode}
                      </span>
                    </td>
                    <td>{b.supplierBundle || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{isFabric ? (b.brand || '—') : (b.brand || 'Item')}</td>
                    <td>{b.quality || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{b.shade || '—'}</td>
                    {!isFabric && <td>{b.size || '—'}</td>}
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                      {isFabric ? `${b.quantity.toFixed(1)} m` : isReadyMade ? `${Math.round(b.quantity)} pcs` : `${b.quantity} ${b.uom?.toLowerCase() || ''}`}
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
