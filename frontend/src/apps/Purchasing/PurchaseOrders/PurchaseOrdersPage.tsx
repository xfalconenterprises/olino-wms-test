import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { 
  ShoppingCart, 
  Plus, 
  Calendar, 
  Search, 
  ChevronRight, 
  Printer, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Layers,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
  Tag,
  Palette,
  ExternalLink,
  Shirt,
  Package,
  Users,
  FileCheck
} from 'lucide-react';
import { formatDate } from '../../../utils/format';
import { useAuth } from '../../../hooks/useAuth';
import { hasPermission } from '../../../utils/roles';
import '../../../styles/components.css';

export interface POLineItem {
  id: string;
  poId: string;
  itemType?: string | null;
  category?: string | null;
  brand?: string | null;
  quality?: string | null;
  shade?: string | null;
  size?: string | null;
  name?: string | null;
  artNo?: string | null;
  uom?: string | null;
  orderedQty: number;
  receivedQty: number;
  notes?: string | null;
  allocations?: Array<{
    id: string;
    clientId?: string | null;
    clientName: string;
    allocatedQty: number;
    receivedQty: number;
    notes?: string | null;
  }>;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  expectedDate: string;
  status: string;
  totalOrdered: number;
  totalReceived: number;
  supplierName: string;
  targetClient?: string | null;
  clientBreakdown?: Array<{
    clientName: string;
    allocatedQty: number;
    receivedQty: number;
    remainingQty: number;
    progress: number;
    uom: string;
  }>;
  lines: POLineItem[];
  grns?: { id: string }[]; // latest GRN first
}

export interface FlattenedPOItem {
  lineId: string;
  poId: string;
  poNumber: string;
  supplierName: string;
  expectedDate: string;
  poStatus: string;
  itemType: string;
  brand: string;
  quality: string;
  shade: string;
  name: string;
  artNo: string;
  category: string;
  size: string;
  uom: string;
  orderedQty: number;
  receivedQty: number;
  reachedStatus: 'FULLY_REACHED' | 'PARTIALLY_REACHED' | 'NOT_REACHED';
  progress: number;
  allocations: Array<{
    id: string;
    clientName: string;
    allocatedQty: number;
    receivedQty: number;
  }>;
  clientSummary: string;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge-warning',
  PARTIALLY_RECEIVED: 'badge-info',
  RECEIVED: 'badge-success',
  CANCELLED: 'badge-neutral',
};

type ItemSortField = string;

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'ORDERS' | 'ITEMS'>('ORDERS');
  const [search, setSearch] = useState('');
  
  // Orders tab filters
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'FABRIC' | 'READY_MADE' | 'ACCESSORY'>('ALL');

  // Items tab category selector, filters & sorting
  const [itemCategoryTab, setItemCategoryTab] = useState<'FABRIC' | 'READY_MADE' | 'ACCESSORY'>('FABRIC');
  const [itemStatusFilter, setItemStatusFilter] = useState<'ALL' | 'NOT_REACHED' | 'PARTIALLY_REACHED' | 'FULLY_REACHED'>('ALL');
  const [itemSortField, setItemSortField] = useState<ItemSortField>('brand');
  const [itemSortDirection, setItemSortDirection] = useState<'asc' | 'desc'>('asc');
  const load = () => {
    setLoading(true);
    api.get('/api/purchase-orders')
      .then(r => setPos(r.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handlePrint = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write('<div style="font-family:sans-serif;padding:40px;text-align:center;color:#64748b;">Loading document...</div>');
      }
      const response = await api.get(`/api/purchase-orders/${id}/print`, { responseType: 'text' });
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(response.data);
        printWindow.document.close();
      }
    } catch {
      alert('Failed to generate print document');
    }
  };

  const handlePrintGrn = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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

  // Flattened items across all POs
  const allFlattenedItems = useMemo<FlattenedPOItem[]>(() => {
    const list: FlattenedPOItem[] = [];
    for (const po of pos) {
      for (const line of (po.lines || [])) {
        const lineItemType = line.itemType || 'FABRIC';
        const brand = line.brand || '—';
        const quality = line.quality || '—';
        const shade = line.shade || '—';
        const name = line.name || '';
        const artNo = line.artNo || '';
        const category = line.category || '';
        const size = line.size || '';
        const uom = line.uom || (lineItemType === 'FABRIC' ? 'Meters' : 'Pieces');
        const ordered = Number(line.orderedQty) || 0;
        const received = Number(line.receivedQty) || 0;
        const progress = ordered > 0 ? (received / ordered) * 100 : 0;

        let reachedStatus: 'FULLY_REACHED' | 'PARTIALLY_REACHED' | 'NOT_REACHED' = 'NOT_REACHED';
        if (received >= ordered && ordered > 0) {
          reachedStatus = 'FULLY_REACHED';
        } else if (received > 0) {
          reachedStatus = 'PARTIALLY_REACHED';
        }

        const allocations = (line.allocations || []).map(a => ({
          id: a.id,
          clientName: a.clientName,
          allocatedQty: Number(a.allocatedQty) || 0,
          receivedQty: Number(a.receivedQty) || 0,
        }));

        const clientSummary = allocations.length > 0
          ? allocations.map(a => `${a.clientName}: ${a.allocatedQty}${lineItemType === 'FABRIC' ? 'm' : ''}`).join(', ')
          : (po.targetClient || 'General Stock');

        list.push({
          lineId: line.id,
          poId: po.id,
          poNumber: po.poNumber,
          supplierName: po.supplierName,
          expectedDate: po.expectedDate,
          poStatus: po.status,
          itemType: lineItemType,
          brand,
          quality,
          shade,
          name,
          artNo,
          category,
          size,
          uom,
          orderedQty: ordered,
          receivedQty: received,
          reachedStatus,
          progress,
          allocations,
          clientSummary,
        });
      }
    }
    return list;
  }, [pos]);

  // Filtered and sorted POs (Orders view)
  const filteredPos = useMemo(() => {
    return pos.filter(po => {
      const q = search.trim().toLowerCase();
      const matchesSearch = !q || po.poNumber.toLowerCase().includes(q) || 
        po.supplierName.toLowerCase().includes(q);
      
      const matchesStatus = statusFilter === 'ALL' || po.status === statusFilter;

      const firstType = po.lines?.[0]?.itemType || 'FABRIC';
      const matchesType = typeFilter === 'ALL' || firstType === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [pos, search, statusFilter, typeFilter]);

  // Category subsets of flattened items
  const fabricItems = useMemo(() => allFlattenedItems.filter(i => i.itemType === 'FABRIC'), [allFlattenedItems]);
  const readyMadeItems = useMemo(() => allFlattenedItems.filter(i => i.itemType === 'READY_MADE'), [allFlattenedItems]);
  const accessoryItems = useMemo(() => allFlattenedItems.filter(i => i.itemType === 'ACCESSORY'), [allFlattenedItems]);

  const activeCategoryItems = useMemo(() => {
    if (itemCategoryTab === 'FABRIC') return fabricItems;
    if (itemCategoryTab === 'READY_MADE') return readyMadeItems;
    return accessoryItems;
  }, [itemCategoryTab, fabricItems, readyMadeItems, accessoryItems]);

  const categoryTotalCount = activeCategoryItems.length;
  const categoryNotReachedCount = activeCategoryItems.filter(i => i.reachedStatus === 'NOT_REACHED').length;
  const categoryPartialCount = activeCategoryItems.filter(i => i.reachedStatus === 'PARTIALLY_REACHED').length;
  const categoryReachedCount = activeCategoryItems.filter(i => i.reachedStatus === 'FULLY_REACHED').length;

  // Filtered and sorted Items (Items view)
  const filteredAndSortedItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = allFlattenedItems.filter(item => {
      // Strictly separate items by active category
      if (item.itemType !== itemCategoryTab) {
        return false;
      }

      if (itemStatusFilter !== 'ALL' && item.reachedStatus !== itemStatusFilter) {
        return false;
      }

      if (q) {
        const matchesClient = (item.clientSummary || '').toLowerCase().includes(q) ||
          item.allocations.some(a => a.clientName.toLowerCase().includes(q));

        if (itemCategoryTab === 'FABRIC') {
          const matchesBrand = item.brand.toLowerCase().includes(q);
          const matchesQuality = item.quality.toLowerCase().includes(q);
          const matchesShade = item.shade.toLowerCase().includes(q);
          const matchesCategory = item.category.toLowerCase().includes(q);
          const matchesPo = item.poNumber.toLowerCase().includes(q);
          const matchesSup = item.supplierName.toLowerCase().includes(q);
          if (!matchesBrand && !matchesQuality && !matchesShade && !matchesCategory && !matchesPo && !matchesSup && !matchesClient) {
            return false;
          }
        } else if (itemCategoryTab === 'READY_MADE') {
          const matchesName = item.name.toLowerCase().includes(q);
          const matchesCategory = item.category.toLowerCase().includes(q);
          const matchesArtNo = item.artNo.toLowerCase().includes(q);
          const matchesSize = item.size.toLowerCase().includes(q);
          const matchesShade = item.shade.toLowerCase().includes(q);
          const matchesPo = item.poNumber.toLowerCase().includes(q);
          const matchesSup = item.supplierName.toLowerCase().includes(q);
          if (!matchesName && !matchesCategory && !matchesArtNo && !matchesSize && !matchesShade && !matchesPo && !matchesSup && !matchesClient) {
            return false;
          }
        } else {
          // ACCESSORY
          const matchesCategory = item.category.toLowerCase().includes(q);
          const matchesName = (item.name || item.quality).toLowerCase().includes(q);
          const matchesShade = item.shade.toLowerCase().includes(q);
          const matchesSize = item.size.toLowerCase().includes(q);
          const matchesPo = item.poNumber.toLowerCase().includes(q);
          const matchesSup = item.supplierName.toLowerCase().includes(q);
          if (!matchesCategory && !matchesName && !matchesShade && !matchesSize && !matchesPo && !matchesSup && !matchesClient) {
            return false;
          }
        }
      }
      return true;
    });

    result.sort((a, b) => {
      let aVal: any = (a as any)[itemSortField] || '';
      let bVal: any = (b as any)[itemSortField] || '';

      if (itemSortField === 'reachedStatus') {
        const rank = { NOT_REACHED: 1, PARTIALLY_REACHED: 2, FULLY_REACHED: 3 };
        aVal = rank[a.reachedStatus] || 0;
        bVal = rank[b.reachedStatus] || 0;
        return itemSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      if (itemSortField === 'orderedQty') {
        aVal = a.orderedQty;
        bVal = b.orderedQty;
        return itemSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      if (itemSortField === 'shade' || itemSortField === 'artNo' || itemSortField === 'size') {
        const comp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
        return itemSortDirection === 'asc' ? comp : -comp;
      }

      if (typeof aVal === 'string') {
        const comp = aVal.localeCompare(String(bVal));
        return itemSortDirection === 'asc' ? comp : -comp;
      }
      return itemSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [allFlattenedItems, itemCategoryTab, search, itemStatusFilter, itemSortField, itemSortDirection]);

  // Toggle sort field or direction
  const handleSortClick = (field: ItemSortField) => {
    if (itemSortField === field) {
      setItemSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setItemSortField(field);
      setItemSortDirection('asc');
    }
  };

  const renderSortIcon = (field: ItemSortField) => {
    if (itemSortField !== field) return <ArrowUpDown size={13} style={{ opacity: 0.35 }} />;
    return itemSortDirection === 'asc' ? <ArrowUp size={13} color="var(--color-brand)" /> : <ArrowDown size={13} color="var(--color-brand)" />;
  };

  const renderReachedBadge = (item: FlattenedPOItem) => {
    if (item.reachedStatus === 'FULLY_REACHED') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 8px',
          borderRadius: 4,
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          color: '#166534',
          fontSize: 12,
          fontWeight: 700,
        }}>
          <CheckCircle2 size={13} color="#16a34a" /> Reached &amp; In Stock
        </span>
      );
    }
    if (item.reachedStatus === 'PARTIALLY_REACHED') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 8px',
          borderRadius: 4,
          background: '#f0f9ff',
          border: '1px solid #bae6fd',
          color: '#0369a1',
          fontSize: 12,
          fontWeight: 700,
        }}>
          <AlertCircle size={13} color="#0284c7" /> Partially Reached ({Math.round(item.progress)}%)
        </span>
      );
    }
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px',
        borderRadius: 4,
        background: '#fffbeb',
        border: '1px solid #fde68a',
        color: '#92400e',
        fontSize: 12,
        fontWeight: 700,
      }}>
        <Clock size={13} color="#d97706" /> Not Reached (Pending)
      </span>
    );
  };

  // Order Counts
  const totalCount = pos.length;
  const pendingCount = pos.filter(po => po.status === 'PENDING').length;
  const partialCount = pos.filter(po => po.status === 'PARTIALLY_RECEIVED').length;
  const receivedCount = pos.filter(po => po.status === 'RECEIVED').length;

  // Item Counts
  const totalItemsCount = allFlattenedItems.length;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShoppingCart size={28} /> Purchase Orders &amp; Items Tracking
          </h1>
          <p className="page-subtitle">Track purchase orders and inspect individual items by shade, brand, and arrival status</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 10 }}>
          {hasPermission(user, 'po.create') && (
            <Link to="/purchase-orders/new" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={16} /> Create PO
            </Link>
          )}
        </div>
      </div>

      {/* ─── View Mode Switcher (Orders vs Items) ─────────────────────────── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '6px',
        display: 'inline-flex',
        gap: 4,
        marginBottom: 18,
      }}>
        <button
          type="button"
          onClick={() => { setViewMode('ORDERS'); setSearch(''); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: viewMode === 'ORDERS' ? 'var(--color-brand)' : 'transparent',
            color: viewMode === 'ORDERS' ? '#ffffff' : 'var(--color-text-muted)',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <ShoppingCart size={15} />
          <span>By Purchase Orders</span>
          <span style={{
            fontSize: 11,
            padding: '1px 7px',
            borderRadius: 10,
            background: viewMode === 'ORDERS' ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
            color: viewMode === 'ORDERS' ? '#ffffff' : '#64748b',
          }}>
            {totalCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setViewMode('ITEMS'); setSearch(''); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: viewMode === 'ITEMS' ? 'var(--color-brand)' : 'transparent',
            color: viewMode === 'ITEMS' ? '#ffffff' : 'var(--color-text-muted)',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <Layers size={15} />
          <span>By Items &amp; Shades (Warehouse Search)</span>
          <span style={{
            fontSize: 11,
            padding: '1px 7px',
            borderRadius: 10,
            background: viewMode === 'ITEMS' ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
            color: viewMode === 'ITEMS' ? '#ffffff' : '#64748b',
          }}>
            {totalItemsCount}
          </span>
        </button>
      </div>

      {/* ─── Metric Cards ────────────────────────────────────────────────── */}
      {viewMode === 'ORDERS' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div className="text-sm text-muted">Total Purchase Orders</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--color-text-main)' }}>{totalCount}</div>
          </div>
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div className="text-sm text-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={14} color="var(--color-warning)" /> Pending Delivery
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--color-warning)' }}>{pendingCount}</div>
          </div>
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div className="text-sm text-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={14} color="#0284c7" /> Partially Received
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#0284c7' }}>{partialCount}</div>
          </div>
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div className="text-sm text-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={14} color="var(--color-success)" /> Fully Received
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--color-success)' }}>{receivedCount}</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div className="text-sm text-muted">
              {itemCategoryTab === 'FABRIC' ? 'Total Fabric Lines' : itemCategoryTab === 'READY_MADE' ? 'Total Ready-Made Lines' : 'Total Accessory Lines'}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--color-text-main)' }}>{categoryTotalCount}</div>
          </div>
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div className="text-sm text-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={14} color="var(--color-warning)" /> Not Yet Reached (In Transit)
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--color-warning)' }}>{categoryNotReachedCount}</div>
          </div>
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div className="text-sm text-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={14} color="#0284c7" /> Partially Reached
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#0284c7' }}>{categoryPartialCount}</div>
          </div>
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div className="text-sm text-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={14} color="var(--color-success)" /> Fully Reached &amp; In Stock
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--color-success)' }}>{categoryReachedCount}</div>
          </div>
        </div>
      )}

      {/* ─── VIEW 1: BY PURCHASE ORDERS ──────────────────────────────────── */}
      {viewMode === 'ORDERS' && (
        <>
          {/* Status & Type Filter Pills */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { id: 'ALL', label: 'All', count: totalCount },
                { id: 'PENDING', label: 'Pending', count: pendingCount },
                { id: 'PARTIALLY_RECEIVED', label: 'Partial', count: partialCount },
                { id: 'RECEIVED', label: 'Received', count: receivedCount },
              ].map(tab => (
                <button
                  key={tab.id}
                  className="btn btn-ghost"
                  onClick={() => setStatusFilter(tab.id as any)}
                  style={{
                    borderBottom: statusFilter === tab.id ? '2px solid var(--color-brand)' : '2px solid transparent',
                    borderRadius: 0,
                    color: statusFilter === tab.id ? 'var(--color-brand)' : 'var(--color-text-muted)',
                    fontWeight: statusFilter === tab.id ? 600 : 400,
                    padding: '8px 14px',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  {tab.label}
                  <span style={{
                    fontSize: 11,
                    background: statusFilter === tab.id ? 'var(--color-brand-faded)' : 'var(--color-bg-subtle)',
                    color: statusFilter === tab.id ? 'var(--color-brand)' : 'var(--color-text-muted)',
                    padding: '1px 6px',
                    borderRadius: 10,
                    fontWeight: 600
                  }}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {(['ALL', 'FABRIC', 'READY_MADE', 'ACCESSORY'] as const).map(t => (
                <button
                  key={t}
                  className={`btn btn-sm ${typeFilter === t ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setTypeFilter(t)}
                  style={{ fontSize: 12 }}
                >
                  {t === 'ALL' ? 'All Types' : t === 'FABRIC' ? 'Fabric' : t === 'READY_MADE' ? 'Ready-Made' : 'Accessories'}
                </button>
              ))}
            </div>
          </div>

          {/* Search Input */}
          <div className="filters-bar" style={{ marginBottom: 16 }}>
            <div style={{ position: 'relative', width: '380px' }}>
              <Search size={16} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input 
                type="text" 
                className="form-input"
                placeholder="Search PO Number or Supplier..." 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
                style={{ paddingLeft: 36, width: '100%', height: 38 }}
              />
            </div>
          </div>

          {/* Orders Table */}
          {loading ? (
            <div className="loading-center"><span className="spinner spinner-lg" /></div>
          ) : filteredPos.length === 0 ? (
            <div className="table-wrapper">
              <div className="empty-state">
                <div className="empty-state-icon"><ShoppingCart size={48} className="text-muted" /></div>
                <div className="empty-state-text">No purchase orders found</div>
                {search && <p className="text-sm text-muted mt-2">Try clearing your search query</p>}
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>PO Number</th>
                    <th>Supplier</th>
                    <th>Expected Date</th>
                    <th>Items &amp; Progress</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPos.map(po => {
                    const progress = po.totalOrdered > 0 ? (po.totalReceived / po.totalOrdered) * 100 : 0;
                    const poType = po.lines?.[0]?.itemType || 'FABRIC';
                    const unit = poType === 'FABRIC' ? 'm' : 'pcs';
                    
                    return (
                      <tr
                        key={po.id}
                        className="hover-row"
                        onClick={() => navigate(`/purchase-orders/${po.id}/view`)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <span style={{ fontWeight: 600, color: 'var(--color-brand)' }}>
                            {po.poNumber}
                          </span>
                        </td>
                        <td>
                          <strong>{po.supplierName}</strong>
                          {po.clientBreakdown && po.clientBreakdown.length > 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                              <Users size={12} color="var(--color-brand)" />
                              <span>Client: <strong style={{ color: 'var(--color-text-main)' }}>{po.clientBreakdown.map(cb => cb.clientName).join(', ')}</strong></span>
                            </div>
                          ) : po.targetClient ? (
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                              <Users size={12} color="var(--color-brand)" />
                              <span>Client: <strong style={{ color: 'var(--color-text-main)' }}>{po.targetClient}</strong></span>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-muted)' }}>
                            <Calendar size={14} /> 
                            {formatDate(po.expectedDate)}
                          </div>
                        </td>
                        <td style={{ minWidth: 180 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                            <span style={{ fontWeight: 600 }}>{po.totalReceived.toFixed(poType === 'FABRIC' ? 1 : 0)} {unit}</span>
                            <span className="text-muted">/ {po.totalOrdered.toFixed(poType === 'FABRIC' ? 1 : 0)} {unit}</span>
                          </div>
                          <div style={{ width: '100%', height: 6, background: 'var(--color-bg-subtle)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ 
                              height: '100%', 
                              background: progress >= 100 ? 'var(--color-success)' : 'var(--color-brand)', 
                              width: `${Math.min(progress, 100)}%` 
                            }} />
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[po.status] || 'badge-neutral'}`}>
                            {po.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            {po.grns?.[0] && (
                              <button
                                className="btn btn-sm btn-ghost btn-icon"
                                onClick={e => handlePrintGrn(po.grns![0].id, e)}
                                title={po.totalReceived < po.totalOrdered ? `Print Partial GRN (${po.totalReceived.toFixed(1)} received)` : 'Print Complete GRN'}
                                style={{ color: po.totalReceived < po.totalOrdered ? '#b45309' : '#16a34a' }}
                              >
                                <FileCheck size={16} />
                              </button>
                            )}
                            <button
                              className="btn btn-sm btn-ghost btn-icon"
                              onClick={e => handlePrint(po.id, e)}
                              title="Print PO PDF"
                            >
                              <Printer size={15} />
                            </button>
                            <button
                              className="btn btn-sm btn-ghost btn-icon"
                              onClick={() => navigate(`/purchase-orders/${po.id}/view`)}
                              title="View Details"
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── VIEW 2: BY ORDERED ITEMS (WAREHOUSE ATTRIBUTE SEARCH) ───────── */}
      {viewMode === 'ITEMS' && (
        <>
          {/* Category Tabs: Fabric vs Ready-Made vs Accessories */}
          <div style={{
            background: '#ffffff',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '5px',
            display: 'inline-flex',
            gap: 6,
            marginBottom: 16,
          }}>
            <button
              type="button"
              onClick={() => { setItemCategoryTab('FABRIC'); setItemSortField('brand'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: itemCategoryTab === 'FABRIC' ? 'var(--color-brand)' : 'transparent',
                color: itemCategoryTab === 'FABRIC' ? '#ffffff' : 'var(--color-text-muted)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Layers size={15} />
              <span>Fabric</span>
              <span style={{
                fontSize: 11,
                padding: '1px 7px',
                borderRadius: 10,
                background: itemCategoryTab === 'FABRIC' ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                color: itemCategoryTab === 'FABRIC' ? '#ffffff' : '#64748b',
              }}>
                {fabricItems.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setItemCategoryTab('READY_MADE'); setItemSortField('name'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: itemCategoryTab === 'READY_MADE' ? 'var(--color-brand)' : 'transparent',
                color: itemCategoryTab === 'READY_MADE' ? '#ffffff' : 'var(--color-text-muted)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Shirt size={15} />
              <span>Ready-Made</span>
              <span style={{
                fontSize: 11,
                padding: '1px 7px',
                borderRadius: 10,
                background: itemCategoryTab === 'READY_MADE' ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                color: itemCategoryTab === 'READY_MADE' ? '#ffffff' : '#64748b',
              }}>
                {readyMadeItems.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setItemCategoryTab('ACCESSORY'); setItemSortField('category'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: itemCategoryTab === 'ACCESSORY' ? 'var(--color-brand)' : 'transparent',
                color: itemCategoryTab === 'ACCESSORY' ? '#ffffff' : 'var(--color-text-muted)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Package size={15} />
              <span>Accessories</span>
              <span style={{
                fontSize: 11,
                padding: '1px 7px',
                borderRadius: 10,
                background: itemCategoryTab === 'ACCESSORY' ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                color: itemCategoryTab === 'ACCESSORY' ? '#ffffff' : '#64748b',
              }}>
                {accessoryItems.length}
              </span>
            </button>
          </div>

          {/* Arrival Status Filter Pills */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { id: 'ALL', label: `All ${itemCategoryTab === 'FABRIC' ? 'Fabric' : itemCategoryTab === 'READY_MADE' ? 'Ready-Made' : 'Accessories'}`, count: categoryTotalCount },
                { id: 'NOT_REACHED', label: 'Not Yet Reached (In Transit)', count: categoryNotReachedCount },
                { id: 'PARTIALLY_REACHED', label: 'Partially Reached', count: categoryPartialCount },
                { id: 'FULLY_REACHED', label: 'Fully Reached & In Stock', count: categoryReachedCount },
              ].map(tab => (
                <button
                  key={tab.id}
                  className="btn btn-ghost"
                  onClick={() => setItemStatusFilter(tab.id as any)}
                  style={{
                    borderBottom: itemStatusFilter === tab.id ? '2px solid var(--color-brand)' : '2px solid transparent',
                    borderRadius: 0,
                    color: itemStatusFilter === tab.id ? 'var(--color-brand)' : 'var(--color-text-muted)',
                    fontWeight: itemStatusFilter === tab.id ? 600 : 400,
                    padding: '8px 14px',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  {tab.label}
                  <span style={{
                    fontSize: 11,
                    background: itemStatusFilter === tab.id ? 'var(--color-brand-faded)' : 'var(--color-bg-subtle)',
                    color: itemStatusFilter === tab.id ? 'var(--color-brand)' : 'var(--color-text-muted)',
                    padding: '1px 6px',
                    borderRadius: 10,
                    fontWeight: 600
                  }}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              Showing <strong>{filteredAndSortedItems.length}</strong> items
            </div>
          </div>

          {/* Search Bar specifically for the active category */}
          <div className="filters-bar" style={{ marginBottom: 16 }}>
            <div style={{ position: 'relative', width: '480px' }}>
              <Search size={16} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input 
                type="text" 
                className="form-input"
                placeholder={
                  itemCategoryTab === 'FABRIC' 
                    ? "Search Fabric by Brand, Quality, Shade, Fabric Type, PO#, or Supplier..."
                    : itemCategoryTab === 'READY_MADE'
                    ? "Search Ready-Made by Item Name, Fabric Type, Shade, Art No, Size, PO#, or Supplier..."
                    : "Search Accessories by Category, Accessory Item, Color, Size, PO#, or Supplier..."
                } 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
                style={{ paddingLeft: 36, width: '100%', height: 38 }}
                autoFocus
              />
            </div>
            {search && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setSearch('')}
                style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
              >
                Clear Search
              </button>
            )}
          </div>

          {/* Items & PO Table with Category-Specific Required Columns */}
          {loading ? (
            <div className="loading-center"><span className="spinner spinner-lg" /></div>
          ) : filteredAndSortedItems.length === 0 ? (
            <div className="table-wrapper">
              <div className="empty-state">
                <div className="empty-state-icon">
                  {itemCategoryTab === 'FABRIC' ? <Layers size={48} className="text-muted" /> : itemCategoryTab === 'READY_MADE' ? <Shirt size={48} className="text-muted" /> : <Package size={48} className="text-muted" />}
                </div>
                <div className="empty-state-text">
                  No matching {itemCategoryTab === 'FABRIC' ? 'fabric' : itemCategoryTab === 'READY_MADE' ? 'ready-made' : 'accessory'} items found
                </div>
                {search && <p className="text-sm text-muted mt-2">Try adjusting your search terms</p>}
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              {/* ─── 1. FABRIC TABLE ─────────────────────────────────── */}
              {itemCategoryTab === 'FABRIC' && (
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 45, textAlign: 'center' }}>#</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('brand')} title="Sort by Brand">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Tag size={13} color="var(--color-brand)" />
                          <span>Brand</span>
                          {renderSortIcon('brand')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('quality')} title="Sort by Quality">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Quality</span>
                          {renderSortIcon('quality')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('shade')} title="Sort by Shade">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Palette size={13} color="var(--color-brand)" />
                          <span>Shade</span>
                          {renderSortIcon('shade')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('category')} title="Sort by Fabric Type">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Fabric Type</span>
                          {renderSortIcon('category')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('poNumber')} title="Sort by PO#">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Purchase Order</span>
                          {renderSortIcon('poNumber')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('supplierName')} title="Sort by Supplier">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Building2 size={13} />
                          <span>Supplier</span>
                          {renderSortIcon('supplierName')}
                        </div>
                      </th>
                      <th style={{ minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Users size={13} color="var(--color-brand)" />
                          <span>Client Allocation</span>
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('orderedQty')} title="Sort by Meters">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Ordered vs Reached (Meters)</span>
                          {renderSortIcon('orderedQty')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('reachedStatus')} title="Sort by Arrival Status">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Has It Reached?</span>
                          {renderSortIcon('reachedStatus')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('expectedDate')} title="Sort by Expected Date">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Expected Date</span>
                          {renderSortIcon('expectedDate')}
                        </div>
                      </th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedItems.map((item, idx) => (
                      <tr key={item.lineId} className="hover-row" onClick={() => navigate(`/purchase-orders/${item.poId}/view`)} style={{ cursor: 'pointer' }}>
                        <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{idx + 1}</td>
                        <td><span style={{ fontWeight: 700, color: '#0f172a' }}>{item.brand || '—'}</span></td>
                        <td><span style={{ fontWeight: 500, color: '#1e293b' }}>{item.quality || '—'}</span></td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 4, background: '#f1f5f9', border: '1px solid #e2e8f0', fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                            {item.shade || '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', fontSize: 11.5, fontWeight: 600 }}>
                            {item.category === 'PLAIN_SHIRTING' ? 'Plain Shirting' : (item.category || 'Suiting')}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: 'var(--color-brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {item.poNumber}
                            <ExternalLink size={11} style={{ opacity: 0.6 }} />
                          </span>
                        </td>
                        <td><div style={{ fontWeight: 500, fontSize: 13, color: '#334155' }}>{item.supplierName}</div></td>
                        <td>
                          {item.allocations && item.allocations.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {item.allocations.map((a, aIdx) => (
                                <span
                                  key={aIdx}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    background: a.receivedQty >= a.allocatedQty ? '#f0fdf4' : '#eff6ff',
                                    color: a.receivedQty >= a.allocatedQty ? '#166534' : '#1e40af',
                                    border: `1px solid ${a.receivedQty >= a.allocatedQty ? '#bbf7d0' : '#bfdbfe'}`
                                  }}
                                  title={`${a.clientName}: ${a.receivedQty}/${a.allocatedQty}m`}
                                >
                                  <Users size={10} />
                                  <strong>{a.clientName}:</strong> {a.allocatedQty}m
                                  {a.receivedQty > 0 && <span style={{ opacity: 0.75 }}>({a.receivedQty}m in)</span>}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>General Stock</span>
                          )}
                        </td>
                        <td style={{ minWidth: 150 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ fontWeight: 700, color: item.reachedStatus === 'FULLY_REACHED' ? '#166534' : '#0f172a' }}>
                              {item.receivedQty}m
                            </span>
                            <span style={{ color: '#64748b' }}>/ {item.orderedQty}m</span>
                          </div>
                          <div style={{ width: '100%', height: 5, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              background: item.reachedStatus === 'FULLY_REACHED' ? '#16a34a' : item.reachedStatus === 'PARTIALLY_REACHED' ? '#0284c7' : '#cbd5e1',
                              width: `${Math.min(item.progress, 100)}%`,
                            }} />
                          </div>
                        </td>
                        <td>{renderReachedBadge(item)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#64748b' }}>
                            <Calendar size={13} />
                            {formatDate(item.expectedDate)}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={e => { e.stopPropagation(); navigate(`/purchase-orders/${item.poId}/view`); }}
                            style={{ padding: '3px 8px', height: 28, fontSize: 11.5 }}
                          >
                            View PO
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ─── 2. READY-MADE TABLE ─────────────────────────────── */}
              {itemCategoryTab === 'READY_MADE' && (
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 45, textAlign: 'center' }}>#</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('name')} title="Sort by Item Name">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Shirt size={13} color="var(--color-brand)" />
                          <span>Item Name</span>
                          {renderSortIcon('name')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('category')} title="Sort by Fabric Type">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Fabric Type</span>
                          {renderSortIcon('category')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('shade')} title="Sort by Color / Shade">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Palette size={13} color="var(--color-brand)" />
                          <span>Color / Shade</span>
                          {renderSortIcon('shade')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('artNo')} title="Sort by Art No">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Art No</span>
                          {renderSortIcon('artNo')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('size')} title="Sort by Size">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Size</span>
                          {renderSortIcon('size')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('poNumber')} title="Sort by PO#">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Purchase Order</span>
                          {renderSortIcon('poNumber')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('supplierName')} title="Sort by Supplier">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Building2 size={13} />
                          <span>Supplier</span>
                          {renderSortIcon('supplierName')}
                        </div>
                      </th>
                      <th style={{ minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Users size={13} color="var(--color-brand)" />
                          <span>Client Allocation</span>
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('orderedQty')} title="Sort by Pieces">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Ordered vs Reached (Pcs)</span>
                          {renderSortIcon('orderedQty')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('reachedStatus')} title="Sort by Arrival Status">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Has It Reached?</span>
                          {renderSortIcon('reachedStatus')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('expectedDate')} title="Sort by Expected Date">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Expected Date</span>
                          {renderSortIcon('expectedDate')}
                        </div>
                      </th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedItems.map((item, idx) => (
                      <tr key={item.lineId} className="hover-row" onClick={() => navigate(`/purchase-orders/${item.poId}/view`)} style={{ cursor: 'pointer' }}>
                        <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{idx + 1}</td>
                        <td><span style={{ fontWeight: 700, color: '#0f172a' }}>{item.name || item.brand || '—'}</span></td>
                        <td><span style={{ fontWeight: 500, color: '#1e293b' }}>{item.category || '—'}</span></td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 4, background: '#f1f5f9', border: '1px solid #e2e8f0', fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                            {item.shade || '—'}
                          </span>
                        </td>
                        <td>
                          {item.artNo ? (
                            <span style={{ fontFamily: 'monospace', fontSize: 11.5, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, border: '1px solid #e2e8f0', fontWeight: 600 }}>
                              {item.artNo}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', padding: '2px 6px', borderRadius: 4, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 11.5, fontWeight: 700 }}>
                            {item.size || '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: 'var(--color-brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {item.poNumber}
                            <ExternalLink size={11} style={{ opacity: 0.6 }} />
                          </span>
                        </td>
                        <td><div style={{ fontWeight: 500, fontSize: 13, color: '#334155' }}>{item.supplierName}</div></td>
                        <td>
                          {item.allocations && item.allocations.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {item.allocations.map((a, aIdx) => (
                                <span
                                  key={aIdx}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    background: a.receivedQty >= a.allocatedQty ? '#f0fdf4' : '#eff6ff',
                                    color: a.receivedQty >= a.allocatedQty ? '#166534' : '#1e40af',
                                    border: `1px solid ${a.receivedQty >= a.allocatedQty ? '#bbf7d0' : '#bfdbfe'}`
                                  }}
                                  title={`${a.clientName}: ${a.receivedQty}/${a.allocatedQty} pcs`}
                                >
                                  <Users size={10} />
                                  <strong>{a.clientName}:</strong> {a.allocatedQty} pcs
                                  {a.receivedQty > 0 && <span style={{ opacity: 0.75 }}>({a.receivedQty} in)</span>}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>General Stock</span>
                          )}
                        </td>
                        <td style={{ minWidth: 150 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ fontWeight: 700, color: item.reachedStatus === 'FULLY_REACHED' ? '#166534' : '#0f172a' }}>
                              {item.receivedQty} pcs
                            </span>
                            <span style={{ color: '#64748b' }}>/ {item.orderedQty} pcs</span>
                          </div>
                          <div style={{ width: '100%', height: 5, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              background: item.reachedStatus === 'FULLY_REACHED' ? '#16a34a' : item.reachedStatus === 'PARTIALLY_REACHED' ? '#0284c7' : '#cbd5e1',
                              width: `${Math.min(item.progress, 100)}%`,
                            }} />
                          </div>
                        </td>
                        <td>{renderReachedBadge(item)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#64748b' }}>
                            <Calendar size={13} />
                            {formatDate(item.expectedDate)}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={e => { e.stopPropagation(); navigate(`/purchase-orders/${item.poId}/view`); }}
                            style={{ padding: '3px 8px', height: 28, fontSize: 11.5 }}
                          >
                            View PO
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ─── 3. ACCESSORIES TABLE ───────────────────────────── */}
              {itemCategoryTab === 'ACCESSORY' && (
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 45, textAlign: 'center' }}>#</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('category')} title="Sort by Category">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Package size={13} color="var(--color-brand)" />
                          <span>Category</span>
                          {renderSortIcon('category')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('name')} title="Sort by Accessory Item">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Accessory Item</span>
                          {renderSortIcon('name')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('shade')} title="Sort by Color">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Palette size={13} color="var(--color-brand)" />
                          <span>Color</span>
                          {renderSortIcon('shade')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('size')} title="Sort by Size">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Size / Spec</span>
                          {renderSortIcon('size')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('poNumber')} title="Sort by PO#">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Purchase Order</span>
                          {renderSortIcon('poNumber')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('supplierName')} title="Sort by Supplier">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Building2 size={13} />
                          <span>Supplier</span>
                          {renderSortIcon('supplierName')}
                        </div>
                      </th>
                      <th style={{ minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Users size={13} color="var(--color-brand)" />
                          <span>Client Allocation</span>
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('orderedQty')} title="Sort by Quantity">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Ordered vs Reached (Units)</span>
                          {renderSortIcon('orderedQty')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('reachedStatus')} title="Sort by Arrival Status">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Has It Reached?</span>
                          {renderSortIcon('reachedStatus')}
                        </div>
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSortClick('expectedDate')} title="Sort by Expected Date">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Expected Date</span>
                          {renderSortIcon('expectedDate')}
                        </div>
                      </th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedItems.map((item, idx) => (
                      <tr key={item.lineId} className="hover-row" onClick={() => navigate(`/purchase-orders/${item.poId}/view`)} style={{ cursor: 'pointer' }}>
                        <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{idx + 1}</td>
                        <td>
                          <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 4, background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', fontSize: 12, fontWeight: 700 }}>
                            {item.category || 'Accessory'}
                          </span>
                        </td>
                        <td><span style={{ fontWeight: 600, color: '#0f172a' }}>{item.name || item.quality || '—'}</span></td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 4, background: '#f1f5f9', border: '1px solid #e2e8f0', fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                            {item.shade || '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', padding: '2px 6px', borderRadius: 4, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 11.5, fontWeight: 700 }}>
                            {item.size || '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: 'var(--color-brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {item.poNumber}
                            <ExternalLink size={11} style={{ opacity: 0.6 }} />
                          </span>
                        </td>
                        <td><div style={{ fontWeight: 500, fontSize: 13, color: '#334155' }}>{item.supplierName}</div></td>
                        <td>
                          {item.allocations && item.allocations.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {item.allocations.map((a, aIdx) => (
                                <span
                                  key={aIdx}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    background: a.receivedQty >= a.allocatedQty ? '#f0fdf4' : '#eff6ff',
                                    color: a.receivedQty >= a.allocatedQty ? '#166534' : '#1e40af',
                                    border: `1px solid ${a.receivedQty >= a.allocatedQty ? '#bbf7d0' : '#bfdbfe'}`
                                  }}
                                  title={`${a.clientName}: ${a.receivedQty}/${a.allocatedQty} ${item.uom}`}
                                >
                                  <Users size={10} />
                                  <strong>{a.clientName}:</strong> {a.allocatedQty} {item.uom}
                                  {a.receivedQty > 0 && <span style={{ opacity: 0.75 }}>({a.receivedQty} in)</span>}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>General Stock</span>
                          )}
                        </td>
                        <td style={{ minWidth: 150 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ fontWeight: 700, color: item.reachedStatus === 'FULLY_REACHED' ? '#166534' : '#0f172a' }}>
                              {item.receivedQty} {item.uom}
                            </span>
                            <span style={{ color: '#64748b' }}>/ {item.orderedQty} {item.uom}</span>
                          </div>
                          <div style={{ width: '100%', height: 5, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              background: item.reachedStatus === 'FULLY_REACHED' ? '#16a34a' : item.reachedStatus === 'PARTIALLY_REACHED' ? '#0284c7' : '#cbd5e1',
                              width: `${Math.min(item.progress, 100)}%`,
                            }} />
                          </div>
                        </td>
                        <td>{renderReachedBadge(item)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#64748b' }}>
                            <Calendar size={13} />
                            {formatDate(item.expectedDate)}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={e => { e.stopPropagation(); navigate(`/purchase-orders/${item.poId}/view`); }}
                            style={{ padding: '3px 8px', height: 28, fontSize: 11.5 }}
                          >
                            View PO
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
