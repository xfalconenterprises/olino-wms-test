import { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  Layers, 
  Package, 
  MapPin, 
  Truck, 
  Calendar, 
  X, 
  SlidersHorizontal, 
  RefreshCcw, 
  Printer, 
  AlertCircle,
  Download,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  AlertTriangle,
  History,
  CornerDownRight,
  ShieldAlert,
  CheckCircle2,
  Users,
  Repeat2
} from 'lucide-react';
import api from '../../../utils/api';
import { formatDateTime, formatDate } from '../../../utils/format';
import { exportToExcel } from '../../../utils/exportExcel';
import '../../../styles/components.css';

interface SKUChildBatch {
  id: string;
  batchCode: string;
  quantity: number;
  status: string;
  locationCode: string;
  supplierBundle: string | null;
  invoiceRef: string | null;
  clientId?: string | null;
  clientName?: string | null;
  createdAt: string;
  poLine?: any;
  poLineId?: string | null;
  grn?: any;
  grnId?: string | null;
  batchLocations?: any[];
}

interface AggregatedSKU {
  id: string;
  itemType: string;
  brand: string;
  quality: string | null;
  shade: string | null;
  size: string | null;
  category: string | null;
  name: string | null;
  artNo: string | null;
  uom: string;
  totalQuantity: number;
  activeBatches: number;
  fullRollsCount?: number;
  partialRollsCount?: number;
  locations?: string[];
  batches?: SKUChildBatch[];
}

interface BatchRecord {
  id: string;
  batchCode: string;
  quantity: number;
  status: string;
  supplierBundle: string | null;
  invoiceRef: string | null;
  clientId?: string | null;
  clientName?: string | null;
  createdAt: string;
  itemType?: string;
  category?: string | null;
  brand?: string | null;
  quality?: string | null;
  shade?: string | null;
  size?: string | null;
  name?: string | null;
  artNo?: string | null;
  uom?: string;
  poLineId?: string | null;
  poLine?: {
    id?: string;
    poId?: string;
    brand?: string | null;
    quality?: string | null;
    shade?: string | null;
    po?: {
      id?: string;
      poNumber: string;
      supplierName: string;
      targetClient?: string | null;
      status?: string;
      expectedDate?: string | null;
      supplier?: { id?: string; name?: string; };
    };
  };
  grnId?: string | null;
  grn?: {
    id?: string;
    grnNumber?: string;
    invoiceRef?: string | null;
    totalRolls?: number;
    totalQuantity?: number;
    status?: string;
    createdAt?: string;
    supplierName?: string;
    poId?: string | null;
    poNumber?: string | null;
    po?: { id?: string; poNumber?: string; supplierName?: string; };
    receivedBy?: { id?: string; name?: string; };
  };
  batchLocations: { quantity: number; location: { code: string; } }[];
}

interface InventorySummary {
  totalBatches: number;
  fabric: {
    totalMeters: number;
    lumpCount: number;
    fullRolls: number;
    partialRolls: number;
  };
  readyMade: {
    totalPcs: number;
    packCount: number;
  };
  accessory: {
    totalUnits: number;
    itemCount: number;
  };
  dockQueue: {
    unassignedCount: number;
    unassignedFabricMeters: number;
    unassignedReadyMadePcs: number;
    unassignedAccessoryUnits: number;
  };
  locations: {
    total: number;
    occupied: number;
    empty: number;
    occupancyRate: number;
  };
}

interface BatchTransaction {
  id: string;
  type: string;
  quantityMoved: number;
  previousQuantity: number | null;
  newQuantity: number | null;
  referenceType: string | null;
  referenceId: string | null;
  notes: string | null;
  createdAt: string;
  operator?: { name: string };
  fromLocation?: { code: string };
  toLocation?: { code: string };
}

export default function InventoryDashboardPage() {
  const [viewMode, setViewMode] = useState<'AGGREGATED' | 'GRANULAR'>('AGGREGATED');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Executive Summary
  const [summary, setSummary] = useState<InventorySummary | null>(null);

  // Category Quick Tabs
  const [categoryTab, setCategoryTab] = useState<'ALL' | 'FABRIC' | 'READY_MADE' | 'ACCESSORY'>('ALL');

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [brand, setBrand] = useState('');
  const [quality, setQuality] = useState('');
  const [shade, setShade] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [debouncedBrand, setDebouncedBrand] = useState('');
  const [debouncedQuality, setDebouncedQuality] = useState('');
  const [debouncedShade, setDebouncedShade] = useState('');
  const [debouncedLocationCode, setDebouncedLocationCode] = useState('');

  // Sorting
  const [sortField, setSortField] = useState<'code' | 'quantity' | 'date' | 'location'>('date');
  const [sortAsc, setSortAsc] = useState<boolean>(false);


  // Data
  const [skus, setSkus] = useState<AggregatedSKU[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);

  // Item Passport Drawer
  const [selectedBatch, setSelectedBatch] = useState<BatchRecord | null>(null);
  const [batchHistory, setBatchHistory] = useState<BatchTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Clients for internal earmark filtering & reallocation
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
  const [selectedClientFilter, setSelectedClientFilter] = useState('');

  // Reallocate Client Modal State
  const [reallocateModalOpen, setReallocateModalOpen] = useState(false);
  const [batchToReallocate, setBatchToReallocate] = useState<BatchRecord | null>(null);
  const [targetClientId, setTargetClientId] = useState('');
  const [targetClientName, setTargetClientName] = useState('');
  const [reallocateReason, setReallocateReason] = useState('');
  const [reallocating, setReallocating] = useState(false);
  const [reallocateError, setReallocateError] = useState('');

  // Debounce search inputs
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setDebouncedBrand(brand);
      setDebouncedQuality(quality);
      setDebouncedShade(shade);
      setDebouncedLocationCode(locationCode);
    }, 350);
    return () => clearTimeout(timer);
  }, [search, brand, quality, shade, locationCode]);

  // Fetch summary once on mount & on refresh
  const fetchSummary = async () => {
    try {
      const res = await api.get('/api/inventory/summary');
      setSummary(res.data);
    } catch (e) {
      console.error('Failed to load inventory summary', e);
    }
  };

  useEffect(() => {
    fetchSummary();
    api.get('/api/clients').then(res => {
      if (Array.isArray(res.data)) {
        setClientsList(res.data);
      }
    }).catch(() => {});
  }, []);

  // Fetch data on filter change
  useEffect(() => {
    fetchData();
  }, [viewMode, categoryTab, debouncedSearch, status, debouncedBrand, debouncedQuality, debouncedShade, debouncedLocationCode, selectedClientFilter, startDate, endDate]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.append('search', debouncedSearch);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      // Category tab handling
      if (categoryTab !== 'ALL') {
        params.append('itemType', categoryTab);
      }

      if (status && viewMode === 'GRANULAR') params.append('status', status);
      if (debouncedBrand) params.append('brand', debouncedBrand);
      if (debouncedQuality) params.append('quality', debouncedQuality);
      if (debouncedShade) params.append('shade', debouncedShade);
      if (debouncedLocationCode && viewMode === 'GRANULAR') params.append('location', debouncedLocationCode);
      if (selectedClientFilter) params.append('client', selectedClientFilter);

      if (viewMode === 'AGGREGATED') {
        const res = await api.get(`/api/inventory/skus?${params.toString()}`);
        setSkus(Array.isArray(res.data) ? res.data : []);
      } else {
        const res = await api.get(`/api/inventory/batches?${params.toString()}`);
        setBatches(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err: any) {
      console.error('Inventory Dashboard error:', err);
      setError(err?.response?.data?.error || err?.message || 'Failed to fetch inventory records');
    } finally {
      setLoading(false);
    }
  };

  // Load batch history and full details when Item Passport opens
  const openBatchPassport = async (b: BatchRecord) => {
    setSelectedBatch(b);
    setBatchHistory([]);
    setLoadingHistory(true);
    try {
      const [batchRes, historyRes] = await Promise.allSettled([
        api.get(`/api/batches/${b.id}`),
        api.get(`/api/transactions?batchId=${b.id}`)
      ]);

      if (batchRes.status === 'fulfilled' && batchRes.value?.data) {
        setSelectedBatch(prev => ({
          ...(prev || {}),
          ...batchRes.value.data
        }));
      }

      if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value?.data)) {
        setBatchHistory(historyRes.value.data);
      }
    } catch (e) {
      console.error('Failed to load batch transactions / passport data', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const [qcActionLoading, setQcActionLoading] = useState(false);

  const handleQcHold = async (batchId: string) => {
    const reason = window.prompt('Enter reason for Quality Control Hold (Quarantine):', 'Defect / Shade Mismatch');
    if (reason === null) return;
    setQcActionLoading(true);
    try {
      await api.post(`/api/batches/${batchId}/qc-hold`, { reason });
      setSelectedBatch(prev => prev ? { ...prev, status: 'QC_HOLD' } : null);
      fetchData();
      fetchSummary();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to place batch on QC hold');
    } finally {
      setQcActionLoading(false);
    }
  };

  const handleQcApprove = async (batchId: string) => {
    if (!window.confirm('Approve and release this batch from Quality Control Hold to active inventory?')) return;
    setQcActionLoading(true);
    try {
      const res = await api.post(`/api/batches/${batchId}/qc-approve`);
      setSelectedBatch(prev => prev ? { ...prev, status: res.data.status } : null);
      fetchData();
      fetchSummary();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to release batch from QC hold');
    } finally {
      setQcActionLoading(false);
    }
  };

  const openReallocateModal = (batch: BatchRecord) => {
    setBatchToReallocate(batch);
    setTargetClientId(batch.clientId || '');
    setTargetClientName(batch.clientName || '');
    setReallocateReason('');
    setReallocateError('');
    setReallocateModalOpen(true);
  };

  const handleConfirmReallocate = async () => {
    if (!batchToReallocate) return;
    setReallocating(true);
    setReallocateError('');
    try {
      const res = await api.post(`/api/batches/${batchToReallocate.id}/reallocate-client`, {
        clientId: targetClientId || null,
        clientName: targetClientName || null,
        reason: reallocateReason.trim() || undefined
      });

      if (selectedBatch && selectedBatch.id === batchToReallocate.id) {
        setSelectedBatch(prev => prev ? {
          ...prev,
          clientId: res.data.clientId,
          clientName: res.data.clientName
        } : null);
        api.get(`/api/transactions?batchId=${batchToReallocate.id}`)
          .then(hRes => {
            if (Array.isArray(hRes.data)) setBatchHistory(hRes.data);
          }).catch(() => {});
      }

      setReallocateModalOpen(false);
      setBatchToReallocate(null);
      fetchData();
    } catch (err: any) {
      setReallocateError(err.response?.data?.error || err.message || 'Failed to reallocate client');
    } finally {
      setReallocating(false);
    }
  };

  // Accordion Expand State & Lazy Loading for SKU Rollup
  const [expandedSkuIds, setExpandedSkuIds] = useState<Record<string, boolean>>({});
  const [loadingSkuBatches, setLoadingSkuBatches] = useState<Record<string, boolean>>({});

  const toggleSkuExpand = async (sku: AggregatedSKU) => {
    const willExpand = !expandedSkuIds[sku.id];
    setExpandedSkuIds(prev => ({
      ...prev,
      [sku.id]: willExpand
    }));

    // If expanding and child batches have not been loaded yet, fetch on-demand
    if (willExpand && (!sku.batches || sku.batches.length === 0)) {
      setLoadingSkuBatches(prev => ({ ...prev, [sku.id]: true }));
      try {
        const params = new URLSearchParams();
        if (sku.itemType) params.append('itemType', sku.itemType);
        if (sku.brand && sku.brand !== '—') params.append('brand', sku.brand);
        if (sku.quality) params.append('quality', sku.quality);
        if (sku.shade) params.append('shade', sku.shade);
        if (sku.size) params.append('size', sku.size);
        if (sku.category) params.append('category', sku.category);
        if (sku.name) params.append('name', sku.name);
        if (sku.artNo) params.append('artNo', sku.artNo);
        if (selectedClientFilter) params.append('client', selectedClientFilter);

        const res = await api.get(`/api/inventory/skus/batches?${params.toString()}`);
        const loadedBatches = Array.isArray(res.data) ? res.data : [];
        setSkus(prev => prev.map(item => item.id === sku.id ? { ...item, batches: loadedBatches } : item));
      } catch (err) {
        console.error('Failed to load child batches for SKU', err);
      } finally {
        setLoadingSkuBatches(prev => ({ ...prev, [sku.id]: false }));
      }
    }
  };

  const getBatchItemType = (b: BatchRecord) => b.itemType || 'FABRIC';
  const getBatchBrand = (b: BatchRecord) => b.brand || '—';
  const getBatchQuality = (b: BatchRecord) => b.quality || '';
  const getBatchShade = (b: BatchRecord) => b.shade || '';
  const getBatchSize = (b: BatchRecord) => b.size || '';
  const getBatchCategory = (b: BatchRecord) => b.category || '';
  const getBatchName = (b: BatchRecord) => b.name || '';
  const getBatchArtNo = (b: BatchRecord) => b.artNo || '';
  const getBatchUnit = (b: BatchRecord) => {
    if (b.uom) return b.uom.toLowerCase();
    const type = getBatchItemType(b);
    if (type === 'FABRIC') return 'm';
    if (type === 'READY_MADE') return 'pcs';
    return 'units';
  };

  // Sorting
  const sortedBatches = useMemo(() => {
    const list = [...batches];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'code') {
        cmp = a.batchCode.localeCompare(b.batchCode);
      } else if (sortField === 'quantity') {
        cmp = a.quantity - b.quantity;
      } else if (sortField === 'date') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortField === 'location') {
        const locA = a.batchLocations?.[0]?.location?.code || 'ZZZ';
        const locB = b.batchLocations?.[0]?.location?.code || 'ZZZ';
        cmp = locA.localeCompare(locB);
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [batches, sortField, sortAsc]);

  const handleSort = (field: 'code' | 'quantity' | 'date' | 'location') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false); // default desc
    }
  };

  // Export to Excel / CSV
  const handleExport = () => {
    if (viewMode === 'AGGREGATED') {
      const headers = [
        'Item Type',
        'Brand',
        'Quality',
        'Shade / Color',
        'Category',
        'Size',
        'Article No',
        'Total Quantity',
        'UOM',
        'Active Lumps/Batches',
        'Full Rolls/Packs',
        'Partial Rolls',
        'Warehouse Locations'
      ];
      const rows = skus.map(s => [
        s.itemType,
        s.brand,
        s.quality || '',
        s.shade || '',
        s.category || '',
        s.size || '',
        s.artNo || '',
        s.totalQuantity,
        s.uom,
        s.activeBatches,
        s.fullRollsCount || 0,
        s.partialRollsCount || 0,
        (s.locations || []).join('; ')
      ]);
      exportToExcel('Olino_SKU_Inventory_Rollup', headers, rows);
    } else {
      const headers = [
        'Batch / Barcode',
        'Item Type',
        'Brand',
        'Quality',
        'Shade / Color',
        'Category',
        'Size',
        'Item Name',
        'Article No',
        'Quantity',
        'UOM',
        'Status',
        'Physical Shelf Location',
        'Supplier Bundle',
        'Invoice Ref',
        'PO Number',
        'Supplier Name',
        'Received Date'
      ];
      const rows = sortedBatches.map(b => [
        b.batchCode,
        getBatchItemType(b),
        getBatchBrand(b),
        getBatchQuality(b),
        getBatchShade(b),
        getBatchCategory(b),
        getBatchSize(b),
        getBatchName(b),
        getBatchArtNo(b),
        b.quantity,
        getBatchUnit(b),
        b.status,
        b.batchLocations?.[0]?.location?.code || 'Unassigned',
        b.supplierBundle || '',
        b.invoiceRef || '',
        b.poLine?.po?.poNumber || '',
        b.poLine?.po?.supplierName || '',
        formatDate(b.createdAt)
      ]);
      exportToExcel('Olino_Granular_Inventory_Tracking', headers, rows);
    }
  };

  const skuRollupColSpan = categoryTab === 'FABRIC' ? 7 : 9;

  return (
    <div style={{ maxWidth: '100%', margin: '0 auto', paddingBottom: 40 }}>
      
      {/* ─── Header & View Switcher ────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={28} /> Global Inventory Dashboard
          </h1>
          <p className="page-subtitle" style={{ marginTop: 4 }}>
            Central command center to monitor, drill down, and audit physical warehouse inventory across all shelves and storage racks
          </p>
        </div>

        {/* View Mode Toggle */}
        <div style={{ 
          display: 'inline-flex', 
          background: '#f1f5f9', 
          padding: 2, 
          borderRadius: 6, 
          border: '1px solid var(--color-border)',
          gap: 2 
        }}>
          <button 
            type="button"
            onClick={() => setViewMode('AGGREGATED')}
            style={{ 
              padding: '5px 12px', 
              fontSize: 12.5, 
              fontWeight: viewMode === 'AGGREGATED' ? 600 : 500, 
              borderRadius: 4, 
              border: 'none', 
              background: viewMode === 'AGGREGATED' ? '#ffffff' : 'transparent',
              color: viewMode === 'AGGREGATED' ? 'var(--color-brand)' : 'var(--color-text-muted)',
              boxShadow: viewMode === 'AGGREGATED' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.12s ease'
            }}
          >
            <Package size={14} />
            <span>SKU Rollup</span>
          </button>
          <button 
            type="button"
            onClick={() => setViewMode('GRANULAR')}
            style={{ 
              padding: '5px 12px', 
              fontSize: 12.5, 
              fontWeight: viewMode === 'GRANULAR' ? 600 : 500, 
              borderRadius: 4, 
              border: 'none', 
              background: viewMode === 'GRANULAR' ? '#ffffff' : 'transparent',
              color: viewMode === 'GRANULAR' ? 'var(--color-brand)' : 'var(--color-text-muted)',
              boxShadow: viewMode === 'GRANULAR' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.12s ease'
            }}
          >
            <Layers size={14} />
            <span>Granular</span>
          </button>
        </div>
      </div>

      {/* ─── Executive Stock Snapshot Bar ──────────────────────────────────── */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
          {/* Card 1: Fabric */}
          <div 
            className="card" 
            onClick={() => setCategoryTab('FABRIC')}
            style={{ 
              padding: '14px 18px', 
              borderLeft: '4px solid #0284c7', 
              cursor: 'pointer',
              background: categoryTab === 'FABRIC' ? '#f0f9ff' : '#fff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Fabric Stock</span>
              <Layers size={18} color="#0284c7" />
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#0369a1', marginTop: 4 }}>
              {summary.fabric.totalMeters.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 500 }}>meters</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {summary.fabric.lumpCount} lumps ({summary.fabric.fullRolls} full · {summary.fabric.partialRolls} cut)
            </div>
          </div>

          {/* Card 2: Ready-Made */}
          <div 
            className="card" 
            onClick={() => setCategoryTab('READY_MADE')}
            style={{ 
              padding: '14px 18px', 
              borderLeft: '4px solid #16a34a', 
              cursor: 'pointer',
              background: categoryTab === 'READY_MADE' ? '#f0fdf4' : '#fff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Ready-Made Goods</span>
              <Package size={18} color="#16a34a" />
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#15803d', marginTop: 4 }}>
              {summary.readyMade.totalPcs.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 500 }}>pieces</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {summary.readyMade.packCount} cartons/packs in stock
            </div>
          </div>

          {/* Card 3: Accessories */}
          <div 
            className="card" 
            onClick={() => setCategoryTab('ACCESSORY')}
            style={{ 
              padding: '14px 18px', 
              borderLeft: '4px solid #8b5cf6', 
              cursor: 'pointer',
              background: categoryTab === 'ACCESSORY' ? '#faf5ff' : '#fff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Accessories &amp; Trims</span>
              <Package size={18} color="#8b5cf6" />
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#6d28d9', marginTop: 4 }}>
              {summary.accessory.totalUnits.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 500 }}>units</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {summary.accessory.itemCount} accessory lines in stock
            </div>
          </div>
        </div>
      )}

      {/* ─── Search, Tabs & Action Toolbar ─────────────────────────────────── */}
      <div style={{ 
        background: '#fff', 
        padding: '16px 20px', 
        borderRadius: 'var(--radius-lg)', 
        border: '1px solid var(--color-border)', 
        marginBottom: 20 
      }}>
        {/* Main Row */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          
          {/* Search Input */}
          <div style={{ flex: 1, minWidth: 280, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input 
              type="text" 
              placeholder="Search Barcode, Supplier, Brand, Quality, Shade, Article No, Invoice..." 
              className="form-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 40, height: 40, fontSize: 13.5 }}
            />
          </div>

          {/* Category Tabs */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: 3, borderRadius: 6, gap: 2 }}>
            {[
              { key: 'ALL', label: 'All Stock' },
              { key: 'FABRIC', label: 'Fabric Rolls' },
              { key: 'READY_MADE', label: 'Ready-Made' },
              { key: 'ACCESSORY', label: 'Accessories' },
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setCategoryTab(tab.key as any)}
                style={{
                  border: 'none',
                  background: categoryTab === tab.key ? '#ffffff' : 'transparent',
                  color: categoryTab === tab.key ? 'var(--color-brand)' : 'var(--color-text-muted)',
                  fontWeight: categoryTab === tab.key ? 700 : 500,
                  fontSize: 12.5,
                  padding: '6px 12px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  boxShadow: categoryTab === tab.key ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Calendar Date Filter */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            background: '#ffffff', 
            border: (startDate || endDate) ? '1px solid var(--color-brand)' : '1px solid var(--color-border)', 
            borderRadius: 'var(--radius-md)', 
            padding: '2px 10px', 
            height: 40,
            gap: 6,
            boxShadow: 'var(--shadow-xs)'
          }}>
            <Calendar size={15} color={(startDate || endDate) ? 'var(--color-brand)' : 'var(--color-text-muted)'} />
            <input 
              type="date" 
              value={startDate} 
              onChange={e => setStartDate(e.target.value)} 
              title="From Inward Date"
              style={{ 
                border: 'none', 
                outline: 'none', 
                fontSize: 12.5, 
                color: 'var(--color-text-main)', 
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                width: 125
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>&ndash;</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={e => setEndDate(e.target.value)} 
              title="To Inward Date"
              style={{ 
                border: 'none', 
                outline: 'none', 
                fontSize: 12.5, 
                color: 'var(--color-text-main)', 
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                width: 125
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
                  padding: '2px 4px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  color: 'var(--color-text-muted)',
                  borderRadius: 4
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button 
              type="button"
              className={`btn ${showAdvanced ? 'btn-primary' : 'btn-secondary'}`} 
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{ height: 40, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <SlidersHorizontal size={15} /> Advanced Filters
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExport}
              style={{ height: 40, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <Download size={15} /> Export Excel
            </button>
          </div>
        </div>

        {/* Advanced Filters Expandable Drawer */}
        {showAdvanced && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--color-border)' }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Brand</label>
              <input type="text" className="form-input" placeholder="e.g. Siyaram" value={brand} onChange={e => setBrand(e.target.value)} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Quality</label>
              <input type="text" className="form-input" placeholder="e.g. Suiting" value={quality} onChange={e => setQuality(e.target.value)} style={{ height: 36, fontSize: 13 }} />
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Shade / Size</label>
              <input type="text" className="form-input" placeholder="e.g. Navy Blue" value={shade} onChange={e => setShade(e.target.value)} style={{ height: 36, fontSize: 13 }} />
            </div>
            
            {viewMode === 'GRANULAR' && (
              <>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Location / Shelf</label>
                  <input type="text" className="form-input" placeholder="e.g. A-B1-L1-P1" value={locationCode} onChange={e => setLocationCode(e.target.value)} style={{ height: 36, fontSize: 13 }} />
                </div>
                
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Status</label>
                  <select className="form-input" value={status} onChange={e => setStatus(e.target.value)} style={{ height: 36, fontSize: 13 }}>
                    <option value="">Active Stock (In Stock &amp; Cut)</option>
                    <option value="IN_STOCK">Full Rolls / Full Packs</option>
                    <option value="PARTIALLY_USED">Partial Rolls / Cut</option>
                    <option value="QC_HOLD">QC Hold / Quarantine</option>
                    <option value="OUT">Dispatched (History)</option>
                    <option value="ALL">All Statuses</option>
                  </select>
                </div>
              </>
            )}

            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Client Earmark</label>
              <select className="form-input" value={selectedClientFilter} onChange={e => setSelectedClientFilter(e.target.value)} style={{ height: 36, fontSize: 13 }}>
                <option value="">All Clients &amp; Free Stock</option>
                <option value="GENERAL">Free Buffer / General Stock</option>
                {clientsList.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Date Presets</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  style={{ fontSize: 12, height: 36, padding: '0 10px' }}
                  onClick={() => {
                    const today = new Date().toISOString().split('T')[0];
                    setStartDate(today);
                    setEndDate(today);
                  }}
                >
                  Today
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  style={{ fontSize: 12, height: 36, padding: '0 10px' }}
                  onClick={() => {
                    const now = new Date();
                    const d = new Date();
                    d.setDate(now.getDate() - 7);
                    setStartDate(d.toISOString().split('T')[0]);
                    setEndDate(now.toISOString().split('T')[0]);
                  }}
                >
                  Last 7 Days
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  style={{ fontSize: 12, height: 36, padding: '0 10px' }}
                  onClick={() => {
                    const now = new Date();
                    const d = new Date();
                    d.setDate(now.getDate() - 30);
                    setStartDate(d.toISOString().split('T')[0]);
                    setEndDate(now.toISOString().split('T')[0]);
                  }}
                >
                  Last 30 Days
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  style={{ fontSize: 12, height: 36, padding: '0 10px' }}
                  onClick={() => {
                    const now = new Date();
                    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                    const lastDay = now.toISOString().split('T')[0];
                    setStartDate(firstDay);
                    setEndDate(lastDay);
                  }}
                >
                  This Month
                </button>
              </div>
            </div>

            <div>
              <button 
                type="button"
                className="btn btn-ghost" 
                title="Reset All Filters"
                onClick={() => {
                  setSearch(''); setBrand(''); setQuality(''); setShade(''); setLocationCode(''); setStatus(''); setCategoryTab('ALL'); setStartDate(''); setEndDate('');
                }}
                style={{ height: 36, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <RefreshCcw size={14} /> Reset
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Error Alert ───────────────────────────────────────────────────── */}
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={18} />
          <div>{error}</div>
        </div>
      )}

      {/* ─── Table View (SKU Rollup vs Granular) ───────────────────────────── */}
      <div className="card" style={{ boxShadow: 'var(--shadow-sm)', overflow: 'hidden', width: '100%' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center' }}><span className="spinner spinner-lg" /></div>
        ) : viewMode === 'AGGREGATED' ? (
          
          /* ─── SKU ROLLUP VIEW (With Category-Specific Columns & Interactive Drilldown) ──── */
          <div className="table-responsive-wrapper" style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="table" style={{ fontSize: 13.5, minWidth: 1050, width: '100%' }}>
            <thead>
              {categoryTab === 'FABRIC' ? (
                <tr>
                  <th style={{ width: 44 }}></th>
                  <th>Fabric Brand</th>
                  <th>Quality Grade</th>
                  <th>Color / Shade</th>
                  <th>In Stock (Meters)</th>
                  <th>Lumps Count (Full vs Cut)</th>
                  <th>Physical Shelves</th>
                </tr>
              ) : categoryTab === 'READY_MADE' ? (
                <tr>
                  <th style={{ width: 44 }}></th>
                  <th>Garment / Item Name</th>
                  <th>Brand</th>
                  <th>Category</th>
                  <th>Color / Shade</th>
                  <th>Size</th>
                  <th>In Stock (Pieces)</th>
                  <th>Packs / Cartons</th>
                  <th>Physical Shelves</th>
                </tr>
              ) : categoryTab === 'ACCESSORY' ? (
                <tr>
                  <th style={{ width: 44 }}></th>
                  <th>Accessory Item</th>
                  <th>Brand</th>
                  <th>Spec / Quality</th>
                  <th>Color / Shade</th>
                  <th>Size / Art No</th>
                  <th>In Stock (Units)</th>
                  <th>Packs / Boxes</th>
                  <th>Physical Shelves</th>
                </tr>
              ) : (
                <tr>
                  <th style={{ width: 44 }}></th>
                  <th style={{ width: 95 }}>Item Type</th>
                  <th>Brand</th>
                  <th>Quality / Description</th>
                  <th>Color / Shade</th>
                  <th>Category / Size</th>
                  <th>Total In Stock</th>
                  <th>Lumps / Packs</th>
                  <th>Physical Shelves</th>
                </tr>
              )}
            </thead>
            <tbody>
              {skus.map(s => {
                const isExpanded = !!expandedSkuIds[s.id];
                const unitStr = s.itemType === 'FABRIC' ? 'm' : (s.itemType === 'READY_MADE' ? 'pcs' : 'units');
                const childBatches = s.batches || [];

                return (
                  <>
                    <tr 
                      key={s.id} 
                      onClick={() => toggleSkuExpand(s)}
                      style={{ 
                        cursor: 'pointer', 
                        background: isExpanded ? 'var(--color-bg-subtle)' : undefined,
                        borderBottom: isExpanded ? 'none' : undefined
                      }}
                      className="hover-row"
                    >
                      <td style={{ textAlign: 'center', width: 44, verticalAlign: 'middle' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 4, background: isExpanded ? 'var(--color-bg-subtle)' : '#f8fafc', border: '1px solid var(--color-border)' }}>
                          {isExpanded ? <ChevronDown size={14} color="var(--color-brand)" /> : <ChevronRight size={14} color="var(--color-text-muted)" />}
                        </div>
                      </td>

                      {/* ── Category-Specific Cells ── */}
                      {categoryTab === 'FABRIC' ? (
                        <>
                          <td><strong>{s.brand}</strong></td>
                          <td><span style={{ fontWeight: 600, color: '#334155' }}>{s.quality || '—'}</span></td>
                          <td><span className="badge badge-secondary" style={{ fontWeight: 600 }}>{s.shade || '—'}</span></td>
                          <td>
                            <span style={{ fontSize: 15, fontWeight: 700, color: '#0369a1' }}>
                              {s.totalQuantity} m
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {s.activeBatches} lumps
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                              {s.fullRollsCount || 0} full · {s.partialRollsCount || 0} cut
                            </div>
                          </td>
                        </>
                      ) : categoryTab === 'READY_MADE' ? (
                        <>
                          <td>
                            <strong>{s.name || s.artNo || 'Garment'}</strong>
                            {s.artNo && s.name && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Art: {s.artNo}</div>}
                          </td>
                          <td>{s.brand}</td>
                          <td>{s.category || '—'}</td>
                          <td>{s.shade || '—'}</td>
                          <td><span className="badge badge-secondary" style={{ fontWeight: 700 }}>{s.size || '—'}</span></td>
                          <td>
                            <span style={{ fontSize: 15, fontWeight: 700, color: '#15803d' }}>
                              {s.totalQuantity} pcs
                            </span>
                          </td>
                          <td>
                            <strong>{s.activeBatches} packs</strong>
                          </td>
                        </>
                      ) : categoryTab === 'ACCESSORY' ? (
                        <>
                          <td>
                            <strong>{s.name || 'Accessory'}</strong>
                          </td>
                          <td>{s.brand}</td>
                          <td>{s.quality || '—'}</td>
                          <td>{s.shade || '—'}</td>
                          <td>{s.size || s.artNo || '—'}</td>
                          <td>
                            <span style={{ fontSize: 15, fontWeight: 700, color: '#6d28d9' }}>
                              {s.totalQuantity} {s.uom.toLowerCase()}
                            </span>
                          </td>
                          <td>
                            <strong>{s.activeBatches} units/boxes</strong>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-main)' }}>
                              {s.itemType === 'READY_MADE' ? 'Ready Made' : s.itemType === 'FABRIC' ? 'Fabric' : s.itemType === 'ACCESSORY' ? 'Accessory' : s.itemType.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td><strong>{s.brand}</strong></td>
                          <td>{s.itemType === 'FABRIC' ? (s.quality || '—') : (s.name || s.quality || '—')}</td>
                          <td>{s.shade || '—'}</td>
                          <td>
                            {s.category || s.size || s.artNo ? (
                              <span>
                                {s.category ? `${s.category} ` : ''}
                                {s.size ? `· Size ${s.size} ` : ''}
                                {s.artNo ? `· Art ${s.artNo}` : ''}
                              </span>
                            ) : '—'}
                          </td>
                          <td>
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-brand)' }}>
                              {s.totalQuantity} {unitStr}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {s.activeBatches} {s.itemType === 'FABRIC' ? 'lumps' : 'packs'}
                            </div>
                            {s.itemType === 'FABRIC' && (s.fullRollsCount !== undefined) && (
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                {s.fullRollsCount} full · {s.partialRollsCount} cut
                              </div>
                            )}
                          </td>
                        </>
                      )}

                      <td>
                        {s.locations && s.locations.length > 0 ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {s.locations.slice(0, 3).map((loc, li) => (
                              <span key={li} className="badge badge-secondary" style={{ fontSize: 11 }}>
                                <MapPin size={10} style={{ marginRight: 2 }} /> {loc}
                              </span>
                            ))}
                            {s.locations.length > 3 && (
                              <span className="badge badge-neutral" style={{ fontSize: 11 }}>+{s.locations.length - 3} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontSize: 11 }}>Unassigned</span>
                        )}
                      </td>
                    </tr>

                    {/* Accordion Child Table */}
                    {isExpanded && (
                      <tr key={`${s.id}-expanded`} style={{ background: '#f8fafc' }}>
                        <td colSpan={skuRollupColSpan} style={{ padding: '12px 24px 20px 48px', borderBottom: '1px solid var(--color-border)' }}>
                          <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                            <div style={{ padding: '10px 16px', background: '#f1f5f9', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <CornerDownRight size={14} color="var(--color-brand)" /> Child {s.itemType === 'FABRIC' ? 'Rolls & Lumps' : 'Packs & Batches'} for {s.brand} {s.quality || s.name || ''} ({s.shade || ''})
                              </span>
                              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                Showing {childBatches.length} individual items
                              </span>
                            </div>

                            <div className="table-responsive-wrapper" style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                              <table className="table" style={{ fontSize: 12.5, minWidth: 920, width: '100%', margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>{s.itemType === 'FABRIC' ? 'Roll Barcode' : 'Pack / Barcode'}</th>
                                  <th>{s.itemType === 'FABRIC' ? 'Remaining Meters' : 'In Stock Quantity'}</th>
                                  <th>{s.itemType === 'FABRIC' ? 'Roll Status' : 'Pack Status'}</th>
                                  <th>Physical Shelf</th>
                                  <th>Client Earmark</th>
                                  <th>{s.itemType === 'FABRIC' ? 'Lump / Bundle Ref' : 'Carton / Bundle Ref'}</th>
                                  <th>Delivery Invoice</th>
                                  <th style={{ whiteSpace: 'nowrap' }}>Inward Date</th>
                                </tr>
                              </thead>
                              <tbody>
                                {loadingSkuBatches[s.id] ? (
                                  <tr>
                                    <td colSpan={8} style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--color-text-muted)' }}>
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, justifyContent: 'center' }}>
                                        <span className="spinner spinner-sm" /> Loading {s.itemType === 'FABRIC' ? 'rolls & lumps' : 'cartons & packs'}...
                                      </div>
                                    </td>
                                  </tr>
                                ) : (
                                  <>
                                    {childBatches.map(cb => (
                                      <tr key={cb.id} className="hover-row">
                                        <td>
                                          <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontWeight: 700, color: 'var(--color-brand)' }}>
                                            {cb.batchCode}
                                          </code>
                                        </td>
                                        <td>
                                          <strong>{cb.quantity} {unitStr}</strong>
                                        </td>
                                        <td>
                                          <span className={`badge ${cb.status === 'IN_STOCK' ? 'badge-success' : cb.status === 'PARTIALLY_USED' ? 'badge-warning' : cb.status === 'QC_HOLD' ? 'badge-danger' : 'badge-neutral'}`} style={{ fontSize: 10.5 }}>
                                            {cb.status === 'IN_STOCK' ? (s.itemType === 'FABRIC' ? 'Full Roll' : 'Full Pack') : cb.status === 'PARTIALLY_USED' ? (s.itemType === 'FABRIC' ? 'Partial Cut' : 'Open Pack') : cb.status === 'QC_HOLD' ? 'QC Hold' : cb.status}
                                          </span>
                                        </td>
                                        <td>
                                          {cb.locationCode && cb.locationCode !== 'Unassigned' ? (
                                            <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11 }}>
                                              <MapPin size={10} /> {cb.locationCode}
                                            </span>
                                          ) : (
                                            <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontSize: 11 }}>
                                              Unassigned
                                            </span>
                                          )}
                                        </td>
                                        <td>
                                          {cb.clientName ? (
                                            <span style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', background: '#eff6ff', padding: '1px 6px', borderRadius: 4, border: '1px solid #bfdbfe', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                              <Users size={11} /> {cb.clientName}
                                            </span>
                                          ) : (
                                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Free Stock</span>
                                          )}
                                        </td>
                                        <td>
                                          {cb.supplierBundle || '—'}
                                        </td>
                                        <td>
                                          {cb.invoiceRef || '—'}
                                        </td>
                                        <td style={{ whiteSpace: 'nowrap' }}>
                                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontSize: 12.5, color: '#475569' }}>{formatDate(cb.createdAt)}</span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openBatchPassport({
                                                  id: cb.id,
                                                  batchCode: cb.batchCode,
                                                  quantity: cb.quantity,
                                                  status: cb.status,
                                                  supplierBundle: cb.supplierBundle,
                                                  invoiceRef: cb.invoiceRef,
                                                  createdAt: cb.createdAt,
                                                  itemType: s.itemType,
                                                  brand: s.brand,
                                                  quality: s.quality,
                                                  shade: s.shade,
                                                  size: s.size,
                                                  category: s.category,
                                                  name: s.name,
                                                  artNo: s.artNo,
                                                  uom: s.uom,
                                                  poLine: cb.poLine,
                                                  poLineId: cb.poLineId,
                                                  grn: cb.grn,
                                                  grnId: cb.grnId,
                                                  batchLocations: cb.batchLocations || (cb.locationCode && cb.locationCode !== 'Unassigned' ? [{ quantity: cb.quantity, location: { code: cb.locationCode } }] : [])
                                                });
                                              }}
                                              className="btn btn-ghost btn-icon btn-sm"
                                              title="Open Item Passport"
                                              style={{ color: 'var(--color-brand)', width: 22, height: 22, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
                                            >
                                              <ChevronRight size={15} />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                    {childBatches.length === 0 && (
                                      <tr>
                                        <td colSpan={8} style={{ textAlign: 'center', padding: 16, color: 'var(--color-text-muted)' }}>
                                          No child rolls currently registered under this SKU.
                                        </td>
                                      </tr>
                                    )}
                                  </>
                                )}
                              </tbody>
                            </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {skus.length === 0 && (
                <tr>
                  <td colSpan={skuRollupColSpan} style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>
                    No aggregated inventory found matching active filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>

        ) : (
          
          /* ─── GRANULAR TRACKING VIEW (With Category-Specific Column Titles) ───────── */
          <div className="table-responsive-wrapper" style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="table" style={{ fontSize: 13.5, minWidth: 1280, width: '100%' }}>
            <thead>
              {categoryTab === 'FABRIC' ? (
                <tr>
                  <th>Fabric Brand</th>
                  <th>Quality Grade</th>
                  <th>Color / Shade</th>
                  <th>PO Number</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('location')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Shelf Location <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('quantity')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Meters In Stock <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th>Roll Status</th>
                  <th style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => handleSort('date')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Inward Date <ArrowUpDown size={12} />
                    </div>
                  </th>
                </tr>
              ) : categoryTab === 'READY_MADE' ? (
                <tr>
                  <th>Garment / Item Name</th>
                  <th>Brand</th>
                  <th>Category</th>
                  <th>Color / Shade</th>
                  <th>Size</th>
                  <th>PO Number</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('location')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Shelf Location <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('quantity')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Pieces In Stock <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th>Pack Status</th>
                  <th style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => handleSort('date')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Inward Date <ArrowUpDown size={12} />
                    </div>
                  </th>
                </tr>
              ) : categoryTab === 'ACCESSORY' ? (
                <tr>
                  <th>Accessory Item</th>
                  <th>Brand</th>
                  <th>Spec / Quality</th>
                  <th>Color / Shade</th>
                  <th>Size / Art No</th>
                  <th>PO Number</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('location')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Shelf Location <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('quantity')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Units In Stock <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th>Status</th>
                  <th style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => handleSort('date')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Inward Date <ArrowUpDown size={12} />
                    </div>
                  </th>
                </tr>
              ) : (
                <tr>
                  <th>Item Type</th>
                  <th>Brand &amp; Description</th>
                  <th>Color / Shade</th>
                  <th>Category / Size</th>
                  <th>PO Number</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('location')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Shelf Location <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('quantity')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      In Stock Qty <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th>Status</th>
                  <th style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => handleSort('date')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Inward Date <ArrowUpDown size={12} />
                    </div>
                  </th>
                </tr>
              )}
            </thead>
            <tbody>
              {sortedBatches.map(b => {
                const unitStr = getBatchUnit(b);
                const bBrand = getBatchBrand(b);
                const bQuality = getBatchQuality(b);
                const bShade = getBatchShade(b);
                const bSize = getBatchSize(b);
                const bName = getBatchName(b);
                const bType = getBatchItemType(b);
                const bCat = getBatchCategory(b);
                const bArt = getBatchArtNo(b);

                return (
                  <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => openBatchPassport(b)} className="hover-row">

                    {/* Category-Specific Granular Cells */}
                    {categoryTab === 'FABRIC' ? (
                      <>
                        <td><strong>{bBrand}</strong></td>
                        <td><span style={{ fontWeight: 600, color: '#334155' }}>{bQuality || '—'}</span></td>
                        <td><span className="badge badge-secondary" style={{ fontWeight: 600 }}>{bShade || '—'}</span></td>
                      </>
                    ) : categoryTab === 'READY_MADE' ? (
                      <>
                        <td>
                          <strong>{bName || bArt || 'Garment'}</strong>
                          {bArt && bName && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Art: {bArt}</div>}
                        </td>
                        <td>{bBrand}</td>
                        <td>{bCat || '—'}</td>
                        <td>{bShade || '—'}</td>
                        <td><span className="badge badge-secondary" style={{ fontWeight: 700 }}>{bSize || '—'}</span></td>
                      </>
                    ) : categoryTab === 'ACCESSORY' ? (
                      <>
                        <td><strong>{bName || 'Accessory'}</strong></td>
                        <td>{bBrand}</td>
                        <td>{bQuality || '—'}</td>
                        <td>{bShade || '—'}</td>
                        <td>{bSize || bArt || '—'}</td>
                      </>
                    ) : (
                      <>
                        <td>
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-main)' }}>
                            {bType === 'READY_MADE' ? 'Ready Made' : bType === 'FABRIC' ? 'Fabric' : bType === 'ACCESSORY' ? 'Accessory' : bType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>
                          <strong>{bBrand}</strong>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                            {bQuality} {bName ? `· ${bName}` : ''}
                          </div>
                        </td>
                        <td>{bShade || '—'}</td>
                        <td>
                          {bCat || bSize || bArt ? (
                            <span style={{ fontSize: 12.5 }}>
                              {bCat ? `${bCat} ` : ''}
                              {bSize ? `· Size: ${bSize} ` : ''}
                              {bArt ? `· Art: ${bArt}` : ''}
                            </span>
                          ) : '—'}
                        </td>
                      </>
                    )}

                    <td>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{b.poLine?.po?.poNumber || (b.invoiceRef ? `Inv: ${b.invoiceRef}` : '—')}</div>
                      {b.poLine?.po?.supplierName && (
                        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {b.poLine.po.supplierName}
                        </div>
                      )}
                    </td>
                    <td>
                      {b.batchLocations && b.batchLocations.length > 0 ? (
                        <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <MapPin size={12} /> {b.batchLocations[0]?.location?.code || '—'} 
                          {b.batchLocations.length > 1 && ` (+${b.batchLocations.length - 1})`}
                        </span>
                      ) : (
                        <span className="badge" style={{ background: '#fef3c7', color: '#b45309' }}>
                          <AlertTriangle size={11} style={{ marginRight: 3 }} /> Unassigned
                        </span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: 15, fontWeight: 700, color: bType === 'FABRIC' ? '#0369a1' : bType === 'READY_MADE' ? '#15803d' : '#6d28d9' }}>
                        {b.quantity} {unitStr}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${b.status === 'IN_STOCK' ? 'badge-success' : b.status === 'PARTIALLY_USED' ? 'badge-warning' : b.status === 'QC_HOLD' ? 'badge-danger' : 'badge-neutral'}`}>
                        {b.status === 'IN_STOCK' ? (bType === 'FABRIC' ? 'Full Roll' : 'Full Pack') : b.status === 'PARTIALLY_USED' ? (bType === 'FABRIC' ? 'Partial Cut' : 'Open Pack') : b.status === 'QC_HOLD' ? 'QC Hold' : b.status}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12.5, color: '#475569' }}>{formatDate(b.createdAt)}</span>
                        <button 
                          type="button" 
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={(e) => { e.stopPropagation(); openBatchPassport(b); }}
                          title="Open Item Passport"
                          style={{ color: 'var(--color-brand)', width: 22, height: 22, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedBatches.length === 0 && (
                <tr>
                  <td colSpan={categoryTab === 'FABRIC' ? 8 : (categoryTab === 'READY_MADE' || categoryTab === 'ACCESSORY') ? 10 : 9} style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>
                    No granular inventory found matching active filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* ─── ITEM PASSPORT DRAWER ──────────────────────────────────────────── */}
      {selectedBatch && (() => {
        const dType = getBatchItemType(selectedBatch);
        const isFabric = dType === 'FABRIC';
        const dBrand = getBatchBrand(selectedBatch);
        const dQuality = getBatchQuality(selectedBatch);
        const dShade = getBatchShade(selectedBatch);
        const dSize = getBatchSize(selectedBatch);
        const dCategory = getBatchCategory(selectedBatch);
        const dArtNo = getBatchArtNo(selectedBatch);
        const dUnit = selectedBatch.uom ? selectedBatch.uom : (isFabric ? 'Meters' : 'Pieces / Units');

        return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 540, background: '#fff', height: '100%', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', animation: 'slideInRight 0.25s ease-out' }}>
              
              {/* Drawer Header */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Item Passport</div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-brand)', margin: '2px 0 0 0', fontFamily: 'monospace' }}>
                    {selectedBatch.batchCode}
                  </h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a 
                    href={`/api/labels/preview/${selectedBatch.batchCode}`} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    title="Print TSC Barcode Label"
                  >
                    <Printer size={14} /> Print Label
                  </a>
                  <button onClick={() => setSelectedBatch(null)} className="btn btn-ghost btn-icon"><X size={20} /></button>
                </div>
              </div>

              {/* Drawer Body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                
                {/* Quantity & Status Hero Box */}
                <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <Package size={22} color="var(--color-brand)" />
                    <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-text-main)' }}>
                      {selectedBatch.quantity} {dUnit}
                    </span>
                    <span className={`badge ${selectedBatch.status === 'IN_STOCK' ? 'badge-success' : selectedBatch.status === 'PARTIALLY_USED' ? 'badge-warning' : selectedBatch.status === 'QC_HOLD' ? 'badge-danger' : 'badge-neutral'}`} style={{ marginLeft: 'auto' }}>
                      {selectedBatch.status === 'IN_STOCK' ? 'Full Roll' : selectedBatch.status === 'PARTIALLY_USED' ? 'Partial Cut' : selectedBatch.status === 'QC_HOLD' ? 'QC Hold (Quarantine)' : selectedBatch.status}
                    </span>
                  </div>

                  {/* Internal Client Earmark Card in Drawer */}
                  <div style={{ marginTop: 14, background: '#eff6ff', borderRadius: 'var(--radius-md)', padding: '12px 14px', border: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Users size={18} color="#1d4ed8" />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Internal Client Allocation
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', marginTop: 1 }}>
                          {selectedBatch.clientName || selectedBatch.poLine?.po?.targetClient || 'General Warehouse Stock (Buffer)'}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => openReallocateModal(selectedBatch)}
                      style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', borderColor: '#bfdbfe', color: '#1d4ed8' }}
                    >
                      <Repeat2 size={13} /> Reallocate
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 2, textTransform: 'uppercase', fontWeight: 600 }}>Brand &amp; Quality</label>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{dBrand}</div>
                      <div style={{ fontSize: 12.5, color: '#475569' }}>{dQuality || '—'}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 2, textTransform: 'uppercase', fontWeight: 600 }}>Color / Size</label>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{dShade || dSize || '—'}</div>
                      {(dCategory || dArtNo) && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {dCategory} {dArtNo ? `· Art: ${dArtNo}` : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* QC Action Bar */}
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      <strong>QC Status:</strong>{' '}
                      {selectedBatch.status === 'QC_HOLD' ? (
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>Quarantined (QC Hold)</span>
                      ) : (
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>Approved for Dispatch</span>
                      )}
                    </div>
                    {selectedBatch.status === 'QC_HOLD' ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => handleQcApprove(selectedBatch.id)}
                        disabled={qcActionLoading}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                      >
                        <CheckCircle2 size={14} /> Release QC Hold
                      </button>
                    ) : selectedBatch.status !== 'OUT' ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => handleQcHold(selectedBatch.id)}
                        disabled={qcActionLoading}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#dc2626' }}
                      >
                        <ShieldAlert size={14} /> Place on QC Hold
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Shelf Placement */}
                <div style={{ marginBottom: 8 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', margin: 0 }}>
                    Physical Shelf Location
                  </h3>
                </div>

                <div style={{ marginBottom: 20 }}>
                  {selectedBatch.batchLocations && selectedBatch.batchLocations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {selectedBatch.batchLocations.map((bl, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--color-brand)' }}>
                            <MapPin size={16} /> {bl.location?.code || '—'}
                          </span>
                          <strong style={{ color: 'var(--color-text-main)', fontSize: 13.5 }}>{bl.quantity} {dUnit}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: 14, background: '#fef3c7', borderRadius: 'var(--radius-md)', color: '#b45309', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertTriangle size={16} /> Currently unassigned — awaiting physical shelf put-away.
                    </div>
                  )}
                </div>

                {/* Procurement Origin */}
                <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Origin &amp; Receiving
                </h3>
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 14, marginBottom: 20 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
                    <Truck size={16} color="var(--color-text-muted)" style={{ marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>Purchase Order</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-brand)' }}>
                        {selectedBatch.poLine?.po?.poNumber || selectedBatch.grn?.poNumber || 'Direct Gate Inward'}
                      </div>
                      {(selectedBatch.poLine?.po?.supplierName || selectedBatch.grn?.supplierName) && (
                        <div style={{ fontSize: 12.5, color: '#334155' }}>
                          {selectedBatch.poLine?.po?.supplierName || selectedBatch.grn?.supplierName}
                        </div>
                      )}
                    </div>
                    {selectedBatch.grn?.grnNumber && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>GRN Ref</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                          {selectedBatch.grn.grnNumber}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ borderTop: '1px solid var(--color-border)', margin: '10px 0' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>Delivery Invoice</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedBatch.invoiceRef || '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>Supplier Bundle</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedBatch.supplierBundle || '—'}</div>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--color-border)', margin: '10px 0' }} />
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Calendar size={15} color="var(--color-text-muted)" />
                    <div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>Received At Gate</div>
                      <div style={{ fontSize: 12.5 }}>{formatDateTime(selectedBatch.createdAt)}</div>
                    </div>
                  </div>
                </div>

                {/* Complete Movement & Cut History Timeline */}
                <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <History size={14} /> Item Lifecycle &amp; Movement History
                </h3>
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 14 }}>
                  {loadingHistory ? (
                    <div style={{ padding: 20, textAlign: 'center' }}><span className="spinner" /></div>
                  ) : batchHistory.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {batchHistory.map((tx, ti) => (
                        <div key={tx.id || ti} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', borderLeft: '2px solid var(--color-brand)', paddingLeft: 12, position: 'relative' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className={`badge ${tx.type === 'STOCK_IN' ? 'badge-success' : tx.type === 'PARTIAL_CUT' ? 'badge-warning' : 'badge-secondary'}`} style={{ fontSize: 10 }}>
                                {tx.type.replace('_', ' ')}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                {formatDateTime(tx.createdAt)}
                              </span>
                            </div>
                            <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>
                              {tx.type === 'PARTIAL_CUT' ? `Cut ${tx.quantityMoved} ${dUnit}` : `${tx.quantityMoved} ${dUnit} moved`}
                              {tx.previousQuantity !== null && tx.newQuantity !== null && (
                                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: 6 }}>
                                  ({tx.previousQuantity} &rarr; {tx.newQuantity} {dUnit})
                                </span>
                              )}
                            </div>
                            {tx.notes && (
                              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                                {tx.notes}
                              </div>
                            )}
                            {tx.operator?.name && (
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                Operator: {tx.operator.name}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', textAlign: 'center', padding: 12 }}>
                      No separate ledger movements logged for this item.
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── REALLOCATE CLIENT MODAL ─────────────────────────────────────── */}
      {reallocateModalOpen && batchToReallocate && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: 16
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 500,
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden',
            border: '1px solid var(--color-border)'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#fafbfc'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={20} color="var(--color-brand)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                  Reallocate Roll / Item to Client
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReallocateModalOpen(false)}
                className="btn btn-ghost btn-icon btn-sm"
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '20px' }}>
              {reallocateError && (
                <div className="alert alert-danger" style={{ marginBottom: 14, fontSize: 12.5 }}>
                  {reallocateError}
                </div>
              )}

              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: 6, marginBottom: 16, border: '1px solid #e2e8f0', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Roll Barcode:</span>
                  <strong style={{ fontFamily: 'monospace', color: 'var(--color-brand)' }}>{batchToReallocate.batchCode}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Item:</span>
                  <strong>{getBatchBrand(batchToReallocate)} {getBatchQuality(batchToReallocate) || getBatchName(batchToReallocate)} ({getBatchShade(batchToReallocate)})</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Available Quantity:</span>
                  <strong style={{ color: '#0369a1' }}>{batchToReallocate.quantity} {getBatchUnit(batchToReallocate)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Currently Earmarked:</span>
                  <span style={{ fontWeight: 700, color: batchToReallocate.clientName ? '#1e40af' : '#64748b' }}>
                    {batchToReallocate.clientName || 'General Free Stock'}
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>
                  New Earmark / Client <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <select
                  className="form-input"
                  value={targetClientId ? targetClientId : (targetClientName === 'General Warehouse Stock' ? 'FREE' : targetClientName)}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === 'FREE') {
                      setTargetClientId('');
                      setTargetClientName('General Warehouse Stock');
                    } else {
                      const found = clientsList.find(c => c.id === val || c.name === val);
                      if (found) {
                        setTargetClientId(found.id);
                        setTargetClientName(found.name);
                      } else {
                        setTargetClientId('');
                        setTargetClientName(val);
                      }
                    }
                  }}
                  style={{ height: 40, fontSize: 13.5 }}
                >
                  <option value="FREE">Free Stock / General Warehouse Stock</option>
                  {clientsList.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  This change is internal to the WMS and tracks inventory without changing the physical barcode label.
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: 12.5 }}>
                  Transfer Reason / Audit Note (Optional)
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Urgent requirement for client dispatch"
                  value={reallocateReason}
                  onChange={e => setReallocateReason(e.target.value)}
                  style={{ height: 38, fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReallocateModalOpen(false)}
                  disabled={reallocating}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleConfirmReallocate}
                  disabled={reallocating}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                >
                  {reallocating ? <span className="spinner" /> : <Repeat2 size={16} />}
                  Confirm Reallocation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .hover-row:hover { background: #f8fafc !important; }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </div>
  );
}
