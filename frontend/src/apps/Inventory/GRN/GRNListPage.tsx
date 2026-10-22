import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { 
  FileCheck, 
  Search, 
  Calendar, 
  Printer, 
  Eye, 
  AlertTriangle, 
  CheckCircle2, 
  X,
  RotateCcw
} from 'lucide-react';
import { formatDate } from '../../../utils/format';
import { formatUnitTotals } from '../../../utils/units';
import '../../../styles/components.css';

interface GRNItem {
  id: string;
  grnNumber: string;
  supplierName: string;
  supplier?: { id: string; code: string; name: string } | null;
  invoiceRef: string | null;
  poNumber: string | null;
  totalRolls: number;
  totalQuantity: number;
  quantityTotals?: [string, number][];
  status: string;
  remarks: string | null;
  receivedBy?: { id: string; name: string } | null;
  createdAt: string;
  _count?: {
    lines: number;
    batches: number;
    discrepancies: number;
  };
}

export default function GRNListPage() {
  const navigate = useNavigate();

  const [grns, setGrns] = useState<GRNItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchGrns = async () => {
    setLoading(true);
    setError('');
    try {
      const params: any = { limit: 100 };
      if (search.trim()) params.search = search.trim();
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await api.get('/api/grn', { params });
      setGrns(res.data?.grns || []);
      setTotal(res.data?.total || 0);
    } catch (err: any) {
      console.error('Failed to load GRNs:', err);
      setError(err?.response?.data?.error || 'Failed to fetch Goods Receipt Notes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGrns();
  }, [startDate, endDate]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchGrns();
  };

  const handlePrint = async (grnId: string) => {
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

  const handleClearAll = () => {
    setSearch('');
    setStartDate('');
    setEndDate('');
    setTimeout(() => {
      fetchGrns();
    }, 0);
  };

  const hasActiveFilters = Boolean(search || startDate || endDate);

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', paddingBottom: 40 }}>
      {/* Page Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: 20 }}>
          <FileCheck size={24} /> Goods Receipt Notes (GRN)
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Official inward delivery vouchers and warehouse receiving registry
        </p>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Filter Toolbar */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: 16 }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          
          {/* Search Input */}
          <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 260, position: 'relative' }}>
            <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input 
              type="text"
              className="form-input"
              placeholder="Search GRN #, Supplier, Invoice Ref, PO #..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32, width: '100%', height: 36, fontSize: 12.5 }}
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(''); fetchGrns(); }}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  padding: 2
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Date Filter & Presets */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            
            {/* Calendar Range Pill */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              background: '#ffffff', 
              border: (startDate || endDate) ? '1px solid var(--color-brand)' : '1px solid var(--color-border)', 
              borderRadius: 'var(--radius-md)', 
              padding: '2px 8px', 
              height: 36,
              gap: 6,
              boxShadow: 'var(--shadow-xs)'
            }}>
              <Calendar size={15} color={(startDate || endDate) ? 'var(--color-brand)' : 'var(--color-text-muted)'} />
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)} 
                title="From Date"
                style={{ 
                  border: 'none', 
                  outline: 'none', 
                  fontSize: 12, 
                  color: 'var(--color-text-main)', 
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  width: 110
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>&ndash;</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)} 
                title="To Date"
                style={{ 
                  border: 'none', 
                  outline: 'none', 
                  fontSize: 12, 
                  color: 'var(--color-text-main)', 
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  width: 110
                }}
              />
              {(startDate || endDate) && (
                <button 
                  type="button"
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  title="Clear date filter"
                  style={{ 
                    border: 'none', 
                    background: 'none', 
                    cursor: 'pointer', 
                    padding: '2px', 
                    display: 'flex', 
                    alignItems: 'center',
                    color: 'var(--color-text-muted)'
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>



            {hasActiveFilters && (
              <button 
                type="button" 
                className="btn btn-ghost btn-sm"
                onClick={handleClearAll}
                title="Reset all filters"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-text-muted)', fontSize: 12, height: 32 }}
              >
                <RotateCcw size={13} /> Reset
              </button>
            )}

            <button type="submit" className="btn btn-secondary btn-sm" style={{ height: 34, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
              <Search size={13} /> Search
            </button>
          </div>
        </form>
      </div>

      {/* Counter bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 4px' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>
          {loading ? 'Searching records...' : `${total} Goods Receipt Note${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* GRN Register Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, width: '100%', margin: 0 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ width: 140 }}>GRN Number</th>
                <th style={{ width: 110 }}>Intake Date</th>
                <th>Supplier / Mill</th>
                <th>Supplier Invoice</th>
                <th>Purchase Order</th>
                <th style={{ textAlign: 'center', width: 75 }}>Rolls/Pcs</th>
                <th style={{ textAlign: 'right', width: 100 }}>Total Qty</th>
                <th style={{ width: 125 }}>Intake Audit</th>
                <th style={{ width: 110 }}>Received By</th>
                <th style={{ textAlign: 'center', width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '48px 16px' }}>
                    <span className="spinner spinner-lg" />
                  </td>
                </tr>
              ) : grns.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--color-text-muted)' }}>
                    No Goods Receipt Notes match the selected criteria.
                  </td>
                </tr>
              ) : (
                grns.map(grn => {
                  const hasDiscrepancy = (grn._count?.discrepancies || 0) > 0;

                  return (
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
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>
                          {grn.supplierName}
                        </div>
                        {grn.supplier?.code && (
                          <span style={{ fontFamily: 'monospace', fontSize: 10.5, background: '#f1f5f9', padding: '1px 5px', borderRadius: 3, border: '1px solid #cbd5e1' }}>
                            {grn.supplier.code}
                          </span>
                        )}
                      </td>
                      <td>
                        {grn.invoiceRef ? (
                          <span style={{ fontWeight: 600, color: '#334155' }}>{grn.invoiceRef}</span>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                        )}
                      </td>
                      <td>
                        {grn.poNumber ? (
                          <span style={{ fontFamily: 'monospace', fontSize: 11.5, fontWeight: 600, color: '#1d4ed8' }}>
                            {grn.poNumber}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 11.5 }}>Direct Inward</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>
                        {grn.totalRolls}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#065f46' }}>
                        {grn.quantityTotals?.length ? formatUnitTotals(grn.quantityTotals) : grn.totalQuantity.toFixed(1)}
                      </td>
                      <td>
                        {hasDiscrepancy ? (
                          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700 }}>
                            <AlertTriangle size={11} /> Shortage
                          </span>
                        ) : (
                          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600 }}>
                            <CheckCircle2 size={11} /> Clean
                          </span>
                        )}
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
                            onClick={() => handlePrint(grn.id)}
                            title="Print GRN Voucher"
                            style={{ color: '#0f172a' }}
                          >
                            <Printer size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
