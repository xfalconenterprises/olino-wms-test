import { useEffect, useState, useRef, useMemo, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { ShoppingCart, Plus, Trash2, ArrowLeft, Repeat2, Edit, Building2, X, Search, CheckCircle2, Users, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { formatDate } from '../../../utils/format';
import LearningTypeaheadInput from '../../../components/Common/LearningTypeaheadInput';
import '../../../styles/components.css';

interface SupplierOption {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
}

export default function CreatePOPage() {
  const { id } = useParams();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [suppliersList, setSuppliersList] = useState<SupplierOption[]>([]);

  // Supplier Autocomplete State
  const [supplierInput, setSupplierInput] = useState('');
  const [showSupplierMenu, setShowSupplierMenu] = useState(false);
  const supplierWrapperRef = useRef<HTMLDivElement>(null);

  // Quick Add Supplier Modal State
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickForm, setQuickForm] = useState({
    name: '',
    address: '',
    city: '',
    phone: '',
  });
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickError, setQuickError] = useState('');

  const [form, setForm] = useState({
    supplierId: '',
    supplierName: '',
    expectedDate: new Date().toISOString().split('T')[0],
    targetClient: '',
    notes: '',
  });

  const [poType, setPoType] = useState(isEditMode ? 'FABRIC' : '');
  const [categoryCollapsed, setCategoryCollapsed] = useState(Boolean(isEditMode || poType));
  const [generalInfoCollapsed, setGeneralInfoCollapsed] = useState(false);
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [clientInput, setClientInput] = useState('');
  const [showClientMenu, setShowClientMenu] = useState(false);
  const clientWrapperRef = useRef<HTMLDivElement>(null);

  // Quick Add Client Modal State
  const [showQuickAddClientModal, setShowQuickAddClientModal] = useState(false);
  const [quickClientForm, setQuickClientForm] = useState({
    name: '',
    clientType: '',
    contactPerson: '',
    phone: '',
    city: '',
    address: '',
    notes: '',
  });
  const [quickClientSubmitting, setQuickClientSubmitting] = useState(false);
  const [quickClientError, setQuickClientError] = useState('');
  const [expandedAllocIndex, setExpandedAllocIndex] = useState<number | null>(null);

  interface LineAllocationItem {
    clientId?: string;
    clientName: string;
    allocatedQty: string;
    notes?: string;
  }

  const [lines, setLines] = useState<{
    name?: string;
    category: string;
    artNo?: string;
    brand: string;
    quality: string;
    shade: string;
    size: string;
    orderedQty: string;
    notes: string;
    allocations?: LineAllocationItem[];
  }[]>([
    { name: '', category: 'SUITING', artNo: '', brand: '', quality: '', shade: '', size: '', orderedQty: '', notes: '', allocations: [] }
  ]);

  const [masterAttributes, setMasterAttributes] = useState<{
    BRAND: string[];
    QUALITY: string[];
    SHADE: string[];
    ITEM_NAME: string[];
    ART_NO: string[];
    CATEGORY: string[];
    FABRIC_TYPE: string[];
    ACCESSORY_CATEGORY: string[];
  }>({
    BRAND: [],
    QUALITY: [],
    SHADE: [],
    ITEM_NAME: [],
    ART_NO: [],
    CATEGORY: ['SUITING', 'SHIRTING', 'PLAIN_SHIRTING'],
    FABRIC_TYPE: [],
    ACCESSORY_CATEGORY: [],
  });

  const loadSuppliers = async () => {
    try {
      const res = await api.get('/api/suppliers?status=ACTIVE');
      setSuppliersList(res.data);
    } catch {
      // Fallback to meta if suppliers table is fresh
      api.get('/api/purchase-orders/meta/suppliers')
        .then(r => setSuppliersList(r.data))
        .catch(() => {});
    }
  };

  const loadClients = async () => {
    try {
      const res = await api.get('/api/clients');
      if (Array.isArray(res.data)) {
        setClientsList(res.data);
      }
    } catch {}
  };

  const loadMasterAttributes = async () => {
    try {
      const res = await api.get('/api/master-data');
      if (res.data) {
        setMasterAttributes({
          BRAND: res.data.BRAND || [],
          QUALITY: res.data.QUALITY || [],
          SHADE: res.data.SHADE || [],
          ITEM_NAME: res.data.ITEM_NAME || [],
          ART_NO: res.data.ART_NO || [],
          CATEGORY: res.data.CATEGORY || ['SUITING', 'SHIRTING', 'PLAIN_SHIRTING'],
          FABRIC_TYPE: res.data.FABRIC_TYPE || [],
          ACCESSORY_CATEGORY: res.data.ACCESSORY_CATEGORY || [],
        });
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    loadSuppliers();
    loadClients();
    loadMasterAttributes();

    if (isEditMode) {
      api.get(`/api/purchase-orders/${id}`).then(r => {
        const po = r.data;
        if (po.status !== 'PENDING') {
          setError('This Purchase Order has already begun receiving stock and cannot be edited.');
        }
        setForm({
          supplierId: po.supplierId || '',
          supplierName: po.supplierName,
          expectedDate: po.expectedDate ? new Date(po.expectedDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          targetClient: po.targetClient || '',
          notes: po.notes || '',
        });
        setSupplierInput(po.supplierName || '');
        setClientInput(po.targetClient || '');
        
        if (po.lines && po.lines.length > 0) {
          const firstLineType = po.lines[0].itemType || 'FABRIC';
          setPoType(firstLineType);
          setLines(po.lines.map((l: any) => ({
            name: l.name || '',
            category: l.category || '',
            artNo: l.artNo || '',
            brand: l.brand || '',
            quality: l.quality || '',
            shade: l.shade || '',
            size: l.size || '',
            orderedQty: (l.orderedQty || '').toString(),
            notes: l.notes || '',
            allocations: (l.allocations || []).map((a: any) => ({
              clientId: a.clientId || undefined,
              clientName: a.clientName || '',
              allocatedQty: (a.allocatedQty || '').toString(),
              notes: a.notes || ''
            }))
          })));

          setCategoryCollapsed(true);
        }
      }).catch(() => setError('Failed to load PO details for editing'))
      .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [id, isEditMode]);

  // Close dropdown menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (supplierWrapperRef.current && !supplierWrapperRef.current.contains(e.target as Node)) {
        setShowSupplierMenu(false);
      }
      if (clientWrapperRef.current && !clientWrapperRef.current.contains(e.target as Node)) {
        setShowClientMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter clients as user types in the input
  const filteredClients = useMemo(() => {
    const query = clientInput.trim().toLowerCase();
    if (!query) return clientsList.slice(0, 10);
    return clientsList.filter(c =>
      (c.name || '').toLowerCase().includes(query) ||
      (c.code || '').toLowerCase().includes(query) ||
      (c.clientType && c.clientType.toLowerCase().includes(query)) ||
      (c.city && c.city.toLowerCase().includes(query)) ||
      (c.phone && c.phone.includes(query))
    );
  }, [clientsList, clientInput]);

  const matchedClient = useMemo(() => {
    const trimmed = clientInput.trim().toLowerCase();
    if (!trimmed) return null;
    return clientsList.find(c => (c.name || '').toLowerCase() === trimmed);
  }, [clientsList, clientInput]);

  const isNewClient = Boolean(clientInput.trim() && !matchedClient);

  // Filter suppliers as user types in the input
  const filteredSuppliers = useMemo(() => {
    const query = supplierInput.trim().toLowerCase();
    if (!query) return suppliersList.slice(0, 10);
    return suppliersList.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.code.toLowerCase().includes(query) ||
      (s.city && s.city.toLowerCase().includes(query))
    );
  }, [suppliersList, supplierInput]);

  const addLine = () => {
    setLines([...lines, { 
      name: '', 
      category: poType === 'FABRIC' ? 'SUITING' : '', 
      artNo: '', 
      brand: '', 
      quality: '', 
      shade: '', 
      size: '', 
      orderedQty: '', 
      notes: '' 
    }]);
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const duplicateLine = (index: number) => {
    const newLines = [...lines];
    newLines.splice(index + 1, 0, { ...lines[index] });
    setLines(newLines);
  };

  const updateLine = (index: number, field: string, value: string) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setLines(newLines);
  };

  const addAllocation = (lineIdx: number) => {
    const newLines = [...lines];
    const currentAlloc = newLines[lineIdx].allocations || [];
    const totalOrdered = parseFloat(newLines[lineIdx].orderedQty) || 0;
    const currentTotalAlloc = currentAlloc.reduce((sum, a) => sum + (parseFloat(a.allocatedQty) || 0), 0);
    const remaining = Math.max(0, parseFloat((totalOrdered - currentTotalAlloc).toFixed(2)));

    newLines[lineIdx].allocations = [
      ...currentAlloc,
      {
        clientName: '',
        allocatedQty: remaining > 0 ? remaining.toString() : '',
        notes: ''
      }
    ];
    setLines(newLines);
    setExpandedAllocIndex(lineIdx);
  };

  const updateAllocation = (lineIdx: number, allocIdx: number, field: string, val: string) => {
    const newLines = [...lines];
    const allocs = [...(newLines[lineIdx].allocations || [])];
    allocs[allocIdx] = { ...allocs[allocIdx], [field]: val };
    newLines[lineIdx].allocations = allocs;
    setLines(newLines);
  };

  const removeAllocation = (lineIdx: number, allocIdx: number) => {
    const newLines = [...lines];
    newLines[lineIdx].allocations = (newLines[lineIdx].allocations || []).filter((_, i) => i !== allocIdx);
    setLines(newLines);
  };

  const handleCategoryChange = (newType: string) => {
    setPoType(newType);
    setCategoryCollapsed(true);
    setLines([
      { 
        name: '', 
        category: newType === 'FABRIC' ? 'SUITING' : '', 
        artNo: '', 
        brand: '', 
        quality: '', 
        shade: '', 
        size: '', 
        orderedQty: '', 
        notes: '',
        allocations: []
      }
    ]);
  };

  const handleQuickAddSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickError('');
    if (!quickForm.name.trim()) {
      setQuickError('Supplier name is required.');
      return;
    }

    setQuickSubmitting(true);
    try {
      const res = await api.post('/api/suppliers', {
        name: quickForm.name.trim(),
        address: quickForm.address.trim() || undefined,
        city: quickForm.city.trim() || undefined,
        phone: quickForm.phone.trim() || undefined,
      });

      const newSup = res.data;
      setSuppliersList(prev => [newSup, ...prev]);
      setForm(f => ({
        ...f,
        supplierId: newSup.id,
        supplierName: newSup.name,
      }));
      setSupplierInput(newSup.name);
      setShowSupplierMenu(false);
      setShowQuickAddModal(false);
      setQuickForm({ name: '', address: '', city: '', phone: '' });
    } catch (err: any) {
      setQuickError(err.response?.data?.error || 'Failed to create supplier');
    } finally {
      setQuickSubmitting(false);
    }
  };

  const openQuickAddClient = (initialName?: string, initialType?: string) => {
    setQuickClientForm({
      name: initialName || clientInput.trim() || '',
      clientType: initialType || '',
      contactPerson: '',
      phone: '',
      city: '',
      address: '',
      notes: ''
    });
    setQuickClientError('');
    setShowQuickAddClientModal(true);
  };

  const handleQuickAddClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickClientError('');
    if (!quickClientForm.name.trim()) {
      setQuickClientError('Client / School name is required.');
      return;
    }

    setQuickClientSubmitting(true);
    try {
      const res = await api.post('/api/clients', {
        name: quickClientForm.name.trim(),
        clientType: quickClientForm.clientType.trim() || undefined,
        contactPerson: quickClientForm.contactPerson.trim() || undefined,
        phone: quickClientForm.phone.trim() || undefined,
        city: quickClientForm.city.trim() || undefined,
        address: quickClientForm.address.trim() || undefined,
        notes: quickClientForm.notes.trim() || undefined,
      });

      const newCli = res.data;
      setClientsList(prev => [newCli, ...prev]);
      setForm(f => ({
        ...f,
        targetClient: newCli.name
      }));
      setClientInput(newCli.name);
      setShowClientMenu(false);
      setShowQuickAddClientModal(false);
      setQuickClientForm({ name: '', clientType: '', contactPerson: '', phone: '', city: '', address: '', notes: '' });
    } catch (err: any) {
      setQuickClientError(err.response?.data?.error || 'Failed to save client details');
    } finally {
      setQuickClientSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.supplierName.trim()) { setError('Supplier selection is required'); return; }
    if (!form.expectedDate) { setError('Expected date is required'); return; }
    
    const validLines = lines.filter(l => l.orderedQty && parseFloat(l.orderedQty) > 0);
    if (validLines.length === 0) { 
      setError('At least one valid line item is required. Please enter a valid quantity.'); 
      return; 
    }

    const masterClient = form.targetClient?.trim() || '';
    const matchedMasterClient = masterClient
      ? clientsList.find(c => c.name.toLowerCase() === masterClient.toLowerCase())
      : undefined;

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        targetClient: masterClient || undefined,
        lines: validLines.map(l => {
          let lineAllocations: any = undefined;

          // If line has custom client split entered, use it
          if (l.allocations && l.allocations.length > 0) {
            lineAllocations = l.allocations
              .filter(a => a.clientName.trim() && parseFloat(a.allocatedQty) > 0)
              .map(a => ({
                clientId: a.clientId || undefined,
                clientName: a.clientName.trim(),
                allocatedQty: parseFloat(a.allocatedQty),
                notes: a.notes?.trim() || undefined
              }));
          } else if (masterClient) {
            // Otherwise inherit the PO's master client 100%
            lineAllocations = [{
              clientId: matchedMasterClient?.id || undefined,
              clientName: masterClient,
              allocatedQty: parseFloat(l.orderedQty),
              notes: undefined
            }];
          }

          return {
            itemType: poType,
            category: l.category || undefined,
            brand: l.brand?.trim() || undefined,
            quality: l.quality?.trim() || undefined,
            shade: l.shade?.trim() || undefined,
            name: l.name?.trim() || undefined,
            artNo: l.artNo?.trim().toUpperCase() || undefined,
            size: l.size ? l.size.trim() : null,
            orderedQty: parseFloat(l.orderedQty),
            notes: l.notes?.trim() || undefined,
            allocations: lineAllocations && lineAllocations.length > 0 ? lineAllocations : undefined
          };
        })
      };

      // Auto-learn all newly confirmed attributes into Master Attributes catalog
      const itemsToLearn: Array<{ type: string; value?: string | null; category?: string | null }> = [];
      for (const l of validLines) {
        if (l.brand) itemsToLearn.push({ type: 'BRAND', value: l.brand });
        if (l.quality) itemsToLearn.push({ type: 'QUALITY', value: l.quality, category: l.category });
        if (l.shade) itemsToLearn.push({ type: 'SHADE', value: l.shade });
        if (l.name) itemsToLearn.push({ type: 'ITEM_NAME', value: l.name, category: poType });
        if (l.artNo) itemsToLearn.push({ type: 'ART_NO', value: l.artNo });
        if (poType === 'READY_MADE' && l.category) itemsToLearn.push({ type: 'FABRIC_TYPE', value: l.category });
        if (poType === 'ACCESSORY' && l.category) itemsToLearn.push({ type: 'ACCESSORY_CATEGORY', value: l.category });
      }
      if (itemsToLearn.length > 0) {
        api.post('/api/master-data/batch-learn', { items: itemsToLearn }).catch(() => {});
      }

      if (isEditMode) {
        await api.put(`/api/purchase-orders/${id}`, payload);
        navigate(`/purchase-orders/${id}/view`);
      } else {
        await api.post('/api/purchase-orders', payload);
        navigate('/purchase-orders');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || (isEditMode ? 'Failed to update PO' : 'Failed to create PO'));
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading-center"><span className="spinner spinner-lg" /></div>;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ padding: 0, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-text-muted)' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isEditMode ? <><Edit size={28} /> Edit Purchase Order</> : <><ShoppingCart size={28} /> Create Purchase Order</>}
          </h1>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 20 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Step 1: Product Category (Collapsible) */}
        {categoryCollapsed && poType ? (
          <div style={{
            background: '#fff',
            padding: '12px 20px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-xs)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Product Category:
              </span>
              <span className="badge badge-brand" style={{ fontSize: 13, fontWeight: 700, padding: '4px 10px' }}>
                {poType === 'FABRIC' ? 'Fabric Rolls (Meters)' : poType === 'READY_MADE' ? 'Ready-Made Garments (Pieces)' : 'Accessories & Trims (Mixed)'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setCategoryCollapsed(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-brand)', fontWeight: 600 }}
            >
              Change Category <ChevronDown size={14} />
            </button>
          </div>
        ) : (
          <div style={{
            background: '#fff',
            padding: '20px 24px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            boxShadow: 'var(--shadow-xs)'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: 0, color: '#0f172a' }}>Select Product Category</h2>
                {poType && (
                  <button
                    type="button"
                    onClick={() => setCategoryCollapsed(true)}
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '2px 8px' }}
                  >
                    Close <ChevronUp size={13} />
                  </button>
                )}
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '3px 0 0 0' }}>
                Choose a product category to load the purchase order items
              </p>
            </div>
            <select
              className="form-select"
              style={{ width: 280, height: 40, padding: '0 14px', fontSize: 13.5, fontWeight: 600, borderRadius: 6 }}
              value={poType}
              onChange={e => handleCategoryChange(e.target.value)}
            >
              <option value="" disabled>Choose a product category...</option>
              <option value="FABRIC">Fabric Rolls (Meters)</option>
              <option value="READY_MADE">Ready-Made Garments (Pieces)</option>
              <option value="ACCESSORY">Accessories & Trims (Mixed)</option>
            </select>
          </div>
        )}

        {/* Show the rest of the form only after a category is selected */}
        {poType && (
          <>
            {/* General Info (Collapsible & Perfectly Aligned Grid) */}
            <div style={{
              background: '#fff',
              padding: generalInfoCollapsed ? '14px 20px' : '20px 24px',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              marginBottom: 20,
              boxShadow: 'var(--shadow-xs)'
            }}>
              <div
                onClick={() => setGeneralInfoCollapsed(!generalInfoCollapsed)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  userSelect: 'none',
                  paddingBottom: generalInfoCollapsed ? 0 : 16,
                  borderBottom: generalInfoCollapsed ? 'none' : '1px solid var(--color-border-subtle)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={18} color="var(--color-brand)" /> General Information
                  </h2>

                  {generalInfoCollapsed && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: '#475569', flexWrap: 'wrap' }}>
                      <span><strong>Supplier:</strong> {form.supplierName || '—'}</span>
                      <span style={{ color: '#cbd5e1' }}>•</span>
                      <span><strong>Delivery:</strong> {formatDate(form.expectedDate)}</span>
                      <span style={{ color: '#cbd5e1' }}>•</span>
                      <span><strong>Client:</strong> {form.targetClient ? <strong style={{ color: '#1e40af' }}>{form.targetClient}</strong> : 'General Stock'}</span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '4px 8px', color: 'var(--color-text-muted)' }}
                  onClick={e => {
                    e.stopPropagation();
                    setGeneralInfoCollapsed(!generalInfoCollapsed);
                  }}
                >
                  {generalInfoCollapsed ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--color-brand)' }}>
                      Edit Details <ChevronDown size={14} />
                    </span>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
                      Minimize <ChevronUp size={14} />
                    </span>
                  )}
                </button>
              </div>

              {!generalInfoCollapsed && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px 20px', marginTop: 16 }}>
                  {/* Supplier Autocomplete Input */}
                  <div className="form-group" style={{ margin: 0, position: 'relative' }} ref={supplierWrapperRef}>
                    <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                      Supplier <span className="required">*</span>
                    </label>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Type supplier name or code..."
                          value={supplierInput}
                          onChange={e => {
                            const val = e.target.value;
                            setSupplierInput(val);
                            setForm(f => ({ ...f, supplierName: val, supplierId: '' }));
                            setShowSupplierMenu(true);
                          }}
                          onFocus={() => setShowSupplierMenu(true)}
                          style={{ paddingLeft: 36, paddingRight: form.supplierId ? 36 : 12, height: 40, fontSize: 13.5, fontWeight: 500 }}
                          required
                        />
                        {form.supplierId && (
                          <button
                            type="button"
                            onClick={() => {
                              setSupplierInput('');
                              setForm(f => ({ ...f, supplierId: '', supplierName: '' }));
                              setShowSupplierMenu(true);
                            }}
                            style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--color-text-muted)' }}
                            title="Clear selection"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setShowQuickAddModal(true)}
                        style={{
                          height: 40,
                          width: 40,
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
                        title="Add New Supplier"
                      >
                        <Plus size={18} />
                      </button>
                    </div>

                    {/* Floating Suggestions Dropdown */}
                    {showSupplierMenu && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 48,
                        zIndex: 50,
                        background: '#fff',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.1)',
                        maxHeight: 220,
                        overflowY: 'auto',
                        marginTop: 4
                      }}>
                        {filteredSuppliers.length === 0 ? (
                          <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                            No matching suppliers found. Type directly or click <strong>+ Add New Supplier</strong>.
                          </div>
                        ) : (
                          filteredSuppliers.map(s => {
                            const isSelected = form.supplierId === s.id;
                            return (
                              <div
                                key={s.id}
                                onClick={() => {
                                  setForm(f => ({
                                    ...f,
                                    supplierId: s.id,
                                    supplierName: s.name,
                                  }));
                                  setSupplierInput(s.name);
                                  setShowSupplierMenu(false);
                                }}
                                style={{
                                  padding: '10px 14px',
                                  borderBottom: '1px solid var(--color-border-subtle)',
                                  cursor: 'pointer',
                                  background: isSelected ? 'var(--color-bg-subtle)' : '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  transition: 'background 0.15s ease'
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-subtle)')}
                                onMouseLeave={e => (e.currentTarget.style.background = isSelected ? 'var(--color-bg-subtle)' : '#fff')}
                              >
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-main)' }}>
                                    {s.name}
                                  </div>
                                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                    Code: {s.code}{s.city ? ` • ${s.city}` : ''}
                                  </div>
                                </div>
                                {isSelected && <CheckCircle2 size={16} color="var(--color-brand)" />}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expected Delivery Date */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                      Expected Delivery Date <span className="required">*</span>
                    </label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.expectedDate}
                      onChange={e => setForm({ ...form, expectedDate: e.target.value })}
                      required
                      style={{ height: 40, fontSize: 13.5 }}
                    />
                  </div>

                  {/* Client */}
                  <div className="form-group" style={{ margin: 0, position: 'relative' }} ref={clientWrapperRef}>
                    <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                      Client <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span>
                    </label>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Type or select client name..."
                          value={clientInput}
                          onChange={e => {
                            const val = e.target.value;
                            setClientInput(val);
                            setForm(f => ({ ...f, targetClient: val }));
                            setShowClientMenu(true);
                          }}
                          onFocus={() => setShowClientMenu(true)}
                          style={{ paddingLeft: 36, paddingRight: clientInput ? 36 : 12, height: 40, fontSize: 13.5, fontWeight: 500 }}
                        />
                        {clientInput && (
                          <button
                            type="button"
                            onClick={() => {
                              setClientInput('');
                              setForm(f => ({ ...f, targetClient: '' }));
                              setShowClientMenu(true);
                            }}
                            style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--color-text-muted)' }}
                            title="Clear client"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => openQuickAddClient(clientInput)}
                        style={{
                          height: 40,
                          width: 40,
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
                        title="Add New Client"
                      >
                        <Plus size={18} />
                      </button>
                    </div>

                    {/* Floating Suggestions Dropdown */}
                    {showClientMenu && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 48,
                        zIndex: 50,
                        background: '#fff',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.1)',
                        maxHeight: 220,
                        overflowY: 'auto',
                        marginTop: 4
                      }}>
                        {filteredClients.length === 0 ? (
                          <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                            No matching clients found. Type directly or click <strong>+ Add New Client</strong>.
                          </div>
                        ) : (
                          filteredClients.map(c => {
                            const isSelected = matchedClient?.id === c.id;
                            return (
                              <div
                                key={c.id}
                                onClick={() => {
                                  setForm(f => ({ ...f, targetClient: c.name }));
                                  setClientInput(c.name);
                                  setShowClientMenu(false);
                                }}
                                style={{
                                  padding: '10px 14px',
                                  borderBottom: '1px solid var(--color-border-subtle)',
                                  cursor: 'pointer',
                                  background: isSelected ? 'var(--color-bg-subtle)' : '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  transition: 'background 0.15s ease'
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-subtle)')}
                                onMouseLeave={e => (e.currentTarget.style.background = isSelected ? 'var(--color-bg-subtle)' : '#fff')}
                              >
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span>{c.name}</span>
                                    {c.clientType && (
                                      <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                                        {c.clientType}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                    Code: {c.code}{c.city ? ` • ${c.city}` : ''}{c.phone ? ` • ${c.phone}` : ''}
                                  </div>
                                </div>
                                {isSelected && <CheckCircle2 size={16} color="var(--color-brand)" />}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}

                    {/* Alert: New Client Notice */}
                    {isNewClient && (
                      <div style={{
                        marginTop: 8,
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-md)',
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
                          <span>New Client: <strong>"{clientInput.trim()}"</strong> is not in master directory.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openQuickAddClient(clientInput.trim())}
                          className="btn btn-sm btn-secondary"
                          style={{ height: 26, padding: '0 8px', fontSize: 11, background: '#fff', whiteSpace: 'nowrap' }}
                        >
                          <Plus size={12} /> Save Client Details
                        </button>
                      </div>
                    )}

                    {/* Registered Client Badge */}
                    {matchedClient && (
                      <div style={{
                        marginTop: 6,
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-md)',
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        color: '#15803d',
                        fontSize: 12,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <CheckCircle2 size={13} color="#16a34a" />
                        <span>Registered Client: {matchedClient.code}{matchedClient.clientType ? ` • ${matchedClient.clientType}` : ''} {matchedClient.city ? `• ${matchedClient.city}` : ''} {matchedClient.phone ? `• ${matchedClient.phone}` : ''}</span>
                      </div>
                    )}

                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                      {form.targetClient 
                        ? `Whole order will be earmarked for ${form.targetClient}. Leave blank for General Stock.`
                        : 'Empty = General Stock. You can also split individual lines below.'}
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                      Notes / Instructions <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Optional instructions for warehouse receiving..."
                      value={form.notes}
                      onChange={e => setForm({ ...form, notes: e.target.value })}
                      style={{ height: 40, fontSize: 13.5 }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Line Items Table */}
            <div style={{ background: '#fff', padding: 24, borderRadius: 'var(--radius-lg)', border: '1.5px solid #94a3b8', boxShadow: '0 1px 4px rgba(0, 0, 0, 0.05)', marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>Order Items</h2>
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '2px 0 0 0' }}>
                    {poType === 'FABRIC' 
                      ? 'Specify fabric roll quality, shade, type, and expected meters'
                      : poType === 'READY_MADE'
                      ? 'Specify garment item, fabric type, article number, size, color, and expected pieces'
                      : 'Specify accessory item, category, specification, size, and expected quantity'}
                  </p>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" onClick={addLine} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={14} /> Add Line
                </button>
              </div>

              <div style={{ overflowX: 'auto', minHeight: 320, paddingBottom: 120 }}>
                <table className="table order-items-table" style={{ borderRadius: 'var(--radius-md)', minWidth: 960 }}>
                  <thead style={{ background: '#f8fafc' }}>
                    {poType === 'FABRIC' ? (
                      <tr>
                        <th style={{ width: 140 }}>Fabric Type</th>
                        <th style={{ width: 220 }}>Brand</th>
                        <th style={{ width: 220 }}>Quality</th>
                        <th style={{ width: 200 }}>Shade</th>
                        <th style={{ width: 110 }}>Meters *</th>
                        <th>Notes</th>
                        <th style={{ width: 140 }}>Client Split</th>
                        <th style={{ width: 70, textAlign: 'center' }}></th>
                      </tr>
                    ) : poType === 'READY_MADE' ? (
                      <tr>
                        <th style={{ width: 220 }}>Item Name</th>
                        <th style={{ width: 140 }}>Fabric Type</th>
                        <th style={{ width: 160 }}>Color / Shade</th>
                        <th style={{ width: 130 }}>Art No</th>
                        <th style={{ width: 85 }}>Size</th>
                        <th style={{ width: 100 }}>Pieces *</th>
                        <th>Notes</th>
                        <th style={{ width: 140 }}>Client Split</th>
                        <th style={{ width: 70, textAlign: 'center' }}></th>
                      </tr>
                    ) : (
                      <tr>
                        <th style={{ width: 140 }}>Category</th>
                        <th style={{ width: 220 }}>Accessory Item</th>
                        <th style={{ width: 180 }}>Spec / Quality</th>
                        <th style={{ width: 140 }}>Color</th>
                        <th style={{ width: 85 }}>Size</th>
                        <th style={{ width: 100 }}>Quantity *</th>
                        <th>Notes</th>
                        <th style={{ width: 140 }}>Client Split</th>
                        <th style={{ width: 70, textAlign: 'center' }}></th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => (
                      <Fragment key={idx}>
                        <tr>
                        {/* FABRIC Columns */}
                        {poType === 'FABRIC' && (
                          <>
                            <td style={{ padding: '8px' }}>
                              <select className="form-select" style={{ height: 36, padding: '4px 8px' }} value={line.category} onChange={e => updateLine(idx, 'category', e.target.value)}>
                                <option value="SUITING">Suiting</option>
                                <option value="SHIRTING">Shirting</option>
                                <option value="PLAIN_SHIRTING">Plain Shirting</option>
                              </select>
                            </td>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.brand}
                                onChange={val => updateLine(idx, 'brand', val)}
                                options={masterAttributes.BRAND}
                                attributeType="Brand"
                                placeholder="e.g. Siyaram"
                                required
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.quality}
                                onChange={val => updateLine(idx, 'quality', val)}
                                options={masterAttributes.QUALITY}
                                attributeType="Quality"
                                placeholder="e.g. Poly Viscose 65/35"
                                required
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.shade}
                                onChange={val => updateLine(idx, 'shade', val)}
                                options={masterAttributes.SHADE}
                                attributeType="Shade"
                                placeholder="e.g. Navy Blue 04"
                                required
                              />
                            </td>
                          </>
                        )}

                        {/* READY_MADE Columns */}
                        {poType === 'READY_MADE' && (
                          <>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.name || ''}
                                onChange={val => updateLine(idx, 'name', val)}
                                options={masterAttributes.ITEM_NAME}
                                attributeType="Item Name"
                                placeholder="e.g. Boys Half Sleeve Shirt"
                                required
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.category || ''}
                                onChange={val => updateLine(idx, 'category', val)}
                                options={masterAttributes.FABRIC_TYPE}
                                attributeType="Fabric Type"
                                placeholder="e.g. Cotton Twill"
                                required
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.shade}
                                onChange={val => updateLine(idx, 'shade', val)}
                                options={masterAttributes.SHADE}
                                attributeType="Shade"
                                placeholder="e.g. White"
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.artNo || ''}
                                onChange={val => updateLine(idx, 'artNo', val)}
                                options={masterAttributes.ART_NO}
                                attributeType="Art No"
                                placeholder="ART-101"
                                required
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <input type="text" className="form-input" style={{ height: 36, padding: '4px 8px' }} placeholder="e.g. 32" value={line.size} onChange={e => updateLine(idx, 'size', e.target.value)} required />
                            </td>
                          </>
                        )}

                        {/* ACCESSORY Columns */}
                        {poType === 'ACCESSORY' && (
                          <>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.category || ''}
                                onChange={val => updateLine(idx, 'category', val)}
                                options={masterAttributes.ACCESSORY_CATEGORY}
                                attributeType="Category"
                                placeholder="e.g. Shoes, Belts, Badges..."
                                required
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.name || ''}
                                onChange={val => updateLine(idx, 'name', val)}
                                options={masterAttributes.ITEM_NAME}
                                attributeType="Accessory Item"
                                placeholder="e.g. Derby Leather Shoes"
                                required
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.quality}
                                onChange={val => updateLine(idx, 'quality', val)}
                                options={masterAttributes.QUALITY}
                                attributeType="Quality"
                                placeholder="e.g. Genuine Leather"
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <LearningTypeaheadInput
                                value={line.shade}
                                onChange={val => updateLine(idx, 'shade', val)}
                                options={masterAttributes.SHADE}
                                attributeType="Color"
                                placeholder="e.g. Black"
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <input type="text" className="form-input" style={{ height: 36, padding: '4px 8px' }} placeholder="e.g. 8" value={line.size} onChange={e => updateLine(idx, 'size', e.target.value)} />
                            </td>
                          </>
                        )}

                        {/* Ordered Quantity */}
                        <td style={{ padding: '8px' }}>
                          <input type="number" className="form-input" style={{ height: 36, padding: '4px 8px' }} placeholder={poType === 'FABRIC' ? "Meters" : "Qty"} step={poType === 'FABRIC' ? "0.1" : "1"} min={poType === 'FABRIC' ? "0.1" : "1"} value={line.orderedQty} onChange={e => updateLine(idx, 'orderedQty', e.target.value)} required />
                        </td>

                        {/* Notes */}
                        <td style={{ padding: '8px' }}>
                          <input type="text" className="form-input" style={{ height: 36, padding: '4px 8px' }} placeholder="Optional notes" value={line.notes} onChange={e => updateLine(idx, 'notes', e.target.value)} />
                        </td>

                        {/* Client Split Button */}
                        <td style={{ padding: '8px' }}>
                          <button
                            type="button"
                            className={`btn btn-sm ${line.allocations?.length ? 'btn-secondary' : 'btn-ghost'}`}
                            onClick={() => setExpandedAllocIndex(expandedAllocIndex === idx ? null : idx)}
                            style={{
                              fontSize: 12,
                              padding: '4px 8px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              whiteSpace: 'nowrap',
                              color: line.allocations?.length ? 'var(--color-brand)' : (form.targetClient ? '#1e40af' : 'var(--color-text-muted)')
                            }}
                            title={line.allocations?.length ? 'View or edit custom client split' : (form.targetClient ? `Defaulted to ${form.targetClient}. Click to split.` : 'Allocate across clients')}
                          >
                            <Users size={14} />
                            {line.allocations?.length 
                              ? `${line.allocations.length} Clients` 
                              : (form.targetClient ? `${form.targetClient} (100%)` : '+ Split Client')}
                            {expandedAllocIndex === idx ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        </td>

                        {/* Action buttons */}
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                            <button type="button" className="btn btn-ghost btn-icon" onClick={() => duplicateLine(idx)} style={{ color: 'var(--color-brand)' }} title="Duplicate Line">
                              <Repeat2 size={16} />
                            </button>
                            {lines.length > 1 && (
                              <button type="button" className="btn btn-ghost btn-icon" onClick={() => removeLine(idx)} style={{ color: 'var(--color-danger)' }} title="Remove Line">
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Client Allocation Sub-Card */}
                      {expandedAllocIndex === idx && (() => {
                        const lineQty = parseFloat(line.orderedQty) || 0;
                        const allocs = line.allocations || [];
                        const totalAlloc = allocs.reduce((sum, a) => sum + (parseFloat(a.allocatedQty) || 0), 0);
                        const bufferQty = parseFloat((lineQty - totalAlloc).toFixed(2));
                        const isOver = bufferQty < -0.01;
                        const isBalanced = Math.abs(bufferQty) <= 0.01 && lineQty > 0;

                        return (
                          <tr key={`alloc-${idx}`}>
                            <td
                              colSpan={poType === 'FABRIC' ? 8 : (poType === 'READY_MADE' ? 9 : 9)}
                              style={{
                                background: '#f8fafc',
                                padding: '16px 20px',
                                borderTop: 'none',
                                borderBottom: '2px solid #cbd5e1'
                              }}
                            >
                              <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--color-border)', padding: 16 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <Users size={16} color="var(--color-brand)" />
                                      <strong style={{ fontSize: 13.5, color: '#0f172a' }}>
                                        Internal Multi-Client Allocation (Line #{idx + 1})
                                      </strong>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                      Earmark this {lineQty} {poType === 'FABRIC' ? 'meters' : 'units'} order across clients internally. Barcode labels remain standard.
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{ fontSize: 12.5 }}>
                                      Total: <strong>{lineQty}</strong> | Allocated: <strong style={{ color: isOver ? 'var(--color-danger)' : 'var(--color-brand)' }}>{totalAlloc}</strong>
                                      {bufferQty > 0 && <span style={{ color: '#059669', marginLeft: 6 }}>(Buffer Stock: {bufferQty})</span>}
                                      {isBalanced && <span style={{ color: '#059669', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={13} /> 100% Allocated</span>}
                                      {isOver && <span style={{ color: 'var(--color-danger)', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={13} /> Over by {Math.abs(bufferQty)}</span>}
                                    </div>

                                    <button
                                      type="button"
                                      className="btn btn-sm btn-primary"
                                      onClick={() => addAllocation(idx)}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                                    >
                                      <Plus size={13} /> Add Client
                                    </button>
                                  </div>
                                </div>

                                {allocs.length === 0 ? (
                                  <div style={{ padding: '14px', textAlign: 'center', color: 'var(--color-text-muted)', background: '#f8fafc', borderRadius: 6, fontSize: 13 }}>
                                    {form.targetClient 
                                      ? `This line is currently 100% earmarked for ${form.targetClient}. Click "+ Add Client" if you want to split it across multiple clients.`
                                      : `No specific clients entered. The full ${lineQty || 0} ${poType === 'FABRIC' ? 'meters' : 'units'} will be treated as General Stock. Click "+ Add Client" to allocate.`}
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {allocs.map((alloc, aIdx) => (
                                      <div key={aIdx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr 36px', gap: 10, alignItems: 'center' }}>
                                        <div>
                                          <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Client Name (e.g. St. Joseph's Academy)"
                                            value={alloc.clientName}
                                            onChange={e => {
                                              const val = e.target.value;
                                              const match = clientsList.find(c => c.name.toLowerCase() === val.toLowerCase());
                                              updateAllocation(idx, aIdx, 'clientName', val);
                                              if (match) updateAllocation(idx, aIdx, 'clientId', match.id);
                                            }}
                                            list={`clients-datalist-${idx}`}
                                            style={{ height: 34, fontSize: 13 }}
                                            required
                                          />
                                          <datalist id={`clients-datalist-${idx}`}>
                                            {clientsList.map(c => <option key={c.id} value={c.name} />)}
                                          </datalist>
                                        </div>
                                        <div>
                                          <input
                                            type="number"
                                            className="form-input"
                                            placeholder={poType === 'FABRIC' ? "Meters" : "Qty"}
                                            step={poType === 'FABRIC' ? "0.1" : "1"}
                                            min="0.1"
                                            value={alloc.allocatedQty}
                                            onChange={e => updateAllocation(idx, aIdx, 'allocatedQty', e.target.value)}
                                            style={{ height: 34, fontSize: 13 }}
                                            required
                                          />
                                        </div>
                                        <div>
                                          <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Optional remarks (e.g. Grades 1-5)"
                                            value={alloc.notes || ''}
                                            onChange={e => updateAllocation(idx, aIdx, 'notes', e.target.value)}
                                            style={{ height: 34, fontSize: 13 }}
                                          />
                                        </div>
                                        <div>
                                          <button
                                            type="button"
                                            className="btn btn-ghost btn-icon btn-sm"
                                            onClick={() => removeAllocation(idx, aIdx)}
                                            style={{ color: 'var(--color-danger)', width: 30, height: 30, padding: 0 }}
                                            title="Remove Allocation"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })()}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div style={{ marginTop: 16, textAlign: 'right', fontWeight: 700, fontSize: 16, paddingRight: 16, color: 'var(--color-brand)' }}>
                {poType === 'FABRIC'
                  ? `Total Expected: ${lines.reduce((sum, l) => sum + (parseFloat(l.orderedQty) || 0), 0).toFixed(1)} Meters`
                  : poType === 'READY_MADE'
                  ? `Total Expected: ${lines.reduce((sum, l) => sum + (parseFloat(l.orderedQty) || 0), 0)} Pieces`
                  : `Total Expected: ${lines.reduce((sum, l) => sum + (parseFloat(l.orderedQty) || 0), 0)} Units`}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/purchase-orders')}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting || (isEditMode && error.includes('cannot be edited'))}>
                {submitting ? <><span className="spinner" /> Saving...</> : (isEditMode ? 'Update PO' : 'Create Purchase Order')}
              </button>
            </div>
          </>
        )}
      </form>

      {/* ── Quick Add Supplier Modal ── */}
      {showQuickAddModal && (
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
            maxWidth: 520,
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#fafbfc'
            }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building2 size={18} /> Quick Add Supplier
              </h2>
              <button 
                type="button"
                className="btn btn-ghost" 
                onClick={() => setShowQuickAddModal(false)}
                style={{ padding: 4, color: 'var(--color-text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleQuickAddSupplierSubmit} style={{ padding: 20 }}>
              {quickError && (
                <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                  {quickError}
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Official Legal / Mill Name <span className="required">*</span></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Siyaram Silk Mills Ltd., Raymond Limited"
                  value={quickForm.name}
                  onChange={e => setQuickForm({ ...quickForm, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>

              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">City</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Surat"
                    value={quickForm.city}
                    onChange={e => setQuickForm({ ...quickForm, city: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Phone</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. +91 98200 12345"
                    value={quickForm.phone}
                    onChange={e => setQuickForm({ ...quickForm, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Factory Address</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. B-12, Textile Market, Ring Road"
                  value={quickForm.address}
                  onChange={e => setQuickForm({ ...quickForm, address: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowQuickAddModal(false)}
                  disabled={quickSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={quickSubmitting}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {quickSubmitting ? <span className="spinner" /> : 'Save & Select Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Quick Add Client Modal ── */}
      {showQuickAddClientModal && (
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
            maxWidth: 520,
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#fafbfc'
            }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={18} /> Quick Add Master Client
              </h2>
              <button 
                type="button"
                className="btn btn-ghost" 
                onClick={() => setShowQuickAddClientModal(false)}
                style={{ padding: 4, color: 'var(--color-text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleQuickAddClientSubmit} style={{ padding: 20 }}>
              {quickClientError && (
                <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                  {quickClientError}
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Client / School / Customer Name <span className="required">*</span></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Al-Ameen School Uniforms, DPS International"
                  value={quickClientForm.name}
                  onChange={e => setQuickClientForm({ ...quickClientForm, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Type of Client <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span></label>
                <input
                  type="text"
                  className="form-input"
                  list="quick-po-client-types"
                  placeholder="Select or enter type (e.g. School, Wholesaler, Retailer, Corporate)"
                  value={quickClientForm.clientType}
                  onChange={e => setQuickClientForm({ ...quickClientForm, clientType: e.target.value })}
                />
                <datalist id="quick-po-client-types">
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

              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Contact Person</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Mr. Rajesh / Principal"
                    value={quickClientForm.contactPerson}
                    onChange={e => setQuickClientForm({ ...quickClientForm, contactPerson: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Phone Number</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. +91 98470 12345"
                    value={quickClientForm.phone}
                    onChange={e => setQuickClientForm({ ...quickClientForm, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">City / Destination</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Manjeri, Calicut"
                    value={quickClientForm.city}
                    onChange={e => setQuickClientForm({ ...quickClientForm, city: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Full Address / Delivery Location</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Main Campus, P.O. Box 14, Near Junction"
                  value={quickClientForm.address}
                  onChange={e => setQuickClientForm({ ...quickClientForm, address: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowQuickAddClientModal(false)}
                  disabled={quickClientSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={quickClientSubmitting}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {quickClientSubmitting ? <span className="spinner" /> : 'Save & Select Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
