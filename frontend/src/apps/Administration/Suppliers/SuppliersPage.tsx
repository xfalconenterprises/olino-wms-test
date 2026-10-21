import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { formatDate } from '../../../utils/format';
import { 
  Building2, 
  Search, 
  Plus, 
  Edit, 
  Phone, 
  Mail, 
  MapPin, 
  CheckCircle2, 
  XCircle, 
  ShoppingCart, 
  ExternalLink, 
  X,
  RotateCcw
} from 'lucide-react';
import '../../../styles/components.css';

interface Supplier {
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
  createdAt: string;
  updatedAt: string;
}

interface SupplierPO {
  id: string;
  poNumber: string;
  expectedDate: string;
  status: string;
  targetClient: string | null;
  lines: { id: string; orderedQty: number; receivedQty: number }[];
}

export default function SuppliersPage() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
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
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // POs drawer state
  const [activeSupplierPOs, setActiveSupplierPOs] = useState<{ supplier: Supplier; pos: SupplierPO[] } | null>(null);
  const [loadingPOs, setLoadingPOs] = useState(false);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/suppliers');
      setSuppliers(res.data);
    } catch (err) {
      console.error('Failed to fetch suppliers', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter(s => {
      if (statusFilter === 'ACTIVE' && !s.isActive) return false;
      if (statusFilter === 'INACTIVE' && s.isActive) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.city && s.city.toLowerCase().includes(q)) ||
        (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
        (s.phone && s.phone.toLowerCase().includes(q)) ||
        (s.gstin && s.gstin.toLowerCase().includes(q))
      );
    });
  }, [suppliers, search, statusFilter]);

  const openCreateModal = () => {
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
    setModalError('');
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
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
    setModalError('');
    setIsModalOpen(true);
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    if (!modalForm.name.trim()) {
      setModalError('Supplier legal / mill name is required.');
      return;
    }

    setModalSubmitting(true);
    try {
      const payload = {
        name: modalForm.name.trim(),
        contactPerson: modalForm.contactPerson.trim() || undefined,
        phone: modalForm.phone.trim() || undefined,
        email: modalForm.email.trim() || undefined,
        address: modalForm.address.trim() || undefined,
        city: modalForm.city.trim() || undefined,
        state: modalForm.state.trim() || undefined,
        gstin: modalForm.gstin.trim() || undefined,
        notes: modalForm.notes.trim() || undefined,
        isActive: modalForm.isActive,
      };

      if (editingSupplier) {
        await api.put(`/api/suppliers/${editingSupplier.id}`, payload);
      } else {
        await api.post('/api/suppliers', payload);
      }

      setIsModalOpen(false);
      fetchSuppliers();
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to save supplier.';
      setModalError(msg);
    } finally {
      setModalSubmitting(false);
    }
  };

  const toggleStatus = async (supplier: Supplier) => {
    try {
      await api.put(`/api/suppliers/${supplier.id}`, {
        isActive: !supplier.isActive
      });
      fetchSuppliers();
    } catch (err) {
      console.error('Failed to toggle status', err);
    }
  };

  const viewSupplierPOs = async (supplier: Supplier) => {
    setLoadingPOs(true);
    try {
      const res = await api.get(`/api/suppliers/${supplier.id}`);
      setActiveSupplierPOs({ supplier, pos: res.data.purchaseOrders || [] });
    } catch (err) {
      console.error('Failed to load supplier POs', err);
    } finally {
      setLoadingPOs(false);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Page Header ── */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={28} /> Suppliers Master
          </h1>
          <p className="page-subtitle">Central directory of mills and vendors with auto-generated codes & roll brand tags</p>
        </div>
        <div className="page-actions">
          <button 
            className="btn btn-primary"
            onClick={openCreateModal}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Plus size={18} /> Add New Supplier
          </button>
        </div>
      </div>

      {/* ── Filters & Search Toolbar ── */}
      <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 300 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--color-text-muted)' }} />
              <input 
                type="text"
                className="form-input"
                placeholder="Search by supplier name, code, brand tag, city, phone..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 36, width: '100%', height: 40 }}
              />
            </div>
            {search && (
              <button 
                className="btn btn-ghost" 
                onClick={() => setSearch('')}
                style={{ padding: '0 8px', height: 40, color: 'var(--color-text-muted)' }}
              >
                Clear
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-md)', padding: 3 }}>
              {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map(f => (
                <button
                  key={f}
                  className="btn"
                  onClick={() => setStatusFilter(f)}
                  style={{
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 'var(--radius-sm)',
                    background: statusFilter === f ? '#fff' : 'transparent',
                    color: statusFilter === f ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                    boxShadow: statusFilter === f ? 'var(--shadow-sm)' : 'none',
                    border: 'none',
                  }}
                >
                  {f === 'ALL' ? 'All' : f === 'ACTIVE' ? 'Active Only' : 'Inactive Only'}
                </button>
              ))}
            </div>

            <button 
              className="btn btn-secondary"
              onClick={fetchSuppliers}
              title="Refresh"
              style={{ padding: '0 12px', height: 40, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RotateCcw size={16} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ── Table Card ── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Showing {filteredSuppliers.length} of {suppliers.length} suppliers
          </span>
        </div>

        {loading ? (
          <div className="loading-center" style={{ padding: 60 }}><span className="spinner spinner-lg" /></div>
        ) : filteredSuppliers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
            <Building2 size={40} style={{ opacity: 0.4, marginBottom: 12 }} />
            <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>No suppliers found</p>
            <p style={{ fontSize: 13, margin: '4px 0 16px 0' }}>Try adjusting your search criteria or add a new supplier.</p>
            <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
              <Plus size={14} /> Add Supplier
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, width: 120 }}>Code (Auto)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Supplier</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Contact Person</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Location</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>GSTIN</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, width: 110 }}>Open Orders</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, width: 90 }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {/* Code */}
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <span style={{ 
                        fontFamily: 'monospace', 
                        fontSize: 12, 
                        fontWeight: 700, 
                        background: 'var(--color-bg-subtle)', 
                        padding: '3px 8px', 
                        borderRadius: 4,
                        border: '1px solid var(--color-border)'
                      }}>
                        {s.code}
                      </span>
                    </td>

                    {/* Name */}
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: 600, color: 'var(--color-text-main)', fontSize: 14 }}>
                        {s.name}
                      </div>
                    </td>

                    {/* Contact */}
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: 500, color: 'var(--color-text-main)' }}>
                        {s.contactPerson || '—'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 10, marginTop: 2 }}>
                        {s.phone && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Phone size={12} /> {s.phone}
                          </span>
                        )}
                        {s.email && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Mail size={12} /> {s.email}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Location */}
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-text-main)', fontWeight: 500 }}>
                        <MapPin size={13} color="var(--color-text-muted)" />
                        {[s.city, s.state].filter(Boolean).join(', ') || '—'}
                      </div>
                    </td>

                    {/* GSTIN */}
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: s.gstin ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>
                        {s.gstin || '—'}
                      </span>
                    </td>

                    {/* Open Orders */}
                    <td style={{ padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle' }}>
                      {s.openPOs > 0 ? (
                        <button
                          className="btn btn-sm"
                          onClick={() => viewSupplierPOs(s)}
                          style={{
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                            fontWeight: 700,
                            padding: '3px 8px',
                            fontSize: 12,
                            cursor: 'pointer'
                          }}
                        >
                          {s.openPOs} Open
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {s.totalPOs > 0 ? `${s.totalPOs} total` : 'None'}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td style={{ padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <span className={`badge ${s.isActive ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 11, padding: '2px 8px' }}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '12px 16px', textAlign: 'right', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => openEditModal(s)}
                          title="Edit Supplier"
                          style={{ padding: 6 }}
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => toggleStatus(s)}
                          title={s.isActive ? 'Deactivate Supplier' : 'Activate Supplier'}
                          style={{ padding: 6, color: s.isActive ? '#b91c1c' : '#15803d' }}
                        >
                          {s.isActive ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
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

      {/* ── Modal: Add / Edit Supplier ── */}
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
          padding: 20
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 620,
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#fafbfc'
            }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Building2 size={20} /> {editingSupplier ? `Edit Supplier (${editingSupplier.code})` : 'Add New Supplier'}
                </h2>
                {!editingSupplier && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Supplier code will be assigned automatically (SUP-XXXX).
                  </span>
                )}
              </div>
              <button 
                className="btn btn-ghost" 
                onClick={() => setIsModalOpen(false)}
                style={{ padding: 4, color: 'var(--color-text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleModalSubmit} style={{ overflowY: 'auto', padding: 24 }}>
              {modalError && (
                <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                  {modalError}
                </div>
              )}

              {/* Legal Name Input */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Official Legal / Mill Name <span className="required">*</span></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Siyaram Silk Mills Ltd., Raymond Limited, Nike"
                  value={modalForm.name}
                  onChange={e => setModalForm({ ...modalForm, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>

              <div className="form-row" style={{ marginBottom: 16 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Contact Person</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Ramesh Sharma"
                    value={modalForm.contactPerson}
                    onChange={e => setModalForm({ ...modalForm, contactPerson: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Phone / Mobile</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. +91 98200 12345"
                    value={modalForm.phone}
                    onChange={e => setModalForm({ ...modalForm, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row" style={{ marginBottom: 16 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="e.g. orders@siyaram.com"
                    value={modalForm.email}
                    onChange={e => setModalForm({ ...modalForm, email: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">GSTIN / Tax ID</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 24AAACS1234F1Z5"
                    value={modalForm.gstin}
                    onChange={e => setModalForm({ ...modalForm, gstin: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Mill / Factory Address</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. B-12, Textile Market, Ring Road"
                  value={modalForm.address}
                  onChange={e => setModalForm({ ...modalForm, address: e.target.value })}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 16 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">City</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Surat"
                    value={modalForm.city}
                    onChange={e => setModalForm({ ...modalForm, city: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">State</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Gujarat"
                    value={modalForm.state}
                    onChange={e => setModalForm({ ...modalForm, state: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Operational Notes</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="e.g. Ships by roll bundles. Requires booking station pickup."
                  value={modalForm.notes}
                  onChange={e => setModalForm({ ...modalForm, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                  disabled={modalSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={modalSubmitting}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {modalSubmitting ? <span className="spinner" /> : (editingSupplier ? 'Save Changes' : 'Create Supplier')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Drawer: View Supplier's Purchase Orders ── */}
      {activeSupplierPOs && (
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
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 750,
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#fafbfc'
            }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShoppingCart size={20} /> Purchase Orders for {activeSupplierPOs.supplier.name}
                </h2>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Code: {activeSupplierPOs.supplier.code}
                </span>
              </div>
              <button 
                className="btn btn-ghost" 
                onClick={() => setActiveSupplierPOs(null)}
                style={{ padding: 4, color: 'var(--color-text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: 20 }}>
              {loadingPOs ? (
                <div className="loading-center" style={{ padding: 40 }}><span className="spinner spinner-lg" /></div>
              ) : activeSupplierPOs.pos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
                  No Purchase Orders found for this supplier.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {activeSupplierPOs.pos.map(po => {
                    const totalOrd = po.lines.reduce((s, l) => s + l.orderedQty, 0);
                    const totalRec = po.lines.reduce((s, l) => s + l.receivedQty, 0);
                    const pending = Math.max(0, totalOrd - totalRec);

                    return (
                      <div 
                        key={po.id} 
                        style={{
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          padding: '14px 16px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: '#fff'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-main)' }}>
                              {po.poNumber}
                            </span>
                            <span className={`badge ${
                              po.status === 'RECEIVED' ? 'badge-success' :
                              po.status === 'PARTIALLY_RECEIVED' ? 'badge-info' :
                              po.status === 'CANCELLED' ? 'badge-danger' : 'badge-warning'
                            }`} style={{ fontSize: 11, padding: '2px 6px' }}>
                              {po.status.replace('_', ' ')}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                            Expected: {formatDate(po.expectedDate)} | Ordered: {totalOrd}m | Recv: {totalRec}m | <strong>Due: {pending}m</strong>
                          </div>
                          {po.targetClient && (
                            <div style={{ fontSize: 11, color: 'var(--color-brand)', marginTop: 2 }}>
                              Client: {po.targetClient}
                            </div>
                          )}
                        </div>

                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => {
                            setActiveSupplierPOs(null);
                            navigate(`/purchase-orders/${po.id}/view`);
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <ExternalLink size={14} /> Open PO
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
