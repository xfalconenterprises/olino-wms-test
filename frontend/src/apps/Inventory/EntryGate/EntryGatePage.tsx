import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { 
  LogIn, 
  CheckCircle2, 
  Printer, 
  Plus, 
  ShoppingCart, 
  ScanLine, 
  Eye, 
  Truck, 
  Building2, 
  Package, 
  Layers, 
  Shirt, 
  Boxes, 
  FileText, 
  X, 
  RotateCcw,
  AlertTriangle,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Filter,
  Repeat2,
  ChevronDown,
  Check,
  FileCheck,
  Users,
  Search,
  Trash2,
  ChevronRight,
  FileSpreadsheet

} from 'lucide-react';
import { printTSPL, autoPrintReceivedLabel } from '../../../utils/printer';
import { formatDate, formatDateTime } from '../../../utils/format';
import { ITEM_TYPE_LABEL, lumpPayload, remainingQty, type ImportLine, type InwardItemType } from '../../../utils/directInwardImport';
import DirectInwardImport from './DirectInwardImport';
import '../../../styles/components.css';

interface Supplier {
  id: string;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
}

interface OpenOrderLine {
  poId: string;
  poNumber: string;
  lineId: string;
  targetClient: string | null;
  expectedDate: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  allocations?: Array<{
    id: string;
    clientId: string;
    clientName: string;
    allocatedQty: number;
    receivedQty: number;
    notes?: string | null;
  }>;
}

interface PendingItem {
  sku: {
    id: string;
    itemType: string;
    brand: string | null;
    quality: string | null;
    shade: string | null;
    size: string | null;
    name: string | null;
    artNo: string | null;
    category: string | null;
    uom: string;
  };
  totalOrderedQty: number;
  totalReceivedQty: number;
  totalRemainingQty: number;
  openOrders: OpenOrderLine[];
}

interface SupplierInboundData {
  supplier: Supplier;
  totalOpenPOs: number;
  totalPendingQty: number;
  pendingItems: PendingItem[];
  allOpenPOs: Array<{
    id: string;
    poNumber: string;
    expectedDate: string;
    targetClient: string | null;
    linesCount: number;
  }>;
}

interface ReceivedRoll {
  id: string;
  batchCode: string;
  quantity: number;
  supplierBundle?: string | null;
  invoiceRef?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  createdAt: string;
  itemType: string;
  brand: string | null;
  quality: string | null;
  shade: string | null;
  name: string | null;
  artNo: string | null;
  category: string | null;
  size: string | null;
  uom: string;
  poLine?: {
    id: string;
    orderedQty: number;
    receivedQty: number;
    po: {
      id: string;
      poNumber: string;
      targetClient: string | null;
    };
  } | null;
}

interface InboundDiscrepancyItem {
  id: string;
  supplierId: string;
  invoiceRef: string;
  bundleNumber: string;
  itemType?: string | null;
  category?: string | null;
  brand?: string | null;
  quality?: string | null;
  shade?: string | null;
  size?: string | null;
  name?: string | null;
  artNo?: string | null;
  issueType: string;
  expectedQty?: number | null;
  receivedQty?: number | null;
  notes?: string | null;
  reportedBy?: { name?: string; username?: string };
  createdAt: string;
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  MISSING_FROM_BUNDLE: 'Item Not Available in Bundle (Missing / Short)',
  WRONG_ITEM_PACKED: 'Wrong Item / Shade / Size in Bundle',
  SHORT_QUANTITY: 'Physical Quantity Less Than Invoice',
  DAMAGED_DEFECTIVE: 'Damaged or Defective in Bundle',
};

type InboundMode = 'SELECT_MODE' | 'SUPPLIER_INBOUND' | 'PO_SCAN' | 'DIRECT';

// What the Direct Inward Desk keeps on the server between visits (see /api/direct-inward/draft)
interface DirectInwardDraftData {
  supplierId: string | null;
  supplierName: string;
  invoiceRef: string;
  invoiceDate: string;
  clientId: string | null;
  clientName: string;
  infoConfirmed: boolean;
  itemType: InwardItemType | null;
  entryMode: 'MANUAL' | 'IMPORT' | null;
  importLines: ImportLine[];
  sessionBatches: any[]; // saved as ids; the server returns the current batch rows
}

// Large option button for the Direct Inward steps
function ChoiceCard({ icon, title, subtitle, badge, onClick }: {
  icon: React.ReactNode; title: string; subtitle: string; badge?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: '1 1 220px', textAlign: 'left', cursor: 'pointer', padding: '18px 20px', borderRadius: 'var(--radius-lg)',
        border: '1.5px solid var(--color-border)', background: '#fff', display: 'flex', alignItems: 'flex-start', gap: 14,
        position: 'relative', transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.06)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <span style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--color-brand-faded)', color: 'var(--color-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      <span>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 3 }}>{subtitle}</span>
      </span>
      {badge && (
        <span style={{ position: 'absolute', top: 10, right: 12, fontSize: 11, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10 }}>
          {badge}
        </span>
      )}
    </button>
  );
}
type InwardStep = 'ITEMS_LIST' | 'RECEIVE_PANEL';

export default function EntryGatePage() {
  const navigate = useNavigate();
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const poScanInputRef = useRef<HTMLInputElement>(null);

  // Active Screen Mode (Starts on SELECT_MODE to prompt the 3 options)
  const [activeTab, setActiveTab] = useState<InboundMode>('SELECT_MODE');
  const [inwardStep, setInwardStep] = useState<InwardStep>('ITEMS_LIST');

  // Supplier Inbound State
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [supplierSearchText, setSupplierSearchText] = useState('');
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [supplierHighlightIndex, setSupplierHighlightIndex] = useState(0);
  const supplierDropdownRef = useRef<HTMLDivElement>(null);
  const supplierInputRef = useRef<HTMLInputElement>(null);
  const [invoiceRef, setInvoiceRef] = useState('');
  const [supplierData, setSupplierData] = useState<SupplierInboundData | null>(null);
  const [loadingPending, setLoadingPending] = useState(false);

  // Item Classification Tab
  const [itemTypeFilter, setItemTypeFilter] = useState<'FABRIC' | 'READY_MADE' | 'ACCESSORY' | null>(null);

  // Column Filters
  const [quickSearch, setQuickSearch] = useState('');
  const [fabricFilters, setFabricFilters] = useState({ brand: '', quality: '', shade: '' });
  const [readyMadeFilters, setReadyMadeFilters] = useState({ artNo: '', fabricType: '', size: '', shade: '' });
  const [accessoryFilters, setAccessoryFilters] = useState({ category: '', name: '', size: '' });

  // Selected Item & PO Selection Popout
  const [selectedItem, setSelectedItem] = useState<PendingItem | null>(null);
  const [showPoPopout, setShowPoPopout] = useState(false);
  const [selectedPoOrder, setSelectedPoOrder] = useState<OpenOrderLine | null>(null);

  // PO In-Window Preview State
  const [viewingPoId, setViewingPoId] = useState<string | null>(null);
  const [viewingPoData, setViewingPoData] = useState<any | null>(null);
  const [loadingViewingPo, setLoadingViewingPo] = useState(false);
  const [viewingPoTargetLineId, setViewingPoTargetLineId] = useState<string | null>(null);

  // Bundle & Roll Entry
  const [activeBundleNo, setActiveBundleNo] = useState('');
  const [rollQty, setRollQty] = useState('');
  const [millPieceTag, setMillPieceTag] = useState('');

  // Submitting state & recent received batch
  const [inwardSubmitting, setInwardSubmitting] = useState(false);
  const [inwardError, setInwardError] = useState('');
  const [recentBatch, setRecentBatch] = useState<{
    batchCode: string;
    quantity: number;
    uom: string;
    bundleNumber?: string;
    matchedPoNumber?: string;
  } | null>(null);

  // Live session rolls (truck delivery feed)
  const [sessionRolls, setSessionRolls] = useState<ReceivedRoll[]>([]);
  const [loadingSessionRolls, setLoadingSessionRolls] = useState(false);
  const [feedViewMode, setFeedViewMode] = useState<'BY_BUNDLE' | 'FLAT'>('BY_BUNDLE');

  // Discrepancies Registry
  const [discrepancies, setDiscrepancies] = useState<InboundDiscrepancyItem[]>([]);
  const [showDiscrepancyModal, setShowDiscrepancyModal] = useState(false);
  const [discrepancySubmitting, setDiscrepancySubmitting] = useState(false);
  const [discrepancyForm, setDiscrepancyForm] = useState({
    bundleNumber: '',
    itemKey: '',
    itemType: 'FABRIC',
    brand: '',
    quality: '',
    shade: '',
    category: '',
    name: '',
    artNo: '',
    size: '',
    issueType: 'MISSING_FROM_BUNDLE',
    expectedQty: '',
    receivedQty: '0',
    notes: ''
  });

  // PO Scanner Tab State
  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(false);

  // Direct Inward General Information State
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [directSupplierInput, setDirectSupplierInput] = useState('');
  const [directSupplierId, setDirectSupplierId] = useState('');
  const [showDirectSupplierMenu, setShowDirectSupplierMenu] = useState(false);
  const directSupplierWrapperRef = useRef<HTMLDivElement>(null);

  // Quick Add Supplier Modal State
  const [showQuickAddSupplierModal, setShowQuickAddSupplierModal] = useState(false);
  const [quickSupplierForm, setQuickSupplierForm] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    city: '',
    address: '',
  });
  const [quickSupplierSubmitting, setQuickSupplierSubmitting] = useState(false);
  const [quickSupplierError, setQuickSupplierError] = useState('');

  const [directInvoiceRef, setDirectInvoiceRef] = useState('');
  const [directInvoiceDate, setDirectInvoiceDate] = useState(() => new Date().toISOString().split('T')[0]);

  const [directClientInput, setDirectClientInput] = useState('');
  const [directSelectedClient, setDirectSelectedClient] = useState<any | null>(null);
  const [showDirectClientMenu, setShowDirectClientMenu] = useState(false);
  const directClientWrapperRef = useRef<HTMLDivElement>(null);

  // Quick Add Client Modal State (identical to PO)
  const [showQuickAddClientModal, setShowQuickAddClientModal] = useState(false);
  const [quickClientForm, setQuickClientForm] = useState({
    name: '',
    clientType: '',
    contactPerson: '',
    phone: '',
    city: '',
    address: '',
    notes: ''
  });
  const [quickClientSubmitting, setQuickClientSubmitting] = useState(false);
  const [quickClientError, setQuickClientError] = useState('');

  // Master Data Attributes for Autocomplete
  const [masterAttributes, setMasterAttributes] = useState<{
    BRAND: string[];
    QUALITY: string[];
    SHADE: string[];
    ITEM_NAME: string[];
    FABRIC_TYPE: string[];
    ART_NO: string[];
    ACCESSORY_CATEGORY: string[];
    CATEGORY: string[];
  }>({
    BRAND: [],
    QUALITY: [],
    SHADE: [],
    ITEM_NAME: [],
    FABRIC_TYPE: [],
    ART_NO: [],
    ACCESSORY_CATEGORY: [],
    CATEGORY: ['SUITING', 'SHIRTING', 'PLAIN_SHIRTING'],
  });

  // Direct Inward Item Entry State
  // Steps: General Information → item type → entry method → entry. Unset means "not chosen yet".
  const [directInfoConfirmed, setDirectInfoConfirmed] = useState(false);
  const [directInfoError, setDirectInfoError] = useState('');
  const [directClassification, setDirectClassification] = useState<InwardItemType | null>(null);
  const [directItemForm, setDirectItemForm] = useState({
    // Fabric
    category: 'SUITING',
    brand: '',
    quality: '',
    shade: '',
    bundleNumber: '',
    meters: '',

    // Ready-Made
    rmName: '',
    rmFabricType: '',
    rmShade: '',
    rmArtNo: '',
    rmSize: '',
    rmQty: '',
    rmBundleNumber: '',

    // Accessory
    accCategory: '',
    accItemName: '',
    specSize: '',
    accShade: '',
    uom: 'PCS',
    accQuantity: '',
    accBundleNumber: '',

    notes: ''
  });
  const [directSubmittingItem, setDirectSubmittingItem] = useState(false);
  const [directItemError, setDirectItemError] = useState('');
  const [directSessionBatches, setDirectSessionBatches] = useState<any[]>([]);

  // Excel import: items with totals, received lump by lump
  const [directEntryMode, setDirectEntryMode] = useState<'MANUAL' | 'IMPORT' | null>(null);
  const [importLines, setImportLines] = useState<ImportLine[]>([]);
  const pendingImportLines = importLines.filter(l => remainingQty(l) > 0);

  // Server-side draft (per user): imported items and lumps not yet on a GRN survive leaving the page
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftSyncBroken, setDraftSyncBroken] = useState(false);
  const [draftRestored, setDraftRestored] = useState<{ savedAt: string; items: number; lumps: number } | null>(null);
  const draftOnServer = useRef(false);
  const pendingDraftSave = useRef<(() => void) | null>(null);

  // Session table shows item fields in their own columns; headers name the field for the item
  // type in the session, or both names when fabric and ready-made/accessories are mixed
  const sessionItemColumns = useMemo(() => {
    const types = new Set(directSessionBatches.map(b => b.itemType));
    const only = types.size === 1 ? [...types][0] : null;
    const pick = (fabric: string, other: string) => (only === 'FABRIC' ? fabric : only ? other : `${fabric} / ${other}`);
    const categoryLabel: Record<string, string> = { SUITING: 'Suiting', SHIRTING: 'Shirting', PLAIN_SHIRTING: 'Plain Shirting', OTHER: 'Other' };
    return [
      { header: only === 'READY_MADE' ? 'Fabric Type' : 'Category', value: (b: any) => categoryLabel[b.category] ?? b.category ?? '' },
      { header: pick('Brand', 'Item Name'), value: (b: any) => (b.itemType === 'FABRIC' ? b.brand : b.name) ?? '' },
      { header: pick('Quality', 'Art No'), value: (b: any) => (b.itemType === 'FABRIC' ? b.quality : b.artNo) ?? '' },
      { header: 'Shade', value: (b: any) => b.shade ?? '' },
      { header: only === 'ACCESSORY' ? 'Spec / Size' : 'Size', value: (b: any) => b.size ?? '' },
    ];
  }, [directSessionBatches]);

  // Direct GRN Finalize Modal State
  const [showDirectGrnModal, setShowDirectGrnModal] = useState(false);
  const [directGrnRemarks, setDirectGrnRemarks] = useState('');
  const [issuingDirectGrn, setIssuingDirectGrn] = useState(false);
  const [directGrnSuccess, setDirectGrnSuccess] = useState<any | null>(null);

  // GRN Summary & Finalize State (Supplier Inbound)
  const [showGrnModal, setShowGrnModal] = useState(false);
  const [grnRemarks, setGrnRemarks] = useState('');
  const [issuingGrn, setIssuingGrn] = useState(false);
  const [grnSuccess, setGrnSuccess] = useState<any | null>(null);

  // Determine if this delivery session is partial (more items remaining on POs)
  const isPartialReceiving = useMemo(() => {
    return (supplierData?.totalPendingQty ?? 0) > 0;
  }, [supplierData]);

  const handleFinalizeGrn = async () => {
    if (!sessionRolls || sessionRolls.length === 0) {
      alert('No rolls in current delivery session to issue GRN.');
      return;
    }
    setIssuingGrn(true);
    try {
      const isPartial = (supplierData?.totalPendingQty ?? 0) > 0;
      const res = await api.post('/api/grn', {
        supplierId: selectedSupplierId || undefined,
        supplierName: supplierData?.supplier.name || 'Supplier Inbound',
        invoiceRef: invoiceRef.trim() || undefined,
        remarks: isPartial
          ? (grnRemarks.trim() ? `[PARTIAL RECEIPT] ${grnRemarks.trim()}` : '[PARTIAL RECEIPT] Balance remains open on PO')
          : (grnRemarks.trim() || undefined),
        batchIds: sessionRolls.map(r => r.id),
        discrepancyIds: discrepancies.map(d => d.id),
      });

      const newGrn = res.data;
      setGrnSuccess(newGrn);
      printGrnVoucher(newGrn.id);
      setSessionRolls([]);
      setDiscrepancies([]);

      // Refresh pending items from supplier to keep balances up to date
      if (selectedSupplierId) {
        try {
          const pendingRes = await api.get(`/api/purchase-orders/supplier-inbound/${selectedSupplierId}/pending`);
          setSupplierData(pendingRes.data);
        } catch (refreshErr) {
          console.warn('Failed to refresh pending supplier items:', refreshErr);
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to issue GRN');
    } finally {
      setIssuingGrn(false);
    }
  };

  const printGrnVoucher = async (grnId: string) => {
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

  // Load suppliers, clients, and master data on mount
  useEffect(() => {
    loadSuppliers();
    loadClients();
    loadMasterData();
  }, []);

  // When delivering supplier is selected, fetch pending items and session rolls
  useEffect(() => {
    if (!selectedSupplierId) {
      setSupplierData(null);
      setSessionRolls([]);
      setDiscrepancies([]);
      setSelectedItem(null);
      setSelectedPoOrder(null);
      setInwardStep('ITEMS_LIST');
      return;
    }
    loadPendingItems(selectedSupplierId);
    loadSessionRolls(selectedSupplierId, invoiceRef);
    loadDiscrepancies(selectedSupplierId, invoiceRef);
  }, [selectedSupplierId]);

  const selectedSupplier = useMemo(() => {
    return suppliers.find(s => s.id === selectedSupplierId) || null;
  }, [suppliers, selectedSupplierId]);

  // Keep search text in sync with selected supplier
  useEffect(() => {
    if (selectedSupplierId && suppliers.length > 0) {
      const match = suppliers.find(s => s.id === selectedSupplierId);
      if (match) {
        setSupplierSearchText(match.name);
      }
    } else if (!selectedSupplierId) {
      setSupplierSearchText('');
    }
  }, [selectedSupplierId, suppliers]);

  // Focus PO scanner input when entering PO_SCAN tab
  useEffect(() => {
    if (activeTab === 'PO_SCAN') {
      setTimeout(() => poScanInputRef.current?.focus(), 100);
    }
  }, [activeTab]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target as Node)) {
        setShowSupplierDropdown(false);
        if (selectedSupplier) {
          setSupplierSearchText(selectedSupplier.name);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [selectedSupplier]);

  // Filtered suppliers based on search text
  const filteredSuppliers = useMemo(() => {
    const query = supplierSearchText.trim().toLowerCase();
    if (!query) return suppliers;

    if (selectedSupplier && (query === selectedSupplier.name.toLowerCase() || query === `${selectedSupplier.name} (${selectedSupplier.code})`.toLowerCase())) {
      return suppliers;
    }

    return suppliers.filter(s => {
      const name = (s.name || '').toLowerCase();
      const code = (s.code || '').toLowerCase();
      const city = (s.city || '').toLowerCase();
      const phone = (s.phone || '').toLowerCase();
      return name.includes(query) || code.includes(query) || city.includes(query) || phone.includes(query);
    });
  }, [suppliers, supplierSearchText, selectedSupplier]);

  const handleSelectSupplier = (s: Supplier) => {
    setSelectedSupplierId(s.id);
    setSupplierSearchText(s.name);
    setShowSupplierDropdown(false);
    setItemTypeFilter(null);
    resetFilters();
  };

  const handleClearSupplier = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedSupplierId('');
    setSupplierSearchText('');
    setShowSupplierDropdown(true);
    setItemTypeFilter(null);
    resetFilters();
    setTimeout(() => supplierInputRef.current?.focus(), 50);
  };

  const handleSupplierKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSupplierDropdown) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setShowSupplierDropdown(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSupplierHighlightIndex(prev => (prev + 1 < filteredSuppliers.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSupplierHighlightIndex(prev => (prev - 1 >= 0 ? prev - 1 : filteredSuppliers.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredSuppliers.length > 0 && filteredSuppliers[supplierHighlightIndex]) {
        handleSelectSupplier(filteredSuppliers[supplierHighlightIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowSupplierDropdown(false);
      if (selectedSupplier) {
        setSupplierSearchText(selectedSupplier.name);
      }
    }
  };

  const loadSuppliers = async () => {
    try {
      const res = await api.get('/api/suppliers');
      setSuppliers(res.data || []);
    } catch (err) {
      console.error('Failed to load suppliers:', err);
    }
  };

  const loadClients = async () => {
    try {
      const res = await api.get('/api/clients');
      if (Array.isArray(res.data)) {
        setClientsList(res.data);
      }
    } catch (err) {
      console.error('Failed to load clients:', err);
    }
  };

  const loadMasterData = async () => {
    try {
      const res = await api.get('/api/master-data');
      if (res.data) {
        setMasterAttributes({
          BRAND: res.data.BRAND || [],
          QUALITY: res.data.QUALITY || [],
          SHADE: res.data.SHADE || [],
          ITEM_NAME: res.data.ITEM_NAME || [],
          FABRIC_TYPE: res.data.FABRIC_TYPE || [],
          ART_NO: res.data.ART_NO || [],
          ACCESSORY_CATEGORY: res.data.ACCESSORY_CATEGORY || [],
          CATEGORY: res.data.CATEGORY || ['SUITING', 'SHIRTING', 'PLAIN_SHIRTING'],
        });
      }
    } catch {}
  };

  // Close direct inward menus on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (directSupplierWrapperRef.current && !directSupplierWrapperRef.current.contains(e.target as Node)) {
        setShowDirectSupplierMenu(false);
      }
      if (directClientWrapperRef.current && !directClientWrapperRef.current.contains(e.target as Node)) {
        setShowDirectClientMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, []);

  // Filter clients for direct inward dropdown
  const filteredDirectClients = useMemo(() => {
    const q = directClientInput.trim().toLowerCase();
    if (!q) return clientsList.slice(0, 30);
    return clientsList.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.code && c.code.toLowerCase().includes(q)) ||
      (c.city && c.city.toLowerCase().includes(q)) ||
      (c.clientType && c.clientType.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [clientsList, directClientInput]);

  // Filter suppliers for direct inward dropdown
  const filteredDirectSuppliers = useMemo(() => {
    const q = directSupplierInput.trim().toLowerCase();
    if (!q) return suppliers.slice(0, 30);
    return suppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.code && s.code.toLowerCase().includes(q)) ||
      (s.city && s.city.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [suppliers, directSupplierInput]);

  const openDirectQuickAddSupplier = (initialName?: string) => {
    setQuickSupplierForm({
      name: initialName || directSupplierInput.trim() || '',
      contactPerson: '',
      phone: '',
      city: '',
      address: '',
    });
    setQuickSupplierError('');
    setShowQuickAddSupplierModal(true);
  };

  const handleDirectQuickAddSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickSupplierError('');
    if (!quickSupplierForm.name.trim()) {
      setQuickSupplierError('Supplier legal / mill name is required.');
      return;
    }

    setQuickSupplierSubmitting(true);
    try {
      const res = await api.post('/api/suppliers', {
        name: quickSupplierForm.name.trim(),
        contactPerson: quickSupplierForm.contactPerson.trim() || undefined,
        phone: quickSupplierForm.phone.trim() || undefined,
        city: quickSupplierForm.city.trim() || undefined,
        address: quickSupplierForm.address.trim() || undefined,
      });

      const newSup = res.data;
      setSuppliers(prev => [newSup, ...prev]);
      setDirectSupplierId(newSup.id);
      setDirectSupplierInput(newSup.name);
      setShowDirectSupplierMenu(false);
      setShowQuickAddSupplierModal(false);
      setQuickSupplierForm({ name: '', contactPerson: '', phone: '', city: '', address: '' });
    } catch (err: any) {
      setQuickSupplierError(err.response?.data?.error || 'Failed to save supplier details');
    } finally {
      setQuickSupplierSubmitting(false);
    }
  };

  const openDirectQuickAddClient = (initialName?: string) => {
    setQuickClientForm({
      name: initialName || directClientInput.trim() || '',
      clientType: '',
      contactPerson: '',
      phone: '',
      city: '',
      address: '',
      notes: ''
    });
    setQuickClientError('');
    setShowQuickAddClientModal(true);
  };

  const handleDirectQuickAddClientSubmit = async (e: React.FormEvent) => {
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
      setDirectSelectedClient(newCli);
      setDirectClientInput(newCli.name);
      setShowDirectClientMenu(false);
      setShowQuickAddClientModal(false);
      setQuickClientForm({ name: '', clientType: '', contactPerson: '', phone: '', city: '', address: '', notes: '' });
    } catch (err: any) {
      setQuickClientError(err.response?.data?.error || 'Failed to save client details');
    } finally {
      setQuickClientSubmitting(false);
    }
  };

  const loadPendingItems = async (supplierId: string) => {
    setLoadingPending(true);
    setInwardError('');
    try {
      const res = await api.get(`/api/purchase-orders/supplier-inbound/${supplierId}/pending`);
      setSupplierData(res.data);
    } catch (err: any) {
      console.error('Failed to load pending items:', err);
      setInwardError(err.response?.data?.error || 'Failed to fetch pending items for this supplier');
    } finally {
      setLoadingPending(false);
    }
  };

  const loadSessionRolls = async (supplierId?: string, invoice?: string) => {
    setLoadingSessionRolls(true);
    try {
      const params: any = {};
      if (supplierId) params.supplierId = supplierId;
      if (invoice) params.invoiceRef = invoice.trim();
      const res = await api.get('/api/purchase-orders/supplier-inbound/session-rolls', { params });
      setSessionRolls(res.data || []);
    } catch (err) {
      console.error('Failed to load session rolls:', err);
    } finally {
      setLoadingSessionRolls(false);
    }
  };

  const loadDiscrepancies = async (supplierId?: string, invoice?: string) => {
    try {
      const params: any = {};
      if (supplierId) params.supplierId = supplierId;
      if (invoice) params.invoiceRef = invoice.trim();
      const res = await api.get('/api/purchase-orders/supplier-inbound/discrepancies', { params });
      setDiscrepancies(res.data || []);
    } catch (err) {
      console.error('Failed to load discrepancies:', err);
    }
  };


  // Filter items by classification & column filters
  const filteredPendingItems = useMemo(() => {
    if (!supplierData || !itemTypeFilter) return [];
    let items = supplierData.pendingItems.filter(p => p.sku.itemType === itemTypeFilter);

    // Quick text search across all columns
    if (quickSearch.trim()) {
      const q = quickSearch.trim().toLowerCase();
      items = items.filter(p => {
        const s = p.sku;
        const brandMatch = (s.brand || '').toLowerCase().includes(q);
        const qualityMatch = (s.quality || '').toLowerCase().includes(q);
        const shadeMatch = (s.shade || '').toLowerCase().includes(q);
        const artNoMatch = (s.artNo || '').toLowerCase().includes(q);
        const nameMatch = (s.name || '').toLowerCase().includes(q);
        const catMatch = (s.category || '').toLowerCase().includes(q);
        const sizeMatch = (s.size || '').toLowerCase().includes(q);
        return brandMatch || qualityMatch || shadeMatch || artNoMatch || nameMatch || catMatch || sizeMatch;
      });
    }

    // Specific column filters
    if (itemTypeFilter === 'FABRIC') {
      if (fabricFilters.brand.trim()) {
        const b = fabricFilters.brand.trim().toLowerCase();
        items = items.filter(p => (p.sku.brand || '').toLowerCase().includes(b));
      }
      if (fabricFilters.quality.trim()) {
        const q = fabricFilters.quality.trim().toLowerCase();
        items = items.filter(p => (p.sku.quality || p.sku.category || '').toLowerCase().includes(q));
      }
      if (fabricFilters.shade.trim()) {
        const sh = fabricFilters.shade.trim().toLowerCase();
        items = items.filter(p => (p.sku.shade || '').toLowerCase().includes(sh));
      }
    } else if (itemTypeFilter === 'READY_MADE') {
      if (readyMadeFilters.artNo.trim()) {
        const a = readyMadeFilters.artNo.trim().toLowerCase();
        items = items.filter(p => (p.sku.artNo || '').toLowerCase().includes(a));
      }
      if (readyMadeFilters.fabricType.trim()) {
        const f = readyMadeFilters.fabricType.trim().toLowerCase();
        items = items.filter(p => (p.sku.category || p.sku.quality || '').toLowerCase().includes(f));
      }
      if (readyMadeFilters.size.trim()) {
        const sz = readyMadeFilters.size.trim().toLowerCase();
        items = items.filter(p => (p.sku.size || '').toLowerCase().includes(sz));
      }
      if (readyMadeFilters.shade.trim()) {
        const sh = readyMadeFilters.shade.trim().toLowerCase();
        items = items.filter(p => (p.sku.shade || '').toLowerCase().includes(sh));
      }
    } else if (itemTypeFilter === 'ACCESSORY') {
      if (accessoryFilters.category.trim()) {
        const c = accessoryFilters.category.trim().toLowerCase();
        items = items.filter(p => (p.sku.category || '').toLowerCase().includes(c));
      }
      if (accessoryFilters.name.trim()) {
        const n = accessoryFilters.name.trim().toLowerCase();
        items = items.filter(p => (p.sku.name || p.sku.brand || '').toLowerCase().includes(n));
      }
      if (accessoryFilters.size.trim()) {
        const sz = accessoryFilters.size.trim().toLowerCase();
        items = items.filter(p => (p.sku.size || '').toLowerCase().includes(sz));
      }
    }

    return items;
  }, [supplierData, itemTypeFilter, quickSearch, fabricFilters, readyMadeFilters, accessoryFilters]);

  // Counts by item type
  const countsByType = useMemo(() => {
    if (!supplierData) return { FABRIC: 0, READY_MADE: 0, ACCESSORY: 0 };
    return {
      FABRIC: supplierData.pendingItems.filter(p => p.sku.itemType === 'FABRIC').length,
      READY_MADE: supplierData.pendingItems.filter(p => p.sku.itemType === 'READY_MADE').length,
      ACCESSORY: supplierData.pendingItems.filter(p => p.sku.itemType === 'ACCESSORY').length,
    };
  }, [supplierData]);

  // Check if any filter is active
  const hasActiveFilters = Boolean(
    quickSearch.trim() ||
    fabricFilters.brand || fabricFilters.quality || fabricFilters.shade ||
    readyMadeFilters.artNo || readyMadeFilters.fabricType || readyMadeFilters.size || readyMadeFilters.shade ||
    accessoryFilters.category || accessoryFilters.name || accessoryFilters.size
  );

  const resetFilters = () => {
    setQuickSearch('');
    setFabricFilters({ brand: '', quality: '', shade: '' });
    setReadyMadeFilters({ artNo: '', fabricType: '', size: '', shade: '' });
    setAccessoryFilters({ category: '', name: '', size: '' });
  };

  // Click an item in the list -> open PO selection popout
  const handleSelectItem = (item: PendingItem) => {
    setSelectedItem(item);
    setSelectedPoOrder(item.openOrders.length > 0 ? item.openOrders[0] : null);
    setShowPoPopout(true);
  };

  // Open PO details preview right in a window modal
  const handleViewPo = async (poId: string, targetLineId?: string) => {
    setViewingPoId(poId);
    setViewingPoTargetLineId(targetLineId || null);
    setLoadingViewingPo(true);
    setViewingPoData(null);
    try {
      const res = await api.get(`/api/purchase-orders/${poId}`);
      setViewingPoData(res.data);
    } catch (err) {
      console.error('Failed to load PO:', err);
      alert('Failed to load purchase order details.');
      setViewingPoId(null);
    } finally {
      setLoadingViewingPo(false);
    }
  };

  const handleCloseViewPo = () => {
    setViewingPoId(null);
    setViewingPoData(null);
    setViewingPoTargetLineId(null);
  };

  const handleProceedToReceiveFromView = () => {
    if (!viewingPoData) return;
    const poId = viewingPoData.id;
    const invoiceQuery = invoiceRef.trim() ? `?invoiceRef=${encodeURIComponent(invoiceRef.trim())}` : '';
    handleCloseViewPo();
    setShowPoPopout(false);
    navigate(`/entry-gate/${poId}${invoiceQuery}`);
  };

  // Group all session rolls by bundle number
  const groupedSessionRolls = useMemo(() => {
    const map: Record<string, { bundleNumber: string; rolls: ReceivedRoll[]; totalQty: number }> = {};
    for (const r of sessionRolls) {
      const bKey = (r.supplierBundle || 'Unbundled / Loose').trim();
      if (!map[bKey]) {
        map[bKey] = { bundleNumber: bKey, rolls: [], totalQty: 0 };
      }
      map[bKey].rolls.push(r);
      map[bKey].totalQty += r.quantity;
    }
    return Object.values(map);
  }, [sessionRolls]);

  // Fast Roll Inward Submission
  const handleInwardRoll = async (e: React.FormEvent) => {
    e.preventDefault();
    setInwardError('');

    if (!selectedSupplierId) {
      setInwardError('Please select a delivering supplier first');
      return;
    }
    if (!selectedItem) {
      setInwardError('Please pick an item being inwarded');
      return;
    }
    const qty = parseFloat(rollQty);
    if (!qty || qty <= 0) {
      setInwardError('Please enter a valid physical quantity');
      return;
    }

    setInwardSubmitting(true);
    try {
      const res = await api.post('/api/purchase-orders/supplier-inbound/receive-roll', {
        supplierId: selectedSupplierId,
        brand: selectedItem.sku.brand || undefined,
        quality: selectedItem.sku.quality || undefined,
        shade: selectedItem.sku.shade || undefined,
        itemType: selectedItem.sku.itemType || 'FABRIC',
        category: selectedItem.sku.category || undefined,
        size: selectedItem.sku.size || undefined,
        name: selectedItem.sku.name || undefined,
        artNo: selectedItem.sku.artNo || undefined,
        quantity: qty,
        supplierBundle: activeBundleNo.trim() || undefined,
        invoiceRef: invoiceRef.trim() || undefined,
        targetPoLineId: selectedPoOrder?.lineId || undefined,
        allowUnlinked: !selectedPoOrder,
      });

      const { batchCode, matchedPo, unlinked } = res.data;

      setRecentBatch({
        batchCode,
        quantity: qty,
        uom: selectedItem.sku.uom || (itemTypeFilter === 'FABRIC' ? 'Meters' : 'Pcs'),
        bundleNumber: activeBundleNo.trim() || undefined,
        matchedPoNumber: matchedPo ? matchedPo.poNumber : (unlinked ? 'Direct Unlinked Stock' : undefined),
      });

      // Auto-print the roll label when enabled in Printer Settings
      await autoPrintReceivedLabel(batchCode);

      // Reset roll entry form fields while PRESERVING active bundle number
      setRollQty('');
      setMillPieceTag('');
      
      // Refresh pending items from supplier and session rolls
      const pendingRes = await api.get(`/api/purchase-orders/supplier-inbound/${selectedSupplierId}/pending`);
      setSupplierData(pendingRes.data);
      loadSessionRolls(selectedSupplierId, invoiceRef);

      // Keep current item updated with latest balance
      if (pendingRes.data?.pendingItems) {
        const refreshed = pendingRes.data.pendingItems.find((p: PendingItem) => p.sku.id === selectedItem.sku.id);
        if (refreshed) {
          setSelectedItem(refreshed);
          if (selectedPoOrder) {
            const updatedOrder = refreshed.openOrders.find((o: OpenOrderLine) => o.lineId === selectedPoOrder.lineId);
            if (updatedOrder) setSelectedPoOrder(updatedOrder);
          }
        }
      }

      // Keep keyboard focus on quantity input for the next roll
      setTimeout(() => qtyInputRef.current?.focus(), 150);
    } catch (err: any) {
      console.error('Failed to receive roll:', err);
      setInwardError(err.response?.data?.message || err.response?.data?.error || 'Failed to receive roll');
    } finally {
      setInwardSubmitting(false);
    }
  };

  // Open discrepancy modal
  const handleOpenDiscrepancyModal = () => {
    setDiscrepancyForm({
      bundleNumber: activeBundleNo.trim(),
      itemKey: selectedItem?.sku.id || '',
      itemType: selectedItem?.sku.itemType || 'FABRIC',
      brand: selectedItem?.sku.brand || '',
      quality: selectedItem?.sku.quality || '',
      shade: selectedItem?.sku.shade || '',
      category: selectedItem?.sku.category || '',
      name: selectedItem?.sku.name || '',
      artNo: selectedItem?.sku.artNo || '',
      size: selectedItem?.sku.size || '',
      issueType: 'MISSING_FROM_BUNDLE',
      expectedQty: selectedPoOrder ? String(selectedPoOrder.remainingQty) : (selectedItem ? String(selectedItem.totalRemainingQty) : ''),
      receivedQty: '0',
      notes: ''
    });
    setShowDiscrepancyModal(true);
  };

  // Submit discrepancy report
  const handleSaveDiscrepancy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId) {
      alert('Please select a supplier first.');
      return;
    }

    setDiscrepancySubmitting(true);
    try {
      await api.post('/api/purchase-orders/supplier-inbound/discrepancies', {
        supplierId: selectedSupplierId,
        invoiceRef: invoiceRef.trim() || 'INBOUND',
        bundleNumber: discrepancyForm.bundleNumber.trim() || 'Unbundled',
        itemType: discrepancyForm.itemType,
        brand: discrepancyForm.brand || undefined,
        quality: discrepancyForm.quality || undefined,
        shade: discrepancyForm.shade || undefined,
        category: discrepancyForm.category || undefined,
        name: discrepancyForm.name || undefined,
        artNo: discrepancyForm.artNo || undefined,
        size: discrepancyForm.size || undefined,
        issueType: discrepancyForm.issueType,
        expectedQty: discrepancyForm.expectedQty ? parseFloat(discrepancyForm.expectedQty) : undefined,
        receivedQty: discrepancyForm.receivedQty ? parseFloat(discrepancyForm.receivedQty) : 0,
        notes: discrepancyForm.notes.trim() || undefined,
      });

      setShowDiscrepancyModal(false);
      loadDiscrepancies(selectedSupplierId, invoiceRef);
      alert('Discrepancy recorded. It will be included on the GRN shortage records.');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to record discrepancy');
    } finally {
      setDiscrepancySubmitting(false);
    }
  };

  const handleDeleteDiscrepancy = async (id: string) => {
    if (!window.confirm('Delete this discrepancy record?')) return;
    try {
      await api.delete(`/api/purchase-orders/supplier-inbound/discrepancies/${id}`);
      loadDiscrepancies(selectedSupplierId, invoiceRef);
    } catch (err) {
      console.error(err);
    }
  };

  // Invoice and client from General Information, sent with every direct-inward lump
  const directCommonFields = () => ({
    invoiceRef: directInvoiceRef.trim() || undefined,
    clientId: directSelectedClient?.id || undefined,
    clientName: directClientInput.trim() || undefined,
  });

  // Saves one direct-inward lump as a batch, adds it to the session and prints its label
  const saveDirectBatch = async (payload: any) => {
    const res = await api.post('/api/batches', payload);
    const batch = res.data;
    setDirectSessionBatches(prev => [batch, ...prev]);
    setRecentBatch({
      batchCode: batch.batchCode,
      quantity: batch.quantity,
      uom: batch.uom || (payload.itemType === 'FABRIC' ? 'Meters' : 'Pcs'),
      bundleNumber: payload.supplierBundle,
      matchedPoNumber: 'Direct Inward',
    });
    // Auto-print the label when enabled in Printer Settings
    await autoPrintReceivedLabel(batch.batchCode);
    return batch;
  };

  // One lump of an imported Excel line
  const inwardImportedLump = async (line: ImportLine, quantity: number, bundle: string) => {
    if (!directSupplierInput.trim()) throw new Error('Please enter or select a delivering Supplier first.');
    try {
      await saveDirectBatch({ ...lumpPayload(line, quantity, bundle), ...directCommonFields() });
    } catch (err: any) {
      console.error('Direct Inward import lump error:', err);
      throw new Error(err.response?.data?.error || 'Failed to inward this lump');
    }
  };

  // ── Direct Inward draft ──
  // Restore the user's unfinished work the first time the desk opens
  useEffect(() => {
    if (activeTab !== 'DIRECT' || draftLoaded) return;
    let cancelled = false;
    api.get('/api/direct-inward/draft')
      .then(({ data }) => {
        if (cancelled || !data.draft) return;
        const d = data.draft.data as DirectInwardDraftData;
        draftOnServer.current = true;
        setDirectSupplierInput(d.supplierName ?? '');
        setDirectSupplierId(d.supplierId ?? '');
        setDirectInvoiceRef(d.invoiceRef ?? '');
        if (d.invoiceDate) setDirectInvoiceDate(d.invoiceDate);
        setDirectClientInput(d.clientName ?? '');
        setDirectSelectedClient(d.clientId ? { id: d.clientId, name: d.clientName } : null);
        setDirectInfoConfirmed(!!d.infoConfirmed);
        setDirectClassification(d.itemType ?? null);
        setDirectEntryMode(d.entryMode ?? null);
        setImportLines(Array.isArray(d.importLines) ? d.importLines : []);
        setDirectSessionBatches(Array.isArray(d.sessionBatches) ? d.sessionBatches : []);
        setDraftRestored({
          savedAt: data.draft.updatedAt,
          items: (d.importLines ?? []).filter(l => remainingQty(l) > 0).length,
          lumps: (d.sessionBatches ?? []).length,
        });
      })
      .catch(err => {
        console.error('Could not load the Direct Inward draft:', err);
        if (!cancelled) setDraftSyncBroken(true);
      })
      .finally(() => { if (!cancelled) setDraftLoaded(true); });
    return () => { cancelled = true; };
  }, [activeTab, draftLoaded]);

  // Keep the draft saved while there is work to keep (imported items or lumps not yet on a GRN)
  useEffect(() => {
    if (!draftLoaded || draftSyncBroken) return;
    const hasWork = importLines.length > 0 || directSessionBatches.length > 0;
    if (!hasWork && !draftOnServer.current) return;
    const data: DirectInwardDraftData = {
      supplierId: directSupplierId || null,
      supplierName: directSupplierInput,
      invoiceRef: directInvoiceRef,
      invoiceDate: directInvoiceDate,
      clientId: directSelectedClient?.id ?? null,
      clientName: directClientInput,
      infoConfirmed: directInfoConfirmed,
      itemType: directClassification,
      entryMode: directEntryMode,
      importLines,
      sessionBatches: directSessionBatches.map(b => ({ id: b.id })),
    };
    const save = () => {
      pendingDraftSave.current = null;
      const request = hasWork
        ? api.put('/api/direct-inward/draft', { data }).then(() => { draftOnServer.current = true; })
        : api.delete('/api/direct-inward/draft').then(() => { draftOnServer.current = false; });
      request.catch(err => console.error('Could not save the Direct Inward draft:', err));
    };
    pendingDraftSave.current = save;
    const timer = setTimeout(save, 600);
    return () => clearTimeout(timer);
  }, [draftLoaded, draftSyncBroken, importLines, directSessionBatches, directSupplierId, directSupplierInput, directInvoiceRef,
      directInvoiceDate, directSelectedClient, directClientInput, directInfoConfirmed, directClassification, directEntryMode]);

  // Leaving the page must not drop a save that is still waiting
  useEffect(() => () => { pendingDraftSave.current?.(); }, []);

  const confirmDirectInfo = () => {
    if (!directSupplierInput.trim()) {
      setDirectInfoError('Select or enter the delivering supplier to continue.');
      return;
    }
    setDirectInfoError('');
    setShowDirectSupplierMenu(false);
    setShowDirectClientMenu(false);
    setDirectInfoConfirmed(true);
  };

  // Direct Inward Item Inwarding Handler
  const handleInwardDirectItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setDirectItemError('');

    if (!directSupplierInput.trim()) {
      setDirectItemError('Please enter or select a delivering Supplier.');
      return;
    }
    if (!directClassification) return;

    let payload: any = {
      itemType: directClassification,
      ...directCommonFields(),
    };

    if (directClassification === 'FABRIC') {
      const meters = parseFloat(directItemForm.meters);
      if (!meters || meters <= 0) {
        setDirectItemError('Please enter a valid meter quantity.');
        return;
      }
      if (!directItemForm.brand.trim()) {
        setDirectItemError('Fabric Brand is required.');
        return;
      }
      if (!directItemForm.quality.trim()) {
        setDirectItemError('Quality is required.');
        return;
      }
      if (!directItemForm.shade.trim()) {
        setDirectItemError('Shade / Color is required.');
        return;
      }

      payload = {
        ...payload,
        category: directItemForm.category,
        brand: directItemForm.brand.trim(),
        quality: directItemForm.quality.trim(),
        shade: directItemForm.shade.trim(),
        quantity: meters,
        uom: 'METERS',
        supplierBundle: directItemForm.bundleNumber.trim() || undefined,
        notes: directItemForm.notes.trim() || undefined,
      };
    } else if (directClassification === 'READY_MADE') {
      const pieces = parseFloat(directItemForm.rmQty);
      if (!pieces || pieces <= 0 || !Number.isInteger(pieces)) {
        setDirectItemError('Please enter a whole number of pieces.');
        return;
      }
      if (!directItemForm.rmName.trim()) {
        setDirectItemError('Item Name is required.');
        return;
      }
      if (!directItemForm.rmArtNo.trim()) {
        setDirectItemError('Art No is required.');
        return;
      }
      if (!directItemForm.rmSize.trim()) {
        setDirectItemError('Size is required.');
        return;
      }

      payload = {
        ...payload,
        name: directItemForm.rmName.trim(),
        category: directItemForm.rmFabricType.trim() || undefined,
        shade: directItemForm.rmShade.trim() || undefined,
        artNo: directItemForm.rmArtNo.trim().toUpperCase(),
        size: directItemForm.rmSize.trim(),
        quantity: pieces,
        uom: 'PCS',
        supplierBundle: directItemForm.rmBundleNumber.trim() || undefined,
        notes: directItemForm.notes.trim() || undefined,
      };
    } else {
      // ACCESSORY
      const qty = parseFloat(directItemForm.accQuantity);
      if (!qty || qty <= 0) {
        setDirectItemError('Please enter a valid quantity.');
        return;
      }
      if (!directItemForm.accCategory.trim()) {
        setDirectItemError('Accessory Category is required.');
        return;
      }
      if (!directItemForm.accItemName.trim()) {
        setDirectItemError('Accessory Item Name is required.');
        return;
      }

      payload = {
        ...payload,
        category: directItemForm.accCategory.trim(),
        name: directItemForm.accItemName.trim(),
        brand: directItemForm.accCategory.trim(),
        size: directItemForm.specSize.trim() || undefined,
        shade: directItemForm.accShade.trim() || undefined,
        quantity: qty,
        uom: directItemForm.uom || 'PCS',
        supplierBundle: directItemForm.accBundleNumber.trim() || undefined,
        notes: directItemForm.notes.trim() || undefined,
      };
    }

    setDirectSubmittingItem(true);
    try {
      await saveDirectBatch(payload);

      // Reset quantity, retaining bundle number for fast entry
      setDirectItemForm(prev => ({
        ...prev,
        meters: '',
        rmQty: '',
        accQuantity: '',
        notes: '',
      }));
    } catch (err: any) {
      console.error('Direct Inward item error:', err);
      setDirectItemError(err.response?.data?.error || 'Failed to inward item');
    } finally {
      setDirectSubmittingItem(false);
    }
  };

  // Direct GRN Finalization Handler
  const handleFinalizeDirectGrn = async () => {
    if (!directSessionBatches || directSessionBatches.length === 0) {
      alert('No items in the current direct inward session to issue GRN.');
      return;
    }

    setIssuingDirectGrn(true);
    try {
      const res = await api.post('/api/grn', {
        supplierId: directSupplierId || undefined,
        supplierName: directSupplierInput.trim() || 'Direct Inward Supplier',
        invoiceRef: directInvoiceRef.trim() || undefined,
        invoiceDate: directInvoiceDate || undefined,
        remarks: directGrnRemarks.trim() || undefined,
        batchIds: directSessionBatches.map(b => b.id),
      });

      const newGrn = res.data;
      setDirectGrnSuccess(newGrn);
      setShowDirectGrnModal(false);
      printGrnVoucher(newGrn.id);
      setDirectSessionBatches([]);
      setDirectGrnRemarks('');
      // Fully received imported items are done; partly received ones stay for the next lumps
      setImportLines(prev => prev.filter(l => remainingQty(l) > 0));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to finalize Direct Inward GRN');
    } finally {
      setIssuingDirectGrn(false);
    }
  };

  const printLabel = async (batchCode: string) => {
    try {
      await printTSPL(batchCode);
      alert(`Label for ${batchCode} sent to thermal barcode printer!`);
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || 'Failed to print label. Please check printer IP in Settings.');
      console.error(err);
    }
  };

  const previewLabel = (batchCode: string) => {
    window.open(`/api/labels/preview/${batchCode}`, '_blank');
  };

  const totalSessionQuantity = sessionRolls.reduce((sum, r) => sum + r.quantity, 0);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', paddingBottom: 60 }}>

      {/* ─────────────────────────────────────────────────────────────────────────────
          1. OPTION SELECTION SCREEN (PROMPT WITH 3 CLEAN CARDS)
          ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'SELECT_MODE' && (
        <div style={{ padding: '24px 0' }}>
          <div style={{ marginBottom: 28, textAlign: 'center' }}>
            <h1 className="page-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 24 }}>
              <LogIn size={28} /> Stock In
            </h1>
            <p className="page-subtitle" style={{ fontSize: 14, marginTop: 4 }}>
              Select an inbound receiving method to proceed
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 20,
            maxWidth: 1000,
            margin: '0 auto'
          }}>
            {/* Option 1: Supplier Inbound */}
            <div
              className="card"
              onClick={() => {
                setActiveTab('SUPPLIER_INBOUND');
                setInwardStep('ITEMS_LIST');
                setItemTypeFilter(null);
              }}
              style={{
                padding: 28,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                border: '1.5px solid var(--color-border)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-brand)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
            >
              <div>
                <div style={{
                  width: 54,
                  height: 54,
                  borderRadius: 'var(--radius)',
                  background: 'var(--color-brand-faded)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16
                }}>
                  <Truck size={28} color="var(--color-brand)" />
                </div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--color-text-main)' }}>
                  Supplier Inbound
                </h2>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                  Receive shipments against open purchase orders with easy item and order matching.
                </p>
              </div>

              <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-brand)', fontWeight: 700, fontSize: 13 }}>
                Open Inbound Desk <ArrowRight size={16} />
              </div>
            </div>

            {/* Option 2: Scan PO Barcode */}
            <div
              className="card"
              onClick={() => setActiveTab('PO_SCAN')}
              style={{
                padding: 28,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                border: '1.5px solid var(--color-border)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-brand)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
            >
              <div>
                <div style={{
                  width: 54,
                  height: 54,
                  borderRadius: 'var(--radius)',
                  background: 'var(--color-brand-faded)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16
                }}>
                  <ScanLine size={28} color="var(--color-brand)" />
                </div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--color-text-main)' }}>
                  Scan PO Barcode
                </h2>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                  Point your barcode scanner or enter a specific Purchase Order number to open order details.
                </p>
              </div>

              <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-brand)', fontWeight: 700, fontSize: 13 }}>
                Open PO Scanner <ArrowRight size={16} />
              </div>
            </div>

            {/* Option 3: Direct Inward */}
            <div
              className="card"
              onClick={() => setActiveTab('DIRECT')}
              style={{
                padding: 28,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                border: '1.5px solid var(--color-border)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-brand)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
            >
              <div>
                <div style={{
                  width: 54,
                  height: 54,
                  borderRadius: 'var(--radius)',
                  background: 'var(--color-brand-faded)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16
                }}>
                  <Plus size={28} color="var(--color-brand)" />
                </div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--color-text-main)' }}>
                  Direct Inward
                </h2>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                  Receive buffer, sample, or excess rolls directly into warehouse inventory without a PO.
                </p>
              </div>

              <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-brand)', fontWeight: 700, fontSize: 13 }}>
                Open Direct Entry <ArrowRight size={16} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TOP BACK BAR (WHEN INSIDE A WORKFLOW) ── */}
      {activeTab !== 'SELECT_MODE' && (
        <div style={{ marginBottom: 16 }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setActiveTab('SELECT_MODE');
              setItemTypeFilter(null);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: 13, color: 'var(--color-text-muted)' }}
          >
            <ArrowLeft size={16} /> Back to Stock In Options
          </button>
        </div>
      )}

      {/* ── RECENT BATCH NOTIFICATION BANNER ── */}
      {recentBatch && (
        <div style={{
          background: '#ecfdf5',
          border: '1px solid #a7f3d0',
          borderRadius: 'var(--radius)',
          padding: '12px 18px',
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={20} color="#059669" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#065f46' }}>
                Inward Successful: <span style={{ fontFamily: 'monospace', fontSize: 14 }}>{recentBatch.batchCode}</span> ({recentBatch.quantity} {recentBatch.uom})
                {recentBatch.bundleNumber && <span style={{ marginLeft: 8, fontSize: 12, background: '#d1fae5', padding: '1px 7px', borderRadius: 4 }}>Bundle: {recentBatch.bundleNumber}</span>}
              </div>
              <div style={{ fontSize: 12, color: '#047857' }}>
                {recentBatch.matchedPoNumber ? `Allocated to: ${recentBatch.matchedPoNumber}` : 'Recorded in inventory'} • Label sent to printer
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => previewLabel(recentBatch.batchCode)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', border: '1px solid #a7f3d0' }}>
              <Eye size={14} /> Preview Label
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => printLabel(recentBatch.batchCode)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Printer size={14} /> Reprint Label
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          2. SUPPLIER INBOUND MODE
          ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'SUPPLIER_INBOUND' && (
        <>
          {/* Top Header Card: Supplier & Optional Invoice */}
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building2 size={18} color="var(--color-brand)" />
                <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Supplier Inbound</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {supplierData && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                    {supplierData.totalOpenPOs} Open Orders Pending
                  </span>
                )}
              </div>
            </div>

            {/* Searchable Supplier Combobox Input */}
            <div ref={supplierDropdownRef} style={{ position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0, fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
                  Delivering Supplier <span className="required">*</span>
                </label>
                {selectedSupplier && (
                  <span style={{ 
                    fontSize: 11.5, 
                    color: '#6B21A8', 
                    background: '#f5f3ff', 
                    border: '1.5px solid #ddd6fe',
                    padding: '2px 9px', 
                    borderRadius: 5, 
                    fontWeight: 700, 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    gap: 5 
                  }}>
                    <Check size={13} strokeWidth={2.5} /> {selectedSupplier.code} Active
                  </span>
                )}
              </div>

              {/* Text Input Container with Crisp Dark & Purple Border */}
              <div style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                background: '#ffffff',
                border: showSupplierDropdown ? '2px solid #6B21A8' : '1.5px solid #18181b',
                borderRadius: 8,
                boxShadow: showSupplierDropdown ? '0 0 0 3px rgba(107, 33, 168, 0.16)' : '0 1px 2px rgba(0,0,0,0.04)',
                transition: 'all 0.15s ease'
              }}>
                <div style={{
                  paddingLeft: 12,
                  display: 'flex',
                  alignItems: 'center',
                  color: '#6B21A8',
                  pointerEvents: 'none'
                }}>
                  <Building2 size={18} />
                </div>

                <input
                  ref={supplierInputRef}
                  type="text"
                  className="form-input"
                  value={supplierSearchText}
                  onChange={e => {
                    const val = e.target.value;
                    setSupplierSearchText(val);
                    setShowSupplierDropdown(true);
                    setSupplierHighlightIndex(0);
                    if (!val.trim()) {
                      setSelectedSupplierId('');
                    }
                  }}
                  onFocus={e => {
                    setShowSupplierDropdown(true);
                    if (selectedSupplier) {
                      e.target.select();
                    }
                  }}
                  onClick={() => setShowSupplierDropdown(true)}
                  onKeyDown={handleSupplierKeyDown}
                  placeholder="Type to search supplier by name, code, city... (or tap to browse)"
                  style={{
                    border: 'none',
                    boxShadow: 'none',
                    height: 44,
                    paddingLeft: 10,
                    paddingRight: (supplierSearchText || selectedSupplierId) ? 72 : 44,
                    fontSize: 14,
                    fontWeight: 600,
                    width: '100%',
                    background: 'transparent',
                    color: '#0f172a'
                  }}
                  autoComplete="off"
                  autoFocus
                />

                {/* Right Action Icons: Clear Button + Dropdown Chevron */}
                <div style={{ position: 'absolute', right: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {(supplierSearchText || selectedSupplierId) && (
                    <button
                      type="button"
                      onClick={handleClearSupplier}
                      style={{
                        border: '1px solid #ddd6fe',
                        background: '#f5f3ff',
                        padding: 5,
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6B21A8',
                        width: 26,
                        height: 26,
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = '#ede9fe';
                        (e.currentTarget as HTMLElement).style.color = '#4c1d95';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = '#f5f3ff';
                        (e.currentTarget as HTMLElement).style.color = '#6B21A8';
                      }}
                      title="Clear supplier"
                    >
                      <X size={14} strokeWidth={2.5} />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowSupplierDropdown(prev => !prev);
                      if (!showSupplierDropdown) {
                        supplierInputRef.current?.focus();
                      }
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 6,
                      borderRadius: 6,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: showSupplierDropdown ? '#6B21A8' : '#18181b'
                    }}
                    title="Toggle supplier list"
                  >
                    <ChevronDown
                      size={18}
                      style={{
                        transition: 'transform 0.2s ease',
                        transform: showSupplierDropdown ? 'rotate(180deg)' : 'none'
                      }}
                    />
                  </button>
                </div>
              </div>

              {/* Floating Rich Dropdown Popover with Crisp Purple Border */}
              {showSupplierDropdown && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  background: '#ffffff',
                  borderRadius: 10,
                  border: '2px solid #6B21A8',
                  boxShadow: '0 16px 36px -4px rgba(107, 33, 168, 0.16), 0 8px 16px -2px rgba(15, 23, 42, 0.12)',
                  maxHeight: 320,
                  overflowY: 'auto'
                }}>
                  {/* Dropdown Header with Purple Theme */}
                  <div style={{
                    padding: '9px 14px',
                    background: '#faf5ff',
                    borderBottom: '1.5px solid #e9d5ff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#6B21A8',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>Suppliers</span>
                      <span style={{
                        background: '#6B21A8',
                        color: '#ffffff',
                        padding: '1px 6px',
                        borderRadius: 10,
                        fontSize: 10.5,
                        fontWeight: 700
                      }}>
                        {filteredSuppliers.length}
                      </span>
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#7c3aed', textTransform: 'none' }}>
                      Type to filter · Tap to select
                    </span>
                  </div>

                  {filteredSuppliers.length === 0 ? (
                    <div style={{ padding: '28px 16px', textAlign: 'center', color: '#6B21A8' }}>
                      <Building2 size={34} color="#a855f7" style={{ marginBottom: 8, opacity: 0.7 }} />
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#18181b' }}>
                        No suppliers found
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
                        No registered supplier matches "{supplierSearchText}"
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          setSupplierSearchText('');
                          supplierInputRef.current?.focus();
                        }}
                        style={{ marginTop: 14, height: 34, fontSize: 12, fontWeight: 700, borderColor: '#6B21A8', color: '#6B21A8' }}
                      >
                        Show All Suppliers ({suppliers.length})
                      </button>
                    </div>
                  ) : (
                    filteredSuppliers.map((s, index) => {
                      const isSelected = selectedSupplierId === s.id;
                      const isHighlighted = supplierHighlightIndex === index;
                      const badgeLabel = (s.code || s.name.substring(0, 3)).toUpperCase();

                      return (
                        <div
                          key={s.id}
                          onClick={() => handleSelectSupplier(s)}
                          onMouseEnter={() => setSupplierHighlightIndex(index)}
                          style={{
                            padding: '12px 14px',
                            borderBottom: '1px solid #f3e8ff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            background: isSelected 
                              ? '#f3e8ff' 
                              : isHighlighted 
                                ? '#faf5ff' 
                                : '#ffffff',
                            borderLeft: isSelected 
                              ? '4px solid #6B21A8' 
                              : isHighlighted 
                                ? '4px solid #a855f7' 
                                : '4px solid transparent',
                            transition: 'all 0.12s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                            {/* Supplier Initials Badge */}
                            <div style={{
                              width: 38,
                              height: 38,
                              borderRadius: 8,
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 800,
                              fontSize: 11.5,
                              letterSpacing: '0.4px',
                              background: isSelected ? '#6B21A8' : '#f5f3ff',
                              color: isSelected ? '#ffffff' : '#6B21A8',
                              border: isSelected ? 'none' : '1.5px solid #ddd6fe'
                            }}>
                              {badgeLabel.slice(0, 4)}
                            </div>

                            {/* Supplier Details */}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ 
                                fontWeight: 700, 
                                fontSize: 13.5, 
                                color: isSelected ? '#4C1D95' : '#0f172a',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}>
                                {s.name}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#6B7280', marginTop: 2, flexWrap: 'wrap' }}>
                                <span style={{ 
                                  fontFamily: 'monospace', 
                                  fontWeight: 700, 
                                  background: '#f5f3ff', 
                                  padding: '1px 6px', 
                                  borderRadius: 4, 
                                  color: '#6B21A8',
                                  border: '1px solid #ddd6fe' 
                                }}>
                                  {s.code}
                                </span>
                                {s.city && (
                                  <span style={{ color: '#4b5563', fontWeight: 500 }}>• {s.city}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Selection Indicator */}
                          {isSelected ? (
                            <div style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: 5, 
                              background: '#6B21A8', 
                              color: '#ffffff', 
                              padding: '4px 10px', 
                              borderRadius: 6, 
                              fontSize: 11.5, 
                              fontWeight: 700,
                              flexShrink: 0,
                              boxShadow: '0 2px 4px rgba(107, 33, 168, 0.25)'
                            }}>
                              <Check size={14} strokeWidth={2.5} /> Selected
                            </div>
                          ) : (
                            <div style={{ 
                              fontSize: 11.5, 
                              fontWeight: 700, 
                              color: isHighlighted ? '#6B21A8' : '#9ca3af', 
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4
                            }}>
                              Select <ArrowRight size={13} />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Discrepancies Alert Banner if any recorded for this delivery */}
            {discrepancies.length > 0 && (
              <div style={{
                marginTop: 14,
                padding: '10px 14px',
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                borderRadius: 'var(--radius)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={18} color="#b45309" />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#92400e' }}>
                    {discrepancies.length} Discrepancy Notice(s) Recorded
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {discrepancies.map(d => (
                    <span key={d.id} style={{ fontSize: 11, background: '#fef3c7', padding: '2px 8px', borderRadius: 4, border: '1px solid #fde68a', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {d.bundleNumber ? <strong>{d.bundleNumber}: </strong> : null}
                      {d.name || [d.brand, d.shade].filter(Boolean).join(' ') || 'Item'}
                      <button onClick={() => handleDeleteDiscrepancy(d.id)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: '#991b1b' }}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Loading Pending State */}
          {loadingPending ? (
            <div className="loading-center" style={{ padding: 60 }}><span className="spinner spinner-lg" /></div>
          ) : !selectedSupplierId ? (
            <div style={{ background: '#fff', padding: 60, borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <Truck size={48} style={{ opacity: 0.35, marginBottom: 16 }} />
              <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 6px 0', color: 'var(--color-text-main)' }}>Select a Supplier Above</h3>
              <p style={{ fontSize: 13, margin: 0 }}>
                The system will automatically load open purchase orders and pending items.
              </p>
            </div>
          ) : !itemTypeFilter ? (
            /* ─────────────────────────────────────────────────────────────────────────
               CATEGORY SELECTION: FABRIC, READY-MADE, ACCESSORIES
               ───────────────────────────────────────────────────────────────────────── */
            <div style={{ padding: '6px 0' }}>
              <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px 0', color: 'var(--color-text-main)' }}>
                    Select Item Category
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
                    Select a category to view and inward ordered items for {supplierData?.supplier?.name || 'this supplier'}:
                  </p>
                </div>
                {supplierData && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', background: 'var(--color-bg-subtle)', padding: '5px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}>
                    Pending Orders: <strong>{supplierData.totalOpenPOs} POs</strong> ({supplierData.pendingItems.length} SKUs Total)
                  </span>
                )}
              </div>



              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 20
              }}>
                {/* 1. Fabric */}
                <div
                  className="card"
                  onClick={() => {
                    setItemTypeFilter('FABRIC');
                    resetFilters();
                  }}
                  style={{
                    padding: 24,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: '1.5px solid var(--color-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: '#ffffff'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--color-brand)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 'var(--radius)',
                        background: 'var(--color-brand-faded)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Layers size={24} color="var(--color-brand)" />
                      </div>
                      <span className="badge badge-brand" style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px' }}>
                        {countsByType.FABRIC} {countsByType.FABRIC === 1 ? 'Item' : 'Items'} Pending
                      </span>
                    </div>

                    <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--color-text-main)' }}>
                      Fabric
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                      Suiting, shirting, drill cotton, denim & bottom weight rolls measured in meters.
                    </p>
                  </div>

                  <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-brand)', fontWeight: 700, fontSize: 13 }}>
                    List Fabric Items <ArrowRight size={15} />
                  </div>
                </div>

                {/* 2. Ready-Made */}
                <div
                  className="card"
                  onClick={() => {
                    setItemTypeFilter('READY_MADE');
                    resetFilters();
                  }}
                  style={{
                    padding: 24,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: '1.5px solid var(--color-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: '#ffffff'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--color-brand)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 'var(--radius)',
                        background: 'var(--color-brand-faded)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Shirt size={24} color="var(--color-brand)" />
                      </div>
                      <span className="badge badge-brand" style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px' }}>
                        {countsByType.READY_MADE} {countsByType.READY_MADE === 1 ? 'Item' : 'Items'} Pending
                      </span>
                    </div>

                    <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--color-text-main)' }}>
                      Ready-Made
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                      Finished uniform garments, shirts, trousers, skirts, blazers & tracksuits by Art No & Size.
                    </p>
                  </div>

                  <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-brand)', fontWeight: 700, fontSize: 13 }}>
                    List Ready-Made Items <ArrowRight size={15} />
                  </div>
                </div>

                {/* 3. Accessories */}
                <div
                  className="card"
                  onClick={() => {
                    setItemTypeFilter('ACCESSORY');
                    resetFilters();
                  }}
                  style={{
                    padding: 24,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: '1.5px solid var(--color-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: '#ffffff'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--color-brand)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 'var(--radius)',
                        background: 'var(--color-brand-faded)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Boxes size={24} color="var(--color-brand)" />
                      </div>
                      <span className="badge badge-brand" style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px' }}>
                        {countsByType.ACCESSORY} {countsByType.ACCESSORY === 1 ? 'Item' : 'Items'} Pending
                      </span>
                    </div>

                    <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--color-text-main)' }}>
                      Accessories
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                      School ties, leather & nylon belts, socks, crest badges, logos, buttons & footwear.
                    </p>
                  </div>

                  <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-brand)', fontWeight: 700, fontSize: 13 }}>
                    List Accessory Items <ArrowRight size={15} />
                  </div>
                </div>
              </div>
            </div>
          ) : inwardStep === 'ITEMS_LIST' ? (
            /* ─────────────────────────────────────────────────────────────────────────
               STEP A: ORDERED ITEMS LIST WITH EASY COLUMN FILTERING
               ───────────────────────────────────────────────────────────────────────── */
            <div className="card" style={{ padding: 20 }}>
              {/* Active Delivery Session Banner (if rolls have been inwarded) */}
              {sessionRolls.length > 0 && (
                <div style={{
                  background: isPartialReceiving ? '#fffbeb' : '#f0fdf4',
                  border: isPartialReceiving ? '1.5px solid #fcd34d' : '1.5px solid #86efac',
                  borderRadius: 'var(--radius)',
                  padding: '12px 18px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileCheck size={20} color={isPartialReceiving ? '#b45309' : '#16a34a'} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0f172a' }}>
                        Current Delivery Session: {sessionRolls.length} rolls ({totalSessionQuantity.toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'Meters' : 'Units'}) Inwarded
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {isPartialReceiving ? (
                          <span style={{ color: '#b45309', fontWeight: 600 }}>
                            Partial Delivery — {(supplierData?.totalPendingQty ?? 0).toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'm' : 'units'} pending on open PO(s). You can finalize this partial GRN now and do the rest later.
                          </span>
                        ) : (
                          <span style={{ color: '#059669', fontWeight: 600 }}>
                            Full Delivery — All ordered PO items 100% fulfilled in this session.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowGrnModal(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, padding: '7px 16px' }}
                  >
                    <Printer size={15} /> {isPartialReceiving ? 'Finalize Partial GRN & Print' : 'Finalize GRN & Print'}
                  </button>
                </div>
              )}
              
              {/* Classification Navigation & Tabs */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 16,
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: 12
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      setItemTypeFilter(null);
                      resetFilters();
                    }}
                    style={{ height: 36, fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <ArrowLeft size={14} /> Back to Categories
                  </button>

                  <div style={{ height: 20, width: 1, background: 'var(--color-border)' }} />

                  <div style={{ display: 'flex', gap: 6 }}>
                    {(
                      [
                        { id: 'FABRIC', label: 'Fabric', count: countsByType.FABRIC, icon: Layers },
                        { id: 'READY_MADE', label: 'Ready-Made', count: countsByType.READY_MADE, icon: Shirt },
                        { id: 'ACCESSORY', label: 'Accessories', count: countsByType.ACCESSORY, icon: Boxes },
                      ] as const
                    ).map(tab => {
                      const Icon = tab.icon;
                      const isSel = itemTypeFilter === tab.id;
                      return (
                        <button
                          type="button"
                          key={tab.id}
                          className={`btn btn-sm ${isSel ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => {
                            setItemTypeFilter(tab.id);
                            resetFilters();
                          }}
                          style={{ height: 36, fontSize: 12.5, fontWeight: isSel ? 700 : 500, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Icon size={14} />
                          {tab.label}
                          <span style={{
                            fontSize: 11,
                            padding: '1px 6px',
                            borderRadius: 10,
                            background: isSel ? 'rgba(255,255,255,0.25)' : 'var(--color-bg-subtle)',
                            color: isSel ? '#fff' : 'var(--color-text-main)',
                            fontWeight: 700
                          }}>
                            {tab.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={resetFilters}
                    style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-text-muted)' }}
                  >
                    <RotateCcw size={13} /> Reset Filters
                  </button>
                )}
              </div>

              {/* Column Filters Bar */}
              <div style={{
                background: '#f8fafc',
                padding: '12px 14px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--color-border)',
                marginBottom: 16
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Filter size={14} color="var(--color-brand)" />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-main)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Quick Column Filters (Type What You Know)
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  {/* General Search Input */}
                  <div>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Search All Columns..."
                      value={quickSearch}
                      onChange={e => setQuickSearch(e.target.value)}
                      style={{ height: 36, fontSize: 12.5 }}
                    />
                  </div>

                  {/* Fabric Column Filters */}
                  {itemTypeFilter === 'FABRIC' && (
                    <>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Brand"
                          value={fabricFilters.brand}
                          onChange={e => setFabricFilters({ ...fabricFilters, brand: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Quality / Blend"
                          value={fabricFilters.quality}
                          onChange={e => setFabricFilters({ ...fabricFilters, quality: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Shade"
                          value={fabricFilters.shade}
                          onChange={e => setFabricFilters({ ...fabricFilters, shade: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                    </>
                  )}

                  {/* Ready-Made Column Filters */}
                  {itemTypeFilter === 'READY_MADE' && (
                    <>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Fabric Type"
                          value={readyMadeFilters.fabricType}
                          onChange={e => setReadyMadeFilters({ ...readyMadeFilters, fabricType: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Shade / Color"
                          value={readyMadeFilters.shade}
                          onChange={e => setReadyMadeFilters({ ...readyMadeFilters, shade: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Art No"
                          value={readyMadeFilters.artNo}
                          onChange={e => setReadyMadeFilters({ ...readyMadeFilters, artNo: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Size"
                          value={readyMadeFilters.size}
                          onChange={e => setReadyMadeFilters({ ...readyMadeFilters, size: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                    </>
                  )}

                  {/* Accessories Column Filters */}
                  {itemTypeFilter === 'ACCESSORY' && (
                    <>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Category"
                          value={accessoryFilters.category}
                          onChange={e => setAccessoryFilters({ ...accessoryFilters, category: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Item Name"
                          value={accessoryFilters.name}
                          onChange={e => setAccessoryFilters({ ...accessoryFilters, name: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Filter Size"
                          value={accessoryFilters.size}
                          onChange={e => setAccessoryFilters({ ...accessoryFilters, size: e.target.value })}
                          style={{ height: 36, fontSize: 12.5 }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Items Table */}
              {filteredPendingItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--color-text-muted)', fontSize: 13 }}>
                  No items match your filter criteria.
                  {hasActiveFilters && (
                    <div style={{ marginTop: 8 }}>
                      <button className="btn btn-sm btn-secondary" onClick={resetFilters}>
                        Clear Filters
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
                  <table className="table" style={{ width: '100%', fontSize: 12.5, margin: 0 }}>
                    <thead style={{ background: '#f8fafc' }}>
                      <tr>
                        {itemTypeFilter === 'FABRIC' ? (
                          <>
                            <th style={{ padding: '10px 12px' }}>Brand</th>
                            <th style={{ padding: '10px 12px' }}>Quality / Blend</th>
                            <th style={{ padding: '10px 12px' }}>Shade</th>
                          </>
                        ) : itemTypeFilter === 'READY_MADE' ? (
                          <>
                            <th style={{ padding: '10px 12px' }}>Item Description</th>
                            <th style={{ padding: '10px 12px' }}>Fabric Type</th>
                            <th style={{ padding: '10px 12px' }}>Color / Shade</th>
                            <th style={{ padding: '10px 12px' }}>Art No</th>
                            <th style={{ padding: '10px 12px' }}>Size</th>
                          </>
                        ) : (
                          <>
                            <th style={{ padding: '10px 12px' }}>Category</th>
                            <th style={{ padding: '10px 12px' }}>Accessory Item</th>
                            <th style={{ padding: '10px 12px' }}>Quality / Spec</th>
                            <th style={{ padding: '10px 12px' }}>Size</th>
                          </>
                        )}
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Ordered</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Received</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Remaining</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center' }}>Open Orders</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPendingItems.map(p => {
                        const unit = p.sku.uom ? p.sku.uom.toLowerCase() : (itemTypeFilter === 'FABRIC' ? 'm' : 'pcs');
                        return (
                          <tr
                            key={p.sku.id}
                            onClick={() => handleSelectItem(p)}
                            style={{
                              borderBottom: '1px solid var(--color-border)',
                              cursor: 'pointer',
                              transition: 'background 0.15s ease'
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                          >
                            {itemTypeFilter === 'FABRIC' ? (
                              <>
                                <td style={{ padding: '10px 12px', fontWeight: 700 }}>{p.sku.brand || '—'}</td>
                                <td style={{ padding: '10px 12px' }}>{p.sku.quality || p.sku.category || '—'}</td>
                                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{p.sku.shade || '—'}</td>
                              </>
                            ) : itemTypeFilter === 'READY_MADE' ? (
                              <>
                                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{p.sku.name || '—'}</td>
                                <td style={{ padding: '10px 12px' }}>{p.sku.category || p.sku.quality || '—'}</td>
                                <td style={{ padding: '10px 12px' }}>{p.sku.shade || '—'}</td>
                                <td style={{ padding: '10px 12px', fontWeight: 700 }}>{p.sku.artNo || '—'}</td>
                                <td style={{ padding: '10px 12px', fontWeight: 700 }}>{p.sku.size || '—'}</td>
                              </>
                            ) : (
                              <>
                                <td style={{ padding: '10px 12px', fontWeight: 700 }}>{p.sku.category || '—'}</td>
                                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{p.sku.name || '—'}</td>
                                <td style={{ padding: '10px 12px' }}>{p.sku.quality || '—'}</td>
                                <td style={{ padding: '10px 12px' }}>{p.sku.size || '—'}</td>
                              </>
                            )}

                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                              {p.totalOrderedQty} {unit}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                              {p.totalReceivedQty} {unit}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--color-brand)' }}>
                              {p.totalRemainingQty} {unit}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                              <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                                {p.openOrders.length} Order{p.openOrders.length !== 1 ? 's' : ''}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectItem(p);
                                }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px' }}
                              >
                                Select Item <ArrowRight size={13} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* ─────────────────────────────────────────────────────────────────────────
               STEP B: DEDICATED RECEIVING PANEL (ITEM & PO ALLOCATION + BUNDLE + QTY)
               ───────────────────────────────────────────────────────────────────────── */
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(440px, 1.25fr) minmax(360px, 1fr)', gap: 20 }}>
              
              {/* Left Column: Receiving Entry Form */}
              <div className="card" style={{ padding: 20 }}>
                {/* Back to Items List Button */}
                <div style={{ marginBottom: 14 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setInwardStep('ITEMS_LIST')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-text-muted)', padding: 0 }}
                  >
                    <ArrowLeft size={15} /> Back to Ordered Items List
                  </button>
                </div>

                {/* Selected Item & Allocated Order Banner */}
                {selectedItem && selectedPoOrder && (
                  <div style={{
                    background: '#f8fafc',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--color-border)',
                    padding: '14px 16px',
                    marginBottom: 18
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-brand)', textTransform: 'uppercase' }}>
                          Selected Item for Inward
                        </span>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)', marginTop: 2 }}>
                          {itemTypeFilter === 'FABRIC' ? (
                            <>{selectedItem.sku.brand} — {selectedItem.sku.quality || selectedItem.sku.category} [Shade: {selectedItem.sku.shade || 'Std'}]</>
                          ) : itemTypeFilter === 'READY_MADE' ? (
                            <>{selectedItem.sku.name} (Art: {selectedItem.sku.artNo || '—'}, Size: {selectedItem.sku.size || '—'})</>
                          ) : (
                            <>{selectedItem.sku.name} ({selectedItem.sku.category}, Size: {selectedItem.sku.size || 'Std'})</>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setShowPoPopout(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-brand)' }}
                      >
                        <Repeat2 size={13} /> Change PO
                      </button>
                    </div>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingTop: 8,
                      borderTop: '1px dashed #e2e8f0',
                      fontSize: 12.5
                    }}>
                      <div>
                        Allocated Order: <strong style={{ color: '#0f172a' }}>{selectedPoOrder.poNumber}</strong>
                        {selectedPoOrder.targetClient && <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>({selectedPoOrder.targetClient})</span>}
                      </div>
                      <div>
                        Pending on PO: <strong style={{ color: 'var(--color-brand)' }}>{selectedPoOrder.remainingQty} {selectedItem.sku.uom.toLowerCase()}</strong>
                      </div>
                    </div>
                  </div>
                )}

                {inwardError && (
                  <div className="alert alert-danger" style={{ marginBottom: 16, fontSize: 13 }}>
                    {inwardError}
                  </div>
                )}

                <form onSubmit={handleInwardRoll}>
                  {/* Bundle Number (Optional) */}
                  <div style={{ marginBottom: 16 }}>
                    <label className="form-label" style={{ marginBottom: 6 }}>
                      Bundle Number (Optional)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Enter bundle number"
                      value={activeBundleNo}
                      onChange={e => {
                        setActiveBundleNo(e.target.value);
                        setDiscrepancyForm(prev => ({ ...prev, bundleNumber: e.target.value }));
                      }}
                      style={{ height: 42, fontSize: 14 }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      Leave blank if items are unbundled or loose
                    </div>
                  </div>

                  {/* Quantity and Optional Mill Roll Tag */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginBottom: 18 }}>
                    <div>
                      <label className="form-label" style={{ fontWeight: 700 }}>
                        Quantity ({selectedItem?.sku.uom || (itemTypeFilter === 'FABRIC' ? 'Meters' : 'Pcs')}) <span className="required">*</span>
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input
                          ref={qtyInputRef}
                          type="number"
                          inputMode="decimal"
                          className="form-input"
                          placeholder={itemTypeFilter === 'FABRIC' ? "0.0" : "0"}
                          step="any"
                          min="0.001"
                          value={rollQty}
                          onChange={e => setRollQty(e.target.value)}
                          style={{ fontSize: 20, fontWeight: 700, height: 48, paddingRight: 56 }}
                          required
                          autoFocus
                        />
                        <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                          {selectedItem?.sku.uom ? selectedItem.sku.uom.toLowerCase() : (itemTypeFilter === 'FABRIC' ? 'm' : 'pcs')}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="form-label">Mill Roll / Piece No. (Optional)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Mill Roll No."
                        value={millPieceTag}
                        onChange={e => setMillPieceTag(e.target.value)}
                        style={{ height: 48, fontSize: 13 }}
                      />
                    </div>
                  </div>

                  {/* Client Reference */}
                  {(() => {
                    const clientNames = (selectedPoOrder?.allocations && selectedPoOrder.allocations.length > 0)
                      ? Array.from(new Set(selectedPoOrder.allocations.map(al => al.clientName).filter(Boolean))).join(', ')
                      : ((selectedPoOrder as any)?.targetClient || '');
                    if (!clientNames) return null;
                    return (
                      <div style={{ marginBottom: 16, padding: '8px 12px', background: '#f8fafc', borderRadius: 'var(--radius)', border: '1px solid #e2e8f0', fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Users size={13} color="var(--color-brand)" />
                        <span><strong>Client:</strong> {clientNames}</span>
                      </div>
                    );
                  })()}

                  {/* Submit Action Buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      style={{ height: 48, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                      disabled={inwardSubmitting}
                    >
                      {inwardSubmitting ? (
                        <><span className="spinner" /> Recording Roll & Printing Label...</>
                      ) : (
                        <><Printer size={18} /> Inward & Print Barcode Label</>
                      )}
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleOpenDiscrepancyModal}
                      style={{ height: 40, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#b45309', borderColor: '#fde68a', background: '#fffbeb' }}
                    >
                      <AlertTriangle size={14} /> Item NOT Available in Bundle? Flag Shortage
                    </button>
                  </div>
                </form>
              </div>

              {/* Right Column: Live Session Feed */}
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileText size={16} /> Delivery Session Feed
                    </h2>
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '2px 0 0 0' }}>
                      {invoiceRef ? `Invoice: ${invoiceRef}` : 'Current Inbound Session'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${feedViewMode === 'BY_BUNDLE' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setFeedViewMode('BY_BUNDLE')}
                      style={{ fontSize: 11, padding: '3px 8px' }}
                    >
                      Group by Bundle
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${feedViewMode === 'FLAT' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setFeedViewMode('FLAT')}
                      style={{ fontSize: 11, padding: '3px 8px' }}
                    >
                      Flat List
                    </button>
                  </div>
                </div>

                {/* Session Totals Banner */}
                <div style={{
                  background: '#f8fafc',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--color-border)',
                  marginBottom: 16,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block' }}>TOTAL INWARD</span>
                    <strong style={{ fontSize: 16, color: 'var(--color-text-main)' }}>
                      {totalSessionQuantity.toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'Meters' : 'Units'} ({sessionRolls.length} rolls)
                    </strong>
                  </div>

                  {sessionRolls.length > 0 && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => setShowGrnModal(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontWeight: 700,
                        background: isPartialReceiving ? '#d97706' : undefined,
                        borderColor: isPartialReceiving ? '#d97706' : undefined
                      }}
                    >
                      <Printer size={14} /> {isPartialReceiving ? 'Finalize Partial GRN & Print' : 'Finalize GRN & Print'}
                    </button>
                  )}
                </div>

                {/* Rolls Feed */}
                {loadingSessionRolls ? (
                  <div className="loading-center" style={{ padding: 30 }}><span className="spinner" /></div>
                ) : sessionRolls.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--color-text-muted)', fontSize: 13 }}>
                    No rolls received yet in this delivery session.
                  </div>
                ) : feedViewMode === 'BY_BUNDLE' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {groupedSessionRolls.map(grp => (
                      <div key={grp.bundleNumber} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                        <div style={{
                          background: '#f1f5f9',
                          padding: '8px 12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 12.5,
                          fontWeight: 700
                        }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
                            <Package size={14} color="var(--color-brand)" /> {grp.bundleNumber}
                          </span>
                          <span style={{ color: '#065f46' }}>
                            {grp.rolls.length} item(s) • {grp.totalQty.toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'm' : 'pcs'}
                          </span>
                        </div>

                        <table className="table" style={{ width: '100%', fontSize: 12, margin: 0 }}>
                          <tbody>
                            {grp.rolls.map(r => (
                              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{r.batchCode}</td>
                                <td style={{ padding: '8px 10px' }}>
                                  <div style={{ fontWeight: 600 }}>{r.brand || r.name}</div>
                                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.shade || r.artNo}</div>
                                  {r.clientName && (
                                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#1e40af', background: '#eff6ff', padding: '1px 5px', borderRadius: 3, border: '1px solid #bfdbfe', display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                                      <Users size={10} /> {r.clientName}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#065f46' }}>
                                  {r.quantity} {r.uom ? r.uom.toLowerCase() : 'm'}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => printLabel(r.batchCode)}
                                    title="Reprint Label"
                                    style={{ padding: 4 }}
                                  >
                                    <Printer size={13} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                    <table className="table" style={{ width: '100%', fontSize: 12 }}>
                      <thead style={{ background: '#f8fafc' }}>
                        <tr>
                          <th style={{ padding: '8px 10px' }}>Barcode</th>
                          <th style={{ padding: '8px 10px' }}>Bundle</th>
                          <th style={{ padding: '8px 10px' }}>Item</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Qty</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionRolls.map(r => (
                          <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{r.batchCode}</td>
                            <td style={{ padding: '8px 10px', fontSize: 11 }}>{r.supplierBundle || '—'}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ fontWeight: 600 }}>{r.brand || r.name}</div>
                              {r.clientName && (
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#1e40af', background: '#eff6ff', padding: '1px 5px', borderRadius: 3, border: '1px solid #bfdbfe', display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                                  <Users size={10} /> {r.clientName}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#065f46' }}>
                              {r.quantity} {r.uom ? r.uom.toLowerCase() : 'm'}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => printLabel(r.batchCode)}
                                title="Reprint Label"
                                style={{ padding: 4 }}
                              >
                                <Printer size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Prominent Finalize GRN & Print Action Card */}
                {sessionRolls.length > 0 && (
                  <div style={{
                    marginTop: 16,
                    paddingTop: 14,
                    borderTop: '1px solid var(--color-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}>
                    {isPartialReceiving ? (
                      <div style={{
                        fontSize: 12,
                        background: '#fffbeb',
                        color: '#92400e',
                        border: '1px solid #fde68a',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius)',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8
                      }}>
                        <AlertCircle size={16} color="#b45309" style={{ flexShrink: 0, marginTop: 1 }} />
                        <div>
                          <strong>Partial Receiving Detected:</strong> {(supplierData?.totalPendingQty ?? 0).toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'm' : 'units'} pending on PO. You can finalize this partial GRN now and inward the rest later.
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        fontSize: 12,
                        background: '#f0fdf4',
                        color: '#166534',
                        border: '1px solid #86efac',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}>
                        <CheckCircle2 size={16} color="#16a34a" style={{ flexShrink: 0 }} />
                        <span><strong>Full Delivery:</strong> All ordered items are 100% fulfilled in this session.</span>
                      </div>
                    )}

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setShowGrnModal(true)}
                      style={{
                        height: 44,
                        fontSize: 13.5,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        width: '100%'
                      }}
                    >
                      <Printer size={16} /> {isPartialReceiving ? 'Finalize Partial GRN & Print' : 'Finalize Full GRN & Print'} ({sessionRolls.length} rolls)
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          3. SCAN SPECIFIC PO BARCODE
          ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'PO_SCAN' && (
        <div style={{
          minHeight: 'calc(100vh - 220px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px'
        }}>
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 480,
              padding: '36px 32px',
              textAlign: 'center',
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
              background: '#ffffff'
            }}
          >
            {/* Icon */}
            <div style={{
              width: 58,
              height: 58,
              borderRadius: 12,
              background: 'var(--color-brand-faded)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
              color: 'var(--color-brand)'
            }}>
              <ScanLine size={30} />
            </div>

            <h2 style={{ fontSize: 19, fontWeight: 700, margin: '0 0 6px 0', color: '#0f172a' }}>
              Scan Purchase Order Barcode
            </h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 24px 0', lineHeight: 1.5 }}>
              Scan barcode or enter PO number to open receiving details
            </p>

            {scanError && (
              <div className="alert alert-danger" style={{ marginBottom: 18, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span>{scanError}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setScanError(''); poScanInputRef.current?.focus(); }}
                  style={{ padding: '0 6px', height: 'auto', fontSize: 12 }}
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <form onSubmit={async (e) => {
              e.preventDefault();
              const q = scanInput.trim().toUpperCase();
              if (!q) return;
              setScanError('');
              setScanning(true);
              try {
                const res = await api.get(`/api/purchase-orders/by-number/${encodeURIComponent(q)}`);
                navigate(`/entry-gate/${res.data.id}`);
              } catch {
                setScanError(`Purchase Order "${q}" not found.`);
              } finally {
                setScanning(false);
              }
            }}>
              <div style={{ display: 'flex', gap: 10, maxWidth: 420, margin: '0 auto' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    ref={poScanInputRef}
                    type="text"
                    className="form-input"
                    placeholder="PO #"
                    value={scanInput}
                    onChange={e => {
                      setScanInput(e.target.value);
                      if (scanError) setScanError('');
                    }}
                    style={{
                      height: 46,
                      fontSize: 15,
                      fontWeight: 600,
                      textAlign: 'center',
                      paddingRight: scanInput ? 36 : 12,
                      letterSpacing: '0.4px'
                    }}
                    autoFocus
                  />
                  {scanInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setScanInput('');
                        setScanError('');
                        poScanInputRef.current?.focus();
                      }}
                      style={{
                        position: 'absolute',
                        right: 10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-muted)',
                        padding: 4,
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={scanning || !scanInput.trim()}
                  style={{
                    height: 46,
                    padding: '0 20px',
                    fontWeight: 700,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexShrink: 0
                  }}
                >
                  {scanning ? <span className="spinner" /> : <><ArrowRight size={16} /> Open PO</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          4. DIRECT INWARD (NO PO)
          ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'DIRECT' && (
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          {/* Header Title */}
          <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Plus size={24} color="var(--color-brand)" /> Direct Inward Desk
              </h1>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>
                Inward stock directly into warehouse inventory without a Purchase Order and issue Goods Receipt Notes
              </p>
            </div>

            {directSessionBatches.length > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowDirectGrnModal(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, padding: '9px 18px' }}
              >
                <FileCheck size={16} /> Finalize Inward &amp; Issue GRN ({directSessionBatches.length})
              </button>
            )}
          </div>

          {draftRestored && (draftRestored.items > 0 || draftRestored.lumps > 0) && (
            <div className="alert alert-success" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
              <span>
                <strong>Your unfinished inward was restored</strong> (saved {formatDateTime(draftRestored.savedAt)}):{' '}
                {[
                  draftRestored.items > 0 && `${draftRestored.items} imported item(s) still to receive`,
                  draftRestored.lumps > 0 && `${draftRestored.lumps} lump(s) waiting for the GRN`,
                ].filter(Boolean).join(', ')}.
                {' '}It stays saved until you finish it or clear it.
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraftRestored(null)} title="Hide" style={{ padding: 4 }}>
                <X size={14} />
              </button>
            </div>
          )}

          {draftSyncBroken && (
            <div className="alert alert-warning" style={{ marginBottom: 16, fontSize: 13 }}>
              Your saved draft could not be loaded, so work on this page is <strong>not</strong> being saved as a draft right now.
              Reload the page to try again.
            </div>
          )}

          {directGrnSuccess && (
            <div style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: 'var(--radius)',
              padding: '14px 18px',
              marginBottom: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle2 size={20} color="#059669" />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#065f46' }}>
                    Goods Receipt Note <span style={{ fontFamily: 'monospace' }}>{directGrnSuccess.grnNumber}</span> Generated Successfully
                  </div>
                  <div style={{ fontSize: 12, color: '#047857' }}>
                    All items recorded in inventory and linked to this official GRN voucher.
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => printGrnVoucher(directGrnSuccess.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Printer size={14} /> Reprint GRN Voucher
              </button>
            </div>
          )}

          {/* 1. General Information Card */}
          <div style={{
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            padding: directInfoConfirmed ? '14px 20px' : '20px 24px',
            marginBottom: 20,
            boxShadow: 'var(--shadow-xs)',
            transition: 'all 0.2s ease'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: directInfoConfirmed ? 0 : 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {directInfoConfirmed
                    ? <CheckCircle2 size={18} color="#059669" />
                    : <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--color-brand)', color: '#fff', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>1</span>}
                  General Information
                </h2>
                {directInfoConfirmed && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
                    <span><strong>Supplier:</strong> <span style={{ color: '#0f172a', fontWeight: 600 }}>{directSupplierInput || 'Not specified'}</span></span>
                    {directInvoiceRef && <span>• <strong>Invoice:</strong> <span style={{ color: '#0f172a' }}>{directInvoiceRef}</span></span>}
                    {directInvoiceDate && <span>• <strong>Date:</strong> <span style={{ color: '#0f172a' }}>{directInvoiceDate}</span></span>}
                    {directClientInput && <span>• <strong>Client:</strong> <span style={{ color: '#1d4ed8', fontWeight: 600 }}>{directClientInput}</span></span>}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {directInfoConfirmed ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDirectInfoConfirmed(false)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 12px', border: '1px solid var(--color-border)', background: '#f8fafc' }}
                    title="Change supplier, invoice or client"
                  >
                    <ChevronDown size={14} /> Edit
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Applies to all items received in this delivery session
                  </span>
                )}
              </div>
            </div>

            {!directInfoConfirmed && (
              <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '16px 20px' }}>
                {/* Supplier Input with Autocomplete & Quick Add */}
                <div className="form-group" style={{ margin: 0, position: 'relative' }} ref={directSupplierWrapperRef}>
                  <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    Supplier <span className="required">*</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                      <Search size={16} style={{ position: 'absolute', left: 12, color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Type or select supplier..."
                        value={directSupplierInput}
                        onChange={e => {
                          const val = e.target.value;
                          setDirectSupplierInput(val);
                          setDirectSupplierId('');
                          setShowDirectSupplierMenu(true);
                        }}
                        onFocus={() => setShowDirectSupplierMenu(true)}
                        style={{ paddingLeft: 36, paddingRight: directSupplierInput ? 36 : 12, height: 40, fontSize: 13.5, fontWeight: 500 }}
                        required
                      />
                      {directSupplierInput && (
                        <button
                          type="button"
                          onClick={() => {
                            setDirectSupplierInput('');
                            setDirectSupplierId('');
                            setShowDirectSupplierMenu(true);
                          }}
                          style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--color-text-muted)' }}
                          title="Clear supplier"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => openDirectQuickAddSupplier(directSupplierInput)}
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

                  {showDirectSupplierMenu && (
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
                      {filteredDirectSuppliers.length === 0 ? (
                        <div style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>No match for <strong>"{directSupplierInput}"</strong></span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openDirectQuickAddSupplier(directSupplierInput)}
                            style={{ fontSize: 11.5, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            <Plus size={13} /> Add
                          </button>
                        </div>
                      ) : (
                        filteredDirectSuppliers.map(s => {
                          const isSelected = directSupplierId === s.id;
                          return (
                            <div
                              key={s.id}
                              onClick={() => {
                                setDirectSupplierId(s.id);
                                setDirectSupplierInput(s.name);
                                setShowDirectSupplierMenu(false);
                              }}
                              style={{
                                padding: '9px 14px',
                                borderBottom: '1px solid var(--color-border-subtle)',
                                cursor: 'pointer',
                                background: isSelected ? 'var(--color-bg-subtle)' : '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-subtle)')}
                              onMouseLeave={e => (e.currentTarget.style.background = isSelected ? 'var(--color-bg-subtle)' : '#fff')}
                            >
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-main)' }}>{s.name}</div>
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

              {/* Supplier Invoice (Optional, but do NOT mention optional) */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                  Supplier Invoice
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter invoice number..."
                  value={directInvoiceRef}
                  onChange={e => setDirectInvoiceRef(e.target.value)}
                  style={{ height: 40, fontSize: 13.5 }}
                />
              </div>

              {/* Invoice Date (Optional, but do NOT mention optional) */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                  Invoice Date
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={directInvoiceDate}
                  onChange={e => setDirectInvoiceDate(e.target.value)}
                  style={{ height: 40, fontSize: 13.5 }}
                />
              </div>

              {/* Client (PO Implementation Pattern, do NOT mention optional) */}
              <div className="form-group" style={{ margin: 0, position: 'relative' }} ref={directClientWrapperRef}>
                <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                  Client
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Type or select client name..."
                      value={directClientInput}
                      onChange={e => {
                        const val = e.target.value;
                        setDirectClientInput(val);
                        setDirectSelectedClient(null);
                        setShowDirectClientMenu(true);
                      }}
                      onFocus={() => setShowDirectClientMenu(true)}
                      style={{ paddingLeft: 36, paddingRight: directClientInput ? 36 : 12, height: 40, fontSize: 13.5, fontWeight: 500 }}
                    />
                    {directClientInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setDirectClientInput('');
                          setDirectSelectedClient(null);
                          setShowDirectClientMenu(true);
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
                    onClick={() => openDirectQuickAddClient(directClientInput)}
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

                {showDirectClientMenu && (
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
                    {filteredDirectClients.length === 0 ? (
                      <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                        No matching clients found. Type directly or click <strong>+ Add New Client</strong>.
                      </div>
                    ) : (
                      filteredDirectClients.map(c => {
                        const isSelected = directSelectedClient?.id === c.id || directClientInput.toLowerCase() === c.name.toLowerCase();
                        return (
                          <div
                            key={c.id}
                            onClick={() => {
                              setDirectSelectedClient(c);
                              setDirectClientInput(c.name);
                              setShowDirectClientMenu(false);
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
                              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-main)' }}>{c.name}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                Code: {c.code}{c.clientType ? ` • ${c.clientType}` : ''}{c.city ? ` • ${c.city}` : ''}
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
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
              {directInfoError && <span style={{ color: '#dc2626', fontSize: 13, fontWeight: 600 }}>{directInfoError}</span>}
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmDirectInfo}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, padding: '9px 22px' }}
              >
                Continue <ChevronRight size={16} />
              </button>
            </div>
            </>
            )}
          </div>

          {/* 2. Inward Item Card: item type, then entry method, then entry */}
          {directInfoConfirmed && (
          <div style={{
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            padding: '20px 24px',
            marginBottom: 20,
            boxShadow: 'var(--shadow-xs)'
          }}>
            {/* Header with the choices made so far */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 18, borderBottom: '1px solid var(--color-border-subtle)', paddingBottom: 14 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--color-brand)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>Inward Item</h2>
              {directClassification && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--color-brand-faded)', color: 'var(--color-brand)', fontWeight: 700, fontSize: 12.5, padding: '4px 6px 4px 12px', borderRadius: 20 }}>
                  {ITEM_TYPE_LABEL[directClassification]}
                  <button type="button" onClick={() => setDirectClassification(null)} style={{ border: 'none', background: '#fff', color: 'var(--color-brand)', fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 12, cursor: 'pointer' }}>
                    Change
                  </button>
                </span>
              )}
              {directClassification && directEntryMode && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#f1f5f9', color: '#0f172a', fontWeight: 700, fontSize: 12.5, padding: '4px 6px 4px 12px', borderRadius: 20 }}>
                  {directEntryMode === 'IMPORT' ? 'Import Excel' : 'Enter manually'}
                  <button type="button" onClick={() => setDirectEntryMode(null)} style={{ border: 'none', background: '#fff', color: 'var(--color-brand)', fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 12, cursor: 'pointer' }}>
                    Change
                  </button>
                </span>
              )}
            </div>

            {!directClassification ? (
              <>
                <p style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: '#334155' }}>What are you receiving?</p>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {([
                    ['FABRIC', <Layers size={22} />, 'Rolls, entered in meters'],
                    ['READY_MADE', <Shirt size={22} />, 'Garments, entered in pieces'],
                    ['ACCESSORY', <Boxes size={22} />, 'Buttons, zips, labels and more'],
                  ] as const).map(([type, icon, subtitle]) => {
                    const pending = pendingImportLines.filter(l => l.itemType === type).length;
                    return (
                      <ChoiceCard
                        key={type}
                        icon={icon}
                        title={ITEM_TYPE_LABEL[type]}
                        subtitle={subtitle}
                        badge={pending > 0 ? `${pending} imported pending` : undefined}
                        onClick={() => setDirectClassification(type)}
                      />
                    );
                  })}
                </div>
              </>
            ) : !directEntryMode ? (
              <>
                <p style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: '#334155' }}>How do you want to enter these items?</p>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <ChoiceCard
                    icon={<Plus size={22} />}
                    title="Enter manually"
                    subtitle="Type each lump and print its label"
                    onClick={() => setDirectEntryMode('MANUAL')}
                  />
                  <ChoiceCard
                    icon={<FileSpreadsheet size={22} />}
                    title="Import Excel"
                    subtitle="Load items with their totals from a sheet, then enter lumps"
                    badge={(() => {
                      const pending = pendingImportLines.filter(l => l.itemType === directClassification).length;
                      return pending > 0 ? `${pending} pending` : undefined;
                    })()}
                    onClick={() => setDirectEntryMode('IMPORT')}
                  />
                </div>
              </>
            ) : directEntryMode === 'IMPORT' ? (
              <DirectInwardImport
                itemType={directClassification}
                lines={importLines}
                onLinesChange={setImportLines}
                inwardLump={inwardImportedLump}
              />
            ) : (
            <>
            {directItemError && (
              <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                {directItemError}
              </div>
            )}

            <form onSubmit={handleInwardDirectItem}>
              {/* Classification: FABRIC */}
              {directClassification === 'FABRIC' && (
                <>
                  <div className="form-row" style={{ marginBottom: 14 }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Fabric Category <span className="required">*</span></label>
                      <select
                        className="form-select"
                        value={directItemForm.category}
                        onChange={e => setDirectItemForm({ ...directItemForm, category: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      >
                        <option value="SUITING">Suiting</option>
                        <option value="SHIRTING">Shirting</option>
                        <option value="PLAIN_SHIRTING">Plain Shirting</option>
                        <option value="OTHER">Other Fabric</option>
                      </select>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Brand <span className="required">*</span></label>
                      <input
                        type="text"
                        className="form-input"
                        list="direct-brand-options"
                        placeholder="e.g. Raymond, Arvind, Siyaram"
                        value={directItemForm.brand}
                        onChange={e => setDirectItemForm({ ...directItemForm, brand: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                      <datalist id="direct-brand-options">
                        {masterAttributes.BRAND.map(b => <option key={b} value={b} />)}
                      </datalist>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Quality <span className="required">*</span></label>
                      <input
                        type="text"
                        className="form-input"
                        list="direct-quality-options"
                        placeholder="Quality"
                        value={directItemForm.quality}
                        onChange={e => setDirectItemForm({ ...directItemForm, quality: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                      <datalist id="direct-quality-options">
                        {masterAttributes.QUALITY.map(q => <option key={q} value={q} />)}
                      </datalist>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Shade / Color <span className="required">*</span></label>
                      <input
                        type="text"
                        className="form-input"
                        list="direct-shade-options"
                        placeholder="e.g. Navy Blue 04, White"
                        value={directItemForm.shade}
                        onChange={e => setDirectItemForm({ ...directItemForm, shade: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                      <datalist id="direct-shade-options">
                        {masterAttributes.SHADE.map(s => <option key={s} value={s} />)}
                      </datalist>
                    </div>
                  </div>

                  <div className="form-row" style={{ marginBottom: 18 }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Quantity (Meters) <span className="required">*</span></label>
                      <input
                        type="number"
                        className="form-input"
                        step="any"
                        min="0.001"
                        placeholder="e.g. 52.40"
                        value={directItemForm.meters}
                        onChange={e => setDirectItemForm({ ...directItemForm, meters: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 14, fontWeight: 600 }}
                      />
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>bundle number</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. B-101, Bale 12"
                        value={directItemForm.bundleNumber}
                        onChange={e => setDirectItemForm({ ...directItemForm, bundleNumber: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Remarks</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Notes or comments"
                        value={directItemForm.notes}
                        onChange={e => setDirectItemForm({ ...directItemForm, notes: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Classification: READY_MADE */}
              {directClassification === 'READY_MADE' && (
                <>
                  <div className="form-row" style={{ marginBottom: 14 }}>
                    <div className="form-group" style={{ flex: 1.5 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Item Name <span className="required">*</span></label>
                      <input
                        type="text"
                        className="form-input"
                        list="direct-item-name-options"
                        placeholder="e.g. Boys Half Sleeve Shirt"
                        value={directItemForm.rmName}
                        onChange={e => setDirectItemForm({ ...directItemForm, rmName: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                      <datalist id="direct-item-name-options">
                        {masterAttributes.ITEM_NAME.map(n => <option key={n} value={n} />)}
                      </datalist>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Fabric Type</label>
                      <input
                        type="text"
                        className="form-input"
                        list="direct-fabric-type-options"
                        placeholder="e.g. Cotton Twill"
                        value={directItemForm.rmFabricType}
                        onChange={e => setDirectItemForm({ ...directItemForm, rmFabricType: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                      <datalist id="direct-fabric-type-options">
                        {masterAttributes.FABRIC_TYPE.map(f => <option key={f} value={f} />)}
                      </datalist>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Color / Shade</label>
                      <input
                        type="text"
                        className="form-input"
                        list="direct-shade-options"
                        placeholder="e.g. White"
                        value={directItemForm.rmShade}
                        onChange={e => setDirectItemForm({ ...directItemForm, rmShade: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>
                  </div>

                  <div className="form-row" style={{ marginBottom: 18 }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Art No <span className="required">*</span></label>
                      <input
                        type="text"
                        className="form-input"
                        list="direct-art-no-options"
                        placeholder="e.g. ART-101"
                        value={directItemForm.rmArtNo}
                        onChange={e => setDirectItemForm({ ...directItemForm, rmArtNo: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                      <datalist id="direct-art-no-options">
                        {masterAttributes.ART_NO.map(a => <option key={a} value={a} />)}
                      </datalist>
                    </div>

                    <div className="form-group" style={{ flex: 0.7 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Size <span className="required">*</span></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. 32"
                        value={directItemForm.rmSize}
                        onChange={e => setDirectItemForm({ ...directItemForm, rmSize: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>

                    <div className="form-group" style={{ flex: 0.8 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Quantity (Pcs) <span className="required">*</span></label>
                      <input
                        type="number"
                        className="form-input"
                        step="1"
                        min="1"
                        placeholder="e.g. 50"
                        value={directItemForm.rmQty}
                        onChange={e => setDirectItemForm({ ...directItemForm, rmQty: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 14, fontWeight: 600 }}
                      />
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>bundle number</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. B-101, Bale 12"
                        value={directItemForm.rmBundleNumber}
                        onChange={e => setDirectItemForm({ ...directItemForm, rmBundleNumber: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Remarks</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Notes or comments"
                        value={directItemForm.notes}
                        onChange={e => setDirectItemForm({ ...directItemForm, notes: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Classification: ACCESSORY */}
              {directClassification === 'ACCESSORY' && (
                <>
                  <div className="form-row" style={{ marginBottom: 14 }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Accessory Category <span className="required">*</span></label>
                      <input
                        type="text"
                        className="form-input"
                        list="direct-accessory-category-options"
                        placeholder="e.g. Buttons, Zippers"
                        value={directItemForm.accCategory}
                        onChange={e => setDirectItemForm({ ...directItemForm, accCategory: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                      <datalist id="direct-accessory-category-options">
                        {masterAttributes.ACCESSORY_CATEGORY.map(c => <option key={c} value={c} />)}
                      </datalist>
                    </div>

                    <div className="form-group" style={{ flex: 1.5 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Item Name / Brand <span className="required">*</span></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. 24L 4-Hole Navy Button, Metal Zipper 7 inch"
                        value={directItemForm.accItemName}
                        onChange={e => setDirectItemForm({ ...directItemForm, accItemName: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Spec / Size</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. 24L, 7 inch, Free Size"
                        value={directItemForm.specSize}
                        onChange={e => setDirectItemForm({ ...directItemForm, specSize: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>
                  </div>

                  <div className="form-row" style={{ marginBottom: 18 }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Shade / Color</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Navy Blue, Silver"
                        value={directItemForm.accShade}
                        onChange={e => setDirectItemForm({ ...directItemForm, accShade: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Unit of Measure (UOM) <span className="required">*</span></label>
                      <select
                        className="form-select"
                        value={directItemForm.uom}
                        onChange={e => setDirectItemForm({ ...directItemForm, uom: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      >
                        <option value="PCS">Pcs</option>
                        <option value="GROSS">Gross (144 pcs)</option>
                        <option value="BOXES">Boxes</option>
                        <option value="METERS">Meters</option>
                        <option value="PACKETS">Packets</option>
                      </select>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Quantity <span className="required">*</span></label>
                      <input
                        type="number"
                        className="form-input"
                        min="0.001"
                        step="any"
                        placeholder="e.g. 500"
                        value={directItemForm.accQuantity}
                        onChange={e => setDirectItemForm({ ...directItemForm, accQuantity: e.target.value })}
                        required
                        style={{ height: 40, fontSize: 14, fontWeight: 600 }}
                      />
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>Packet / Box Number</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Pkt #3"
                        value={directItemForm.accBundleNumber}
                        onChange={e => setDirectItemForm({ ...directItemForm, accBundleNumber: e.target.value })}
                        style={{ height: 40, fontSize: 13.5 }}
                      />
                    </div>
                  </div>
                </>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', height: 44, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14 }}
                disabled={directSubmittingItem}
              >
                {directSubmittingItem ? <><span className="spinner" /> Inwarding...</> : <><Plus size={18} /> Inward Item &amp; Print Barcode Label</>}
              </button>
            </form>
            </>
            )}
          </div>
          )}

          {/* 3. Session Items Table: once entry has started, or while lumps await their GRN */}
          {(directSessionBatches.length > 0 || (directInfoConfirmed && directClassification && directEntryMode)) && (
          <div style={{
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-xs)'
          }}>
            <div style={{
              padding: '16px 20px',
              background: '#fafbfc',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText size={18} color="var(--color-brand)" />
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                  Current Inward Session
                </h3>
                <span className="badge badge-info" style={{ fontSize: 12 }}>
                  {directSessionBatches.length} {directSessionBatches.length === 1 ? 'item' : 'items'} recorded
                </span>
              </div>

              {directSessionBatches.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowDirectGrnModal(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, padding: '7px 14px', fontSize: 13 }}
                >
                  <FileCheck size={16} /> Finalize Inward &amp; Issue GRN
                </button>
              )}
            </div>

            {directSessionBatches.length === 0 ? (
              <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <Package size={32} style={{ opacity: 0.35, marginBottom: 8 }} />
                <p style={{ margin: 0, fontSize: 13.5 }}>
                  No items inwarded in this session yet. Complete the form above and click <strong>Inward Item &amp; Print Barcode Label</strong>.
                </p>
              </div>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%', margin: 0, fontSize: 13 }}>
                    <thead style={{ background: '#f8fafc' }}>
                      <tr>
                        <th style={{ width: 40, textAlign: 'center' }}>#</th>
                        <th>Barcode</th>
                        <th>Classification</th>
                        {sessionItemColumns.map(c => <th key={c.header}>{c.header}</th>)}
                        <th>Bundle / Box</th>
                        <th style={{ textAlign: 'right' }}>Quantity</th>
                        <th>Client</th>
                        <th style={{ textAlign: 'center', width: 140 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {directSessionBatches.map((b, idx) => (
                        <tr key={b.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                          <td style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                          <td>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
                              {b.batchCode}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${b.itemType === 'FABRIC' ? 'badge-primary' : b.itemType === 'READY_MADE' ? 'badge-info' : 'badge-neutral'}`} style={{ fontSize: 11 }}>
                              {b.itemType === 'FABRIC' ? 'Fabric' : b.itemType === 'READY_MADE' ? 'Ready-Made' : 'Accessory'}
                            </span>
                          </td>
                          {sessionItemColumns.map((c, i) => {
                            const value = c.value(b);
                            return (
                              <td key={c.header} style={{ fontWeight: i === 1 ? 700 : 500, color: 'var(--color-text-main)' }}>
                                {value || <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>—</span>}
                              </td>
                            );
                          })}
                          <td>
                            {b.supplierBundle ? (
                              <span style={{ fontWeight: 600, background: '#f1f5f9', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                                {b.supplierBundle}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#065f46' }}>
                            {b.quantity} {b.uom ? b.uom.toLowerCase() : (b.itemType === 'FABRIC' ? 'm' : 'pcs')}
                          </td>
                          <td>
                            {b.clientName ? (
                              <span style={{ color: '#1e40af', fontWeight: 600 }}>{b.clientName}</span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>General Stock</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => previewLabel(b.batchCode)}
                                title="Preview Label"
                                style={{ padding: '4px 6px' }}
                              >
                                <Eye size={14} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => printLabel(b.batchCode)}
                                title="Reprint Barcode Label"
                                style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5 }}
                              >
                                <Printer size={13} /> Print
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setDirectSessionBatches(prev => prev.filter(x => x.id !== b.id))}
                                title="Remove from session list"
                                style={{ padding: '4px 6px', color: '#ef4444' }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{
                  padding: '14px 20px',
                  background: '#f8fafc',
                  borderTop: '1px solid var(--color-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>
                    <span>Delivering Supplier: <strong style={{ color: '#0f172a' }}>{directSupplierInput || '—'}</strong></span>
                    {directInvoiceRef && <span>• Invoice: <strong style={{ color: '#0f172a' }}>{directInvoiceRef}</strong></span>}
                    <span>• Client: <strong style={{ color: directClientInput ? '#1e40af' : '#0f172a' }}>{directClientInput || 'General Stock'}</strong></span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowDirectGrnModal(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, padding: '9px 18px' }}
                  >
                    <FileCheck size={16} /> Finalize Inward &amp; Issue GRN ({directSessionBatches.length} items)
                  </button>
                </div>
              </>
            )}
          </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          PO SELECTION POPOUT MODAL
          ───────────────────────────────────────────────────────────────────────────── */}
      {showPoPopout && selectedItem && (
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
            maxWidth: 860,
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShoppingCart size={18} color="var(--color-brand)" /> Select Purchase Order
                </h2>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Allocate inward stock to an open order for this item
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setShowPoPopout(false)} style={{ padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: 20, overflowY: 'auto' }}>
              {/* Item Details Banner */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                padding: '12px 14px',
                marginBottom: 16
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-brand)', textTransform: 'uppercase' }}>
                  Item to Inward
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-main)', marginTop: 2 }}>
                  {itemTypeFilter === 'FABRIC' ? (
                    <>{selectedItem.sku.brand} — {selectedItem.sku.quality || selectedItem.sku.category} [Shade: {selectedItem.sku.shade || 'Std'}]</>
                  ) : itemTypeFilter === 'READY_MADE' ? (
                    <>{selectedItem.sku.name} (Art: {selectedItem.sku.artNo || '—'}, Size: {selectedItem.sku.size || '—'})</>
                  ) : (
                    <>{selectedItem.sku.name} ({selectedItem.sku.category}, Size: {selectedItem.sku.size || 'Std'})</>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Total Pending across all orders: <strong>{selectedItem.totalRemainingQty} {selectedItem.sku.uom.toLowerCase()}</strong>
                </div>
              </div>

              {/* Purchase Orders List */}
              <div style={{ marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-main)' }}>
                Select an open order below:
              </div>

              {selectedItem.openOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-text-muted)', fontSize: 13 }}>
                  No open orders pending for this item.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedItem.openOrders.map((order) => {
                    const isSelected = selectedPoOrder?.lineId === order.lineId;

                    return (
                      <div
                        key={order.lineId}
                        onClick={() => setSelectedPoOrder(order)}
                        style={{
                          border: isSelected ? '2px solid var(--color-brand)' : '1px solid var(--color-border)',
                          borderRadius: 'var(--radius)',
                          padding: '12px 14px',
                          cursor: 'pointer',
                          background: isSelected ? '#f0fdf4' : '#fff',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {/* Radio Indicator */}
                          <div style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            border: isSelected ? '5px solid var(--color-brand)' : '2px solid var(--color-border)',
                            background: '#fff'
                          }} />

                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <strong style={{ fontSize: 14, color: '#0f172a' }}>{order.poNumber}</strong>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                              {order.targetClient ? `Client: ${order.targetClient} • ` : ''}Expected: {formatDate(order.expectedDate)}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block' }}>Needs</span>
                            <strong style={{ fontSize: 14, color: 'var(--color-brand)' }}>
                              {order.remainingQty} {selectedItem.sku.uom.toLowerCase()}
                            </strong>
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block' }}>
                              of {order.orderedQty}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPoOrder(order);
                              handleViewPo(order.poId, order.lineId);
                            }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, padding: '6px 12px' }}
                          >
                            <Eye size={14} /> View PO
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
              <button className="btn btn-secondary" onClick={() => setShowPoPopout(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (selectedPoOrder) handleViewPo(selectedPoOrder.poId, selectedPoOrder.lineId);
                }}
                disabled={!selectedPoOrder}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
              >
                <Eye size={15} /> View Selected PO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          PO VIEW MODAL / PREVIEW WINDOW (IN-PLACE PREVIEW BEFORE COMMITTING TO RECEIVE)
          ───────────────────────────────────────────────────────────────────────────── */}
      {viewingPoId && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1060,
          padding: 20
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 1140,
            maxHeight: '90vh',
            boxShadow: 'var(--shadow-xl)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ShoppingCart size={20} color="var(--color-brand)" />
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    Purchase Order Details: <span style={{ color: 'var(--color-brand)' }}>{viewingPoData?.poNumber || '...'}</span>
                    {viewingPoData && (
                      <span className={`badge ${viewingPoData.status === 'RECEIVED' ? 'badge-success' : viewingPoData.status === 'PARTIALLY_RECEIVED' ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: 11 }}>
                        {viewingPoData.status.replace(/_/g, ' ')}
                      </span>
                    )}
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Verify order lines against your physical delivery document before receiving
                  </div>
                </div>
              </div>
              <button className="btn btn-ghost" onClick={handleCloseViewPo} style={{ padding: 4 }} title="Close Preview">
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
              {loadingViewingPo ? (
                <div className="loading-center" style={{ padding: 60 }}>
                  <span className="spinner spinner-lg" />
                  <div style={{ marginTop: 12, color: 'var(--color-text-muted)', fontSize: 13 }}>Loading Purchase Order details...</div>
                </div>
              ) : !viewingPoData ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  Purchase Order details could not be loaded.
                </div>
              ) : (
                <>
                  {/* PO Metadata Cards */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 12,
                    marginBottom: 16,
                    background: '#f8fafc',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: 14
                  }}>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block' }}>Supplier</span>
                      <strong style={{ fontSize: 13.5 }}>{viewingPoData.supplier?.name || viewingPoData.supplierName}</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block' }}>Expected Delivery</span>
                      <strong style={{ fontSize: 13.5 }}>{formatDate(viewingPoData.expectedDate)}</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block' }}>Client</span>
                      <strong style={{ fontSize: 13.5 }}>
                        {(() => {
                          const viewingClients = Array.from(
                            new Set(
                              (viewingPoData.lines || [])
                                .flatMap((l: any) => (l.allocations || []).map((a: any) => a.clientName))
                                .concat(viewingPoData.targetClient ? [viewingPoData.targetClient] : [])
                                .filter(Boolean)
                            )
                          );
                          return viewingClients.length > 0 ? viewingClients.join(', ') : 'General Stock';
                        })()}
                      </strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block' }}>Delivery Invoice</span>
                      <strong style={{ fontSize: 13.5 }}>{invoiceRef || viewingPoData.invoiceRef || '—'}</strong>
                    </div>
                  </div>

                  {viewingPoData.notes && (
                    <div style={{ marginBottom: 14, fontSize: 12.5, color: '#475569', background: '#eff6ff', padding: '8px 12px', borderRadius: 6, border: '1px solid #bfdbfe' }}>
                      <strong>PO Notes:</strong> {viewingPoData.notes}
                    </div>
                  )}

                  {/* Notice Banner */}
                  <div style={{
                    marginBottom: 14,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    fontSize: 12,
                    color: '#166534',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}>
                    <CheckCircle2 size={15} />
                    <span>Does this PO match your arriving goods? If yes, click <strong>Receive This PO</strong>. If not, click <strong>Back to Orders List</strong> to check another PO.</span>
                  </div>

                  {/* Lines Table */}
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                    <table className="table" style={{ width: '100%', fontSize: 12.5, margin: 0 }}>
                      <thead style={{ background: '#f8fafc' }}>
                        <tr>
                          <th style={{ padding: '9px 12px', width: 36 }}>#</th>
                          <th style={{ padding: '9px 12px' }}>Item Description</th>
                          <th style={{ padding: '9px 12px' }}>Quality / Blend</th>
                          <th style={{ padding: '9px 12px' }}>Shade / Color</th>
                          <th style={{ padding: '9px 12px' }}>Size / Art No</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right' }}>Ordered</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right' }}>Received</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right' }}>Pending</th>
                          <th style={{ padding: '9px 12px', textAlign: 'center' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewingPoData.lines?.map((line: any, idx: number) => {
                          const isTarget = line.id === viewingPoTargetLineId;
                          const remaining = Math.max(0, (line.orderedQty || 0) - (line.receivedQty || 0));
                          const isComplete = (line.receivedQty || 0) >= (line.orderedQty || 0);
                          const lineUom = line.uom ? line.uom.toLowerCase() : (line.itemType === 'FABRIC' ? 'm' : 'pcs');

                          return (
                            <tr
                              key={line.id}
                              style={{
                                background: isTarget ? '#ecfdf5' : isComplete ? '#fafafa' : '#fff',
                                borderBottom: '1px solid var(--color-border)',
                                borderLeft: isTarget ? '3px solid var(--color-brand)' : undefined
                              }}
                            >
                              <td style={{ padding: '9px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>#{idx + 1}</td>
                              <td style={{ padding: '9px 12px', fontWeight: 600 }}>
                                {line.name || line.brand || 'Item'}
                                {isTarget && (
                                  <span className="badge badge-success" style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px' }}>
                                    Selected Item
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '9px 12px' }}>{line.quality || line.category || '—'}</td>
                              <td style={{ padding: '9px 12px', fontWeight: 600 }}>{line.shade || '—'}</td>
                              <td style={{ padding: '9px 12px' }}>{line.size || line.artNo || '—'}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right' }}>{line.orderedQty} {lineUom}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--color-text-muted)' }}>{line.receivedQty} {lineUom}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: remaining > 0 ? 'var(--color-brand)' : '#16a34a' }}>
                                {remaining.toFixed(remaining % 1 === 0 ? 0 : 1)} {lineUom}
                              </td>
                              <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                                {isComplete ? (
                                  <span className="badge badge-success" style={{ fontSize: 10.5 }}>Fulfilled</span>
                                ) : (
                                  <span className="badge badge-warning" style={{ fontSize: 10.5 }}>Pending</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '14px 20px',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseViewPo}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
              >
                <ArrowLeft size={15} /> Back to Orders List
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleProceedToReceiveFromView()}
                disabled={!viewingPoData}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, padding: '8px 18px' }}
              >
                <CheckCircle2 size={16} /> Receive This PO ({viewingPoData?.poNumber || ''}) <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          BUNDLE DISCREPANCY REPORTING MODAL
          ───────────────────────────────────────────────────────────────────────────── */}
      {showDiscrepancyModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.5)',
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
            maxWidth: 540,
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fffbeb' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={20} color="#b45309" />
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#92400e' }}>
                    Bundle Packing Discrepancy
                  </h2>
                  <div style={{ fontSize: 11.5, color: '#b45309' }}>
                    Report when a lump or item on invoice is not available in this bundle
                  </div>
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setShowDiscrepancyModal(false)} style={{ padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveDiscrepancy} style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label className="form-label">Invoice Number</label>
                  <input
                    type="text"
                    className="form-input"
                    value={invoiceRef}
                    onChange={e => setInvoiceRef(e.target.value)}
                    placeholder="Invoice Number"
                  />
                </div>
                <div>
                  <label className="form-label">Bundle Number</label>
                  <input
                    type="text"
                    className="form-input"
                    value={discrepancyForm.bundleNumber}
                    onChange={e => setDiscrepancyForm({ ...discrepancyForm, bundleNumber: e.target.value })}
                    placeholder="Enter bundle number"
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="form-label">Affected Item</label>
                <select
                  className="form-select"
                  value={discrepancyForm.itemKey}
                  onChange={e => {
                    const found = supplierData?.pendingItems.find(x => x.sku.id === e.target.value);
                    setDiscrepancyForm(prev => ({
                      ...prev,
                      itemKey: e.target.value,
                      itemType: found?.sku.itemType || 'FABRIC',
                      brand: found?.sku.brand || '',
                      quality: found?.sku.quality || '',
                      shade: found?.sku.shade || '',
                      category: found?.sku.category || '',
                      name: found?.sku.name || '',
                      artNo: found?.sku.artNo || '',
                      size: found?.sku.size || '',
                      expectedQty: found ? String(found.totalRemainingQty) : prev.expectedQty
                    }));
                  }}
                >
                  <option value="">Select affected item...</option>
                  {supplierData?.pendingItems.map(p => (
                    <option key={p.sku.id} value={p.sku.id}>
                      {p.sku.itemType === 'FABRIC'
                        ? `[Fabric] ${p.sku.brand} — ${p.sku.quality || p.sku.category} (Shade: ${p.sku.shade || 'Std'})`
                        : p.sku.itemType === 'READY_MADE'
                        ? `[Ready-Made] ${p.sku.name} (Art: ${p.sku.artNo || '—'}, Size: ${p.sku.size || '—'})`
                        : `[Accessory] ${p.sku.name} (${p.sku.category}, Size: ${p.sku.size || 'Std'})`}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="form-label">Discrepancy Issue Type <span className="required">*</span></label>
                <select
                  className="form-select"
                  value={discrepancyForm.issueType}
                  onChange={e => setDiscrepancyForm({ ...discrepancyForm, issueType: e.target.value })}
                  required
                >
                  <option value="MISSING_FROM_BUNDLE">Lump / Set / Item NOT Available in Bundle (Missing)</option>
                  <option value="WRONG_ITEM_PACKED">Wrong Item / Shade / Size Packed in Bundle</option>
                  <option value="SHORT_QUANTITY">Physical Quantity Less than Invoice (Shortage)</option>
                  <option value="DAMAGED_DEFECTIVE">Damaged, Defective, Stained Goods in Bundle</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label className="form-label">Expected Qty on Invoice</label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input"
                    placeholder="Claimed Qty"
                    value={discrepancyForm.expectedQty}
                    onChange={e => setDiscrepancyForm({ ...discrepancyForm, expectedQty: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">Actual Qty Found in Bundle</label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input"
                    placeholder="0"
                    value={discrepancyForm.receivedQty}
                    onChange={e => setDiscrepancyForm({ ...discrepancyForm, receivedQty: e.target.value })}
                  />
                </div>
              </div>

              {discrepancyForm.expectedQty && (
                <div style={{ marginBottom: 14, background: '#fef3c7', padding: '8px 12px', borderRadius: 6, fontSize: 12, color: '#92400e', fontWeight: 600 }}>
                  Calculated Shortage: {(parseFloat(discrepancyForm.expectedQty) - (parseFloat(discrepancyForm.receivedQty) || 0)).toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'Meters' : 'Units'}
                </div>
              )}

              <div style={{ marginBottom: 20 }}>
                <label className="form-label">Notes / Observation</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Observation notes"
                  value={discrepancyForm.notes}
                  onChange={e => setDiscrepancyForm({ ...discrepancyForm, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowDiscrepancyModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={discrepancySubmitting} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#b45309', borderColor: '#b45309' }}>
                  {discrepancySubmitting ? <span className="spinner" /> : <AlertTriangle size={15} />}
                  Record Discrepancy Notice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          GRN (GOODS RECEIPT NOTE) SUMMARY MODAL
          ───────────────────────────────────────────────────────────────────────────── */}
      {showGrnModal && (
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
            maxWidth: 720,
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileCheck size={18} /> {grnSuccess 
                    ? (isPartialReceiving ? 'Partial Goods Receipt Note Issued' : 'Goods Receipt Note Issued') 
                    : (isPartialReceiving ? 'Finalize Partial Goods Receipt Note (GRN)' : 'Goods Receipt Note (GRN) Summary')}
                  {isPartialReceiving && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                      PARTIAL RECEIPT
                    </span>
                  )}
                </h2>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Invoice: {invoiceRef || 'N/A'} • {supplierData?.supplier.name}
                </div>
              </div>
              <button 
                className="btn btn-ghost" 
                onClick={() => {
                  setShowGrnModal(false);
                  if (grnSuccess) setGrnSuccess(null);
                }} 
                style={{ padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {grnSuccess ? (
              <div style={{ padding: 30, textAlign: 'center' }}>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <CheckCircle2 size={36} />
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px', color: '#0f172a' }}>
                  {grnSuccess.grnNumber} {isPartialReceiving ? '(Partial GRN)' : ''} Issued Successfully!
                </h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13.5, maxWidth: 460, margin: '0 auto 16px', lineHeight: 1.5 }}>
                  Successfully inwarded <strong>{grnSuccess.totalRolls} rolls</strong> totaling <strong>{grnSuccess.totalQuantity.toFixed(1)} units</strong> for <strong>{grnSuccess.supplierName}</strong>. Inventory put-away is ready.
                </p>

                {isPartialReceiving && (
                  <div style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 6,
                    padding: '10px 16px',
                    maxWidth: 480,
                    margin: '0 auto 22px',
                    fontSize: 12.5,
                    color: '#92400e',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10
                  }}>
                    <AlertCircle size={18} color="#b45309" style={{ flexShrink: 0 }} />
                    <div>
                      <strong>Partial Receipt Finalized:</strong> Remaining {(supplierData?.totalPendingQty ?? 0).toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'meters' : 'units'} stay open on the purchase order so you can inward the rest later.
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button 
                    className="btn btn-primary"
                    onClick={() => printGrnVoucher(grnSuccess.id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                  >
                    <Printer size={16} /> Print {isPartialReceiving ? 'Partial ' : ''}GRN Voucher
                  </button>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => navigate(`/inventory/grn/${grnSuccess.id}`)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <FileCheck size={16} /> View in GRN Register
                  </button>
                  <button 
                    className="btn btn-ghost"
                    onClick={() => {
                      setGrnSuccess(null);
                      setShowGrnModal(false);
                    }}
                  >
                    Done (Start Next Session)
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ padding: 20, overflowY: 'auto' }}>
                  {/* Partial Receiving Prompt Notice */}
                  {isPartialReceiving ? (
                    <div style={{
                      background: '#fffbeb',
                      border: '1.5px solid #f59e0b',
                      borderRadius: 8,
                      padding: '12px 16px',
                      marginBottom: 16,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12
                    }}>
                      <div style={{ color: '#b45309', marginTop: 2 }}>
                        <AlertCircle size={20} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: '#92400e', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                          Partial Delivery Detected — Finalize Partial GRN
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 12, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                            PARTIAL RECEIVING
                          </span>
                        </div>
                        <div style={{ fontSize: 12.5, color: '#78350f', lineHeight: 1.5 }}>
                          You have inwarded <strong>{totalSessionQuantity.toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'M' : 'units'}</strong> ({sessionRolls.length} rolls) in this delivery session. The purchase order(s) still have <strong>{(supplierData?.totalPendingQty ?? 0).toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'M' : 'units'}</strong> pending.
                        </div>
                        <div style={{ fontSize: 12, color: '#92400e', marginTop: 4, fontWeight: 600 }}>
                          Finalizing this Partial GRN will book the received inventory and print your official Partial GRN voucher. Remaining items stay open on the PO so you can inward the rest later.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      background: '#f0fdf4',
                      border: '1px solid #86efac',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 16,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 12.5,
                      color: '#166534'
                    }}>
                      <CheckCircle2 size={18} color="#16a34a" style={{ flexShrink: 0 }} />
                      <div>
                        <strong>Full Delivery Confirmed:</strong> All pending quantities across this supplier's open PO(s) are completely fulfilled.
                      </div>
                    </div>
                  )}

                  {/* Summary Metric Strip (5 columns) */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>SUPPLIER</div>
                      <strong style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {supplierData?.supplier.name}
                      </strong>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>TOTAL BUNDLES</div>
                      <strong style={{ fontSize: 15 }}>{groupedSessionRolls.length} Bales</strong>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>SESSION ROLLS</div>
                      <strong style={{ fontSize: 15 }}>{sessionRolls.length} Rolls</strong>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>SESSION QTY</div>
                      <strong style={{ fontSize: 15, color: '#065f46' }}>
                        {totalSessionQuantity.toFixed(1)} {itemTypeFilter === 'FABRIC' ? 'M' : 'Pcs'}
                      </strong>
                    </div>
                    <div style={{
                      background: isPartialReceiving ? '#fffbeb' : '#f0fdf4',
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: isPartialReceiving ? '1px solid #fde68a' : '1px solid #bbf7d0'
                    }}>
                      <div style={{ fontSize: 10.5, color: isPartialReceiving ? '#92400e' : '#166534', fontWeight: 600 }}>
                        PO BALANCE
                      </div>
                      <strong style={{ fontSize: 14, color: isPartialReceiving ? '#b45309' : '#16a34a', display: 'block', whiteSpace: 'nowrap' }}>
                        {isPartialReceiving ? `${(supplierData?.totalPendingQty ?? 0).toFixed(1)} ${itemTypeFilter === 'FABRIC' ? 'M' : 'Pcs'}` : '0 Fulfilled'}
                      </strong>
                      <div style={{ fontSize: 10, color: isPartialReceiving ? '#b45309' : '#15803d', marginTop: 1 }}>
                        {isPartialReceiving ? 'Open for later' : '100% Complete'}
                      </div>
                    </div>
                  </div>

                  {/* Gate Remarks */}
                  <div style={{ marginBottom: 16, background: '#f8fafc', padding: '12px 14px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                      Gate Remarks
                    </label>
                    <input 
                      type="text"
                      className="form-input"
                      placeholder="e.g. Driver verified, unloaded at Dock 2"
                      value={grnRemarks}
                      onChange={e => setGrnRemarks(e.target.value)}
                      style={{ height: 34, fontSize: 13 }}
                    />
                  </div>

                  {/* Notice of Discrepancies if any */}
                  {discrepancies.length > 0 && (
                    <div style={{ marginBottom: 16, border: '1.5px solid #f59e0b', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ background: '#fffbeb', padding: '10px 14px', fontWeight: 700, fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertTriangle size={16} color="#b45309" /> OFFICIAL NOTICE OF BUNDLE SHORTAGE &amp; DISCREPANCIES
                      </div>
                      <table className="table" style={{ width: '100%', fontSize: 11.5, margin: 0 }}>
                        <thead style={{ background: '#fef3c7' }}>
                          <tr>
                            <th style={{ padding: '6px 10px' }}>Bundle No.</th>
                            <th style={{ padding: '6px 10px' }}>Expected Item</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right' }}>Claimed</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right' }}>Found</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', color: '#991b1b' }}>Shortage</th>
                            <th style={{ padding: '6px 10px' }}>Issue Type</th>
                            <th style={{ padding: '6px 10px' }}>Observations</th>
                          </tr>
                        </thead>
                        <tbody>
                          {discrepancies.map(d => {
                            const claimed = d.expectedQty ?? 0;
                            const found = d.receivedQty ?? 0;
                            const shortage = Math.max(0, claimed - found);
                            const uom = (d.itemType === 'FABRIC' || itemTypeFilter === 'FABRIC') ? 'm' : 'pcs';
                            return (
                              <tr key={d.id} style={{ borderBottom: '1px solid #fde68a' }}>
                                <td style={{ padding: '6px 10px', fontWeight: 700 }}>{d.bundleNumber || 'Unbundled'}</td>
                                <td style={{ padding: '6px 10px' }}>
                                  <div style={{ fontWeight: 600 }}>{d.name || [d.brand, d.shade].filter(Boolean).join(' ') || 'General Item'}</div>
                                  {d.artNo && <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>Art: {d.artNo} {d.size ? `• Size: ${d.size}` : ''}</div>}
                                </td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{d.expectedQty ? `${d.expectedQty} ${uom}` : '—'}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{found} {uom}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>
                                  {d.expectedQty != null ? `${shortage.toFixed(1)} ${uom}` : 'Missing'}
                                </td>
                                <td style={{ padding: '6px 10px', color: '#b45309', fontWeight: 600 }}>{ISSUE_TYPE_LABELS[d.issueType] || d.issueType}</td>
                                <td style={{ padding: '6px 10px', color: '#64748b' }}>{d.notes || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Grouped Rolls Table */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {groupedSessionRolls.map(grp => (
                      <div key={grp.bundleNumber} style={{ border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ background: '#f1f5f9', padding: '6px 10px', display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                          <span>Bundle / Bale: {grp.bundleNumber}</span>
                          <span style={{ color: '#065f46' }}>{grp.rolls.length} roll(s) • {grp.totalQty.toFixed(1)}m</span>
                        </div>
                        <table className="table" style={{ width: '100%', fontSize: 11.5, margin: 0 }}>
                          <tbody>
                            {grp.rolls.map((r, i) => (
                              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <td style={{ padding: '6px 10px', width: 30 }}>{i + 1}</td>
                                <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{r.batchCode}</td>
                                <td style={{ padding: '6px 10px' }}>{r.brand} — {r.quality || r.category} ({r.shade || ''})</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>{r.quantity}m</td>
                                <td style={{ padding: '6px 10px', fontWeight: 600, color: '#1d4ed8' }}>{r.poLine?.po.poNumber || 'Unlinked'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ padding: '14px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#fafbfc' }}>
                  <button className="btn btn-secondary" onClick={() => setShowGrnModal(false)} disabled={issuingGrn}>
                    Cancel
                  </button>
                  <button 
                    className="btn btn-primary" 
                    onClick={handleFinalizeGrn} 
                    disabled={issuingGrn || sessionRolls.length === 0} 
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      fontWeight: 700,
                      background: isPartialReceiving ? '#d97706' : 'var(--color-brand)',
                      borderColor: isPartialReceiving ? '#d97706' : 'var(--color-brand)',
                      color: '#fff',
                      padding: '8px 18px'
                    }}
                  >
                    {issuingGrn ? <span className="spinner" /> : <Printer size={16} />}
                    {isPartialReceiving ? 'Finalize Partial GRN & Print Voucher' : 'Finalize Full GRN & Print Voucher'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Direct Inward Finalize GRN Modal ── */}
      {showDirectGrnModal && (
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
            maxWidth: 580,
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
                <FileCheck size={18} color="var(--color-brand)" /> Finalize Direct Inward &amp; Issue GRN
              </h2>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowDirectGrnModal(false)}
                style={{ padding: 4, color: 'var(--color-text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 20 }}>
              {/* Summary Metric Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                padding: 14,
                background: '#f8fafc',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--color-border)',
                marginBottom: 16,
                fontSize: 13
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Supplier</div>
                  <div style={{ fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{directSupplierInput || 'Direct Inward Supplier'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Supplier Invoice</div>
                  <div style={{ fontWeight: 600, color: '#0f172a', marginTop: 2 }}>{directInvoiceRef || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Invoice Date</div>
                  <div style={{ fontWeight: 600, color: '#0f172a', marginTop: 2 }}>{directInvoiceDate ? formatDate(directInvoiceDate) : '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Client</div>
                  <div style={{ fontWeight: 700, color: directClientInput ? '#1e40af' : '#475569', marginTop: 2 }}>
                    {directClientInput || 'General Stock'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Total Items / Rolls</div>
                  <div style={{ fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{directSessionBatches.length} items</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Total Quantity</div>
                  <div style={{ fontWeight: 700, color: '#065f46', marginTop: 2 }}>
                    {directSessionBatches.reduce((acc, b) => acc + (b.quantity || 0), 0).toFixed(2)}
                  </div>
                </div>
              </div>

              {pendingImportLines.length > 0 && (
                <div className="alert alert-warning" style={{ marginBottom: 16, fontSize: 13 }}>
                  <strong>{pendingImportLines.length} imported item(s) are not fully received.</strong> The GRN records only the lumps
                  inwarded so far; those items stay in the import list for the rest.
                </div>
              )}

              {/* Gate Remarks */}
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label" style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
                  Gate Remarks
                </label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="e.g. Sample rolls received in good condition, verified at Dock 1..."
                  value={directGrnRemarks}
                  onChange={e => setDirectGrnRemarks(e.target.value)}
                  style={{ fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDirectGrnModal(false)}
                  disabled={issuingDirectGrn}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleFinalizeDirectGrn}
                  disabled={issuingDirectGrn || directSessionBatches.length === 0}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                >
                  {issuingDirectGrn ? <span className="spinner" /> : <FileCheck size={16} />}
                  Confirm &amp; Issue Official GRN
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Add Client Modal (Identical to PO implementation) ── */}
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
          zIndex: 1100,
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

            <form onSubmit={handleDirectQuickAddClientSubmit} style={{ padding: 20 }}>
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
                <label className="form-label">Type of Client</label>
                <input
                  type="text"
                  className="form-input"
                  list="direct-client-types"
                  placeholder="Select or enter type (e.g. School, Wholesaler, Retailer, Corporate)"
                  value={quickClientForm.clientType}
                  onChange={e => setQuickClientForm({ ...quickClientForm, clientType: e.target.value })}
                />
                <datalist id="direct-client-types">
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

      {/* ── Quick Add Supplier Modal ── */}
      {showQuickAddSupplierModal && (
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
          zIndex: 1100,
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
                onClick={() => setShowQuickAddSupplierModal(false)}
                style={{ padding: 4, color: 'var(--color-text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleDirectQuickAddSupplierSubmit} style={{ padding: 20 }}>
              {quickSupplierError && (
                <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                  {quickSupplierError}
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Official Legal / Mill Name <span className="required">*</span></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Siyaram Silk Mills Ltd., Raymond Limited"
                  value={quickSupplierForm.name}
                  onChange={e => setQuickSupplierForm({ ...quickSupplierForm, name: e.target.value })}
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
                    placeholder="e.g. Surat, Bhilwara"
                    value={quickSupplierForm.city}
                    onChange={e => setQuickSupplierForm({ ...quickSupplierForm, city: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Phone</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. +91 98200 12345"
                    value={quickSupplierForm.phone}
                    onChange={e => setQuickSupplierForm({ ...quickSupplierForm, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Contact Person</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Mr. Rajesh / Sales Manager"
                    value={quickSupplierForm.contactPerson}
                    onChange={e => setQuickSupplierForm({ ...quickSupplierForm, contactPerson: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Factory Address</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. B-12, Textile Market, Ring Road"
                    value={quickSupplierForm.address}
                    onChange={e => setQuickSupplierForm({ ...quickSupplierForm, address: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowQuickAddSupplierModal(false)}
                  disabled={quickSupplierSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={quickSupplierSubmitting}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {quickSupplierSubmitting ? <span className="spinner" /> : 'Save & Select Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
