import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../../utils/api';
import { 
  LogIn, 
  ArrowLeft, 
  ArrowRight, 
  Printer, 
  CheckCircle2, 
  Package, 
  Eye, 
  AlertTriangle, 
  X, 
  Search,
  FileCheck,
  Users,
  AlertCircle
} from 'lucide-react';
import { printTSPL, autoPrintReceivedLabel } from '../../../utils/printer';
import { formatDate } from '../../../utils/format';
import '../../../styles/components.css';

interface POLine {
  id: string;
  orderedQty: number;
  receivedQty: number;
  itemType?: string | null;
  category?: string | null;
  brand?: string | null;
  quality?: string | null;
  shade?: string | null;
  size?: string | null;
  name?: string | null;
  artNo?: string | null;
  uom?: string | null;
  batches: { id: string; batchCode: string; quantity: number; grnId?: string | null }[];
  allocations?: {
    id: string;
    clientId: string;
    clientName: string;
    allocatedQty: number;
    receivedQty: number;
    notes?: string | null;
  }[];
}

interface PO {
  id: string;
  poNumber: string;
  supplierId?: string;
  supplier?: { id: string; name: string; code?: string } | null;
  supplierName: string;
  status: string;
  expectedDate: string;
  targetClient?: string | null;
  lines: POLine[];
  grns?: any[];
}

// Helper to clean up float precision issues
const cleanNumber = (val: number, maxDecimals = 2): number => {
  return Math.round((val + Number.EPSILON) * Math.pow(10, maxDecimals)) / Math.pow(10, maxDecimals);
};

const formatQty = (val: number, maxDecimals = 2): string => {
  const rounded = cleanNumber(val, maxDecimals);
  return Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(maxDecimals)));
};

export default function ReceivePOPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledInvoice = searchParams.get('invoiceRef');

  const qtyInputRef = useRef<HTMLInputElement>(null);

  const [po, setPo] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  // Modal & Active Line state — strictly false on initial load!
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [viewingBarcodeLine, setViewingBarcodeLine] = useState<POLine | null>(null);

  const [quantity, setQuantity] = useState('');
  const [invoiceRef, setInvoiceRef] = useState(prefilledInvoice || '');
  const [supplierBundle, setSupplierBundle] = useState('');
  
  const [skuOverride, setSkuOverride] = useState({ brand: '', quality: '', shade: '', size: '', category: '' });
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState('');
  const [recentBatch, setRecentBatch] = useState<{ batchCode: string; quantity: number } | null>(null);

  // Line search & sorting state — PO Order default
  const [lineSearch, setLineSearch] = useState('');
  const [lineSort, setLineSort] = useState<'default' | 'pending' | 'shade' | 'brand'>('default');

  // Finalize GRN & Print Modal State
  const [showGrnFinalizeModal, setShowGrnFinalizeModal] = useState(false);
  const [grnRemarks, setGrnRemarks] = useState('');
  const [issuingGrn, setIssuingGrn] = useState(false);

  // Discrepancy reporting state
  const [showDiscrepancyModal, setShowDiscrepancyModal] = useState(false);
  const [discrepancySubmitting, setDiscrepancySubmitting] = useState(false);
  const [discrepancyForm, setDiscrepancyForm] = useState({
    bundleNumber: '',
    lineId: '',
    itemType: 'FABRIC',
    brand: '',
    quality: '',
    shade: '',
    size: '',
    category: '',
    name: '',
    artNo: '',
    issueType: 'MISSING_FROM_BUNDLE',
    expectedQty: '',
    receivedQty: '0',
    notes: ''
  });

  const load = () => {
    setLoading(true);
    setPageError('');
    api.get(`/api/purchase-orders/${id}`)
       .then(r => {
         setPo(r.data);
         // Only set invoiceRef if the PO is already finalized (so it displays the confirmed invoice),
         // or if prefilledInvoice was passed via URL query params.
         // Never auto-fill an open/pending PO input with past GRN invoices.
         if (r.data.status === 'RECEIVED') {
           const finalizedInv = r.data.grns && r.data.grns.length > 0 ? r.data.grns[0].invoiceRef : '';
           if (finalizedInv) setInvoiceRef(finalizedInv);
         } else if (prefilledInvoice) {
           setInvoiceRef(prefilledInvoice);
         }
       })
       .catch(err => {
         setPageError(err?.response?.data?.error || err?.message || 'Failed to load purchase order');
       })
       .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const currentLine = po?.lines ? (po.lines.find(l => l.id === selectedLine) || null) : null;
  const poType = po?.lines?.[0]?.itemType || 'FABRIC';

  const currentLineItemType = currentLine?.itemType || poType;
  const isCurrentFabric = currentLineItemType === 'FABRIC';
  const isCurrentReadyMade = currentLineItemType === 'READY_MADE';
  const currentUnit = currentLine?.uom || (isCurrentFabric ? 'Meters' : isCurrentReadyMade ? 'Pieces' : 'Units');

  const isLineComplete = (line: POLine) => line.receivedQty >= line.orderedQty || (line.orderedQty - line.receivedQty) <= 0.001;

  const allComplete = po?.lines && po.lines.length > 0 ? po.lines.every(l => isLineComplete(l)) : false;

  const allBatches = useMemo(() => {
    return (po?.lines || []).flatMap(l => l.batches || []);
  }, [po?.lines]);

  const hasUnfinalizedBatches = useMemo(() => {
    return allBatches.some(b => !b.grnId);
  }, [allBatches]);

  const hasGrn = Boolean(po?.grns && po.grns.length > 0);
  const latestGrn = hasGrn ? po!.grns![0] : null;

  // Fully finalized means: all received batches have a GRN, at least one batch exists, and order is completely received
  const isPoFullyFinalized = Boolean(
    allBatches.length > 0 &&
    !hasUnfinalizedBatches &&
    (po?.status === 'RECEIVED' || allComplete)
  );

  // Filtered and sorted lines for touch list: Fulfilled items ALWAYS sink to the bottom!
  const sortedAndFilteredLines = useMemo(() => {
    if (!po?.lines) return [];
    let list = [...po.lines];
    const q = lineSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(l => {
        const brand = (l.brand || '').toLowerCase();
        const shade = (l.shade || '').toLowerCase();
        const quality = (l.quality || '').toLowerCase();
        const name = (l.name || '').toLowerCase();
        const artNo = (l.artNo || '').toLowerCase();
        const cat = (l.category || '').toLowerCase();
        return brand.includes(q) || shade.includes(q) || quality.includes(q) || name.includes(q) || artNo.includes(q) || cat.includes(q);
      });
    }

    list.sort((a, b) => {
      // 1. Fulfilled items always sink to the bottom
      const aComplete = isLineComplete(a) ? 1 : 0;
      const bComplete = isLineComplete(b) ? 1 : 0;
      if (aComplete !== bComplete) return aComplete - bComplete;

      // 2. Unfulfilled items sorted according to lineSort:
      if (lineSort === 'shade') return (a.shade || '').localeCompare(b.shade || '', undefined, { numeric: true });
      if (lineSort === 'brand') return (a.brand || '').localeCompare(b.brand || '');
      return 0; // PO Order
    });

    return list;
  }, [po?.lines, lineSearch, lineSort]);

  // Open the "Receive Roll / Item" Modal ONLY on explicit user tap/click on unfulfilled item
  const openReceiveModal = (line: POLine) => {
    // If line is already complete, open the Barcode Viewer instead of allowing multiple additions!
    if (line.receivedQty >= line.orderedQty) {
      setViewingBarcodeLine(line);
      return;
    }

    setSelectedLine(line.id);
    const remaining = cleanNumber(Math.max(0, line.orderedQty - line.receivedQty));
    setQuantity(remaining > 0 ? formatQty(remaining) : formatQty(line.orderedQty));
    setError('');
    setRecentBatch(null);
    setSkuOverride({
      brand: line.brand || '',
      quality: line.quality || '',
      shade: line.shade || '',
      size: line.size || '',
      category: line.category || '',
    });
    setShowReceiveModal(true);
    setTimeout(() => qtyInputRef.current?.focus(), 120);
  };

  const closeReceiveModal = () => {
    setShowReceiveModal(false);
    setSelectedLine(null);
    setError('');
    setRecentBatch(null);
  };

  // Keyboard navigation: Escape closes modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showReceiveModal && !showDiscrepancyModal) closeReceiveModal();
        if (viewingBarcodeLine) setViewingBarcodeLine(null);
        if (showDiscrepancyModal) setShowDiscrepancyModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showReceiveModal, showDiscrepancyModal, viewingBarcodeLine]);

  const openDiscrepancyModal = (line?: POLine | null) => {
    const targetLine = line || currentLine;
    const remaining = targetLine ? cleanNumber(Math.max(0, targetLine.orderedQty - targetLine.receivedQty)) : 0;
    setDiscrepancyForm({
      bundleNumber: supplierBundle.trim(),
      lineId: targetLine?.id || '',
      itemType: targetLine?.itemType || 'FABRIC',
      brand: targetLine?.brand || '',
      quality: targetLine?.quality || '',
      shade: targetLine?.shade || '',
      size: targetLine?.size || '',
      category: targetLine?.category || '',
      name: targetLine?.name || '',
      artNo: targetLine?.artNo || '',
      issueType: 'MISSING_FROM_BUNDLE',
      expectedQty: remaining > 0 ? formatQty(remaining) : '',
      receivedQty: '0',
      notes: ''
    });
    setShowDiscrepancyModal(true);
  };

  const handleSaveDiscrepancy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!po) return;
    const sId = po.supplierId || po.supplier?.id;
    if (!sId) {
      alert('Supplier ID is not linked to this purchase order.');
      return;
    }
    const inv = invoiceRef.trim() || po.poNumber;

    setDiscrepancySubmitting(true);
    try {
      await api.post('/api/purchase-orders/supplier-inbound/discrepancies', {
        supplierId: sId,
        invoiceRef: inv,
        bundleNumber: discrepancyForm.bundleNumber.trim(),
        itemType: discrepancyForm.itemType,
        brand: discrepancyForm.brand || undefined,
        quality: discrepancyForm.quality || undefined,
        shade: discrepancyForm.shade || undefined,
        size: discrepancyForm.size || undefined,
        category: discrepancyForm.category || undefined,
        name: discrepancyForm.name || undefined,
        artNo: discrepancyForm.artNo || undefined,
        issueType: discrepancyForm.issueType,
        expectedQty: discrepancyForm.expectedQty ? parseFloat(discrepancyForm.expectedQty) : undefined,
        receivedQty: discrepancyForm.receivedQty ? parseFloat(discrepancyForm.receivedQty) : 0,
        notes: discrepancyForm.notes.trim() || undefined,
      });

      setShowDiscrepancyModal(false);
      alert(`Discrepancy recorded for ${discrepancyForm.bundleNumber || 'item'}. It will be included on GRN shortage records.`);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to record discrepancy');
    } finally {
      setDiscrepancySubmitting(false);
    }
  };

  // Issues a GRN for the rolls not yet on one, then prints it. When every roll is
  // already finalized, reprints the latest GRN instead.
  const handlePrintGRN = async (overrideRemarks?: string) => {
    if (!po) return;
    const unfinalized = allBatches.filter(b => !b.grnId);
    if (unfinalized.length === 0) {
      if (latestGrn) await handlePrintSpecificGRN(latestGrn.id);
      else alert('No received rolls to put on a GRN yet.');
      return;
    }

    setIssuingGrn(true);
    // Open the window during the click so the browser does not block it
    const printWindow = window.open('', '_blank');
    printWindow?.document.write('<div style="font-family:sans-serif;padding:40px;text-align:center;color:#64748b;">Issuing Goods Receipt Note...</div>');
    try {
      const rem = (overrideRemarks || grnRemarks).trim();
      const { data: grn } = await api.post('/api/grn', {
        supplierId: po.supplierId || po.supplier?.id || undefined,
        supplierName: po.supplierName,
        poId: po.id,
        poNumber: po.poNumber,
        invoiceRef: invoiceRef.trim() || undefined,
        remarks: rem || undefined,
        batchIds: unfinalized.map(b => b.id),
      });
      const response = await api.get(`/api/grn/${grn.id}/print`, { responseType: 'text' });
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(response.data);
        printWindow.document.close();
      }
      setShowGrnFinalizeModal(false);
      // Refresh PO data to update issued GRNs
      try {
        const updatedPoRes = await api.get(`/api/purchase-orders/${id}`);
        setPo(updatedPoRes.data);
      } catch {
        // silent
      }
    } catch (err: any) {
      printWindow?.close();
      alert(err.response?.data?.error || 'Failed to issue Goods Receipt Note');
    } finally {
      setIssuingGrn(false);
    }
  };

  const handlePrintSpecificGRN = async (grnId: string) => {
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

  const handleReceive = async () => {
    if (!selectedLine) return;
    setError('');
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      setError('Please enter a valid quantity received.');
      return;
    }

    setReceiving(true);
    try {
      const res = await api.post(`/api/purchase-orders/${id}/lines/${selectedLine}/receive`, {
        batches: [{ 
          quantity: String(qty), 
          invoiceRef: invoiceRef.trim() || undefined, 
          supplierBundle: supplierBundle.trim() || undefined,
        }],
        skuOverride,
      });

      const newBatch = res.data.newRolls?.[0];
      if (newBatch?.batchCode) {
        setRecentBatch({ batchCode: newBatch.batchCode, quantity: qty });
        await autoPrintReceivedLabel(newBatch.batchCode);
      }

      // Refresh PO data directly
      const updatedPoRes = await api.get(`/api/purchase-orders/${id}`);
      const updatedPo = updatedPoRes.data;
      setPo(updatedPo);

      // Check current line status to update remaining balance
      const updatedLine = updatedPo?.lines?.find((l: POLine) => l.id === selectedLine);
      if (updatedLine) {
        const remaining = cleanNumber(Math.max(0, updatedLine.orderedQty - updatedLine.receivedQty));
        if (remaining <= 0.001) {
          // Line fulfilled! Clear quantity, do not allow further submissions
          setQuantity('');
        } else {
          setQuantity(formatQty(remaining));
          setTimeout(() => qtyInputRef.current?.focus(), 100);
        }
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to receive item');
    } finally {
      setReceiving(false);
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

  // Overall PO Statistics with clear Unit and Total Lumps/Rolls
  const poStats = useMemo(() => {
    if (!po?.lines) return { totalLines: 0, completedLines: 0, totalOrdered: 0, totalReceived: 0, totalRemaining: 0, progressPct: 0, totalBatches: 0 };
    const totalLines = po.lines.length;
    const completedLines = po.lines.filter(l => isLineComplete(l)).length;
    const totalOrdered = cleanNumber(po.lines.reduce((sum, l) => sum + (l.orderedQty || 0), 0));
    const totalReceived = cleanNumber(po.lines.reduce((sum, l) => sum + (l.receivedQty || 0), 0));
    const totalRemaining = cleanNumber(Math.max(0, totalOrdered - totalReceived));
    const progressPct = totalOrdered > 0 ? Math.min(100, Math.round((totalReceived / totalOrdered) * 100)) : 0;
    const totalBatches = po.lines.reduce((sum, l) => sum + (l.batches?.length || 0), 0);
    return { totalLines, completedLines, totalOrdered, totalReceived, totalRemaining, progressPct, totalBatches };
  }, [po?.lines]);

  const isPoPartial = poStats.totalRemaining > 0 && poStats.totalReceived > 0;

  if (loading) return <div className="loading-center"><span className="spinner spinner-lg" /></div>;
  if (pageError) {
    return (
      <div style={{ maxWidth: 540, margin: '80px auto', textAlign: 'center', padding: 24, background: '#fff', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ color: 'var(--color-danger)', fontSize: 16, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <AlertCircle size={20} /> Error Loading Purchase Order
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 20 }}>{pageError}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={() => load()}>Retry</button>
          <button className="btn btn-primary" onClick={() => navigate('/entry-gate')}>Back to Entry Gate</button>
        </div>
      </div>
    );
  }
  if (!po) {
    return (
      <div style={{ maxWidth: 540, margin: '80px auto', textAlign: 'center', padding: 24, background: '#fff', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)', marginBottom: 8 }}>Purchase Order Not Found</div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 20 }}>The requested PO could not be located in the database.</p>
        <button className="btn btn-secondary" onClick={() => navigate('/entry-gate')}>Back to Entry Gate</button>
      </div>
    );
  }

  const isCurrentLineFullyReceived = currentLine ? isLineComplete(currentLine) : false;

  const unfulfilledLines = sortedAndFilteredLines.filter(l => !isLineComplete(l));
  const fulfilledLines = sortedAndFilteredLines.filter(l => isLineComplete(l));

  const renderLineCard = (line: POLine, originalIdx: number, isComplete: boolean) => {
    const lineIsFabric = line.itemType === 'FABRIC' || (poType === 'FABRIC' && !line.itemType);
    const lineIsReadyMade = line.itemType === 'READY_MADE' || (poType === 'READY_MADE' && !line.itemType);
    const lineUnit = line.uom ? line.uom.toLowerCase() : (lineIsFabric ? 'm' : 'pcs');
    const remainingQty = cleanNumber(Math.max(0, line.orderedQty - line.receivedQty));
    const progress = line.orderedQty > 0 ? (line.receivedQty / line.orderedQty) * 100 : 0;

    return (
      <div
        key={line.id}
        onClick={() => {
          if (isComplete) {
            setViewingBarcodeLine(line);
          } else {
            openReceiveModal(line);
          }
        }}
        style={{
          background: isComplete ? '#fcfdfd' : '#fff',
          borderRadius: 'var(--radius-lg)',
          border: isComplete ? '1.5px solid #86efac' : '1.5px solid var(--color-border)',
          borderLeft: isComplete ? '6px solid #16a34a' : '6px solid var(--color-brand)',
          padding: '18px 22px',
          boxShadow: 'var(--shadow-sm)',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          WebkitTapHighlightColor: 'transparent',
          opacity: isComplete ? 0.95 : 1
        }}
      >
        {/* Main Card Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            
            {/* Item Title & Status Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 700, fontSize: 13 }}>#{originalIdx + 1}</span>
              
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                {lineIsFabric ? (
                  <>{line.brand || 'Brand'} — {line.quality || 'Standard Fabric'}</>
                ) : lineIsReadyMade ? (
                  <>{line.name || line.brand || 'Garment Item'}</>
                ) : (
                  <>{line.category ? `${line.category} — ` : ''}{line.name || 'Accessory Item'}</>
                )}
              </span>

              {isComplete ? (
                <span className="badge badge-success" style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px' }}>
                  <CheckCircle2 size={13} /> Fulfilled
                </span>
              ) : (
                <span className="badge badge-warning" style={{ fontSize: 11.5, padding: '3px 8px' }}>
                  Needs {formatQty(remainingQty)} {lineUnit}
                </span>
              )}
            </div>

            {/* Specifications Row */}
            <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.5 }}>
              {lineIsFabric ? (
                <>
                  Fabric Type: <strong>{line.category === 'PLAIN_SHIRTING' ? 'Plain Shirting' : (line.category || 'Fabric')}</strong>
                  <span style={{ margin: '0 8px', color: '#cbd5e1' }}>•</span>
                  Shade: <strong>{line.shade || '—'}</strong>
                </>
              ) : lineIsReadyMade ? (
                <>
                  Fabric Type: <strong>{line.category || '—'}</strong>
                  {line.shade && (
                    <>
                      <span style={{ margin: '0 8px', color: '#cbd5e1' }}>•</span>
                      Color / Shade: <strong>{line.shade}</strong>
                    </>
                  )}
                  <span style={{ margin: '0 8px', color: '#cbd5e1' }}>•</span>
                  Art No: <strong style={{ fontFamily: 'monospace' }}>{line.artNo || '—'}</strong>
                  <span style={{ margin: '0 8px', color: '#cbd5e1' }}>•</span>
                  Size: <strong>{line.size || '—'}</strong>
                </>
              ) : (
                <>
                  Category: <strong>{line.category || '—'}</strong>
                  {line.quality && (
                    <>
                      <span style={{ margin: '0 8px', color: '#cbd5e1' }}>•</span>
                      Spec: <strong>{line.quality}</strong>
                    </>
                  )}
                  {line.shade && (
                    <>
                      <span style={{ margin: '0 8px', color: '#cbd5e1' }}>•</span>
                      Color: <strong>{line.shade}</strong>
                    </>
                  )}
                  {line.size && (
                    <>
                      <span style={{ margin: '0 8px', color: '#cbd5e1' }}>•</span>
                      Size: <strong>{line.size}</strong>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Client Reference */}
            {(() => {
              const lineClients = (line.allocations && line.allocations.length > 0)
                ? Array.from(new Set(line.allocations.map(al => al.clientName).filter(Boolean))).join(', ')
                : (po?.targetClient || '');
              if (!lineClients) return null;
              return (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11.5,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: '#f8fafc',
                      color: '#334155',
                      border: '1px solid #e2e8f0'
                    }}
                  >
                    <Users size={12} color="var(--color-brand)" />
                    <strong>Client:</strong> {lineClients}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Right side: Numbers & Distinct Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: isComplete ? '#166534' : 'var(--color-text-main)' }}>
                {formatQty(line.receivedQty)} <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--color-text-muted)' }}>/ {formatQty(line.orderedQty)} {lineUnit}</span>
              </div>
              <div style={{ fontSize: 11.5, color: isComplete ? '#16a34a' : 'var(--color-brand)', fontWeight: 600, marginTop: 2 }}>
                {isComplete ? 'Completely Entered' : `${formatQty(remainingQty)} ${lineUnit} remaining`}
              </div>
            </div>

            {isComplete ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewingBarcodeLine(line);
                }}
                style={{
                  height: 44,
                  padding: '0 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  borderRadius: 6,
                  borderColor: '#cbd5e1',
                  background: '#fff'
                }}
              >
                <Printer size={16} /> View Barcode
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  openReceiveModal(line);
                }}
                style={{
                  height: 44,
                  padding: '0 18px',
                  fontSize: 13.5,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  borderRadius: 6
                }}
              >
                <Package size={16} /> Tap to Receive
              </button>
            )}
          </div>
        </div>

        {/* Progress bar inside card */}
        <div style={{ width: '100%', height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden', marginTop: 14 }}>
          <div style={{
            height: '100%',
            background: progress >= 100 ? '#16a34a' : 'var(--color-brand)',
            width: `${Math.min(progress, 100)}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>

        {/* Received Lots chips under card */}
        {line.batches && line.batches.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--color-border-subtle)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>
              Inwarded Lots ({line.batches.length}):
            </span>
            {line.batches.map(b => (
              <span
                key={b.id}
                style={{
                  fontSize: 12,
                  background: '#f8fafc',
                  border: '1px solid var(--color-border)',
                  padding: '3px 8px',
                  borderRadius: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <code style={{ fontWeight: 700 }}>{b.batchCode}</code> · {formatQty(b.quantity)} {lineUnit}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); printLabel(b.batchCode); }}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--color-brand)' }}
                  title="Reprint barcode label"
                >
                  <Printer size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 16px 80px 16px' }}>
      
      {/* ─── Top Navigation & Header ────────────────────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigate('/entry-gate')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', marginBottom: 10, padding: '6px 10px', fontSize: 13.5, borderRadius: 6 }}
        >
          <ArrowLeft size={18} /> Back to Inbound Gate
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: 22, fontWeight: 800 }}>
              <LogIn size={26} color="var(--color-brand)" /> Receiving PO: <span style={{ color: 'var(--color-brand)' }}>{po.poNumber}</span>
            </h1>
            <span className={`badge ${po.status === 'RECEIVED' ? 'badge-success' : po.status === 'PARTIALLY_RECEIVED' ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: 12, padding: '4px 10px', fontWeight: 700 }}>
              {po.status.replace(/_/g, ' ')}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!isPoFullyFinalized && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openDiscrepancyModal(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, height: 40, padding: '0 14px', color: '#b45309', borderColor: '#fde68a', background: '#fffbeb', fontWeight: 600, borderRadius: 6 }}
              >
                <AlertTriangle size={16} /> Report Missing / Shortage
              </button>
            )}

            {isPoFullyFinalized ? (
              <>
                <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 14px', height: 40, fontSize: 12.5, fontWeight: 700, borderRadius: 6 }}>
                  <FileCheck size={16} /> Finalized ({latestGrn?.grnNumber || 'GRN Issued'})
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handlePrintGRN()}
                  disabled={issuingGrn}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    fontSize: 13,
                    height: 40,
                    padding: '0 16px',
                    fontWeight: 700,
                    borderRadius: 6,
                  }}
                  title="Print finalized Goods Receipt Note voucher"
                >
                  <Printer size={16} /> Print Official GRN
                </button>
              </>
            ) : poStats.totalReceived > 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowGrnFinalizeModal(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 13,
                  height: 40,
                  padding: '0 16px',
                  fontWeight: 700,
                  borderRadius: 6,
                  background: isPoPartial ? '#d97706' : 'var(--color-brand)',
                  borderColor: isPoPartial ? '#d97706' : 'var(--color-brand)',
                  color: '#fff',
                }}
                title={isPoPartial ? 'Finalize Partial GRN & Print Voucher' : 'Finalize Full GRN & Print Voucher'}
              >
                <Printer size={16} /> {isPoPartial ? 'Finalize Partial GRN & Print' : 'Finalize Full GRN & Print'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                disabled
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, height: 40, padding: '0 16px', opacity: 0.6 }}
                title="Receive at least one roll to finalize and print GRN"
              >
                <Printer size={16} /> Finalize GRN &amp; Print
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── PO Overview Card (Clean, Calm, Clearly mentions Lump / Pcs / Qty) ─ */}
      <div style={{
        background: '#fff',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        padding: '18px 22px',
        marginBottom: 20,
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>SUPPLIER</span>
            <strong style={{ fontSize: 15, color: '#0f172a' }}>{po.supplierName}</strong>
          </div>
          <div>
            <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>EXPECTED ARRIVAL</span>
            <strong style={{ fontSize: 14 }}>{formatDate(po.expectedDate)}</strong>
          </div>
          <div>
            <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>CLIENT</span>
            <strong style={{ fontSize: 14 }}>
              {(() => {
                const allClients = Array.from(
                  new Set(
                    (po.lines || [])
                      .flatMap(l => (l.allocations || []).map(a => a.clientName))
                      .concat(po.targetClient ? [po.targetClient] : [])
                      .filter(Boolean)
                  )
                );
                return allClients.length > 0 ? allClients.join(', ') : 'General Stock';
              })()}
            </strong>
          </div>
          <div>
            <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>
              SUPPLIER INVOICE NO.
            </span>
            {isPoFullyFinalized ? (
              <strong style={{ fontSize: 14, color: '#0f172a', display: 'block', paddingTop: 6 }}>
                {invoiceRef || latestGrn?.invoiceRef || '—'}
              </strong>
            ) : (
              <input
                type="text"
                className="form-input"
                placeholder="Enter invoice no..."
                value={invoiceRef}
                onChange={e => setInvoiceRef(e.target.value)}
                style={{ height: 38, fontSize: 13.5, background: '#f8fafc', fontWeight: 600, width: '100%', maxWidth: 220 }}
              />
            )}
          </div>
        </div>

        {/* Fulfillment Progress Bar & Clear Lump / Pcs / Qty Metrics */}
        <div style={{ background: '#f8fafc', padding: '16px 20px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1e293b' }}>
                Order Fulfillment: {poStats.completedLines} of {poStats.totalLines} Items Received
              </span>
              <span className="badge badge-info" style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px' }}>
                {poType === 'FABRIC' ? 'Unit: Meters / Lumps' : poType === 'READY_MADE' ? 'Unit: Pieces (Pcs)' : 'Unit: Quantity (Qty)'}
              </span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 800, color: poStats.progressPct >= 100 ? '#16a34a' : 'var(--color-brand)' }}>
              {poStats.progressPct}% Complete
            </span>
          </div>

          <div style={{ width: '100%', height: 9, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{
              height: '100%',
              width: `${poStats.progressPct}%`,
              background: poStats.progressPct >= 100 ? '#16a34a' : 'var(--color-brand)',
              borderRadius: 4,
              transition: 'width 0.3s ease'
            }} />
          </div>

          {/* Clearly mentions Lump / Pcs / Qty in dedicated metric cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            <div style={{ background: '#fff', padding: '12px 16px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {poType === 'FABRIC' ? 'Total Received (Meters / Lumps)' : poType === 'READY_MADE' ? 'Total Received (Pcs)' : 'Total Received (Qty)'}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                {formatQty(poStats.totalReceived)}{' '}
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  {poType === 'FABRIC' ? 'Meters' : poType === 'READY_MADE' ? 'Pcs' : 'Qty'}
                </span>
              </div>
              {poType === 'FABRIC' && (
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-brand)', marginTop: 2 }}>
                  {poStats.totalBatches} {poStats.totalBatches === 1 ? 'Lump' : 'Lumps'} Inwarded
                </div>
              )}
            </div>

            <div style={{ background: '#fff', padding: '12px 16px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {poType === 'FABRIC' ? 'Remaining to Receive (Meters)' : poType === 'READY_MADE' ? 'Remaining to Receive (Pcs)' : 'Remaining to Receive (Qty)'}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: poStats.totalRemaining > 0 ? 'var(--color-brand)' : '#16a34a', marginTop: 2 }}>
                {formatQty(poStats.totalRemaining)}{' '}
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  {poType === 'FABRIC' ? 'Meters' : poType === 'READY_MADE' ? 'Pcs' : 'Qty'}
                </span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: poStats.totalRemaining > 0 ? '#b45309' : '#16a34a', marginTop: 2 }}>
                {poStats.totalRemaining > 0 ? 'Pending Inbound Delivery' : '100% Inwarded'}
              </div>
            </div>

            <div style={{ background: '#fff', padding: '12px 16px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {poType === 'FABRIC' ? 'Total Expected on PO (Meters)' : poType === 'READY_MADE' ? 'Total Expected (Pcs)' : 'Total Expected (Qty)'}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                {formatQty(poStats.totalOrdered)}{' '}
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  {poType === 'FABRIC' ? 'Meters' : poType === 'READY_MADE' ? 'Pcs' : 'Qty'}
                </span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Across {poStats.totalLines} PO items
              </div>
            </div>
          </div>


        </div>
      </div>

      {/* Fully Complete Notification */}
      {allComplete && (
        <div className="alert alert-success" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderRadius: 'var(--radius-lg)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 14.5 }}>
            <CheckCircle2 size={22} color="#16a34a" /> {isPoFullyFinalized ? `All lines on this Purchase Order are 100% received & finalized (GRN: ${latestGrn?.grnNumber || 'Issued'})!` : 'All lines on this Purchase Order have been completely received!'}
          </span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {isPoFullyFinalized && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => handlePrintGRN()}
                disabled={issuingGrn}
                style={{ fontWeight: 700, height: 38, padding: '0 16px', background: '#fff', color: '#166534', borderColor: '#86efac', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Printer size={15} /> Print GRN Voucher
              </button>
            )}
            <button className="btn btn-sm btn-primary" onClick={() => navigate('/entry-gate')} style={{ fontWeight: 700, height: 38, padding: '0 16px' }}>
              Return to Inbound Gate <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ─── Search & Sort Bar ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1', minWidth: 260, maxWidth: 360 }}>
          <Search size={16} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search shade, brand, art no..."
            value={lineSearch}
            onChange={e => setLineSearch(e.target.value)}
            style={{ paddingLeft: 36, height: 42, fontSize: 13.5, width: '100%', background: '#fff', borderRadius: 8 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, marginRight: 2 }}>Sort:</span>
          {[
            { id: 'default', label: 'PO Order' },
            { id: 'shade', label: 'By Shade' },
            { id: 'brand', label: 'By Brand' },
          ].map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setLineSort(s.id as any)}
              style={{
                background: lineSort === s.id ? 'var(--color-brand)' : '#fff',
                color: lineSort === s.id ? '#fff' : 'var(--color-text-muted)',
                border: '1px solid ' + (lineSort === s.id ? 'var(--color-brand)' : 'var(--color-border)'),
                borderRadius: 6,
                padding: '7px 12px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Touch-Friendly PO Items Cards (Fulfilled items sink to bottom) ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sortedAndFilteredLines.length === 0 ? (
          <div style={{ background: '#fff', padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            No items match &quot;{lineSearch}&quot;
          </div>
        ) : (
          <>
            {/* Unfulfilled / Pending Items */}
            {unfulfilledLines.map((line, idx) => renderLineCard(line, idx, false))}

            {/* Fulfilled Items (Automatically positioned down at the bottom) */}
            {fulfilledLines.length > 0 && (
              <div style={{ marginTop: unfulfilledLines.length > 0 ? 18 : 0 }}>
                {unfulfilledLines.length > 0 && (
                  <div style={{
                    marginBottom: 14,
                    padding: '10px 16px',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CheckCircle2 size={18} color="#16a34a" />
                      <strong style={{ fontSize: 13.5, color: '#166534' }}>
                        Completed / Fulfilled Items ({fulfilledLines.length} of {poStats.totalLines})
                      </strong>
                      <span style={{ fontSize: 12, color: '#15803d' }}>
                        — Completely inwarded. Tap &quot;View Barcode&quot; to reprint.
                      </span>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#166534' }}>
                      Fulfilled lines moved below
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {fulfilledLines.map((line, idx) => renderLineCard(line, unfulfilledLines.length + idx, true))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          "RECEIVE ROLL / ITEM" POP-UP MODAL (Touch Screen, Bigger Top-Right Cross)
          ───────────────────────────────────────────────────────────────────────────── */}
      {showReceiveModal && currentLine && (
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
          zIndex: 1000,
          padding: 16
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 560,
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden',
            border: '1px solid var(--color-border)'
          }}>
            
            {/* Modal Header — Bigger, Normal Cross Sign */}
            <div style={{
              padding: '16px 22px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#fafbfc'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 8, background: 'rgba(2, 132, 199, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Package size={20} color="var(--color-brand)" />
                </div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                    Receive {isCurrentFabric ? 'Roll' : 'Item'}
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    PO #{po.poNumber} · {po.supplierName}
                  </div>
                </div>
              </div>

              {/* Big, Clear Normal Cross Sign */}
              <button
                type="button"
                onClick={closeReceiveModal}
                aria-label="Close"
                style={{
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  border: 'none',
                  background: '#f1f5f9',
                  color: '#334155',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#e2e8f0'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f1f5f9'; }}
                title="Close"
              >
                <X size={26} strokeWidth={2.5} />
              </button>
            </div>

            {/* Modal Body */}
            {isCurrentLineFullyReceived ? (
              // If line just completed 100%, show Barcode Viewer immediately with reprint option
              <div style={{ padding: '22px' }}>
                <div style={{
                  padding: '14px 18px',
                  borderRadius: 8,
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  marginBottom: 18,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}>
                  <CheckCircle2 size={22} color="#16a34a" />
                  <div>
                    <strong style={{ fontSize: 14.5, color: '#166534', display: 'block' }}>
                      Item is 100% Fully Received!
                    </strong>
                    <span style={{ fontSize: 12.5, color: '#15803d' }}>
                      All required quantity has been inwarded. Tap the top-right cross to return to orders.
                    </span>
                  </div>
                </div>

                <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                  Inwarded Barcode Labels ({currentLine.batches?.length || 0}):
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflowY: 'auto' }}>
                  {currentLine.batches && currentLine.batches.length > 0 ? (
                    currentLine.batches.map(b => (
                      <div
                        key={b.id}
                        style={{
                          padding: '12px 14px',
                          background: '#f8fafc',
                          borderRadius: 8,
                          border: '1px solid var(--color-border)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12
                        }}
                      >
                        <div>
                          <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                            {b.batchCode}
                            {recentBatch?.batchCode === b.batchCode && (
                              <span className="badge badge-success" style={{ marginLeft: 8, fontSize: 11, padding: '2px 6px' }}>
                                Just Created
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                            Quantity: <strong>{formatQty(b.quantity)}</strong> {currentUnit}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => previewLabel(b.batchCode)}
                            style={{ height: 38, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
                          >
                            <Eye size={14} /> Preview
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => printLabel(b.batchCode)}
                            style={{ height: 38, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12.5 }}
                          >
                            <Printer size={15} /> Reprint
                          </button>
                        </div>
                      </div>
                    ))
                  ) : recentBatch ? (
                    <div style={{ padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Generated Barcode:</div>
                      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#0f172a', marginBottom: 12 }}>
                        {recentBatch.batchCode} ({formatQty(recentBatch.quantity)} {currentUnit})
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => printLabel(recentBatch.batchCode)}
                          style={{ height: 42, padding: '0 18px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Printer size={16} /> Reprint Label
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => previewLabel(recentBatch.batchCode)}
                          style={{ height: 42, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Eye size={15} /> Preview
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              // Active Receive Form
              <form onSubmit={(e) => { e.preventDefault(); handleReceive(); }}>
                <div style={{ padding: '20px 22px' }}>
                  
                  {/* Item Details Box */}
                  <div style={{
                    background: '#f8fafc',
                    padding: '14px 16px',
                    borderRadius: 8,
                    marginBottom: 18,
                    border: '1px solid var(--color-border)'
                  }}>
                    <div style={{ fontSize: 15, color: '#0f172a', fontWeight: 700, marginBottom: 4 }}>
                      {isCurrentFabric ? (
                        <>{currentLine.brand} — {currentLine.quality || currentLine.category || 'Fabric'}</>
                      ) : isCurrentReadyMade ? (
                        <>{currentLine.name || currentLine.brand || 'Garment Item'}</>
                      ) : (
                        <>{currentLine.name || 'Accessory Item'}</>
                      )}
                    </div>

                    <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, marginBottom: 10 }}>
                      {isCurrentFabric ? (
                        <>Type: <strong>{currentLine.category === 'PLAIN_SHIRTING' ? 'Plain Shirting' : (currentLine.category || '—')}</strong> · Shade: <strong>{currentLine.shade || '—'}</strong></>
                      ) : isCurrentReadyMade ? (
                        <>Fabric Type: <strong>{currentLine.category || '—'}</strong>{currentLine.shade ? <> · Shade: <strong>{currentLine.shade}</strong></> : null} · Art No: <strong>{currentLine.artNo || '—'}</strong> · Size: <strong>{currentLine.size || '—'}</strong></>
                      ) : (
                        <>Category: <strong>{currentLine.category || '—'}</strong>{currentLine.quality ? <> · Spec: <strong>{currentLine.quality}</strong></> : null}{currentLine.shade ? <> · Color: <strong>{currentLine.shade}</strong></> : null}{currentLine.size ? <> · Size: <strong>{currentLine.size}</strong></> : null}</>
                      )}
                    </div>

                    <div style={{
                      fontSize: 13,
                      display: 'flex',
                      justifyContent: 'space-between',
                      paddingTop: 8,
                      borderTop: '1px dashed #cbd5e1',
                      color: 'var(--color-text-muted)'
                    }}>
                      <span>Ordered: <strong style={{ color: '#0f172a' }}>{formatQty(currentLine.orderedQty)} {currentUnit}</strong></span>
                      <span>Received: <strong style={{ color: '#166534' }}>{formatQty(currentLine.receivedQty)} {currentUnit}</strong></span>
                      <span>Remaining: <strong style={{ color: 'var(--color-brand)' }}>{formatQty(Math.max(0, currentLine.orderedQty - currentLine.receivedQty))} {currentUnit}</strong></span>
                    </div>

                    {/* Client Reference */}
                    {(() => {
                      const lineClients = (currentLine.allocations && currentLine.allocations.length > 0)
                        ? Array.from(new Set(currentLine.allocations.map(a => a.clientName).filter(Boolean))).join(', ')
                        : (po?.targetClient || '');
                      if (!lineClients) return null;
                      return (
                        <div style={{
                          marginTop: 10,
                          padding: '8px 12px',
                          background: '#f8fafc',
                          borderRadius: 6,
                          border: '1px solid #e2e8f0',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          color: '#475569'
                        }}>
                          <Users size={14} color="var(--color-brand)" />
                          <span><strong style={{ color: '#0f172a' }}>Client:</strong> {lineClients}</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Bundle Number Input */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)', marginBottom: 6, display: 'block' }}>
                      Bundle Number <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. BND-01 or leave blank if loose"
                      value={supplierBundle}
                      onChange={e => {
                        setSupplierBundle(e.target.value);
                        setDiscrepancyForm(prev => ({ ...prev, bundleNumber: e.target.value }));
                      }}
                      style={{ height: 44, fontSize: 14 }}
                    />
                  </div>

                  {/* Quantity Received Input */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                        Quantity Received ({currentUnit}) <span style={{ color: '#dc2626' }}>*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const rem = cleanNumber(Math.max(0, currentLine.orderedQty - currentLine.receivedQty));
                          if (rem > 0) setQuantity(formatQty(rem));
                        }}
                        style={{
                          border: 'none',
                          background: '#f1f5f9',
                          color: 'var(--color-brand)',
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: '4px 10px',
                          borderRadius: 4
                        }}
                      >
                        Fill Remaining ({formatQty(Math.max(0, currentLine.orderedQty - currentLine.receivedQty))} {currentUnit})
                      </button>
                    </div>

                    <div style={{ position: 'relative' }}>
                      <input
                        ref={qtyInputRef}
                        type="number"
                        inputMode="decimal"
                        className="form-input"
                        placeholder={isCurrentFabric ? '0.0' : '0'}
                        step="any"
                        min="0.001"
                        value={quantity}
                        onChange={e => setQuantity(e.target.value)}
                        style={{ fontSize: 24, fontWeight: 800, padding: '10px 16px', paddingRight: 75, height: 54 }}
                        required
                        autoFocus
                      />
                      <div style={{
                        position: 'absolute',
                        right: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 13.5,
                        fontWeight: 700,
                        color: 'var(--color-text-muted)',
                        pointerEvents: 'none',
                        background: '#f1f5f9',
                        padding: '4px 10px',
                        borderRadius: 4
                      }}>
                        {currentLine.uom ? currentLine.uom.toLowerCase() : (isCurrentFabric ? 'm' : 'pcs')}
                      </div>
                    </div>
                  </div>



                  {error && <div className="alert alert-danger" style={{ marginBottom: 14, fontSize: 13 }}>{error}</div>}

                  {/* Recent Batch Barcode Generated Card */}
                  {recentBatch && (
                    <div style={{
                      marginBottom: 16,
                      padding: '12px 16px',
                      borderRadius: 8,
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 10
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#166534', fontWeight: 700, fontSize: 13 }}>
                          <CheckCircle2 size={16} /> Batch Barcode Created & Sent to Printer!
                        </div>
                        <div style={{ marginTop: 2, fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>
                          {recentBatch.batchCode} ({formatQty(recentBatch.quantity)} {currentUnit})
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => previewLabel(recentBatch.batchCode)}
                          style={{ height: 34, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <Eye size={13} /> Preview
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => printLabel(recentBatch.batchCode)}
                          style={{ height: 34, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <Printer size={13} /> Reprint
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Modal Footer (No close button, only Flag Shortage and Receive Submit) */}
                <div style={{
                  padding: '14px 22px',
                  borderTop: '1px solid var(--color-border)',
                  background: '#fafbfc',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12
                }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setShowReceiveModal(false);
                      openDiscrepancyModal(currentLine);
                    }}
                    style={{
                      color: '#b45309',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12.5,
                      height: 44,
                      padding: '0 10px'
                    }}
                  >
                    <AlertTriangle size={15} /> Flag Shortage
                  </button>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={receiving}
                    style={{ height: 48, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, padding: '0 24px' }}
                  >
                    {receiving ? (
                      <><span className="spinner" /> Receiving & Printing...</>
                    ) : (
                      <><Printer size={18} /> Receive & Print Label</>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          "VIEW BARCODE LABELS" MODAL (For Fulfilled Items - NO duplicate addition)
          ───────────────────────────────────────────────────────────────────────────── */}
      {viewingBarcodeLine && (
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
          zIndex: 1000,
          padding: 16
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 560,
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden',
            border: '1px solid var(--color-border)'
          }}>
            {/* Modal Header — Bigger Close Cross */}
            <div style={{
              padding: '16px 22px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#fafbfc'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 8, background: 'rgba(22, 163, 74, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Printer size={20} color="#16a34a" />
                </div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                    Inwarded Barcodes & Labels
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    PO #{po.poNumber} · Fully Received
                  </div>
                </div>
              </div>

              {/* Big, Clear Touch Cross Button */}
              <button
                type="button"
                onClick={() => setViewingBarcodeLine(null)}
                aria-label="Close"
                style={{
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  border: 'none',
                  background: '#f1f5f9',
                  color: '#334155',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#e2e8f0'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f1f5f9'; }}
                title="Close"
              >
                <X size={26} strokeWidth={2.5} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px 22px' }}>
              <div style={{
                background: '#f8fafc',
                padding: '14px 16px',
                borderRadius: 8,
                marginBottom: 16,
                border: '1px solid var(--color-border)'
              }}>
                <div style={{ fontSize: 15, color: '#0f172a', fontWeight: 700, marginBottom: 4 }}>
                  {viewingBarcodeLine.itemType === 'FABRIC' || (poType === 'FABRIC' && !viewingBarcodeLine.itemType) ? (
                    <>{viewingBarcodeLine.brand} — {viewingBarcodeLine.quality || viewingBarcodeLine.category}</>
                  ) : viewingBarcodeLine.itemType === 'READY_MADE' ? (
                    <>{viewingBarcodeLine.name || viewingBarcodeLine.brand}</>
                  ) : (
                    <>{viewingBarcodeLine.name}</>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 8 }}>
                  Ordered: <strong>{formatQty(viewingBarcodeLine.orderedQty)}</strong> · Received: <strong style={{ color: '#16a34a' }}>{formatQty(viewingBarcodeLine.receivedQty)}</strong> {viewingBarcodeLine.uom || (poType === 'FABRIC' ? 'Meters' : 'Pcs')}
                </div>
                <div style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#166534', fontWeight: 700 }}>
                  <CheckCircle2 size={15} /> All quantity has been completely entered. You can reprint any barcode below:
                </div>
              </div>

              {/* Batches List with Big Reprint Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflowY: 'auto' }}>
                {viewingBarcodeLine.batches && viewingBarcodeLine.batches.length > 0 ? (
                  viewingBarcodeLine.batches.map(b => (
                    <div
                      key={b.id}
                      style={{
                        padding: '12px 14px',
                        background: '#fff',
                        borderRadius: 8,
                        border: '1px solid var(--color-border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12
                      }}
                    >
                      <div>
                        <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                          {b.batchCode}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          Quantity: <strong>{formatQty(b.quantity)}</strong> {viewingBarcodeLine.uom ? viewingBarcodeLine.uom.toLowerCase() : (poType === 'FABRIC' ? 'm' : 'pcs')}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => previewLabel(b.batchCode)}
                          style={{ height: 38, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
                        >
                          <Eye size={14} /> Preview
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => printLabel(b.batchCode)}
                          style={{ height: 38, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12.5 }}
                        >
                          <Printer size={15} /> Reprint
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                    No batch barcode records found.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Issued Goods Receipt Notes (GRN) for this PO ───────────────────── */}
      {po.grns && po.grns.length > 0 && (
        <div style={{
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          marginBottom: 20,
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{
            padding: '12px 18px',
            background: '#f8fafc',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileCheck size={18} color="var(--color-brand)" />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-main)' }}>
                Issued Goods Receipt Notes (GRN)
              </span>
              <span className="badge badge-info" style={{ fontSize: 11, fontWeight: 700 }}>
                {po.grns.length} {po.grns.length === 1 ? 'Voucher' : 'Vouchers'}
              </span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Completed delivery receipts for this Purchase Order
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5, width: '100%', margin: 0 }}>
              <thead>
                <tr style={{ background: '#ffffff', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ width: 140 }}>GRN Number</th>
                  <th style={{ width: 120 }}>Intake Date</th>
                  <th>Supplier Invoice</th>
                  <th style={{ textAlign: 'center', width: 85 }}>Rolls/Pcs</th>
                  <th style={{ textAlign: 'right', width: 120 }}>Quantity</th>
                  <th>Received By</th>
                  <th style={{ textAlign: 'center', width: 90 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {po.grns.map((g: any) => (
                  <tr key={g.id} className="hover-row">
                    <td>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-brand)' }}>
                        {g.grnNumber}
                      </span>
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {formatDate(g.createdAt)}
                    </td>
                    <td>
                      {g.invoiceRef ? (
                        <span style={{ fontWeight: 600, color: '#334155' }}>{g.invoiceRef}</span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>
                      {g.totalRolls}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#065f46' }}>
                      {g.totalQuantity?.toFixed(1)} {currentUnit}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {g.receivedBy?.name || 'Staff'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => window.open(`/inventory/grn/${g.id}`, '_blank')}
                          title="View GRN Details"
                          style={{ color: 'var(--color-brand)' }}
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => handlePrintSpecificGRN(g.id)}
                          title="Print GRN Voucher"
                          style={{ color: '#0f172a' }}
                        >
                          <Printer size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          background: 'rgba(15, 23, 42, 0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1010,
          padding: 16
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
                  <div style={{ fontSize: 12, color: '#b45309' }}>
                    Report when a lump or item on the supplier invoice/PO is NOT in this bundle
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDiscrepancyModal(false)}
                aria-label="Close"
                style={{
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  border: 'none',
                  background: '#fef3c7',
                  color: '#92400e',
                  cursor: 'pointer'
                }}
              >
                <X size={24} strokeWidth={2.5} />
              </button>
            </div>

            <form onSubmit={handleSaveDiscrepancy} style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label className="form-label">Supplier Invoice</label>
                  <input
                    type="text"
                    className="form-input"
                    value={invoiceRef}
                    onChange={e => setInvoiceRef(e.target.value)}
                    placeholder="e.g. INV-98124"
                    style={{ height: 42 }}
                    required
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
                    style={{ height: 42 }}
                    required
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="form-label">Affected Item Line</label>
                <select
                  className="form-select"
                  value={discrepancyForm.lineId}
                  style={{ height: 42 }}
                  onChange={e => {
                    const l = po.lines.find(x => x.id === e.target.value);
                    const rem = l ? cleanNumber(Math.max(0, l.orderedQty - l.receivedQty)) : 0;
                    setDiscrepancyForm({
                      ...discrepancyForm,
                      lineId: e.target.value,
                      itemType: l?.itemType || 'FABRIC',
                      brand: l?.brand || '',
                      quality: l?.quality || '',
                      shade: l?.shade || '',
                      size: l?.size || '',
                      category: l?.category || '',
                      name: l?.name || '',
                      artNo: l?.artNo || '',
                      expectedQty: rem > 0 ? formatQty(rem) : discrepancyForm.expectedQty
                    });
                  }}
                >
                  <option value="">Select affected item...</option>
                  {po.lines.map(l => {
                    const lType = l.itemType || 'FABRIC';
                    const lBrand = l.brand || '';
                    const lQuality = l.quality || l.category || '';
                    const lShade = l.shade || '';
                    const lName = l.name || '';
                    const lArtNo = l.artNo || '';
                    const lSize = l.size || '';
                    const lCategory = l.category || '';
                    return (
                      <option key={l.id} value={l.id}>
                        {lType === 'FABRIC'
                          ? `[Fabric] ${lBrand} — ${lQuality} (Shade: ${lShade || 'Std'})`
                          : lType === 'READY_MADE'
                          ? `[Ready-Made] ${lName || lBrand} (${lCategory ? `Fabric: ${lCategory}, ` : ''}${lShade ? `Shade: ${lShade}, ` : ''}Art: ${lArtNo || '—'}, Size: ${lSize || '—'})`
                          : `[Accessory] ${lCategory ? `${lCategory} - ` : ''}${lName || lBrand} (Size: ${lSize || 'Std'})`}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="form-label">Discrepancy Issue Type <span className="required">*</span></label>
                <select
                  className="form-select"
                  value={discrepancyForm.issueType}
                  onChange={e => setDiscrepancyForm({ ...discrepancyForm, issueType: e.target.value })}
                  style={{ height: 42 }}
                  required
                >
                  <option value="MISSING_FROM_BUNDLE">Lump / Set / Item NOT Available in Bundle (Missing)</option>
                  <option value="WRONG_ITEM_PACKED">Wrong Item / Shade / Size Packed in Bundle</option>
                  <option value="SHORT_QUANTITY">Physical Quantity Less than Invoice / PO (Shortage)</option>
                  <option value="DAMAGED_DEFECTIVE">Damaged, Defective, Stained Goods in Bundle</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label className="form-label">Expected Qty on Invoice / PO</label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input"
                    placeholder="e.g. 60.0"
                    value={discrepancyForm.expectedQty}
                    onChange={e => setDiscrepancyForm({ ...discrepancyForm, expectedQty: e.target.value })}
                    style={{ height: 42 }}
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
                    style={{ height: 42 }}
                  />
                </div>
              </div>

              {discrepancyForm.expectedQty && (
                <div style={{ marginBottom: 14, background: '#fef3c7', padding: '10px 14px', borderRadius: 6, fontSize: 13, color: '#92400e', fontWeight: 600 }}>
                  Calculated Shortage: {formatQty(Math.max(0, (parseFloat(discrepancyForm.expectedQty) || 0) - (parseFloat(discrepancyForm.receivedQty) || 0)))} {currentUnit}
                </div>
              )}

              <div style={{ marginBottom: 20 }}>
                <label className="form-label">Worker Notes / Observation</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="e.g. Invoice states 3 rolls in this bundle. Found only 2."
                  value={discrepancyForm.notes}
                  onChange={e => setDiscrepancyForm({ ...discrepancyForm, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowDiscrepancyModal(false)} style={{ height: 42 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={discrepancySubmitting} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#b45309', borderColor: '#b45309', height: 42 }}>
                  {discrepancySubmitting ? <span className="spinner" /> : <AlertTriangle size={16} />}
                  Record Discrepancy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Finalize GRN & Print Confirmation Modal ─── */}
      {showGrnFinalizeModal && (
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
            maxWidth: 680,
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '90vh'
          }}>
            {/* Modal Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileCheck size={18} /> {isPoPartial ? 'Finalize Partial Goods Receipt Note (GRN)' : 'Finalize Full Goods Receipt Note (GRN)'}
                  {isPoPartial && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                      PARTIAL RECEIPT
                    </span>
                  )}
                </h2>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  PO: {po.poNumber} • Supplier: {po.supplierName}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setShowGrnFinalizeModal(false)} style={{ padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: 20, overflowY: 'auto' }}>
              {/* Prompt Alert */}
              {isPoPartial ? (
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
                  <AlertCircle size={20} color="#b45309" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#92400e', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                      Partial Receiving Detected — Finalize Partial GRN
                    </div>
                    <div style={{ fontSize: 12.5, color: '#78350f', lineHeight: 1.5 }}>
                      You have received <strong>{formatQty(poStats.totalReceived)} of {formatQty(poStats.totalOrdered)} {poType === 'FABRIC' ? 'Meters' : 'Units'}</strong> on this order. The purchase order still has <strong>{formatQty(poStats.totalRemaining)} {poType === 'FABRIC' ? 'Meters' : 'Units'}</strong> pending.
                    </div>
                    <div style={{ fontSize: 12, color: '#92400e', marginTop: 4, fontWeight: 600 }}>
                      Finalizing this Partial GRN will confirm the received inventory and print your official Partial GRN voucher. The remaining balance stays open on this PO so you can inward the rest later.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  color: '#166534'
                }}>
                  <CheckCircle2 size={20} color="#16a34a" style={{ flexShrink: 0 }} />
                  <div>
                    <strong>Full Order Fulfillment Confirmed:</strong> All {formatQty(poStats.totalOrdered)} {poType === 'FABRIC' ? 'Meters' : 'Units'} on this order are 100% received. Finalizing will generate the complete GRN voucher.
                  </div>
                </div>
              )}

              {/* Metric Strip (5 Columns) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 16 }}>
                <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>PO NUMBER</div>
                  <strong style={{ fontSize: 13, color: 'var(--color-brand)', fontFamily: 'monospace' }}>{po.poNumber}</strong>
                </div>
                <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>TOTAL ORDERED</div>
                  <strong style={{ fontSize: 14 }}>{formatQty(poStats.totalOrdered)} {poType === 'FABRIC' ? 'm' : 'pcs'}</strong>
                </div>
                <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>RECEIVED SO FAR</div>
                  <strong style={{ fontSize: 14, color: '#065f46' }}>{formatQty(poStats.totalReceived)} {poType === 'FABRIC' ? 'm' : 'pcs'}</strong>
                </div>
                <div style={{
                  background: isPoPartial ? '#fffbeb' : '#f0fdf4',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: isPoPartial ? '1px solid #fde68a' : '1px solid #bbf7d0'
                }}>
                  <div style={{ fontSize: 10.5, color: isPoPartial ? '#92400e' : '#166534', fontWeight: 600 }}>PO BALANCE</div>
                  <strong style={{ fontSize: 14, color: isPoPartial ? '#b45309' : '#16a34a' }}>
                    {isPoPartial ? `${formatQty(poStats.totalRemaining)} ${poType === 'FABRIC' ? 'm' : 'pcs'}` : '0 Fulfilled'}
                  </strong>
                  <div style={{ fontSize: 10, color: isPoPartial ? '#b45309' : '#15803d', marginTop: 1 }}>
                    {isPoPartial ? 'Open for later' : '100% Complete'}
                  </div>
                </div>
                <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>ITEMS COUNT</div>
                  <strong style={{ fontSize: 14 }}>{poStats.completedLines}/{poStats.totalLines} Lines</strong>
                </div>
              </div>

              {/* Invoice & Remarks */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 700 }}>
                    Supplier Invoice No.
                  </label>
                  {isPoFullyFinalized ? (
                    <strong style={{ fontSize: 13.5, color: '#0f172a', display: 'block', paddingTop: 6 }}>
                      {invoiceRef || latestGrn?.invoiceRef || '—'}
                    </strong>
                  ) : (
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Enter invoice no..."
                      value={invoiceRef}
                      onChange={e => setInvoiceRef(e.target.value)}
                      style={{ height: 38, fontSize: 13 }}
                    />
                  )}
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 700 }}>
                    Gate / Receiving Remarks
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Received partial shipment, remaining in transit"
                    value={grnRemarks}
                    onChange={e => setGrnRemarks(e.target.value)}
                    style={{ height: 38, fontSize: 13 }}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#fafbfc' }}>
              <button className="btn btn-secondary" onClick={() => setShowGrnFinalizeModal(false)} disabled={issuingGrn}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handlePrintGRN(grnRemarks)}
                disabled={issuingGrn || poStats.totalReceived === 0}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 700,
                  background: isPoPartial ? '#d97706' : 'var(--color-brand)',
                  borderColor: isPoPartial ? '#d97706' : 'var(--color-brand)',
                  color: '#fff',
                  padding: '8px 18px'
                }}
              >
                {issuingGrn ? <span className="spinner" /> : <Printer size={16} />}
                {isPoPartial ? 'Finalize Partial GRN & Print Voucher' : 'Finalize Full GRN & Print Voucher'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
