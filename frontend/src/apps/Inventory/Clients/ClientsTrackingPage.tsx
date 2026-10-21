import { useState, useEffect, type FormEvent } from 'react';
import { 
  Users, 
  Search, 
  Plus, 
  Download, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  MapPin, 
  Phone, 
  Edit, 
  X,
  Layers,
  Printer,
  Eye
} from 'lucide-react';
import api from '../../../utils/api';
import { formatDate } from '../../../utils/format';
import '../../../styles/components.css';

interface ClientItem {
  id: string;
  code: string;
  name: string;
  clientType: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  notes: string | null;
  isActive: boolean;
  totalShipments: number;
  totalFabricMeters: number;
  totalOtherUnits: number;
  lastDispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClientChallanLine {
  id: string;
  quantity: number;
  isPartialCut: boolean;
  batch?: {
    batchCode: string;
    itemType: string;
    brand: string | null;
    quality: string | null;
    shade: string | null;
    size: string | null;
    name: string | null;
    uom: string;
  };
}

interface ClientChallan {
  id: string;
  challanNumber: string;
  customerName: string;
  destination: string | null;
  status: string;
  remarks: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  createdBy?: { name: string };
  lines?: ClientChallanLine[];
}

interface ClientSuppliedItem {
  key: string;
  itemType: string;
  brand: string;
  quality: string;
  shade: string;
  size: string;
  name: string;
  uom: string;
  totalQuantity: number;
  batchCount: number;
  lastDispatchedAt: string;
}

export default function ClientsTrackingPage() {
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientItem | null>(null);
  const [modalForm, setModalForm] = useState({
    name: '',
    clientType: '',
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

  // Shipments & Materials Drawer state
  const [selectedClientData, setSelectedClientData] = useState<{
    client: ClientItem;
    challans: ClientChallan[];
    suppliedItems: ClientSuppliedItem[];
  } | null>(null);
  const [drawerTab, setDrawerTab] = useState<'CHALLANS' | 'MATERIALS'>('CHALLANS');
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  const [printingChallanId, setPrintingChallanId] = useState<string | null>(null);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/clients', {
        params: {
          search: search || undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined
        }
      });
      setClients(res.data);
    } catch (err: any) {
      console.error('Failed to load clients:', err);
      setStatusMsg({ type: 'error', text: err.response?.data?.error || 'Failed to load clients directory' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [statusFilter]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    fetchClients();
  };


  // Open modal for new client
  const openAddModal = () => {
    setEditingClient(null);
    setModalForm({
      name: '',
      clientType: '',
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
  const openEditModal = (client: ClientItem) => {
    setEditingClient(client);
    setModalForm({
      name: client.name,
      clientType: client.clientType || '',
      contactPerson: client.contactPerson || '',
      phone: client.phone || '',
      email: client.email || '',
      address: client.address || '',
      city: client.city || '',
      state: client.state || '',
      gstin: client.gstin || '',
      notes: client.notes || '',
      isActive: client.isActive,
    });
    setIsModalOpen(true);
  };

  // Save client modal
  const handleSaveModal = async (e: FormEvent) => {
    e.preventDefault();
    setSubmittingModal(true);
    setStatusMsg(null);
    try {
      if (editingClient) {
        await api.put(`/api/clients/${editingClient.id}`, modalForm);
        setStatusMsg({ type: 'success', text: `Client '${modalForm.name}' updated successfully.` });
      } else {
        await api.post('/api/clients', modalForm);
        setStatusMsg({ type: 'success', text: `New client '${modalForm.name}' registered successfully.` });
      }
      setIsModalOpen(false);
      fetchClients();
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.response?.data?.error || 'Failed to save client details.' });
    } finally {
      setSubmittingModal(false);
    }
  };

  // View Shipments & Materials Drawer
  const handleViewClientDetails = async (client: ClientItem, initialTab: 'CHALLANS' | 'MATERIALS' = 'CHALLANS') => {
    setLoadingDrawer(true);
    setDrawerTab(initialTab);
    setSelectedClientData({ client, challans: [], suppliedItems: [] });
    try {
      const res = await api.get(`/api/clients/${client.id}`);
      setSelectedClientData({
        client,
        challans: res.data.challans || [],
        suppliedItems: res.data.suppliedItems || []
      });
    } catch (err: any) {
      console.error('Failed to load client shipments and materials:', err);
    } finally {
      setLoadingDrawer(false);
    }
  };

  // Print A4 Delivery Challan directly
  const handlePrintChallan = async (dcId: string) => {
    setPrintingChallanId(dcId);
    try {
      const res = await api.get(`/api/delivery-challans/${dcId}/print`, { responseType: 'text' });
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(res.data);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || 'Failed to print delivery challan.');
    } finally {
      setPrintingChallanId(null);
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'Client Code',
      'Client Name',
      'Client Type',
      'City / Destination',
      'State',
      'Contact Person',
      'Phone',
      'Email',
      'GSTIN',
      'Total Delivery Challans',
      'Fabric Shipped (Meters)',
      'Units Shipped',
      'Last Dispatched Date',
      'Status'
    ];

    const rows = clients.map(c => [
      c.code,
      `"${c.name.replace(/"/g, '""')}"`,
      `"${(c.clientType || 'Standard').replace(/"/g, '""')}"`,
      `"${(c.city || '').replace(/"/g, '""')}"`,
      `"${(c.state || '').replace(/"/g, '""')}"`,
      `"${(c.contactPerson || '').replace(/"/g, '""')}"`,
      `"${c.phone || ''}"`,
      `"${c.email || ''}"`,
      `"${c.gstin || ''}"`,
      c.totalShipments,
      c.totalFabricMeters,
      c.totalOtherUnits,
      c.lastDispatchedAt ? formatDate(c.lastDispatchedAt) : 'None',
      c.isActive ? 'Active' : 'Inactive'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `clients_dispatch_tracking_${formatDate(new Date())}.csv`);
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
            <Users size={28} /> Clients Master
          </h1>
          <p className="page-subtitle" style={{ marginTop: 4 }}>
            Central directory of clients, schools, and customers with auto-generated codes &amp; destinations
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
            <Plus size={18} /> New Client
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
              placeholder="Search by client name, code, destination city, contact person, or phone..."
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
              <option value="ACTIVE">Active Clients</option>
              <option value="INACTIVE">Inactive Clients</option>
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

      {/* ── Clients Data Table ── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={18} /> Clients Directory ({clients.length})
          </h2>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Aggregated delivery challan volumes
          </span>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Code</th>
                <th>Client / Institution</th>
                <th>Destination</th>
                <th>Contact Info</th>
                <th style={{ textAlign: 'center' }}>Dispatches</th>
                <th style={{ textAlign: 'right' }}>Total Volume Supplied</th>
                <th>Last Dispatch</th>
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
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-muted)' }}>
                    No clients found matching your query.
                  </td>
                </tr>
              ) : (
                clients.map(c => (
                  <tr key={c.id}>
                    <td>
                      <code style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: 4, fontWeight: 700, fontSize: 12, color: 'var(--color-brand)' }}>
                        {c.code}
                      </code>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: 'var(--color-text-main)', fontSize: 14 }}>
                          {c.name}
                        </span>
                        {c.clientType && (
                          <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: '#e0f2fe',
                            color: '#0369a1',
                            border: '1px solid #bae6fd'
                          }}>
                            {c.clientType}
                          </span>
                        )}
                      </div>
                      {c.gstin && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          GSTIN: {c.gstin}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--color-text-main)' }}>
                        <MapPin size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                        <span>{c.city || 'Standard'}{c.state ? `, ${c.state}` : ''}</span>
                      </div>
                    </td>
                    <td>
                      {c.contactPerson && (
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)' }}>
                          {c.contactPerson}
                        </div>
                      )}
                      {c.phone && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <Phone size={12} /> {c.phone}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="badge badge-neutral" style={{ fontWeight: 700 }}>
                        {c.totalShipments} Challans
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: c.totalFabricMeters > 0 ? '#16a34a' : 'var(--color-text-muted)' }}>
                        {c.totalFabricMeters > 0 ? `${c.totalFabricMeters.toLocaleString()} M` : '0 M'}
                      </div>
                      {c.totalOtherUnits > 0 && (
                        <div style={{ fontSize: 11, color: '#8b5cf6', marginTop: 2, fontWeight: 600 }}>
                          +{c.totalOtherUnits.toLocaleString()} garments
                        </div>
                      )}
                    </td>
                    <td>
                      {c.lastDispatchedAt ? (
                        <div style={{ fontSize: 12.5, color: 'var(--color-text-main)' }}>
                          {formatDate(c.lastDispatchedAt)}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No shipments</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${c.isActive ? 'badge-success' : 'badge-neutral'}`}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleViewClientDetails(c, 'CHALLANS')}
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          title="Inspect delivery challans and supplied items"
                        >
                          <Eye size={14} /> View History
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => openEditModal(c)}
                          style={{ padding: '6px 8px' }}
                          title="Edit Client Profile"
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

      {/* ─── Add / Edit Client Modal ─── */}
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
                <Users size={18} color="var(--color-brand)" />
                {editingClient ? `Edit Client: ${editingClient.code}` : 'Register New Client'}
              </h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsModalOpen(false)} style={{ padding: 6 }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveModal} style={{ padding: 20 }}>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Client / Customer Name <span style={{ color: 'red' }}>*</span></label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. Al-Ameen Uniforms / St. Joseph School"
                  value={modalForm.name}
                  onChange={e => setModalForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>
                  Type of Client <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  list="modal-client-type-options"
                  placeholder="e.g. School, Wholesaler, Retailer, Corporate"
                  value={modalForm.clientType}
                  onChange={e => setModalForm(prev => ({ ...prev, clientType: e.target.value }))}
                />
                <datalist id="modal-client-type-options">
                  <option value="School" />
                  <option value="Wholesaler" />
                  <option value="Retailer" />
                  <option value="Corporate" />
                  <option value="Institution" />
                  <option value="Uniform Distributor" />
                  <option value="Garment Manufacturer" />
                  <option value="Other" />
                </datalist>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Destination / City</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Bangalore / Chennai"
                    value={modalForm.city}
                    onChange={e => setModalForm(prev => ({ ...prev, city: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>State</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Karnataka / Tamil Nadu"
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
                    placeholder="Purchase Manager or Principal"
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
                    placeholder="accounts@client.com"
                    value={modalForm.email}
                    onChange={e => setModalForm(prev => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>GSTIN</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="29AAACS1234F1Z5"
                    value={modalForm.gstin}
                    onChange={e => setModalForm(prev => ({ ...prev, gstin: e.target.value.toUpperCase() }))}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Delivery Address</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Official delivery / warehouse receiving address"
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
                  {editingClient ? 'Save Changes' : 'Register Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Client Shipments & Materials Drawer ─── */}
      {selectedClientData && (
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
                      {selectedClientData.client.name}
                    </span>
                    <code style={{ background: '#e2e8f0', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700, color: 'var(--color-brand)' }}>
                      {selectedClientData.client.code}
                    </code>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    Destination: {selectedClientData.client.city || 'Standard'} {selectedClientData.client.state ? `, ${selectedClientData.client.state}` : ''} · {selectedClientData.challans.length} Delivery Challans
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedClientData(null)}
                  style={{ padding: 6 }}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Tabs Inside Drawer */}
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => setDrawerTab('CHALLANS')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: 'none',
                    background: drawerTab === 'CHALLANS' ? 'var(--color-brand)' : '#e2e8f0',
                    color: drawerTab === 'CHALLANS' ? '#ffffff' : '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <FileText size={15} /> Dispatched Challans ({selectedClientData.challans.length})
                </button>

                <button
                  type="button"
                  onClick={() => setDrawerTab('MATERIALS')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: 'none',
                    background: drawerTab === 'MATERIALS' ? 'var(--color-brand)' : '#e2e8f0',
                    color: drawerTab === 'MATERIALS' ? '#ffffff' : '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <Layers size={15} /> Supplied Materials Ledger ({selectedClientData.suppliedItems.length} Products)
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              {loadingDrawer ? (
                <div style={{ textAlign: 'center', padding: '80px 0' }}>
                  <span className="spinner spinner-lg" />
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 10 }}>
                    Loading client shipments and supplied materials ledger...
                  </div>
                </div>
              ) : (
                <>
                  {/* ─── TAB 1: DISPATCHED DELIVERY CHALLANS ─── */}
                  {drawerTab === 'CHALLANS' && (
                    <div>
                      {selectedClientData.challans.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
                          <FileText size={36} style={{ color: '#cbd5e1', margin: '0 auto 10px' }} />
                          <p style={{ margin: 0, fontWeight: 600 }}>No delivery challans dispatched yet.</p>
                          <p style={{ fontSize: 12, margin: '4px 0 0 0' }}>Delivery challans created for this customer will appear here.</p>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {selectedClientData.challans.map(dc => {
                            const fabricTotal = dc.lines?.filter(l => l.batch?.itemType === 'FABRIC' || !l.batch?.itemType)
                              .reduce((sum, l) => sum + (l.quantity || 0), 0) || 0;
                            const itemsTotal = dc.lines?.length || 0;

                            return (
                              <div key={dc.id} className="card" style={{ padding: 16, borderLeft: '4px solid #0284c7' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <strong style={{ fontSize: 15, color: 'var(--color-brand)' }}>{dc.challanNumber}</strong>
                                      <span className={`badge ${dc.status === 'DISPATCHED' ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: 10.5 }}>
                                        {dc.status}
                                      </span>
                                      {dc.destination && (
                                        <span style={{ fontSize: 11.5, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#475569' }}>
                                          To: <strong>{dc.destination}</strong>
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                                      Dispatched: {formatDate(dc.dispatchedAt || dc.createdAt)} · By: {dc.createdBy?.name || 'Operator'}
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{ textAlign: 'right' }}>
                                      <div style={{ fontWeight: 800, fontSize: 15, color: '#16a34a' }}>
                                        {fabricTotal > 0 ? `${fabricTotal} M` : `${itemsTotal} items`}
                                      </div>
                                      <div style={{ fontSize: 11, color: '#64748b' }}>
                                        {itemsTotal} lines dispatched
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      disabled={printingChallanId === dc.id}
                                      onClick={() => handlePrintChallan(dc.id)}
                                      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34 }}
                                      title="Print or PDF export official A4 Delivery Challan"
                                    >
                                      {printingChallanId === dc.id ? <span className="spinner spinner-sm" /> : <Printer size={14} />}
                                      <span>Print A4</span>
                                    </button>
                                  </div>
                                </div>

                                {/* Line Items Breakdown */}
                                {dc.lines && dc.lines.length > 0 && (
                                  <div style={{ background: '#f8fafc', borderRadius: 4, padding: '10px 12px', fontSize: 12, border: '1px solid #e2e8f0' }}>
                                    <div style={{ fontWeight: 700, color: '#475569', marginBottom: 6 }}>Dispatched Roll &amp; Item Batches:</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                      {dc.lines.map(line => (
                                        <span 
                                          key={line.id} 
                                          style={{ 
                                            background: '#ffffff', 
                                            padding: '4px 8px', 
                                            borderRadius: 4, 
                                            border: '1px solid #cbd5e1',
                                            fontSize: 11.5,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4
                                          }}
                                        >
                                          <strong>{line.batch?.batchCode || 'Batch'}</strong>: {line.quantity} {line.batch?.uom || 'M'}
                                          {line.batch?.brand && <span style={{ color: '#0369a1' }}>({line.batch.brand}{line.batch.shade ? ` - ${line.batch.shade}` : ''})</span>}
                                          {line.isPartialCut && <span style={{ color: '#d97706', fontWeight: 700, fontSize: 10 }}>[CUT]</span>}
                                        </span>
                                      ))}
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

                  {/* ─── TAB 2: SUPPLIED MATERIALS LEDGER ─── */}
                  {drawerTab === 'MATERIALS' && (
                    <div>
                      {selectedClientData.suppliedItems.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
                          <Layers size={36} style={{ color: '#cbd5e1', margin: '0 auto 10px' }} />
                          <p style={{ margin: 0, fontWeight: 600 }}>No materials recorded yet.</p>
                          <p style={{ fontSize: 12, margin: '4px 0 0 0' }}>All fabric brands, qualities, and garments delivered will be ledgered here.</p>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: 13, color: '#475569', marginBottom: 12, fontWeight: 600 }}>
                            Ledger of all unique fabrics and items supplied to {selectedClientData.client.name}:
                          </div>

                          <div className="table-container" style={{ border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
                            <table className="table" style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>Item / Fabric Description</th>
                                  <th>Type</th>
                                  <th>Shade / Color</th>
                                  <th style={{ textAlign: 'center' }}>Rolls Supplied</th>
                                  <th style={{ textAlign: 'right' }}>Total Delivered</th>
                                  <th>Last Supplied</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedClientData.suppliedItems.map((item, idx) => (
                                  <tr key={idx}>
                                    <td>
                                      <div style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>
                                        {item.brand} {item.quality !== '-' ? `· ${item.quality}` : ''}
                                      </div>
                                      {item.name !== '-' && (
                                        <div style={{ fontSize: 11.5, color: '#64748b' }}>
                                          {item.name}
                                        </div>
                                      )}
                                    </td>
                                    <td>
                                      <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
                                        {item.itemType}
                                      </span>
                                    </td>
                                    <td>
                                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                                        {item.shade}
                                      </span>
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--color-brand)' }}>
                                        {item.batchCount} rolls
                                      </span>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                      <strong style={{ fontSize: 14, color: '#16a34a' }}>
                                        {item.totalQuantity} {item.uom}
                                      </strong>
                                    </td>
                                    <td style={{ fontSize: 12, color: '#64748b' }}>
                                      {formatDate(item.lastDispatchedAt)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
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
