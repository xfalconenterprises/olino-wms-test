import { useEffect, useState } from 'react';
import api from '../../../utils/api';
import { 
  FileBarChart2, 
  Package, 
  Download, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  TrendingUp, 
  Truck, 
  Building2, 
  Search,
  Send,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { formatDateTime } from '../../../utils/format';
import { exportToExcel } from '../../../utils/exportExcel';
import '../../../styles/components.css';

type ReportTab = 'PERIODIC' | 'SHIPMENTS' | 'STOCK_MASTER' | 'SUPPLIERS' | 'CAPACITY';
type PeriodType = 'daily' | 'monthly' | 'yearly';
type ProductFilterType = 'ALL' | 'FABRIC' | 'SHOES' | 'SOCKS';

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('PERIODIC');
  const [loading, setLoading] = useState(false);

  // ─── 1. Periodic Throughput State ─────────────────────────────────────────
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [throughputProduct, setThroughputProduct] = useState<ProductFilterType>('ALL');
  const [throughputFabricCategory, setThroughputFabricCategory] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [periodicData, setPeriodicData] = useState<any>(null);

  // ─── 2. Customer Shipments State ─────────────────────────────────────────
  const [shipmentsData, setShipmentsData] = useState<any[]>([]);
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [expandedChallanId, setExpandedChallanId] = useState<string | null>(null);

  // ─── 3. Stock Master State ───────────────────────────────────────────────
  const [productType, setProductType] = useState<ProductFilterType>('ALL');
  const [fabricCategory, setFabricCategory] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  const [stockMasterData, setStockMasterData] = useState<any[]>([]);

  // ─── 4. Supplier Performance State ───────────────────────────────────────
  const [supplierData, setSupplierData] = useState<any[]>([]);

  // ─── 5. Rack Capacity State ──────────────────────────────────────────────
  const [capacityData, setCapacityData] = useState<any[]>([]);

  // ─── Loaders ─────────────────────────────────────────────────────────────
  const loadPeriodic = async () => {
    setLoading(true);
    try {
      const dateParam = periodType === 'daily' ? selectedDate : periodType === 'monthly' ? selectedMonth : selectedYear;
      const res = await api.get('/api/reports/periodic', {
        params: {
          period: periodType,
          date: dateParam,
          itemType: throughputProduct !== 'ALL' ? throughputProduct : undefined,
          category: throughputFabricCategory || undefined,
        }
      });
      setPeriodicData(res.data);
    } catch (err) {
      console.error('Failed to load periodic report', err);
    } finally {
      setLoading(false);
    }
  };

  const loadShipments = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/reports/customer-shipments', {
        params: { search: shipmentSearch || undefined }
      });
      setShipmentsData(res.data);
    } catch (err) {
      console.error('Failed to load customer shipments', err);
    } finally {
      setLoading(false);
    }
  };

  const loadStockMaster = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/reports/stock-master', {
        params: {
          itemType: productType !== 'ALL' ? productType : undefined,
          category: fabricCategory || undefined,
          search: stockSearch || undefined,
        }
      });
      setStockMasterData(res.data);
    } catch (err) {
      console.error('Failed to load stock master', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSuppliers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/reports/supplier-performance');
      setSupplierData(res.data);
    } catch (err) {
      console.error('Failed to load supplier performance', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCapacity = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/reports/location-map');
      setCapacityData(res.data);
    } catch (err) {
      console.error('Failed to load location capacity', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'PERIODIC') loadPeriodic();
    else if (activeTab === 'SHIPMENTS') loadShipments();
    else if (activeTab === 'STOCK_MASTER') loadStockMaster();
    else if (activeTab === 'SUPPLIERS') loadSuppliers();
    else if (activeTab === 'CAPACITY') loadCapacity();
  }, [activeTab, periodType, selectedDate, selectedMonth, selectedYear, throughputProduct, throughputFabricCategory, productType, fabricCategory]);

  // ─── Excel Exporters ──────────────────────────────────────────────────────
  const exportPeriodicExcel = () => {
    if (!periodicData) return;
    const headers = ['Timestamp', 'Type', 'SKU Code', 'Product', 'Item Type', 'Quantity', 'Operator', 'Reference / Destination', 'Notes'];
    const rows = (periodicData.transactions || []).map((t: any) => [
      formatDateTime(t.timestamp),
      t.type,
      t.batchCode,
      t.product,
      t.itemType,
      t.quantity,
      t.operator,
      t.referenceId || '',
      t.notes || ''
    ]);
    exportToExcel(`Olino_Throughput_${throughputProduct}_${periodType}_${periodType === 'daily' ? selectedDate : periodType === 'monthly' ? selectedMonth : selectedYear}`, headers, rows);
  };

  const exportShipmentsExcel = () => {
    const headers = ['Challan Number', 'Customer Name', 'Destination', 'Dispatched Date', 'Operator', 'Fabric Shipped (Meters)', 'Footwear Shipped (Pairs)', 'Remarks'];
    const rows = shipmentsData.map((s: any) => [
      s.challanNumber,
      s.customerName,
      s.destination,
      formatDateTime(s.dispatchedAt),
      s.operator,
      s.totalFabricMeters,
      s.totalPairs,
      s.remarks || ''
    ]);
    exportToExcel('Olino_Customer_Shipments', headers, rows);
  };

  const exportStockMasterExcel = () => {
    const headers = ['Item Type', 'Category', 'Brand', 'Quality / Model', 'Shade / Color', 'Size', 'Stock Units', 'Total Quantity', 'Unit', 'Shelf Locations'];
    const rows = stockMasterData.map((s: any) => [
      s.itemType,
      s.category || '',
      s.brand,
      s.quality,
      s.shade,
      s.size || '',
      s.unitCount,
      s.totalQuantity,
      s.unit,
      s.locations.join('; ')
    ]);
    exportToExcel(`Olino_Stock_Master_${productType}`, headers, rows);
  };

  const exportSupplierExcel = () => {
    const headers = ['Supplier Name', 'Total POs', 'Completed POs', 'Pending POs', 'Fabric Ordered (m)', 'Fabric Received (m)', 'Pairs Ordered', 'Pairs Received', 'Fulfillment %'];
    const rows = supplierData.map((s: any) => [
      s.supplierName,
      s.totalPOs,
      s.completedPOs,
      s.pendingPOs,
      s.totalFabricOrdered,
      s.totalFabricReceived,
      s.totalPairsOrdered,
      s.totalPairsReceived,
      `${s.fulfillmentRate}%`
    ]);
    exportToExcel('Olino_Supplier_Performance', headers, rows);
  };

  const exportCapacityExcel = () => {
    const headers = ['Location Code', 'Type', 'Rack / Bay', 'Stored Units', 'Total Quantity', 'Status'];
    const rows = capacityData.map((c: any) => [
      c.code,
      c.type,
      c.bay || '',
      c.unitCount,
      c.totalQuantity,
      c.isEmpty ? 'Empty Slot' : 'Occupied'
    ]);
    exportToExcel('Olino_Warehouse_Capacity', headers, rows);
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileBarChart2 size={28} /> Reports & Management Analytics
          </h1>
          <p className="page-subtitle">Executive throughput, customer shipments, stock master, and Excel exports</p>
        </div>
      </div>

      {/* Primary Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--color-border)', paddingBottom: 0, flexWrap: 'wrap' }}>
        {[
          { key: 'PERIODIC', label: 'Periodic Throughput', icon: TrendingUp },
          { key: 'SHIPMENTS', label: 'Customer Shipments (DCs)', icon: Send },
          { key: 'STOCK_MASTER', label: 'Stock Master Inventory', icon: Package },
          { key: 'SUPPLIERS', label: 'Supplier Performance', icon: Truck },
          { key: 'CAPACITY', label: 'Rack & Space Capacity', icon: Building2 },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              className="btn btn-ghost"
              onClick={() => setActiveTab(tab.key as any)}
              style={{
                borderBottom: isActive ? '2px solid var(--color-brand)' : '2px solid transparent',
                borderRadius: 0,
                color: isActive ? 'var(--color-brand)' : 'var(--color-text-muted)',
                fontWeight: isActive ? 600 : 400,
                padding: '10px 18px',
                fontSize: 13.5,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon size={16} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* ─── TAB 1: PERIODIC THROUGHPUT ────────────────────────────────────────── */}
      {activeTab === 'PERIODIC' && (
        <div>
          {/* Controls Bar: Timeframe + Product Category */}
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {/* Daily / Monthly / Yearly Selector */}
              <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {(['daily', 'monthly', 'yearly'] as const).map(p => (
                  <button
                    key={p}
                    className="btn btn-ghost"
                    onClick={() => setPeriodType(p)}
                    style={{
                      background: periodType === p ? 'var(--color-brand)' : '#fff',
                      color: periodType === p ? '#fff' : 'var(--color-text-main)',
                      borderRadius: 0,
                      fontWeight: 600,
                      fontSize: 13,
                      padding: '6px 14px',
                    }}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>

              {periodType === 'daily' && (
                <input
                  type="date"
                  className="form-input"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  style={{ height: 38, width: 160, fontSize: 13 }}
                />
              )}

              {periodType === 'monthly' && (
                <input
                  type="month"
                  className="form-input"
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  style={{ height: 38, width: 160, fontSize: 13 }}
                />
              )}

              {periodType === 'yearly' && (
                <select
                  className="form-select"
                  value={selectedYear}
                  onChange={e => setSelectedYear(e.target.value)}
                  style={{ height: 38, width: 120, fontSize: 13 }}
                >
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                  <option value="2028">2028</option>
                </select>
              )}

              {/* Product Category Filter */}
              <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {(['ALL', 'FABRIC', 'SHOES', 'SOCKS'] as const).map(t => (
                  <button
                    key={t}
                    className="btn btn-ghost"
                    onClick={() => { setThroughputProduct(t); setThroughputFabricCategory(''); }}
                    style={{
                      background: throughputProduct === t ? 'var(--color-brand-faded)' : '#fff',
                      color: throughputProduct === t ? 'var(--color-brand)' : 'var(--color-text-muted)',
                      borderRight: '1px solid var(--color-border)',
                      borderRadius: 0,
                      fontWeight: throughputProduct === t ? 700 : 500,
                      fontSize: 12.5,
                      padding: '6px 12px',
                    }}
                  >
                    {t === 'ALL' ? 'All Products' : t === 'FABRIC' ? 'Fabric' : t === 'SHOES' ? 'Shoes' : 'Socks'}
                  </button>
                ))}
              </div>

              {throughputProduct === 'FABRIC' && (
                <select
                  className="form-select"
                  value={throughputFabricCategory}
                  onChange={e => setThroughputFabricCategory(e.target.value)}
                  style={{ height: 38, width: 130, fontSize: 12.5 }}
                >
                  <option value="">All Fabrics</option>
                  <option value="SUITING">Suiting</option>
                  <option value="SHIRTING">Shirting</option>
                  <option value="PLAIN_SHIRTING">Plain Shirting</option>
                </select>
              )}
            </div>

            <button
              className="btn btn-secondary"
              onClick={exportPeriodicExcel}
              disabled={!periodicData || loading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
            >
              <Download size={15} /> Download Excel (.CSV)
            </button>
          </div>

          {loading ? (
            <div className="loading-center"><span className="spinner spinner-lg" /></div>
          ) : periodicData && (
            <div>
              {/* Product-Aware KPI Stat Cards */}
              <div className="stat-grid" style={{ marginBottom: 20 }}>
                
                {/* INWARD CARD */}
                <div className="stat-card" style={{ borderLeft: '4px solid var(--color-success)' }}>
                  <div className="stat-card-label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}>
                    <ArrowDownToLine size={16} /> Total Inward Goods ({throughputProduct === 'ALL' ? 'Combined' : throughputProduct})
                  </div>
                  <div className="stat-card-value" style={{ fontSize: 24, marginTop: 4 }}>
                    {throughputProduct === 'FABRIC' ? (
                      <>{periodicData.inward.fabricMeters.toLocaleString('en-IN')} <span style={{ fontSize: 14, fontWeight: 400 }}>Meters</span></>
                    ) : throughputProduct === 'SHOES' ? (
                      <>{periodicData.inward.shoesPairs.toLocaleString('en-IN')} <span style={{ fontSize: 14, fontWeight: 400 }}>Pairs</span></>
                    ) : throughputProduct === 'SOCKS' ? (
                      <>{periodicData.inward.socksPairs.toLocaleString('en-IN')} <span style={{ fontSize: 14, fontWeight: 400 }}>Pairs</span></>
                    ) : (
                      <>{periodicData.inward.fabricMeters.toLocaleString('en-IN')} <span style={{ fontSize: 14, fontWeight: 400 }}>m</span> + {periodicData.inward.totalPairs} <span style={{ fontSize: 14, fontWeight: 400 }}>pairs</span></>
                    )}
                  </div>
                  <div className="stat-card-sub" style={{ marginTop: 4, fontWeight: 500 }}>
                    Received from verified supplier purchase orders
                  </div>
                </div>

                {/* OUTWARD CARD */}
                <div className="stat-card" style={{ borderLeft: '4px solid var(--color-danger)' }}>
                  <div className="stat-card-label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}>
                    <ArrowUpFromLine size={16} /> Total Outward Goods ({throughputProduct === 'ALL' ? 'Combined' : throughputProduct})
                  </div>
                  <div className="stat-card-value" style={{ fontSize: 24, marginTop: 4 }}>
                    {throughputProduct === 'FABRIC' ? (
                      <>{periodicData.outward.fabricMeters.toLocaleString('en-IN')} <span style={{ fontSize: 14, fontWeight: 400 }}>Meters</span></>
                    ) : throughputProduct === 'SHOES' ? (
                      <>{periodicData.outward.shoesPairs.toLocaleString('en-IN')} <span style={{ fontSize: 14, fontWeight: 400 }}>Pairs</span></>
                    ) : throughputProduct === 'SOCKS' ? (
                      <>{periodicData.outward.socksPairs.toLocaleString('en-IN')} <span style={{ fontSize: 14, fontWeight: 400 }}>Pairs</span></>
                    ) : (
                      <>{periodicData.outward.fabricMeters.toLocaleString('en-IN')} <span style={{ fontSize: 14, fontWeight: 400 }}>m</span> + {periodicData.outward.totalPairs} <span style={{ fontSize: 14, fontWeight: 400 }}>pairs</span></>
                    )}
                  </div>
                  <div className="stat-card-sub" style={{ marginTop: 4, fontWeight: 500 }}>
                    Dispatched to customers via delivery challans
                  </div>
                </div>

                {/* DELTA CARD */}
                <div className="stat-card" style={{ borderLeft: '4px solid var(--color-brand)' }}>
                  <div className="stat-card-label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-brand)' }}>
                    <TrendingUp size={16} /> Net Inventory Balance Delta
                  </div>
                  <div className="stat-card-value" style={{ fontSize: 24, marginTop: 4 }}>
                    {throughputProduct === 'FABRIC' ? (
                      <>{(periodicData.inward.fabricMeters - periodicData.outward.fabricMeters).toFixed(1)} <span style={{ fontSize: 14, fontWeight: 400 }}>Meters</span></>
                    ) : throughputProduct === 'SHOES' ? (
                      <>{(periodicData.inward.shoesPairs - periodicData.outward.shoesPairs)} <span style={{ fontSize: 14, fontWeight: 400 }}>Pairs</span></>
                    ) : throughputProduct === 'SOCKS' ? (
                      <>{(periodicData.inward.socksPairs - periodicData.outward.socksPairs)} <span style={{ fontSize: 14, fontWeight: 400 }}>Pairs</span></>
                    ) : (
                      <>Δ Fabric: {(periodicData.inward.fabricMeters - periodicData.outward.fabricMeters).toFixed(1)}m</>
                    )}
                  </div>
                  <div className="stat-card-sub" style={{ marginTop: 4, fontWeight: 500 }}>
                    {throughputProduct === 'ALL' ? `Δ Footwear/Socks: ${(periodicData.inward.totalPairs - periodicData.outward.totalPairs)} pairs` : 'Net period change in physical inventory'}
                  </div>
                </div>
              </div>

              {/* Transactions Ledger Table */}
              <div className="table-wrapper">
                <div className="card-header" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="card-title" style={{ fontSize: 15 }}>
                    Activity Ledger ({periodicData.transactions?.length || 0} Movements)
                  </h3>
                </div>
                {periodicData.transactions?.length === 0 ? (
                  <div className="empty-state"><div className="empty-state-text">No stock movements found matching this filter</div></div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Type</th>
                        <th>SKU Code</th>
                        <th>Product Description</th>
                        <th>Quantity Moved</th>
                        <th>Recipient / Reference</th>
                        <th>Operator</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodicData.transactions.map((t: any) => (
                        <tr key={t.id}>
                          <td className="text-muted text-xs" style={{ whiteSpace: 'nowrap' }}>
                            {formatDateTime(t.timestamp)}
                          </td>
                          <td>
                            {t.type === 'STOCK_IN' && <span className="badge badge-success">STOCK IN</span>}
                            {t.type === 'STOCK_OUT' && <span className="badge badge-danger">STOCK OUT</span>}
                            {t.type === 'PARTIAL_CUT' && <span className="badge badge-warning">PARTIAL CUT</span>}
                            {t.type === 'INTERNAL_TRANSFER' && (
                              (t.referenceType === 'PUT_AWAY' || (t.notes && (t.notes.toLowerCase().includes('put-away') || t.notes.toLowerCase().includes('put away') || t.notes.toLowerCase().includes('placed') || t.notes.toLowerCase().includes('assigned')))) ? (
                                <span className="badge" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}>PUT AWAY</span>
                              ) : (
                                <span className="badge" style={{ background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>RELOCATED</span>
                              )
                            )}
                          </td>
                          <td><code>{t.batchCode}</code></td>
                          <td>
                            <strong>{t.product}</strong>
                            {t.size && <span className="text-muted text-xs" style={{ marginLeft: 4 }}>({t.size})</span>}
                          </td>
                          <td>
                            <strong style={{ fontSize: 14 }}>
                              {t.quantity} {t.itemType === 'FABRIC' ? 'm' : 'pairs'}
                            </strong>
                          </td>
                          <td className="text-sm">
                            {t.referenceId ? (
                              <span><code>{t.referenceId}</code> · {t.notes || '—'}</span>
                            ) : (
                              <span className="text-muted">{t.notes || '—'}</span>
                            )}
                          </td>
                          <td style={{ fontWeight: 600 }}>{t.operator}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 2: CUSTOMER SHIPMENTS & DISPATCHES (DCs) ──────────────────────── */}
      {activeTab === 'SHIPMENTS' && (
        <div>
          {/* Search & Export Bar */}
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ position: 'relative', width: 340 }}>
              <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search Customer Name, Destination, DC #..."
                value={shipmentSearch}
                onChange={e => setShipmentSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadShipments()}
                style={{ paddingLeft: 36, height: 40 }}
              />
            </div>

            <button
              className="btn btn-secondary"
              onClick={exportShipmentsExcel}
              disabled={shipmentsData.length === 0 || loading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
            >
              <Download size={15} /> Download Excel (.CSV)
            </button>
          </div>

          {loading ? (
            <div className="loading-center"><span className="spinner spinner-lg" /></div>
          ) : shipmentsData.length === 0 ? (
            <div className="table-wrapper">
              <div className="empty-state">
                <div className="empty-state-icon"><Send size={48} className="text-muted" /></div>
                <div className="empty-state-text">No dispatched customer shipments found</div>
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Challan #</th>
                    <th>Customer Name</th>
                    <th>Destination</th>
                    <th>Fabric Shipped</th>
                    <th>Footwear / Socks</th>
                    <th>Dispatched Date</th>
                    <th>Dispatched By</th>
                    <th style={{ textAlign: 'right' }}>Items</th>
                  </tr>
                </thead>
                <tbody>
                  {shipmentsData.map(s => {
                    const isExpanded = expandedChallanId === s.id;
                    return (
                      <>
                        <tr key={s.id}>
                          <td>
                            <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-brand)' }}>
                              {s.challanNumber}
                            </code>
                          </td>
                          <td><strong style={{ fontSize: 14 }}>{s.customerName}</strong></td>
                          <td className="text-muted text-sm">{s.destination}</td>
                          <td>
                            {s.totalFabricMeters > 0 ? (
                              <strong>{s.totalFabricMeters} m</strong>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td>
                            {s.totalPairs > 0 ? (
                              <strong>{s.totalPairs} pairs</strong>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="text-muted text-xs" style={{ whiteSpace: 'nowrap' }}>
                            {formatDateTime(s.dispatchedAt)}
                          </td>
                          <td>{s.operator}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => setExpandedChallanId(isExpanded ? null : s.id)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              {s.linesCount} items {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Items Breakdown Row */}
                        {isExpanded && (
                          <tr style={{ background: 'var(--color-bg-subtle)' }}>
                            <td colSpan={8} style={{ padding: '12px 24px' }}>
                              <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 14 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                                  Shipped Items Breakdown for {s.challanNumber}
                                </div>
                                <table className="table" style={{ fontSize: 13 }}>
                                  <thead>
                                    <tr>
                                      <th>SKU Code</th>
                                      <th>Product Details</th>
                                      <th>Type</th>
                                      <th>Quantity Dispatched</th>
                                      <th>Cut Type</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.lines.map((l: any) => (
                                      <tr key={l.id}>
                                        <td><code>{l.batchCode}</code></td>
                                        <td><strong>{l.brand}</strong> — {l.quality} · {l.shade} {l.size ? `(Size ${l.size})` : ''}</td>
                                        <td>{l.itemType}</td>
                                        <td><strong>{l.quantity} {l.unit}</strong></td>
                                        <td>
                                          {l.isPartialCut ? (
                                            <span className="badge badge-warning">Partial Roll Cut</span>
                                          ) : (
                                            <span className="badge badge-success">Full Roll/Box</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 3: STOCK MASTER INVENTORY ────────────────────────────────────── */}
      {activeTab === 'STOCK_MASTER' && (
        <div>
          {/* Controls Bar */}
          <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {(['ALL', 'FABRIC', 'SHOES', 'SOCKS'] as const).map(t => (
                  <button
                    key={t}
                    className="btn btn-ghost"
                    onClick={() => setProductType(t)}
                    style={{
                      background: productType === t ? 'var(--color-brand)' : '#fff',
                      color: productType === t ? '#fff' : 'var(--color-text-main)',
                      borderRadius: 0,
                      fontWeight: 600,
                      fontSize: 13,
                      padding: '6px 14px',
                    }}
                  >
                    {t === 'ALL' ? 'All Products' : t === 'FABRIC' ? 'Fabric' : t === 'SHOES' ? 'Shoes' : 'Socks'}
                  </button>
                ))}
              </div>

              {productType === 'FABRIC' && (
                <select
                  className="form-select"
                  value={fabricCategory}
                  onChange={e => setFabricCategory(e.target.value)}
                  style={{ height: 38, width: 140, fontSize: 13 }}
                >
                  <option value="">All Types</option>
                  <option value="SUITING">Suiting</option>
                  <option value="SHIRTING">Shirting</option>
                  <option value="PLAIN_SHIRTING">Plain Shirting</option>
                </select>
              )}

              <div style={{ position: 'relative', width: 240 }}>
                <Search size={14} color="var(--color-text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search brand, quality, shade..."
                  value={stockSearch}
                  onChange={e => setStockSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadStockMaster()}
                  style={{ paddingLeft: 30, height: 38, fontSize: 13 }}
                />
              </div>
            </div>

            <button
              className="btn btn-secondary"
              onClick={exportStockMasterExcel}
              disabled={stockMasterData.length === 0 || loading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
            >
              <Download size={15} /> Download Excel (.CSV)
            </button>
          </div>

          {loading ? (
            <div className="loading-center"><span className="spinner spinner-lg" /></div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product Line</th>
                    <th>Quality / Model</th>
                    <th>Color / Shade</th>
                    <th>Size / Specs</th>
                    <th>Stock Units</th>
                    <th>Total Available Quantity</th>
                    <th>Shelf Locations</th>
                  </tr>
                </thead>
                <tbody>
                  {stockMasterData.map((s, idx) => (
                    <tr key={idx}>
                      <td>
                        <strong>{s.brand}</strong>
                        {s.category && <span className="badge badge-neutral" style={{ marginLeft: 6, fontSize: 11 }}>{s.category === 'PLAIN_SHIRTING' ? 'Plain Shirting' : s.category}</span>}
                      </td>
                      <td>{s.quality}</td>
                      <td>{s.shade}</td>
                      <td>{s.size ? `Size ${s.size}` : '—'}</td>
                      <td>{s.unitCount} items</td>
                      <td>
                        <strong style={{ fontSize: 14, color: 'var(--color-brand)' }}>
                          {s.totalQuantity} {s.unit}
                        </strong>
                      </td>
                      <td>
                        {s.locations.length === 0 ? (
                          <span style={{ color: '#b45309', fontSize: 12 }}>Dock / Unassigned</span>
                        ) : (
                          <span style={{ fontWeight: 600 }}>{s.locations.join(', ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 4: SUPPLIER PERFORMANCE ──────────────────────────────────────── */}
      {activeTab === 'SUPPLIERS' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button
              className="btn btn-secondary"
              onClick={exportSupplierExcel}
              disabled={supplierData.length === 0 || loading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
            >
              <Download size={15} /> Download Excel (.CSV)
            </button>
          </div>

          {loading ? (
            <div className="loading-center"><span className="spinner spinner-lg" /></div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Supplier Name</th>
                    <th>Total POs</th>
                    <th>Completed</th>
                    <th>Pending Backlog</th>
                    <th>Fabric Received / Ordered</th>
                    <th>Footwear Received / Ordered</th>
                    <th>Fulfillment Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierData.map((s, idx) => (
                    <tr key={idx}>
                      <td><strong style={{ fontSize: 14 }}>{s.supplierName}</strong></td>
                      <td>{s.totalPOs} orders</td>
                      <td><span className="badge badge-success">{s.completedPOs}</span></td>
                      <td><span className={`badge ${s.pendingPOs > 0 ? 'badge-warning' : 'badge-neutral'}`}>{s.pendingPOs}</span></td>
                      <td>
                        {s.totalFabricOrdered > 0 ? (
                          <span>{s.totalFabricReceived} / {s.totalFabricOrdered} m</span>
                        ) : '—'}
                      </td>
                      <td>
                        {s.totalPairsOrdered > 0 ? (
                          <span>{s.totalPairsReceived} / {s.totalPairsOrdered} pairs</span>
                        ) : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 60, height: 6, background: 'var(--color-bg-subtle)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', background: s.fulfillmentRate >= 90 ? 'var(--color-success)' : 'var(--color-warning)', width: `${s.fulfillmentRate}%` }} />
                          </div>
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{s.fulfillmentRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 5: RACK & SPACE CAPACITY ─────────────────────────────────────── */}
      {activeTab === 'CAPACITY' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button
              className="btn btn-secondary"
              onClick={exportCapacityExcel}
              disabled={capacityData.length === 0 || loading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
            >
              <Download size={15} /> Download Excel (.CSV)
            </button>
          </div>

          {loading ? (
            <div className="loading-center"><span className="spinner spinner-lg" /></div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Location Code</th>
                    <th>Type</th>
                    <th>Warehouse Bay</th>
                    <th>Stored Items</th>
                    <th>Occupied Quantity</th>
                    <th>Slot Status</th>
                  </tr>
                </thead>
                <tbody>
                  {capacityData.map((c: any) => (
                    <tr key={c.id}>
                      <td><code style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-brand)' }}>{c.code}</code></td>
                      <td>{c.type}</td>
                      <td className="text-muted text-sm">{c.bay || 'Floor Spot'}</td>
                      <td>{c.unitCount} items</td>
                      <td><strong>{c.totalQuantity} qty</strong></td>
                      <td>
                        {c.isEmpty ? (
                          <span className="badge badge-neutral" style={{ color: 'var(--color-success)', background: '#f0fdf4', fontWeight: 600 }}>
                            Empty Slot (Available)
                          </span>
                        ) : (
                          <span className="badge badge-info">Occupied</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
