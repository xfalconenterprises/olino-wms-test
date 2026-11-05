import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { openPrintPage } from '../../../utils/printPage';
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
  Shirt,
  Package,
  Users,
  FileCheck,
  FileClock,
  Trash2
} from 'lucide-react';
import { formatDate, formatDateTime } from '../../../utils/format';
import { allowsDecimals, fabricCategoryLabel, formatQty, formatTotals, unitLabel } from '../../../utils/units';
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
  qualityName?: string | null;
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
  qualityName: string;
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

interface ItemColumn {
  key: string;
  label: string;
  sort?: ItemSortField;
  minWidth?: number;
  cell: (item: FlattenedPOItem) => React.ReactNode;
}

interface PoDraftSummary {
  id: string;
  poType: string;
  supplierName: string | null;
  lineCount: number;
  updatedAt: string;
}

const DRAFT_TYPE_NAMES: Record<string, string> = {
  FABRIC: 'Fabric Rolls',
  READY_MADE: 'Ready-Made Garments',
  ACCESSORY: 'Accessories',
};

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [drafts, setDrafts] = useState<PoDraftSummary[]>([]);
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

  // A person's own unfinished POs; the server sends nobody else's
  const canCreate = hasPermission(user, 'po.create');
  useEffect(() => {
    if (canCreate) api.get('/api/po-drafts').then(r => setDrafts(r.data || [])).catch(() => {});
  }, [canCreate]);

  const deleteDraft = async (draft: PoDraftSummary) => {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    try {
      await api.delete(`/api/po-drafts/${draft.id}`);
      setDrafts(list => list.filter(d => d.id !== draft.id));
    } catch {
      alert('The draft could not be deleted.');
    }
  };

  const handlePrint = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await openPrintPage(`/api/purchase-orders/${id}/print`, 'purchase order');
    } catch {
      alert('Failed to generate print document');
    }
  };

  const handlePrintGrn = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await openPrintPage(`/api/grn/${id}/print`, 'goods receipt note');
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
        const brand = line.brand || '';
        const quality = line.quality || '';
        const shade = line.shade || '';
        const name = line.name || '';
        const artNo = line.artNo || '';
        const category = line.category || '';
        const size = line.size || '';
        const uom = line.uom || (lineItemType === 'FABRIC' ? 'METERS' : 'PCS');
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
          ? allocations.map(a => `${a.clientName}: ${a.allocatedQty} ${unitLabel(uom)}`).join(', ')
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
          qualityName: line.qualityName || '',
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

      if (itemSortField === 'orderedQty' || itemSortField === 'progress') {
        const key = itemSortField as 'orderedQty' | 'progress';
        return itemSortDirection === 'asc' ? a[key] - b[key] : b[key] - a[key];
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

  // ── Items table: plain text throughout; the columns that identify an item depend on its category ──
  const qtyNumber = (n: number, uom: string) => String(allowsDecimals(uom) ? Math.round(n * 100) / 100 : Math.round(n));
  const mainText = (text: string, sub?: string) => (
    <>
      {text && <div style={{ fontWeight: 600, color: '#0f172a' }}>{text}</div>}
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>{sub}</div>}
    </>
  );
  const plain = (text: string, mono = false) => text
    ? <span style={{ color: '#1e293b', fontWeight: 500, ...(mono && { fontFamily: 'monospace' }) }}>{text}</span>
    : null;

  const clientCell = (item: FlattenedPOItem) => {
    if (item.allocations.length === 0) return <span style={{ color: 'var(--color-text-muted)' }}>General Stock</span>;
    // One client taking the whole line needs no figures; the Received column has them
    const whole = item.allocations.length === 1 && Math.abs(item.allocations[0].allocatedQty - item.orderedQty) < 0.005;
    return item.allocations.map(a => (
      <div key={a.id} style={{ lineHeight: 1.5 }}>
        <span style={{ fontWeight: 500, color: '#1e293b' }}>{a.clientName}</span>
        {!whole && (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 12, marginLeft: 6, whiteSpace: 'nowrap' }}>
            {a.receivedQty > 0 ? `${qtyNumber(a.receivedQty, item.uom)} / ` : ''}{formatQty(a.allocatedQty, item.uom)}
          </span>
        )}
      </div>
    ));
  };

  const ARRIVAL = {
    NOT_REACHED: { text: 'Not reached', color: '#b45309', bar: '#cbd5e1' },
    PARTIALLY_REACHED: { text: 'Partly reached', color: '#0369a1', bar: '#0284c7' },
    FULLY_REACHED: { text: 'Fully reached', color: '#15803d', bar: '#16a34a' },
  } as const;
  const receivedCell = (item: FlattenedPOItem) => {
    const arrival = ARRIVAL[item.reachedStatus];
    return (
      <>
        <div style={{ whiteSpace: 'nowrap' }}>
          <strong style={{ color: '#0f172a' }}>{qtyNumber(item.receivedQty, item.uom)}</strong>
          <span style={{ color: 'var(--color-text-muted)' }}> / {formatQty(item.orderedQty, item.uom)}</span>
        </div>
        <div style={{ height: 4, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden', margin: '5px 0 4px' }}>
          <div style={{ height: '100%', width: `${Math.min(item.progress, 100)}%`, background: arrival.bar }} />
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: arrival.color }}>
          {arrival.text}{item.reachedStatus === 'PARTIALLY_REACHED' ? ` · ${Math.floor(item.progress)}%` : ''}
        </div>
      </>
    );
  };

  const identityColumns: ItemColumn[] = itemCategoryTab === 'FABRIC' ? [
    { key: 'item', label: 'Brand / Quality', sort: 'brand', minWidth: 170, cell: i => mainText(i.brand, [i.quality, i.qualityName].filter(Boolean).join(' · ')) },
    { key: 'shade', label: 'Shade', sort: 'shade', cell: i => plain(i.shade) },
    { key: 'category', label: 'Fabric Type', sort: 'category', cell: i => plain(fabricCategoryLabel(i.category)) },
  ] : itemCategoryTab === 'READY_MADE' ? [
    { key: 'item', label: 'Item', sort: 'name', minWidth: 170, cell: i => mainText(i.name || i.brand, i.category) },
    { key: 'shade', label: 'Color / Shade', sort: 'shade', cell: i => plain(i.shade) },
    { key: 'artNo', label: 'Art No', sort: 'artNo', cell: i => plain(i.artNo, true) },
    { key: 'size', label: 'Size', sort: 'size', cell: i => plain(i.size) },
  ] : [
    { key: 'category', label: 'Category', sort: 'category', cell: i => plain(i.category) },
    { key: 'item', label: 'Item', sort: 'name', minWidth: 150, cell: i => mainText(i.name || i.quality) },
    { key: 'shade', label: 'Color', sort: 'shade', cell: i => plain(i.shade) },
    { key: 'size', label: 'Size / Spec', sort: 'size', cell: i => plain(i.size) },
  ];
  const itemColumns: ItemColumn[] = [
    ...identityColumns,
    { key: 'po', label: 'PO / Supplier', sort: 'poNumber', minWidth: 150, cell: i => mainText(i.poNumber, i.supplierName) },
    { key: 'client', label: 'Client', minWidth: 150, cell: clientCell },
    { key: 'received', label: 'Received', sort: 'progress', minWidth: 170, cell: receivedCell },
    { key: 'expected', label: 'Expected', sort: 'expectedDate', cell: i => <span style={{ whiteSpace: 'nowrap', color: '#475569' }}>{formatDate(i.expectedDate)}</span> },
  ];

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

      {/* ─── My Drafts ─────────────────────────────────────────────────────── */}
      {drafts.length > 0 && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            <FileClock size={16} color="var(--color-brand)" /> My Drafts ({drafts.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {drafts.map(d => (
              <div key={d.id} className="po-draft" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.supplierName || DRAFT_TYPE_NAMES[d.poType] || 'Purchase Order'}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {d.supplierName && DRAFT_TYPE_NAMES[d.poType] ? `${DRAFT_TYPE_NAMES[d.poType]} · ` : ''}
                    {d.lineCount} {d.lineCount === 1 ? 'item' : 'items'} · Saved {formatDateTime(d.updatedAt)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <Link to={`/purchase-orders/new?draft=${d.id}`} className="btn btn-primary btn-sm">Continue</Link>
                  <button type="button" className="btn btn-ghost btn-icon" onClick={() => deleteDraft(d)} title="Delete draft" aria-label="Delete draft">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                            <span style={{ fontWeight: 600 }}>{formatTotals((po.lines || []).map(l => ({ uom: l.uom || (poType === 'FABRIC' ? 'METERS' : 'PCS'), quantity: l.receivedQty })))}</span>
                            <span className="text-muted">/ {formatTotals((po.lines || []).map(l => ({ uom: l.uom || (poType === 'FABRIC' ? 'METERS' : 'PCS'), quantity: l.orderedQty })))}</span>
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
                                title={po.totalReceived < po.totalOrdered ? 'Print Partial GRN' : 'Print Complete GRN'}
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
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 40, textAlign: 'center' }}>#</th>
                    {itemColumns.map(col => (
                      <th
                        key={col.key}
                        onClick={col.sort ? () => handleSortClick(col.sort!) : undefined}
                        title={col.sort ? `Sort by ${col.label}` : undefined}
                        style={{ cursor: col.sort ? 'pointer' : undefined, userSelect: 'none', whiteSpace: 'nowrap', minWidth: col.minWidth }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          {col.label}
                          {col.sort && renderSortIcon(col.sort)}
                        </span>
                      </th>
                    ))}
                    <th style={{ width: 28 }} />
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedItems.map((item, idx) => (
                    <tr key={item.lineId} className="hover-row" onClick={() => navigate(`/purchase-orders/${item.poId}/view`)} style={{ cursor: 'pointer' }} title="Open the purchase order">
                      <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{idx + 1}</td>
                      {itemColumns.map(col => <td key={col.key}>{col.cell(item)}</td>)}
                      <td style={{ color: '#94a3b8', textAlign: 'right' }}><ChevronRight size={16} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
