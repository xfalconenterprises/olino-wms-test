import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { 
  FileText, 
  Search, 
  Printer, 
  Download, 
  ChevronDown, 
  ChevronUp,
  RefreshCw,
  Plus,
  MapPin,
  ExternalLink,
  CheckCircle2
} from 'lucide-react';
import { formatDateTime } from '../../../utils/format';
import { formatTotals } from '../../../utils/units';
import { exportToExcel } from '../../../utils/exportExcel';
import '../../../styles/components.css';

interface DeliveryChallan {
  id: string;
  challanNumber: string;
  customerName: string;
  customerId?: string | null;
  destination: string | null;
  status: 'DRAFT' | 'DISPATCHED' | 'CANCELLED';
  dispatchedAt: string | null;
  createdAt: string;
  operator: string;
  remarks: string | null;
  totalFabricMeters: number;
  totalFabricKg?: number;
  totalReadyMadePcs?: number;
  totalAccessoryUnits?: number;
  totalPairs: number;
  totalUnits?: number;
  linesCount: number;
  lines: {
    id: string;
    batchCode: string;
    brand: string;
    quality: string;
    shade: string;
    category: string | null;
    size: string | null;
    itemType: string;
    quantity: number;
    isPartialCut: boolean;
    unit: string;
  }[];
}

export default function DeliveryChallansPage() {
  const navigate = useNavigate();
  const [challans, setChallans] = useState<DeliveryChallan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'FABRIC' | 'READY_MADE'>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewDetailMode, setViewDetailMode] = useState<Record<string, 'GROUPED' | 'INDIVIDUAL'>>({});

  const loadChallans = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/reports/customer-shipments', {
        params: { search: search.trim() || undefined }
      });
      setChallans(res.data || []);
    } catch (e) {
      console.error('Failed to load delivery challans', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChallans();
  }, []);


  // Client-side filtering
  const filteredChallans = useMemo(() => {
    return challans.filter(c => {
      if (typeFilter === 'FABRIC' && (c.totalFabricMeters || 0) <= 0 && (c.totalFabricKg || 0) <= 0) return false;
      if (typeFilter === 'READY_MADE' && (c.totalReadyMadePcs || c.totalUnits || c.totalPairs || 0) <= 0) return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const numMatch = c.challanNumber.toLowerCase().includes(q);
      const custMatch = c.customerName.toLowerCase().includes(q);
      const destMatch = (c.destination || '').toLowerCase().includes(q);
      const opMatch = (c.operator || '').toLowerCase().includes(q);
      const lineMatch = (c.lines || []).some(l => 
        l.batchCode.toLowerCase().includes(q) || 
        l.brand.toLowerCase().includes(q) || 
        l.quality.toLowerCase().includes(q) ||
        l.shade.toLowerCase().includes(q)
      );

      return numMatch || custMatch || destMatch || opMatch || lineMatch;
    });
  }, [challans, typeFilter, search]);

  const handlePrintA4 = async (id: string) => {
    try {
      const printWindow = window.open('', '_blank', 'width=900,height=900');
      if (printWindow) {
        printWindow.document.write('<div style="font-family:sans-serif;padding:40px;text-align:center;color:#64748b;">Loading document...</div>');
      }
      const response = await api.get(`/api/delivery-challans/${id}/print`, { responseType: 'text' });
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(response.data);
        printWindow.document.close();
      }
    } catch {
      alert('Failed to generate print document');
    }
  };

  const handleExportExcel = () => {
    const headers = [
      'Challan Number', 
      'Customer Name', 
      'Destination', 
      'Dispatched Date', 
      'Operator', 
      'Fabric Shipped (Meters)',
      'Fabric Shipped (Kg)', 
      'Ready-Made / Units', 
      'Items Count'
    ];
    const rows = filteredChallans.map(s => [
      s.challanNumber,
      s.customerName,
      s.destination || '',
      formatDateTime(s.dispatchedAt || s.createdAt),
      s.operator,
      s.totalFabricMeters || 0,
      s.totalFabricKg || 0,
      s.totalReadyMadePcs || s.totalUnits || s.totalPairs || 0,
      s.linesCount
    ]);
    exportToExcel('Olino_Delivery_Challans_Registry', headers, rows);
  };

  // Helper to group items by Product Master
  const getGroupedProducts = (lines: DeliveryChallan['lines']) => {
    const map: Record<string, {
      brand: string;
      quality: string;
      shade: string;
      category: string | null;
      size: string | null;
      itemType: string;
      unit: string;
      unitCount: number;
      totalQuantity: number;
    }> = {};

    for (const l of lines) {
      const key = `${l.itemType}|${l.category || ''}|${l.brand}|${l.quality}|${l.shade}|${l.size || ''}`;
      if (!map[key]) {
        map[key] = {
          brand: l.brand,
          quality: l.quality,
          shade: l.shade,
          category: l.category,
          size: l.size,
          itemType: l.itemType,
          unit: l.unit,
          unitCount: 0,
          totalQuantity: 0,
        };
      }
      map[key].unitCount++;
      map[key].totalQuantity = parseFloat((map[key].totalQuantity + l.quantity).toFixed(2));
    }
    return Object.values(map);
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 40 }}>
      {/* ─── Page Header ─────────────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={28} /> Delivery Challans Registry
          </h1>
          <p className="page-subtitle">Supervisory archive of outbound customer dispatches, shipment documents, and reprints</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={loadChallans}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={loading ? 'spinner' : ''} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/exit-gate')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} /> New Delivery Challan &rarr;
          </button>
        </div>
      </div>


      {/* ─── Search, Filters & Export Toolbar ─────────────────────────────── */}
      <div style={{ 
        background: '#fff', 
        padding: '16px 20px', 
        borderRadius: 'var(--radius-lg)', 
        border: '1px solid var(--color-border)', 
        marginBottom: 20, 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        flexWrap: 'wrap', 
        gap: 14 
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 320 }}>
            <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Search Customer, City, DC Number..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadChallans()}
              style={{ paddingLeft: 36, height: 40 }}
            />
          </div>

          {/* Type Filter Tabs */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: 3, borderRadius: 6, gap: 2 }}>
            {[
              { key: 'ALL', label: 'All Dispatches' },
              { key: 'FABRIC', label: 'Fabric Shipments' },
              { key: 'READY_MADE', label: 'Ready-Made / Goods' },
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTypeFilter(tab.key as any)}
                style={{
                  border: 'none',
                  background: typeFilter === tab.key ? '#ffffff' : 'transparent',
                  color: typeFilter === tab.key ? 'var(--color-brand)' : 'var(--color-text-muted)',
                  fontWeight: typeFilter === tab.key ? 700 : 500,
                  fontSize: 12.5,
                  padding: '6px 12px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  boxShadow: typeFilter === tab.key ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button className="btn btn-secondary" onClick={loadChallans} style={{ height: 40 }}>
            Search
          </button>
        </div>

        <button
          className="btn btn-secondary"
          onClick={handleExportExcel}
          disabled={filteredChallans.length === 0 || loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, height: 40 }}
        >
          <Download size={15} /> Download Excel (.CSV)
        </button>
      </div>

      {/* ─── Challans Table ──────────────────────────────────────────────── */}
      {loading ? (
        <div className="loading-center"><span className="spinner spinner-lg" /></div>
      ) : filteredChallans.length === 0 ? (
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="empty-state-icon"><FileText size={48} className="text-muted" /></div>
            <div className="empty-state-text">No delivery challans found matching your filters</div>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Challan No</th>
                <th>Customer / Receiver</th>
                <th>Destination</th>
                <th>Fabric Shipped</th>
                <th>Ready-Made / Units</th>
                <th>Dispatched Date</th>
                <th>Gate Operator</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredChallans.map(s => {
                const isExpanded = expandedId === s.id;
                const detailMode = viewDetailMode[s.id] || 'GROUPED';
                const groupedList = getGroupedProducts(s.lines);
                const readyMadeTotal = s.totalReadyMadePcs || s.totalUnits || s.totalPairs || 0;

                return (
                  <>
                    <tr key={s.id} style={{ background: isExpanded ? 'var(--color-bg-subtle)' : undefined }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <FileText size={14} color="var(--color-brand)" />
                          <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-brand)' }}>
                            {s.challanNumber}
                          </code>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <strong style={{ fontSize: 13.5 }}>{s.customerName}</strong>
                          {s.customerId && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate('/clients');
                              }}
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '0 4px', height: 18, fontSize: 10.5, color: 'var(--color-brand)' }}
                              title="View Client Profile"
                            >
                              <ExternalLink size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        {s.destination && s.destination !== '—' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: '#475569' }}>
                            <MapPin size={12} color="#94a3b8" /> {s.destination}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {(s.totalFabricMeters || 0) > 0 || (s.totalFabricKg || 0) > 0 ? (
                          <strong style={{ color: '#0369a1' }}>
                            {formatTotals([{ uom: 'METERS', quantity: s.totalFabricMeters || 0 }, { uom: 'KG', quantity: s.totalFabricKg || 0 }].filter(t => t.quantity > 0))}
                          </strong>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {readyMadeTotal > 0 ? (
                          <strong style={{ color: '#15803d' }}>{readyMadeTotal} pcs</strong>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-muted text-xs" style={{ whiteSpace: 'nowrap' }}>
                        {formatDateTime(s.dispatchedAt || s.createdAt)}
                      </td>
                      <td style={{ fontWeight: 500, fontSize: 13 }}>{s.operator}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handlePrintA4(s.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            title="Reprint A4 Challan"
                          >
                            <Printer size={13} /> Print
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setExpandedId(isExpanded ? null : s.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: isExpanded ? 700 : 500 }}
                          >
                            <span>{s.linesCount} {s.linesCount === 1 ? 'item' : 'items'}</span>
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expandable Items Details Row */}
                    {isExpanded && (
                      <tr style={{ background: 'var(--color-bg-subtle)' }}>
                        <td colSpan={8} style={{ padding: '14px 24px' }}>
                          <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 18, boxShadow: 'var(--shadow-sm)' }}>
                            
                            {/* Subheader & Toggle */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                              <div>
                                <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--color-text-main)' }}>
                                  Shipment Content: {s.customerName} {s.destination && s.destination !== '—' && `· ${s.destination}`}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                  {groupedList.length} distinct product lines · {s.linesCount} total rolls/packages shipped
                                  {s.remarks && ` · Remarks: "${s.remarks}"`}
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                                  <button
                                    className="btn btn-ghost"
                                    onClick={() => setViewDetailMode(prev => ({ ...prev, [s.id]: 'GROUPED' }))}
                                    style={{
                                      background: detailMode === 'GROUPED' ? 'var(--color-brand-faded)' : '#fff',
                                      color: detailMode === 'GROUPED' ? 'var(--color-brand)' : 'var(--color-text-muted)',
                                      borderRadius: 0,
                                      fontSize: 12,
                                      padding: '5px 12px',
                                      fontWeight: detailMode === 'GROUPED' ? 700 : 500
                                    }}
                                  >
                                    Consolidated (By Product)
                                  </button>
                                  <button
                                    className="btn btn-ghost"
                                    onClick={() => setViewDetailMode(prev => ({ ...prev, [s.id]: 'INDIVIDUAL' }))}
                                    style={{
                                      background: detailMode === 'INDIVIDUAL' ? 'var(--color-brand-faded)' : '#fff',
                                      color: detailMode === 'INDIVIDUAL' ? 'var(--color-brand)' : 'var(--color-text-muted)',
                                      borderRadius: 0,
                                      fontSize: 12,
                                      padding: '5px 12px',
                                      fontWeight: detailMode === 'INDIVIDUAL' ? 700 : 500
                                    }}
                                  >
                                    Scanned Rolls / Units List
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  onClick={() => handlePrintA4(s.id)}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 }}
                                >
                                  <Printer size={13} /> Print A4 Challan
                                </button>
                              </div>
                            </div>

                            {/* View 1: Consolidated View (Grouped by Product Master) */}
                            {detailMode === 'GROUPED' ? (
                              <table className="table" style={{ fontSize: 13 }}>
                                <thead>
                                  <tr>
                                    <th style={{ width: 40 }}>#</th>
                                    <th>Product Description</th>
                                    <th>Type</th>
                                    <th>Total Units Shipped</th>
                                    <th style={{ textAlign: 'right' }}>Total Quantity</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {groupedList.map((g, idx) => (
                                    <tr key={idx}>
                                      <td className="text-muted text-xs">{idx + 1}</td>
                                      <td>
                                        <strong>{g.brand}</strong> {g.category ? `· ${g.category.replace(/_/g, ' ')}` : ''} {g.quality ? `· ${g.quality}` : ''}
                                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                          {g.shade ? `Color: ${g.shade}` : ''} {g.size ? `· Size ${g.size}` : ''}
                                        </div>
                                      </td>
                                      <td>
                                        <span className={`badge ${g.itemType === 'FABRIC' ? 'badge-primary' : g.itemType === 'READY_MADE' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 11 }}>
                                          {g.itemType.replace(/_/g, ' ')}
                                        </span>
                                      </td>
                                      <td>
                                        <span className="badge badge-neutral" style={{ fontWeight: 600 }}>
                                          {g.unitCount} {g.itemType === 'FABRIC' ? (g.unitCount === 1 ? 'Roll' : 'Rolls') : 'Boxes/Packs'}
                                        </span>
                                      </td>
                                      <td style={{ textAlign: 'right' }}>
                                        <strong style={{ fontSize: 14, color: 'var(--color-brand)' }}>
                                          {g.totalQuantity} {g.unit}
                                        </strong>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              /* View 2: Scanned Individual Rolls List */
                              <table className="table" style={{ fontSize: 13 }}>
                                <thead>
                                  <tr>
                                    <th>Roll / Batch Barcode</th>
                                    <th>Product Details</th>
                                    <th>Type</th>
                                    <th>Dispatched Qty</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {s.lines.map((l) => (
                                    <tr key={l.id}>
                                      <td>
                                        <code style={{ fontWeight: 700, color: 'var(--color-brand)' }}>{l.batchCode}</code>
                                      </td>
                                      <td>
                                        <strong>{l.brand}</strong> {l.quality ? `— ${l.quality}` : ''} · {l.shade} {l.size ? `(Size ${l.size})` : ''}
                                      </td>
                                      <td>
                                        <span className={`badge ${l.itemType === 'FABRIC' ? 'badge-primary' : l.itemType === 'READY_MADE' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 11 }}>
                                          {l.itemType.replace(/_/g, ' ')}
                                        </span>
                                      </td>
                                      <td><strong>{l.quantity} {l.unit}</strong></td>
                                      <td>
                                        {l.isPartialCut ? (
                                          <span className="badge badge-warning" style={{ fontSize: 11 }}>
                                            Partial Roll Cut
                                          </span>
                                        ) : (
                                          <span className="badge badge-success" style={{ fontSize: 11 }}>
                                            <CheckCircle2 size={11} style={{ marginRight: 4 }} /> Full Package
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
