import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { 
  Building2, 
  Search, 
  Plus, 
  Download, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Package, 
  MapPin, 
  Phone, 
  Edit, 
  X, 
  Layers, 
  ShoppingCart, 
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Check,
  Eye
} from 'lucide-react';
import api from '../../../utils/api';
import { formatDate } from '../../../utils/format';
import { formatQty, formatTotals, unitLabel } from '../../../utils/units';
import '../../../styles/components.css';

interface SupplierTrackingItem {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  notes: string | null;
  isActive: boolean;
  totalPOs: number;
  openPOs: number;
  discrepanciesCount: number;
  inStockBatches: number;
  inStockMeters: number;
  inStockKg?: number;
  inStockUnits: number;
  createdAt: string;
  updatedAt: string;
}

interface SupplierBatchLocation {
  quantity: number;
  location?: {
    code: string;
    bay?: {
      name: string;
      code: string;
    };
  };
}

interface SupplierBatch {
  id: string;
  batchCode: string;
  itemType: string;
  category: string | null;
  brand: string | null;
  quality: string | null;
  shade: string | null;
  size: string | null;
  name: string | null;
  artNo: string | null;
  quantity: number;
  uom: string;
  status: string;
  supplierBundle: string | null;
  invoiceRef: string | null;
  notes: string | null;
  createdAt: string;
  poLine?: {
    id: string;
    orderedQty?: number;
    receivedQty?: number;
    uom?: string;
    po?: {
      id: string;
      poNumber: string;
      createdAt: string;
      expectedDate: string;
      status: string;
      targetClient: string | null;
    };
  };
  batchLocations?: SupplierBatchLocation[];
}

interface SupplierPOLineBatch {
  id: string;
  batchCode: string;
  quantity: number;
  status: string;
  supplierBundle: string | null;
  invoiceRef: string | null;
  batchLocations?: {
    quantity: number;
    location?: {
      code: string;
    };
  }[];
}

interface SupplierPOLine {
  id: string;
  itemType: string;
  category: string | null;
  brand: string | null;
  quality: string | null;
  qualityName?: string | null;
  shade: string | null;
  size: string | null;
  name: string | null;
  artNo: string | null;
  orderedQty: number;
  receivedQty: number;
  uom: string;
  notes: string | null;
  batches?: SupplierPOLineBatch[];
}

interface SupplierPODetail {
  id: string;
  poNumber: string;
  expectedDate: string;
  status: string;
  targetClient: string | null;
  notes: string | null;
  createdAt: string;
  createdBy?: {
    name: string;
  };
  lines?: SupplierPOLine[];
}

interface SupplierDiscrepancy {
  id: string;
  invoiceRef: string;
  bundleNumber: string;
  itemType: string | null;
  brand: string | null;
  quality: string | null;
  shade: string | null;
  size: string | null;
  issueType: string;
  expectedQty: number | null;
  receivedQty: number | null;
  notes: string | null;
  createdAt: string;
  reportedBy?: {
    name: string;
  };
}

export default function SuppliersTrackingPage() {
  const [suppliers, setSuppliers] = useState<SupplierTrackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierTrackingItem | null>(null);
  const [modalForm, setModalForm] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    gstin: '',
    notes: '',
    isActive: true,
  });
  const [submittingModal, setSubmittingModal] = useState(false);

  // Inspector Drawer state
  const [selectedSupplierStock, setSelectedSupplierStock] = useState<{
    supplier: SupplierTrackingItem;
    batches: SupplierBatch[];
    pos: SupplierPODetail[];
    discrepancies: SupplierDiscrepancy[];
  } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'STOCK' | 'POS' | 'DISCREPANCIES'>('STOCK');
  const [loadingStock, setLoadingStock] = useState(false);
  const [batchSearch, setBatchSearch] = useState('');
  const [stockStatusFilter, setStockStatusFilter] = useState<'IN_STOCK' | 'ALL'>('IN_STOCK');
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/suppliers/inventory-tracking', {
        params: {
          search: search || undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined
        }
      });
      setSuppliers(res.data);
    } catch (err: any) {
      console.error('Failed to load supplier tracking:', err);
      try {
        const fallback = await api.get('/api/suppliers');
        setSuppliers(fallback.data.map((s: any) => ({
          ...s,
          discrepanciesCount: 0,
          inStockBatches: 0,
          inStockMeters: 0,
          inStockUnits: 0,
        })));
      } catch (fErr: any) {
        setStatusMsg({ type: 'error', text: fErr.response?.data?.error || 'Failed to load suppliers' });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, [statusFilter]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    fetchSuppliers();
  };


  // Open modal for new supplier
  const openAddModal = () => {
    setEditingSupplier(null);
    setModalForm({
      name: '',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      city: '',
      state: '',
      gstin: '',
      notes: '',
      isActive: true,
    });
    setIsModalOpen(true);
  };

  // Open modal for editing
  const openEditModal = (supplier: SupplierTrackingItem) => {
    setEditingSupplier(supplier);
    setModalForm({
      name: supplier.name,
      contactPerson: supplier.contactPerson || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      city: supplier.city || '',
      state: supplier.state || '',
      gstin: supplier.gstin || '',
      notes: supplier.notes || '',
      isActive: supplier.isActive,
    });
    setIsModalOpen(true);
  };

  // Save supplier modal
  const handleSaveModal = async (e: FormEvent) => {
    e.preventDefault();
    setSubmittingModal(true);
    setStatusMsg(null);
    try {
      if (editingSupplier) {
        await api.put(`/api/suppliers/${editingSupplier.id}`, modalForm);
        setStatusMsg({ type: 'success', text: `Supplier '${modalForm.name}' updated successfully.` });
      } else {
        await api.post('/api/suppliers', modalForm);
        setStatusMsg({ type: 'success', text: `New supplier '${modalForm.name}' registered successfully.` });
      }
      setIsModalOpen(false);
      fetchSuppliers();
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.response?.data?.error || 'Failed to save supplier details.' });
    } finally {
      setSubmittingModal(false);
    }
  };

  // View Stock & PO Inspector Drawer
  const handleViewStock = async (supplier: SupplierTrackingItem, initialTab: 'STOCK' | 'POS' = 'STOCK') => {
    setLoadingStock(true);
    setInspectorTab(initialTab);
    setBatchSearch('');
    setExpandedPoId(null);
    setSelectedSupplierStock({ supplier, batches: [], pos: [], discrepancies: [] });
    try {
      const [stockRes, supplierDetailRes] = await Promise.all([
        api.get(`/api/suppliers/${supplier.id}/stock`, {
          params: { status: stockStatusFilter }
        }).catch(() => ({ data: [] })),
        api.get(`/api/suppliers/${supplier.id}`).catch(() => ({ data: { purchaseOrders: [], inboundDiscrepancies: [] } }))
      ]);
      setSelectedSupplierStock({
        supplier,
        batches: stockRes.data || [],
        pos: supplierDetailRes.data?.purchaseOrders || [],
        discrepancies: supplierDetailRes.data?.inboundDiscrepancies || []
      });
    } catch (err: any) {
      console.error('Failed to load supplier stock and POs:', err);
    } finally {
      setLoadingStock(false);
    }
  };

  // Re-fetch batches when stockStatusFilter changes inside drawer
  const reloadStockForStatus = async (newStatus: 'IN_STOCK' | 'ALL') => {
    if (!selectedSupplierStock) return;
    setStockStatusFilter(newStatus);
    setLoadingStock(true);
    try {
      const res = await api.get(`/api/suppliers/${selectedSupplierStock.supplier.id}/stock`, {
        params: { status: newStatus }
      });
      setSelectedSupplierStock(prev => prev ? ({ ...prev, batches: res.data || [] }) : null);
    } catch (e) {
      console.error('Failed to reload stock filter:', e);
    } finally {
      setLoadingStock(false);
    }
  };

  // Filtered batches for drawer search
  const filteredBatches = useMemo(() => {
    if (!selectedSupplierStock?.batches) return [];
    if (!batchSearch.trim()) return selectedSupplierStock.batches;
    const term = batchSearch.toLowerCase().trim();
    return selectedSupplierStock.batches.filter(b => 
      b.batchCode?.toLowerCase().includes(term) ||
      b.brand?.toLowerCase().includes(term) ||
      b.quality?.toLowerCase().includes(term) ||
      b.shade?.toLowerCase().includes(term) ||
      b.supplierBundle?.toLowerCase().includes(term) ||
      b.invoiceRef?.toLowerCase().includes(term) ||
      b.poLine?.po?.poNumber?.toLowerCase().includes(term) ||
      b.batchLocations?.some(bl => bl.location?.code?.toLowerCase().includes(term))
    );
  }, [selectedSupplierStock?.batches, batchSearch]);

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'Supplier Code',
      'Supplier / Mill Name',
      'City',
      'State',
      'Contact Person',
      'Phone',
      'Email',
      'GSTIN',
      'Open POs',
      'Warehouse Batches in Stock',
      'Fabric in Stock (Meters)',
      'Fabric in Stock (Kg)',
      'Units in Stock',
      'Inbound Discrepancies',
      'Status'
    ];

    const rows = suppliers.map(s => [
      s.code,
      `"${s.name.replace(/"/g, '""')}"`,
      `"${(s.city || '').replace(/"/g, '""')}"`,
      `"${(s.state || '').replace(/"/g, '""')}"`,
      `"${(s.contactPerson || '').replace(/"/g, '""')}"`,
      `"${s.phone || ''}"`,
      `"${s.email || ''}"`,
      `"${s.gstin || ''}"`,
      s.openPOs,
      s.inStockBatches,
      s.inStockMeters,
      s.inStockKg || 0,
      s.inStockUnits,
      s.discrepanciesCount,
      s.isActive ? 'Active' : 'Inactive'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `suppliers_inventory_tracking_${formatDate(new Date())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1440, margin: '0 auto' }}>
      {/* ── Page Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Building2 size={28} /> Suppliers Inventory & Stock Tracking
          </h1>
          <p className="page-subtitle" style={{ marginTop: 4 }}>
            Monitor vendor purchase orders, live warehouse stock levels, bin locations, and supply fulfillment.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={handleExportCSV}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Download size={18} /> Export CSV
          </button>
          <button 
            type="button" 
            className="btn btn-primary" 
            onClick={openAddModal}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Plus size={18} /> New Supplier
          </button>
        </div>
      </div>

      {/* ── Status Message Banner ── */}
      {statusMsg && (
        <div 
          className={`alert ${statusMsg.type === 'success' ? 'alert-success' : 'alert-danger'}`}
          style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}
        >
          {statusMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{statusMsg.text}</span>
        </div>
      )}


      {/* ── Search & Filter Controls ── */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search 
              size={18} 
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} 
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: 38 }}
              placeholder="Search by supplier name, code, brand tag, contact person, or city..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div style={{ width: 180 }}>
            <select
              className="form-input"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active Suppliers</option>
              <option value="INACTIVE">Inactive Suppliers</option>
            </select>
          </div>

          <button 
            type="submit" 
            className="btn btn-secondary" 
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={16} /> Filter
          </button>
        </form>
      </div>

      {/* ── Suppliers Master Data & Stock Table ── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={18} /> Registered Suppliers & Stock ({suppliers.length})
          </h2>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Showing verified warehouse batches and PO states
          </span>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Code</th>
                <th>Supplier / Mill Name</th>
                <th>Location</th>
                <th>Contact Info</th>
                <th style={{ textAlign: 'center' }}>Open POs</th>
                <th style={{ textAlign: 'right' }}>Stock in Warehouse</th>
                <th style={{ textAlign: 'center' }}>Discrepancies</th>
                <th style={{ textAlign: 'center', width: 90 }}>Status</th>
                <th style={{ textAlign: 'right', width: 220 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '60px 0' }}>
                    <span className="spinner spinner-lg" />
                  </td>
                </tr>
              ) : suppliers.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-muted)' }}>
                    No suppliers found matching your query.
                  </td>
                </tr>
              ) : (
                suppliers.map(s => (
                  <tr key={s.id}>
                    <td>
                      <code style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: 4, fontWeight: 700, fontSize: 12, color: 'var(--color-brand)' }}>
                        {s.code}
                      </code>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--color-text-main)', fontSize: 14 }}>
                        {s.name}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--color-text-main)' }}>
                        <MapPin size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                        <span>{[s.city, s.state].filter(Boolean).join(', ')}</span>
                      </div>
                    </td>
                    <td>
                      {s.contactPerson && (
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)' }}>
                          {s.contactPerson}
                        </div>
                      )}
                      {s.phone && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <Phone size={12} /> {s.phone}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {s.openPOs > 0 ? (
                        <button
                          type="button"
                          onClick={() => handleViewStock(s, 'POS')}
                          className="badge badge-warning" 
                          style={{ fontWeight: 700, padding: '4px 8px', cursor: 'pointer', border: 'none' }}
                          title="Click to verify open purchase orders"
                        >
                          {s.openPOs} Open POs
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>0 Pending</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: s.inStockMeters > 0 || (s.inStockKg || 0) > 0 ? '#16a34a' : 'var(--color-text-muted)' }}>
                        {formatTotals([{ uom: 'METERS', quantity: s.inStockMeters }, ...((s.inStockKg || 0) > 0 ? [{ uom: 'KG', quantity: s.inStockKg! }] : [])])}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {s.inStockBatches} rolls · {s.inStockUnits} garments
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {s.discrepanciesCount > 0 ? (
                        <span className="badge badge-danger" style={{ fontWeight: 700 }}>
                          {s.discrepanciesCount} Issues
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Check size={14} /> Clear
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${s.isActive ? 'badge-success' : 'badge-neutral'}`}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleViewStock(s, 'STOCK')}
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          title="Inspect warehouse batches and verify POs"
                        >
                          <Eye size={14} /> View Stock & PO
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => openEditModal(s)}
                          style={{ padding: '6px 8px' }}
                          title="Edit Supplier Profile"
                        >
                          <Edit size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Add / Edit Supplier Modal ─── */}
      {isModalOpen && (
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
          padding: 20,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 580, boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building2 size={18} color="var(--color-brand)" />
                {editingSupplier ? `Edit Supplier: ${editingSupplier.code}` : 'Register New Supplier'}
              </h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsModalOpen(false)} style={{ padding: 6 }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveModal} style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Supplier Legal Name <span style={{ color: 'red' }}>*</span></label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. Raymond Ltd. / Siyaram Silk Mills"
                    value={modalForm.name}
                    onChange={e => setModalForm(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>City / Textile Hub</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Surat / Bhilwara"
                    value={modalForm.city}
                    onChange={e => setModalForm(prev => ({ ...prev, city: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>State</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Gujarat / Rajasthan"
                    value={modalForm.state}
                    onChange={e => setModalForm(prev => ({ ...prev, state: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Contact Person</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Sales rep or Mill coordinator"
                    value={modalForm.contactPerson}
                    onChange={e => setModalForm(prev => ({ ...prev, contactPerson: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Phone Number</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="+91 98765 43210"
                    value={modalForm.phone}
                    onChange={e => setModalForm(prev => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Email Address</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="orders@supplier.com"
                    value={modalForm.email}
                    onChange={e => setModalForm(prev => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>GSTIN</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="24AAACS1234F1Z5"
                    value={modalForm.gstin}
                    onChange={e => setModalForm(prev => ({ ...prev, gstin: e.target.value.toUpperCase() }))}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Address</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Factory or mill dispatch address"
                  value={modalForm.address}
                  onChange={e => setModalForm(prev => ({ ...prev, address: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submittingModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingModal}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {submittingModal && <span className="spinner spinner-sm" />}
                  {editingSupplier ? 'Save Changes' : 'Register Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Comprehensive Stock & PO Verification Drawer ─── */}
      {selectedSupplierStock && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 1000,
        }}>
          <div style={{
            width: '100%',
            maxWidth: 880,
            background: '#ffffff',
            height: '100%',
            boxShadow: '-4px 0 25px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Drawer Header */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', background: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-text-main)' }}>
                      {selectedSupplierStock.supplier.name}
                    </span>
                    <code style={{ background: '#e2e8f0', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700, color: 'var(--color-brand)' }}>
                      {selectedSupplierStock.supplier.code}
                    </code>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {selectedSupplierStock.supplier.city ? `${selectedSupplierStock.supplier.city}, ` : ''}{selectedSupplierStock.supplier.state || ''} · {selectedSupplierStock.supplier.contactPerson || 'Vendor'}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedSupplierStock(null)}
                  style={{ padding: 6 }}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Navigation Tabs Inside Drawer */}
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => setInspectorTab('STOCK')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: 'none',
                    background: inspectorTab === 'STOCK' ? 'var(--color-brand)' : '#e2e8f0',
                    color: inspectorTab === 'STOCK' ? '#ffffff' : '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <Layers size={15} /> Verified Warehouse Stock ({selectedSupplierStock.batches.length})
                </button>

                <button
                  type="button"
                  onClick={() => setInspectorTab('POS')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: 'none',
                    background: inspectorTab === 'POS' ? 'var(--color-brand)' : '#e2e8f0',
                    color: inspectorTab === 'POS' ? '#ffffff' : '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <ShoppingCart size={15} /> Registered POs ({selectedSupplierStock.pos.length})
                </button>

                <button
                  type="button"
                  onClick={() => setInspectorTab('DISCREPANCIES')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: 'none',
                    background: inspectorTab === 'DISCREPANCIES' ? '#dc2626' : '#e2e8f0',
                    color: inspectorTab === 'DISCREPANCIES' ? '#ffffff' : '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <AlertTriangle size={15} /> Discrepancies ({selectedSupplierStock.discrepancies.length})
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              {loadingStock ? (
                <div style={{ textAlign: 'center', padding: '80px 0' }}>
                  <span className="spinner spinner-lg" />
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 10 }}>
                    Loading supplier stock and purchase order verification data...
                  </div>
                </div>
              ) : (
                <>
                  {/* ─── TAB 1: VERIFIED WAREHOUSE STOCK ─── */}
                  {inspectorTab === 'STOCK' && (
                    <div>
                      {/* Search and Filter Bar */}
                      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                          <input
                            type="text"
                            className="form-input"
                            style={{ paddingLeft: 32, height: 36, fontSize: 13 }}
                            placeholder="Search batch code, brand, quality, shade, location, bundle, or invoice..."
                            value={batchSearch}
                            onChange={e => setBatchSearch(e.target.value)}
                          />
                        </div>

                        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
                          <button
                            type="button"
                            onClick={() => reloadStockForStatus('IN_STOCK')}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 4,
                              fontSize: 11.5,
                              fontWeight: 600,
                              border: 'none',
                              cursor: 'pointer',
                              background: stockStatusFilter === 'IN_STOCK' ? '#ffffff' : 'transparent',
                              color: stockStatusFilter === 'IN_STOCK' ? 'var(--color-brand)' : '#64748b',
                              boxShadow: stockStatusFilter === 'IN_STOCK' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                          >
                            In Stock Only
                          </button>
                          <button
                            type="button"
                            onClick={() => reloadStockForStatus('ALL')}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 4,
                              fontSize: 11.5,
                              fontWeight: 600,
                              border: 'none',
                              cursor: 'pointer',
                              background: stockStatusFilter === 'ALL' ? '#ffffff' : 'transparent',
                              color: stockStatusFilter === 'ALL' ? 'var(--color-brand)' : '#64748b',
                              boxShadow: stockStatusFilter === 'ALL' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                          >
                            All Received
                          </button>
                        </div>
                      </div>

                      {filteredBatches.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
                          <Package size={36} style={{ color: '#cbd5e1', margin: '0 auto 10px' }} />
                          <p style={{ margin: 0, fontWeight: 600 }}>No stock batches found.</p>
                          <p style={{ fontSize: 12, margin: '4px 0 0 0' }}>No physical rolls or batches matching your criteria were found in warehouse.</p>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {filteredBatches.map((batch: any) => {
                            const locCodes = batch.batchLocations?.map((bl: any) => bl.location?.code).filter(Boolean).join(', ') || 'Unassigned Bay';
                            const isFabric = batch.itemType === 'FABRIC';

                            return (
                              <div 
                                key={batch.id} 
                                className="card" 
                                style={{ 
                                  padding: '12px 16px', 
                                  borderLeft: `4px solid ${batch.quantity > 0 ? '#16a34a' : '#94a3b8'}`,
                                  background: batch.quantity <= 0 ? '#f8fafc' : '#ffffff'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <strong style={{ fontSize: 14, color: 'var(--color-text-main)' }}>{batch.batchCode}</strong>
                                      <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
                                        {batch.itemType}
                                      </span>
                                      <span className={`badge ${batch.status === 'IN_STOCK' ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: 10.5 }}>
                                        {batch.status}
                                      </span>
                                    </div>

                                    <div style={{ fontSize: 13, color: '#334155', fontWeight: 600, marginTop: 4 }}>
                                      {[batch.brand, batch.quality, batch.qualityName, batch.shade && `Shade: ${batch.shade}`, batch.size && `Size: ${batch.size}`].filter(Boolean).join(' · ')}
                                    </div>

                                    {/* Location & PO Traceability */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11.5, color: '#64748b', marginTop: 6, alignItems: 'center' }}>
                                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <MapPin size={13} color="var(--color-brand)" />
                                        <span>Bin Rack: <strong style={{ color: 'var(--color-brand)' }}>{locCodes}</strong></span>
                                      </span>

                                      {batch.poLine?.po?.poNumber && (
                                        <span>
                                          PO: <strong style={{ color: '#0369a1' }}>{batch.poLine.po.poNumber}</strong>
                                        </span>
                                      )}

                                      {batch.supplierBundle && (
                                        <span>
                                          Bundle/Lump: <strong>{batch.supplierBundle}</strong>
                                        </span>
                                      )}

                                      {batch.invoiceRef && (
                                        <span>
                                          Invoice Ref: <strong>{batch.invoiceRef}</strong>
                                        </span>
                                      )}

                                      <span>Received: {formatDate(batch.createdAt)}</span>
                                    </div>
                                  </div>

                                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                    <div style={{ fontWeight: 800, fontSize: 16, color: batch.quantity > 0 ? '#16a34a' : '#64748b' }}>
                                      {formatQty(batch.quantity, batch.uom || (isFabric ? 'METERS' : 'PCS'))}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                                      Current Shelf Qty
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ─── TAB 2: REGISTERED PURCHASE ORDERS & VERIFICATION ─── */}
                  {inspectorTab === 'POS' && (
                    <div>
                      {selectedSupplierStock.pos.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
                          <ShoppingCart size={36} style={{ color: '#cbd5e1', margin: '0 auto 10px' }} />
                          <p style={{ margin: 0, fontWeight: 600 }}>No registered Purchase Orders.</p>
                          <p style={{ fontSize: 12, margin: '4px 0 0 0' }}>There are no purchase orders recorded for this supplier.</p>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {selectedSupplierStock.pos.map(po => {
                            const isExpanded = expandedPoId === po.id;
                            const totalOrdered = po.lines?.reduce((sum, l) => sum + (l.orderedQty || 0), 0) || 0;
                            const totalReceived = po.lines?.reduce((sum, l) => sum + (l.receivedQty || 0), 0) || 0;
                            const fulfillmentPct = totalOrdered > 0 ? Math.min(100, Math.round((totalReceived / totalOrdered) * 100)) : 0;

                            return (
                              <div key={po.id} className="card" style={{ padding: 16, borderLeft: `4px solid ${po.status === 'COMPLETED' ? '#16a34a' : po.status === 'PARTIALLY_RECEIVED' ? '#0284c7' : '#f59e0b'}` }}>
                                {/* PO Header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <strong style={{ fontSize: 15, color: 'var(--color-brand)' }}>{po.poNumber}</strong>
                                      <span className={`badge ${po.status === 'COMPLETED' ? 'badge-success' : po.status === 'PARTIALLY_RECEIVED' ? 'badge-warning' : 'badge-neutral'}`} style={{ fontSize: 11 }}>
                                        {po.status}
                                      </span>
                                      {po.targetClient && (
                                        <span style={{ fontSize: 11.5, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#475569' }}>
                                          Client: <strong>{po.targetClient}</strong>
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                                      Placed: {formatDate(po.createdAt)} · Expected: {formatDate(po.expectedDate)} {po.createdBy?.name && `· By: ${po.createdBy.name}`}
                                    </div>
                                  </div>

                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: fulfillmentPct === 100 ? '#16a34a' : 'var(--color-text-main)' }}>
                                      {totalReceived} / {totalOrdered} Units ({fulfillmentPct}%)
                                    </div>
                                    <div style={{ width: 140, height: 6, background: '#e2e8f0', borderRadius: 3, marginTop: 4, overflow: 'hidden' }}>
                                      <div style={{ width: `${fulfillmentPct}%`, height: '100%', background: fulfillmentPct === 100 ? '#16a34a' : '#0284c7' }} />
                                    </div>
                                  </div>
                                </div>

                                {/* Toggle Lines Expander */}
                                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedPoId(isExpanded ? null : po.id)}
                                    className="btn btn-ghost btn-sm"
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-brand)', padding: '4px 8px' }}
                                  >
                                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    {isExpanded ? 'Hide Line Items' : `Verify PO Lines (${po.lines?.length || 0} Items)`}
                                  </button>

                                  <a 
                                    href={`/purchase-orders/${po.id}/view`} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-brand)', textDecoration: 'none', fontWeight: 600 }}
                                  >
                                    <span>Full PO Contract</span>
                                    <ExternalLink size={12} />
                                  </a>
                                </div>

                                {/* Expanded PO Verification Lines */}
                                {isExpanded && po.lines && (
                                  <div style={{ marginTop: 12, background: '#f8fafc', borderRadius: 6, padding: 12, border: '1px solid #e2e8f0' }}>
                                    <div style={{ fontWeight: 700, fontSize: 12, color: '#334155', marginBottom: 8 }}>
                                      Ordered Lines & Stock Inward Verification:
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      {po.lines.map(line => {
                                        const linePct = line.orderedQty > 0 ? Math.round((line.receivedQty / line.orderedQty) * 100) : 0;
                                        return (
                                          <div key={line.id} style={{ background: '#ffffff', borderRadius: 4, border: '1px solid #cbd5e1', padding: '8px 12px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                              <div>
                                                <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                                                  {[line.brand || line.name, line.quality, line.qualityName, line.shade && `Shade: ${line.shade}`].filter(Boolean).join(' · ')}
                                                </div>
                                                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                                                  {[`Type: ${line.itemType}`, line.category && `Category: ${line.category}`, line.size && `Size: ${line.size}`].filter(Boolean).join(' · ')}
                                                </div>
                                              </div>
                                              <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontWeight: 700, fontSize: 13, color: linePct >= 100 ? '#16a34a' : '#d97706' }}>
                                                  {line.receivedQty} / {line.orderedQty} {unitLabel(line.uom)} ({linePct}%)
                                                </div>
                                              </div>
                                            </div>

                                            {/* Generated Batches Traceability */}
                                            {line.batches && line.batches.length > 0 && (
                                              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e2e8f0' }}>
                                                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                                                  Batches Received & Stored ({line.batches.length} rolls):
                                                </div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                  {line.batches.map(b => {
                                                    const loc = b.batchLocations?.[0]?.location?.code || 'Dock';
                                                    return (
                                                      <span key={b.id} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
                                                        <strong>{b.batchCode}</strong>: {formatQty(b.quantity, line.uom)} <span style={{ color: 'var(--color-brand)' }}>({loc})</span>
                                                      </span>
                                                    );
                                                  })}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ─── TAB 3: INBOUND DISCREPANCIES ─── */}
                  {inspectorTab === 'DISCREPANCIES' && (
                    <div>
                      {selectedSupplierStock.discrepancies.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
                          <CheckCircle2 size={36} style={{ color: '#16a34a', margin: '0 auto 10px' }} />
                          <p style={{ margin: 0, fontWeight: 700, color: '#16a34a' }}>Clean Delivery Record</p>
                          <p style={{ fontSize: 12, margin: '4px 0 0 0' }}>No shortages, bundle defects, or inward discrepancies recorded for this supplier.</p>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {selectedSupplierStock.discrepancies.map(disc => (
                            <div key={disc.id} className="card" style={{ padding: '12px 16px', borderLeft: '4px solid #dc2626' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <strong style={{ fontSize: 14, color: '#dc2626' }}>{disc.issueType}</strong>
                                    <span style={{ fontSize: 11, background: '#fef2f2', color: '#991b1b', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>
                                      Bundle: {disc.bundleNumber}
                                    </span>
                                    <span style={{ fontSize: 11, background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: 3 }}>
                                      Invoice: {disc.invoiceRef}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 12.5, color: '#334155', marginTop: 4 }}>
                                    {disc.brand} · {disc.quality} {disc.shade && `(${disc.shade})`}
                                  </div>
                                  {disc.notes && (
                                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontStyle: 'italic' }}>
                                      "{disc.notes}"
                                    </div>
                                  )}
                                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                                    Reported: {formatDate(disc.createdAt)} {disc.reportedBy?.name && `by ${disc.reportedBy.name}`}
                                  </div>
                                </div>

                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontWeight: 800, fontSize: 14, color: '#dc2626' }}>
                                    Diff: {((disc.receivedQty || 0) - (disc.expectedQty || 0)).toFixed(1)}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                    Exp: {disc.expectedQty} · Rec: {disc.receivedQty}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
