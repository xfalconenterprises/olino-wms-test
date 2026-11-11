import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Save, Search } from 'lucide-react';
import DateField from '../../components/Common/DateField';
import { apiError } from '../../utils/printPage';
import { formatDate, formatDateTime, istDateKey } from '../../utils/format';
import { ItemsAtCost, PageTitle, StatCard, cardGrid, isLocked, rupees, useCostApi, type FilterChoices, type LumpAtCost, type RollAtCost, type StockFilters, type Valuation } from './shared';
import type { SummaryLine } from './accountsExport';

const ddmmyyyy = (key: string) => key.split('-').reverse().join('-');

// ─── Stock Value: what is in stock now, at cost ─────────────────────────────

/** This stock year: received from suppliers and returned to them, and POs raised, all at cost. */
interface YearAtCost { from: string; to: string; received: number; supplierReturns: number; ordered: number }
type StockValue = Valuation & { year: YearAtCost | null; codeWordSet: boolean };

export function StockValuePage() {
  const costApi = useCostApi();
  const [overall, setOverall] = useState<StockValue | null>(null);   // the whole warehouse: the cards at the top
  const [data, setData] = useState<StockValue | null>(null);         // what the filters match: the table
  const [error, setError] = useState('');
  const [at, setAt] = useState(() => new Date());
  const [filters, setFilters] = useState<StockFilters>({});
  const [applied, setApplied] = useState<StockFilters>({});
  const [choices, setChoices] = useState<FilterChoices | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  // Typing waits a moment before asking the server
  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), 400);
    return () => clearTimeout(t);
  }, [filters]);
  // By value: an equal set of filters never asks the server again
  const paramsKey = JSON.stringify(Object.fromEntries(Object.entries(applied).filter(([, v]) => typeof v === 'string' && v.trim())));
  const params = useMemo(() => JSON.parse(paramsKey) as Record<string, string>, [paramsKey]);

  useEffect(() => {
    costApi<FilterChoices>({ url: '/api/accounts/stock-value/choices' }).then(setChoices).catch(() => {});
  }, [costApi]);

  useEffect(() => {
    const id = ++request.current;
    const first = !overall;
    setLoading(true);
    costApi<StockValue>({ url: '/api/accounts/stock-value', params: { ...params, ...(first && { withYear: '1' }) } })
      .then(d => {
        if (id !== request.current) return;
        if (first) setOverall(d);
        setData(d); setAt(new Date()); setError('');
      })
      .catch(err => { if (id === request.current && !isLocked(err)) setError(apiError(err, 'Failed to load the stock value')); })
      .finally(() => { if (id === request.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costApi, params]);

  const rollsFor = useCallback((key: string) => costApi<RollAtCost[]>({ url: '/api/accounts/stock-value/rolls', params: { ...params, key } }), [costApi, params]);
  const allRolls = useCallback(() => costApi<LumpAtCost[]>({ url: '/api/accounts/stock-value/all-rolls', params }), [costApi, params]);

  const year = overall?.year;
  // Purchases only: received less what went back to suppliers
  const netIn = year ? year.received - year.supplierReturns : 0;
  const summary: SummaryLine[] = year ? [
    [`Received stock amount since ${ddmmyyyy(year.from)}`, netIn, true],
    [`Ordered amount since ${ddmmyyyy(year.from)}`, year.ordered, true],
  ] : [];

  return (
    <>
      <PageTitle title="Stock Value" text="Everything in stock now, at cost. Open an item to see each lump or pack and its cost." />
      {data && !data.codeWordSet && (
        <div className="alert alert-warning" style={{ marginBottom: 12 }}>
          The secret code word is not set, so labels print no cost code. <Link to="/accounts/secret-code">Set it in Secret Code</Link>.
        </div>
      )}
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      {!data && !error && <div className="loading-center" style={{ minHeight: 200 }}><span className="spinner spinner-lg" /></div>}
      {data && overall && (
        <>
          <div style={cardGrid}>
            <StatCard label="Total stock value" value={rupees(overall.totals.value)}
              note={`${overall.totals.costedRolls} ${overall.totals.costedRolls === 1 ? 'lump or pack' : 'lumps and packs'} in stock, at cost`} />
            {year && (
              <>
                <StatCard label="Received Stock Amount" value={rupees(netIn)} note={`This stock year, since ${ddmmyyyy(year.from)}`} />
                <StatCard label="Ordered Amount" value={rupees(year.ordered)} note={`POs raised this stock year, since ${ddmmyyyy(year.from)}`} />
              </>
            )}
          </div>
          <ItemsAtCost
            data={data}
            rollsFor={rollsFor}
            allRolls={allRolls}
            server={{ filters, onChange: setFilters, choices, loading }}
            heading="Stock value at cost"
            note={`Stock as on ${formatDateTime(at)}. Lumps and packs without a cost are not in the value.`}
            summary={summary}
            fileName={`Olino_Stock_Value_${formatDate(at)}.xlsx`}
            onExport={(columns, rowCount) => costApi({ method: 'POST', url: '/api/accounts/export-log', data: { kind: 'STOCK_VALUE', rowCount, columns } })}
          />
        </>
      )}
    </>
  );
}

// ─── Closing Stock: the stock at the end of a year (or any day), at cost ─────

interface SavedInfo { savedAt: string; savedByName: string; totalValue: number }
interface Years { today: string; currentStarts: string; ended: { id: string; from: string; to: string; saved: SavedInfo | null }[] }
type Closing = Valuation & { asOn: string; from?: string; yearId?: string; saved: SavedInfo | null; choices: FilterChoices };

export function ClosingStockPage() {
  const costApi = useCostApi();
  const [years, setYears] = useState<Years | null>(null);
  const [choice, setChoice] = useState<string>('');       // a year id, or 'date'
  const [asOn, setAsOn] = useState(istDateKey());
  const [overall, setOverall] = useState<Closing | null>(null);   // unfiltered: the card and the note
  const [data, setData] = useState<Closing | null>(null);         // what the filters match: the table
  const [filters, setFilters] = useState<StockFilters>({});
  const [applied, setApplied] = useState<StockFilters>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);

  const loadYears = useCallback(() => costApi<Years>({ url: '/api/accounts/closing-stock/years' })
    .then(y => { setYears(y); setChoice(c => c || (y.ended[0]?.id ?? 'date')); })
    .catch(err => { if (!isLocked(err)) setError(apiError(err, 'Failed to load the years')); }), [costApi]);
  useEffect(() => { loadYears(); }, [loadYears]);

  // Typing waits a moment before asking the server; an equal set of filters never asks again
  useEffect(() => { const t = setTimeout(() => setApplied(filters), 400); return () => clearTimeout(t); }, [filters]);
  const filterKey = JSON.stringify(Object.fromEntries(Object.entries(applied).filter(([, v]) => typeof v === 'string' && v.trim())));
  const which = useMemo(() => (choice === 'date' ? { asOn } : { yearId: choice }), [choice, asOn]);
  const params = useMemo(() => ({ ...which, ...JSON.parse(filterKey) as Record<string, string> }), [which, filterKey]);

  // A different year or day starts again without filters
  useEffect(() => { setOverall(null); setData(null); setFilters({}); setApplied({}); }, [which]);

  useEffect(() => {
    if (!choice || (choice === 'date' && !asOn)) return;
    const id = ++request.current;
    setLoading(true); setError('');
    costApi<Closing>({ url: '/api/accounts/closing-stock', params })
      .then(d => {
        if (id !== request.current) return;
        if (filterKey === '{}') setOverall(d);
        setData(d);
      })
      .catch(err => { if (id === request.current && !isLocked(err)) setError(apiError(err, 'Failed to work out the closing stock')); })
      .finally(() => { if (id === request.current) setLoading(false); });
  }, [costApi, choice, asOn, params, filterKey]);

  const rollsFor = useCallback((key: string) => costApi<RollAtCost[]>({ url: '/api/accounts/closing-stock/rolls', params: { ...params, key } }), [costApi, params]);
  const allRolls = useCallback(() => costApi<LumpAtCost[]>({ url: '/api/accounts/closing-stock/all-rolls', params }), [costApi, params]);

  const save = async () => {
    if (!data?.yearId) return;
    if (data.saved && !window.confirm('Save this year\'s closing stock again at today\'s costs? The figures saved before are replaced.')) return;
    setSaving(true); setError('');
    try {
      await costApi({ method: 'POST', url: `/api/accounts/closing-stock/${data.yearId}/save` });
      setFilters({}); setApplied({});
      const fresh = await costApi<Closing>({ url: '/api/accounts/closing-stock', params: { yearId: data.yearId } });
      setOverall(fresh); setData(fresh);
      loadYears();
    } catch (err) {
      if (!isLocked(err)) setError(apiError(err, 'Failed to save the closing stock'));
    } finally {
      setSaving(false);
    }
  };

  const year = years?.ended.find(y => y.id === choice);
  const shown = overall ?? data;
  const note = !shown ? '' : shown.saved
    ? `Saved on ${formatDateTime(shown.saved.savedAt)} by ${shown.saved.savedByName}, at the costs on that day.`
    : `Worked out from stock movements up to the end of ${ddmmyyyy(shown.asOn)}, at today's costs.`;

  return (
    <>
      <PageTitle title="Closing Stock" text="The stock at the end of a year at cost, for the books. When a year is ended (Administration → Reports → Year-End) its closing stock is saved here, so changing a cost later does not change it." />

      <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0, minWidth: 280 }}>
          <label className="form-label" htmlFor="closing-year">Year</label>
          <select id="closing-year" className="form-input" value={choice} onChange={e => setChoice(e.target.value)}>
            {years?.ended.map(y => (
              <option key={y.id} value={y.id}>{ddmmyyyy(y.from)} to {ddmmyyyy(y.to)}{y.saved ? '' : ' (not saved)'}</option>
            ))}
            <option value="date">Any date{years ? ` (current year from ${ddmmyyyy(years.currentStarts)})` : ''}</option>
          </select>
        </div>
        {choice === 'date' && (
          <div style={{ minWidth: 200 }}>
            <DateField label="As on" value={asOn} onChange={setAsOn} max={years?.today ?? istDateKey()} />
          </div>
        )}
        {year && shown?.yearId === year.id && (
          <button type="button" className="btn btn-secondary" onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {saving ? <span className="spinner" /> : <Save size={15} />} {shown.saved ? 'Save again at today\'s costs' : 'Save these figures'}
          </button>
        )}
      </div>

      {shown && (
        <div className={`alert ${shown.saved ? 'alert-success' : shown.yearId ? 'alert-warning' : 'alert-info'}`} style={{ marginBottom: 12 }}>
          {shown.saved ? note : shown.yearId ? <>This year's closing stock has not been saved yet. {note}</> : <>{note} It is saved by itself when the year is ended.</>}
        </div>
      )}
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      {!data && loading && <div className="loading-center" style={{ minHeight: 200 }}><span className="spinner spinner-lg" /></div>}
      {data && shown && (
        <>
          <div style={cardGrid}>
            <StatCard label="Closing stock value" value={rupees(shown.totals.value)} note={`As on ${ddmmyyyy(shown.asOn)}, at cost`} />
          </div>
          <ItemsAtCost
            key={`${shown.yearId ?? ''}|${shown.asOn}`}
            data={data}
            rollsFor={rollsFor}
            allRolls={allRolls}
            server={{ filters, onChange: setFilters, choices: shown.choices, loading, fields: { dates: false, status: false } }}
            heading={`Closing stock as on ${ddmmyyyy(shown.asOn)}`}
            note={`${shown.from ? `Year ${ddmmyyyy(shown.from)} to ${ddmmyyyy(shown.asOn)}. ` : ''}${note} Lumps and packs without a cost are not in the value.`}
            fileName={`Olino_Closing_Stock_${ddmmyyyy(shown.asOn)}.xlsx`}
            onExport={(columns, rowCount) => costApi({ method: 'POST', url: '/api/accounts/export-log', data: { kind: 'CLOSING_STOCK', asOn: shown.asOn, rowCount, columns } })}
          />
        </>
      )}
    </>
  );
}

// ─── Suppliers: what each supplier was sent orders for, and what they delivered ──

interface SupplierAmounts { received: number; ordered: number }
interface SupplierSource extends SupplierAmounts {
  key: string; kind: 'PO' | 'DIRECT'; poId: string | null; poNumber: string | null; invoiceRef: string | null; grnNumber: string | null; date: string | null;
}
interface SupplierRow extends SupplierAmounts { supplierName: string | null; lastReceived: string | null; sources: SupplierSource[] }
interface SuppliersReply { from: string | null; to: string; today: string; currentYearStarts: string; totals: SupplierAmounts; suppliers: SupplierRow[] }

export function SuppliersPage() {
  const costApi = useCostApi();
  const [from, setFrom] = useState('');      // blank: all time
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<SuppliersReply | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    costApi<SuppliersReply>({ url: '/api/accounts/suppliers', params: { from: from || undefined, to: to || undefined } })
      .then(d => { setData(d); setError(''); })
      .catch(err => { if (!isLocked(err)) setError(apiError(err, 'Failed to load suppliers')); })
      .finally(() => setLoading(false));
  }, [costApi, from, to]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.suppliers ?? []).filter(s => !q || (s.supplierName ?? '').toLowerCase().includes(q));
  }, [data, search]);
  const thisYear = data && from === data.currentYearStarts && !to;
  const toggle = (k: string) => setOpen(o => { const n = new Set(o); if (!n.delete(k)) n.add(k); return n; });
  const keyOf = (s: SupplierRow) => s.supplierName ?? '';

  const sourceName = (x: SupplierSource) => (x.kind === 'PO'
    ? <Link to={`/purchase-orders/${x.poId}/view`} style={{ fontWeight: 700 }}>{x.poNumber}</Link>
    : <span><strong>Direct Inward</strong>{(x.invoiceRef || x.grnNumber) && <span style={{ color: 'var(--color-text-muted)' }}> · {[x.invoiceRef && `Inv ${x.invoiceRef}`, x.grnNumber].filter(Boolean).join(' · ')}</span>}</span>);
  const money = (n: number) => (n ? rupees(n) : '');

  return (
    <>
      <PageTitle title="Suppliers" text="For each supplier: the amount ordered (POs raised) and the stock amount received, for the period you choose." />

      <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--color-text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Search supplier…" aria-label="Search supplier" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button type="button" className={`btn btn-sm ${!from && !to ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setFrom(''); setTo(''); }}>All time</button>
        {data && (
          <button type="button" className={`btn btn-sm ${thisYear ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setFrom(data.currentYearStarts); setTo(''); }}>This stock year</button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DateField compact short="From" label="From date" value={from} onChange={setFrom} max={to || data?.today} />
          <DateField compact short="To" label="To date" value={to} onChange={setTo} min={from || undefined} max={data?.today} />
        </div>
        {loading && <span className="spinner" aria-label="Loading" />}
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      {!data && !error && <div className="loading-center" style={{ minHeight: 200 }}><span className="spinner spinner-lg" /></div>}
      {data && (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden', opacity: loading ? 0.6 : 1 }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: 13, margin: 0, width: '100%' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ width: 44 }} />
                    <th>Supplier</th>
                    <th style={{ textAlign: 'right' }}>Ordered Amount</th>
                    <th style={{ textAlign: 'right' }}>Received Stock Amount</th>
                    <th>Last received</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--color-text-muted)' }}>No orders or deliveries in this period.</td></tr>}
                  {rows.map(s => {
                    const opened = open.has(keyOf(s));
                    return (
                      <Fragment key={keyOf(s)}>
                        <tr onClick={() => toggle(keyOf(s))} style={{ cursor: 'pointer', background: opened ? '#f8fafc' : undefined }}>
                          <td>
                            <button type="button" className="btn btn-ghost btn-icon" aria-label={opened ? 'Hide POs and invoices' : 'Show POs and invoices'} aria-expanded={opened}
                              onClick={e => { e.stopPropagation(); toggle(keyOf(s)); }}>
                              {opened ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          </td>
                          <td style={{ fontWeight: 600 }}>{s.supplierName ?? <span style={{ color: 'var(--color-text-muted)' }}>No supplier recorded</span>}</td>
                          <td style={{ textAlign: 'right' }}>{money(s.ordered)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(s.received)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{s.lastReceived ? formatDate(s.lastReceived) : ''}</td>
                        </tr>
                        {opened && (
                          <tr>
                            <td colSpan={5} style={{ padding: '8px 12px 14px 56px', background: '#f8fafc' }}>
                              <table className="table" style={{ fontSize: 12.5, margin: 0, width: '100%', background: '#fff' }}>
                                <thead>
                                  <tr style={{ background: '#f1f5f9' }}>
                                    <th>PO / Invoice</th><th>Date</th>
                                    <th style={{ textAlign: 'right' }}>Ordered Amount</th>
                                    <th style={{ textAlign: 'right' }}>Received Stock Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {s.sources.map(x => (
                                    <tr key={x.key}>
                                      <td>{sourceName(x)}</td>
                                      <td style={{ whiteSpace: 'nowrap' }}>{x.date ? formatDate(x.date) : ''}</td>
                                      <td style={{ textAlign: 'right' }}>{money(x.ordered)}</td>
                                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(x.received)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
