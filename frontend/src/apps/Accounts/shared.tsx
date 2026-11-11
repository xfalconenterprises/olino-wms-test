import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, RefreshCcw, Search, SlidersHorizontal } from 'lucide-react';
import DateField from '../../components/Common/DateField';
import LoadMore from '../../components/Common/LoadMore';
import { ITEM_FILTERS, matchesItemFilters, type ItemFilterKey, type ItemTypeKey } from '../../utils/itemFilters';
import type { CostApi } from '../../components/Common/CostLock';
import { formatDate } from '../../utils/format';
import { fabricCategoryLabel, formatQty, unitLabel } from '../../utils/units';
import { saveFile } from '../../utils/download';
import { buildValuationWorkbook, originText, XLSX_TYPE, type SummaryLine } from './accountsExport';

// Shared by the Accounts pages: the unlocked API, rupee formatting, paging and stock at cost.

export const CostApiContext = createContext<CostApi | null>(null);
export function useCostApi(): CostApi {
  const api = useContext(CostApiContext);
  if (!api) throw new Error('Accounts pages need the unlocked API');
  return api;
}

/** Ignores the "locked" answer: the page shows the lock screen for it. */
export const isLocked = (err: any) => err?.response?.status === 423;

export const rupees = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

export const TYPE_NAME: Record<string, string> = { FABRIC: 'Fabric', READY_MADE: 'Readymade', ACCESSORY: 'Accessories' };
const TYPE_ORDER = ['FABRIC', 'READY_MADE', 'ACCESSORY'];

export interface ValuedItem {
  key: string;
  itemType: string; uom: string; description: string;
  brand: string | null; quality: string | null; qualityName: string | null; shade: string | null; category: string | null;
  size: string | null; name: string | null; artNo: string | null;
  quantity: number; rolls: number; costedQuantity: number; value: number; rollsWithoutCost: number;
  costPerUnit: number | null; averageCost: number | null;
  // When it was bought at different prices (saved closing stock from before may not have these)
  lowestCost?: number | null; highestCost?: number | null; prices?: number;
}
interface Group { value: number; rolls: number; rollsWithoutCost: number }
export interface Valuation {
  totals: Group & { costedRolls: number };
  byType: (Group & { itemType: string })[];
  items: ValuedItem[];
}
export interface RollAtCost {
  id: string; batchCode: string; bundle: string | null; status?: string; quantity: number; uom: string;
  receivedAt: string; invoiceRef: string | null; supplierName: string | null; shelves: string[];
  costPrice: number | null; value: number | null;
  origin: 'PO' | 'DIRECT' | 'RETURN'; poNumber: string | null; poId: string | null;
}
/** A roll or pack with its item's details, for the Excel's lump sheets. */
export interface LumpAtCost extends Omit<RollAtCost, 'receivedAt'> {
  key: string; itemType: string; receivedAt: string | null;
  category: string | null; brand: string | null; quality: string | null; qualityName: string | null;
  shade: string | null; size: string | null; name: string | null; artNo: string | null;
}

/**
 * A list loaded 50 rows at a time with Load more, as elsewhere in the app. `fetchRows` asks the
 * server for { offset, limit } (it changes when the filters change, which starts again at the top);
 * `refresh` loads the same rows again after a change, so the list stays where it was.
 */
export function useLoadMore<R extends { total: number }, T>(
  fetchRows: (range: { offset: number; limit: number }) => Promise<R>,
  rowsOf: (reply: R) => T[],
  onError: (err: unknown) => void,
) {
  const [reply, setReply] = useState<R | null>(null);
  const [rows, setRows] = useState<T[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const shown = useRef(0);
  const helpers = useRef({ rowsOf, onError });
  useEffect(() => { helpers.current = { rowsOf, onError }; });

  const run = useCallback(async (range: { offset: number; limit: number }, append: boolean) => {
    const id = ++request.current;
    try {
      const r = await fetchRows(range);
      if (id !== request.current) return;
      const next = helpers.current.rowsOf(r);
      setReply(r);
      setRows(prev => {
        const all = append ? [...prev, ...next] : next;
        shown.current = all.length;
        return all;
      });
    } catch (err) {
      if (id === request.current) helpers.current.onError(err);
    }
  }, [fetchRows]);

  useEffect(() => { run({ offset: 0, limit: LIST_PAGE }, false); }, [run]);

  const loadMore = async () => {
    setLoadingMore(true);
    await run({ offset: shown.current, limit: LIST_PAGE }, true);
    setLoadingMore(false);
  };
  const refresh = useCallback(() => run({ offset: 0, limit: Math.max(shown.current, LIST_PAGE) }, false), [run]);
  const total = reply?.total ?? 0;
  return { reply, rows, total, hasMore: rows.length < total, loadingMore, loadMore, refresh };
}
export const LIST_PAGE = 50;

export function PageTitle({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>{title}</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 760 }}>{text}</p>
      </div>
      {children}
    </div>
  );
}

export function StatCard({ label, value, note, tone, children }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'warn' | 'good'; children?: ReactNode }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: tone === 'warn' ? '#b45309' : tone === 'good' ? '#166534' : undefined }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{note}</div>}
      {children}
    </div>
  );
}

export const cardGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 } as const;

const costText = (cost: number | null, uom: string, average = false) =>
  cost === null ? '' : `${average ? 'avg ' : ''}${rupees(cost)} / ${unitLabel(uom)}`;

// ─── Items at cost, by item type, each opening to its rolls or packs ──────────

type Column = { header: string; value: (i: ValuedItem) => ReactNode; text: (i: ValuedItem) => string | null };
const col = (header: string, text: (i: ValuedItem) => string | null | undefined, bold = false): Column => ({
  header,
  text: i => text(i) || null,
  value: i => (bold ? <strong>{text(i)}</strong> : text(i)),
});

// The item's own columns, as in Inventory, for each item type
const ITEM_COLUMNS: Record<string, Column[]> = {
  FABRIC: [
    col('Fabric Type', i => fabricCategoryLabel(i.category)),
    col('Brand', i => i.brand, true),
    { header: 'Quality', text: i => i.quality, value: i => <>{i.quality}{i.qualityName && <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{i.qualityName}</div>}</> },
    col('Shade', i => i.shade),
  ],
  READY_MADE: [
    col('Item Name', i => i.name, true), col('Fabric Type', i => i.category), col('Color / Shade', i => i.shade), col('Art No', i => i.artNo), col('Size', i => i.size),
  ],
  ACCESSORY: [
    col('Category', i => i.category), col('Accessory Item', i => i.name, true), col('Spec / Quality', i => i.quality), col('Color', i => i.shade), col('Size', i => i.size),
  ],
  ALL: [
    { header: 'Item', text: i => i.description, value: i => <><strong>{i.description}</strong><div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{TYPE_NAME[i.itemType] ?? i.itemType}</div></> },
  ],
};
const countWord = (type: string) => (type === 'FABRIC' ? 'Lumps' : type === 'ALL' ? 'Lumps / Packs' : 'Packs');

const STATUS: Record<string, [string, string]> = {
  IN_STOCK: ['Full', 'In stock'], PARTIALLY_USED: ['Cut', 'Part used'], QC_HOLD: ['QC Hold', 'QC Hold'],
};

/** The rolls or packs inside one item, loaded when the item is opened. */
function ItemRolls({ item, rolls, error }: { item: ValuedItem; rolls: RollAtCost[] | null; error: string }) {
  if (error) return <div className="alert alert-danger" style={{ margin: 0 }}>{error}</div>;
  if (!rolls) return <div style={{ padding: 12 }}><span className="spinner" /></div>;
  const fabric = item.itemType === 'FABRIC';
  const has = { bundle: rolls.some(r => r.bundle), status: rolls.some(r => r.status), shelf: rolls.some(r => r.shelves.length), supplier: rolls.some(r => r.supplierName || r.invoiceRef) };
  return (
    <table className="table" style={{ fontSize: 12.5, margin: 0, width: '100%', background: '#fff' }}>
      <thead>
        <tr style={{ background: '#f1f5f9' }}>
          <th>SKU Code</th>
          <th>PO / Source</th>
          {has.bundle && <th>Bundle No</th>}
          {has.status && <th>Status</th>}
          {has.shelf && <th>Shelf</th>}
          <th style={{ textAlign: 'right' }}>Quantity</th>
          <th style={{ textAlign: 'right' }}>Cost / unit</th>
          <th style={{ textAlign: 'right' }}>Value</th>
          <th>Inward</th>
          {has.supplier && <th>Supplier / Invoice</th>}
        </tr>
      </thead>
      <tbody>
        {rolls.map(r => (
          <tr key={r.id}>
            <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.batchCode}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {r.origin === 'PO' && r.poId
                ? <Link to={`/purchase-orders/${r.poId}/view`} onClick={e => e.stopPropagation()} style={{ fontWeight: 600 }}>{r.poNumber}</Link>
                : <span style={{ color: 'var(--color-text-muted)' }}>{originText(r)}</span>}
            </td>
            {has.bundle && <td>{r.bundle}</td>}
            {has.status && <td>{r.status && (STATUS[r.status]?.[fabric ? 0 : 1] ?? r.status)}</td>}
            {has.shelf && <td>{r.shelves.join(', ')}</td>}
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatQty(r.quantity, r.uom)}</td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {r.costPrice !== null ? costText(r.costPrice, r.uom) : <span style={{ color: '#b45309' }}>No cost</span>}
            </td>
            <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{rupees(r.value)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.receivedAt)}</td>
            {has.supplier && <td>{[r.supplierName, r.invoiceRef && `Inv ${r.invoiceRef}`].filter(Boolean).join(' · ')}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One cost, or the range when the item was bought at different prices (each lump's price shows when opened). */
function ItemCost({ item: i }: { item: ValuedItem }) {
  if (i.costPerUnit !== null) return <>{costText(i.costPerUnit, i.uom)}</>;
  if (i.lowestCost == null || i.highestCost == null) return <>{costText(i.averageCost, i.uom, true)}</>;
  return (
    <>
      <span title="Bought at different prices; open the item to see each lump's price">
        {rupees(i.lowestCost)} – {rupees(i.highestCost)} / {unitLabel(i.uom)}
      </span>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>avg {rupees(i.averageCost)} · {i.prices} prices</div>
    </>
  );
}

const PAGE = 50;

/** Filters worked out on the server (they depend on each lump or pack), as on the Inventory screen. */
export interface StockFilters {
  search?: string; from?: string; to?: string; status?: string; supplier?: string; source?: string; cost?: string;
}
export interface FilterChoices { suppliers: string[]; noSupplier: boolean }

const filterLabel = { fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4, display: 'block' } as const;
const filterBox = { minWidth: 0 } as const;
// Five to a row: the top row holds a type's five columns, the bottom row the lump filters
const filterRow = { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, alignItems: 'end' } as const;
const STATUS_FILTER: [string, string][] = [['IN_STOCK', 'Full lumps / packs'], ['PARTIALLY_USED', 'Cut / part used'], ['QC_HOLD', 'QC Hold']];
const SOURCE_FILTER: [string, string][] = [['PO', 'Against a PO'], ['DIRECT', 'Direct Inward'], ['RETURN', 'Customer Return']];
const COST_FILTER: [string, string][] = [['WITH', 'With a cost'], ['WITHOUT', 'Without a cost']];

/**
 * Items at cost with tabs for Fabric / Readymade / Accessories, filters, and an Excel download of
 * what is on screen. With `rollsFor`, an item opens to show its lumps or packs and their costs.
 * With `server`, the lump filters (search, dates, status, supplier, source, cost)
 * are sent to the server; the item filters (fabric type, brand, quality, shade) work here.
 */
export function ItemsAtCost({ data, fileName, heading, note, summary, onExport, rollsFor, allRolls, server }: {
  data: Valuation;
  fileName: string;
  heading: string;
  note: string;
  summary?: SummaryLine[];
  onExport: (columns: Record<string, string[]>, rowCount: number) => Promise<void>;
  rollsFor?: (key: string) => Promise<RollAtCost[]>;
  /** Every lump and pack with its cost: the Excel then has a sheet of them per item type. */
  allRolls?: () => Promise<LumpAtCost[]>;
  server?: { filters: StockFilters; onChange: (f: StockFilters) => void; choices: FilterChoices | null; loading: boolean; fields?: { dates?: boolean; status?: boolean } };
}) {
  const types = TYPE_ORDER.filter(t => data.byType.some(g => g.itemType === t));
  const [type, setType] = useState(types.length === 1 ? types[0] : 'ALL');
  const [search, setSearch] = useState('');            // when there are no server filters
  // The chosen item type's own columns (Fabric: Fabric Type, Brand, Quality…; Readymade: Item Name, Art No…)
  const [itemFilters, setItemFilters] = useState<Partial<Record<ItemFilterKey, string>>>({});
  const setItemFilter = (key: ItemFilterKey, value: string) => { setItemFilters(f => ({ ...f, [key]: value })); setShown(PAGE); };
  const fabricType = itemFilters.fabricType ?? '';
  const [advanced, setAdvanced] = useState(false);
  const [shown, setShown] = useState(PAGE);
  // Items opened, and the lumps already loaded (kept when an item is closed, until the figures change)
  const [open, setOpen] = useState<Record<string, { rolls: RollAtCost[] | null; error: string; shown: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // New figures (filters changed): opened items are loaded again when opened
  useEffect(() => { setOpen({}); setShown(PAGE); }, [data]);

  const sf = server?.filters ?? {};
  const setServer = (patch: StockFilters) => server?.onChange({ ...sf, ...patch });

  const ofType = useMemo(() => data.items.filter(i => type === 'ALL' || i.itemType === type), [data.items, type]);
  const brands = useMemo(() => [...new Set(ofType.map(i => i.brand?.trim()).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b)), [ofType]);
  // Items matching everything but the fabric type: the Fabric Type breakdown is worked out from these
  const beforeFabricType = useMemo(() => ofType.filter(i =>
    matchesItemFilters(i, { ...itemFilters, fabricType: undefined })
    && (server || !search.trim() || i.description.toLowerCase().includes(search.trim().toLowerCase()))),
  [ofType, itemFilters, search, server]);
  const items = useMemo(() => beforeFabricType.filter(i => !fabricType || (i.itemType === 'FABRIC' && i.category === fabricType)),
    [beforeFabricType, fabricType]);
  const fabricTypes = useMemo(() => {
    const groups = new Map<string, { category: string; value: number; rolls: number }>();
    for (const i of beforeFabricType) {
      if (i.itemType !== 'FABRIC') continue;
      const k = i.category ?? '';
      const g = groups.get(k) ?? { category: k, value: 0, rolls: 0 };
      g.value += i.value; g.rolls += i.rolls;
      groups.set(k, g);
    }
    return [...groups.values()].sort((a, b) => b.value - a.value);
  }, [beforeFabricType]);
  const columns = (ITEM_COLUMNS[type] ?? ITEM_COLUMNS.ALL).filter(c => items.some(i => c.text(i)));
  const shownTotals = useMemo(() => items.reduce((t, i) => ({ value: t.value + i.value, rolls: t.rolls + i.rolls }), { value: 0, rolls: 0 }), [items]);
  const span = columns.length + 4 + (rollsFor ? 1 : 0);
  const itemFiltered = Object.values(itemFilters).some(v => v?.trim()) || Boolean(!server && search.trim());
  const serverFiltered = Object.values(sf).some(v => v);
  const filtered = itemFiltered || serverFiltered;

  const clearAll = () => {
    setSearch(''); setItemFilters({}); setShown(PAGE);
    if (serverFiltered) server?.onChange({});
  };

  const toggle = (item: ValuedItem) => {
    if (!rollsFor) return;
    const known = open[item.key];
    if (known?.shown) { setOpen(o => ({ ...o, [item.key]: { ...known, shown: false } })); return; }
    if (known?.rolls && !known.error) { setOpen(o => ({ ...o, [item.key]: { ...known, shown: true } })); return; }
    setOpen(o => ({ ...o, [item.key]: { rolls: null, error: '', shown: true } }));
    rollsFor(item.key)
      .then(rolls => setOpen(o => (o[item.key] ? { ...o, [item.key]: { ...o[item.key], rolls, error: '' } } : o)))
      .catch(err => { if (!isLocked(err)) setOpen(o => ({ ...o, [item.key]: { rolls: [], error: err?.response?.data?.error || 'Could not load the rolls.', shown: true } })); });
  };

  // The filters in words, for the Excel
  const filterWords = () => {
    const words: string[] = [];
    if (type !== 'ALL') words.push(TYPE_NAME[type] ?? type);
    if (type !== 'ALL') {
      for (const def of ITEM_FILTERS[type as ItemTypeKey]) {
        const value = itemFilters[def.key]?.trim();
        if (value) words.push(`${def.label} "${def.key === 'fabricType' ? fabricCategoryLabel(value) : value}"`);
      }
    }
    if (sf.search) words.push(`Search "${sf.search}"`);
    if (!server && search.trim()) words.push(`Search "${search.trim()}"`);
    if (sf.from || sf.to) words.push(`Inward ${sf.from ? formatDate(sf.from) : '…'} to ${sf.to ? formatDate(sf.to) : '…'}`);
    if (sf.status) words.push(STATUS_FILTER.find(s => s[0] === sf.status)?.[1] ?? sf.status);
    if (sf.supplier) words.push(sf.supplier === 'NONE' ? 'No supplier' : `Supplier ${sf.supplier}`);
    if (sf.source) words.push(SOURCE_FILTER.find(s => s[0] === sf.source)?.[1] ?? sf.source);
    if (sf.cost) words.push(COST_FILTER.find(s => s[0] === sf.cost)?.[1] ?? sf.cost);
    return words.join(' · ');
  };

  // The Excel holds what is on screen: these items (and their lumps), with their totals
  const download = async () => {
    setBusy(true); setError('');
    try {
      const keys = new Set(items.map(i => i.key));
      const byType = TYPE_ORDER.map(t => {
        const ofT = items.filter(i => i.itemType === t);
        return { itemType: t, value: ofT.reduce((s, i) => s + i.value, 0), rolls: ofT.reduce((s, i) => s + i.rolls, 0), rollsWithoutCost: ofT.reduce((s, i) => s + i.rollsWithoutCost, 0) };
      }).filter(g => g.rolls > 0);
      const rolls = byType.reduce((s, g) => s + g.rolls, 0), without = byType.reduce((s, g) => s + g.rollsWithoutCost, 0);
      const onScreen: Valuation = {
        items,
        byType,
        totals: { value: Math.round(byType.reduce((s, g) => s + g.value, 0) * 100) / 100, rolls, rollsWithoutCost: without, costedRolls: rolls - without },
      };
      const lumps = allRolls ? (await allRolls()).filter(r => keys.has(r.key)) : undefined;
      const words = filterWords();
      const { file, columns: taken } = await buildValuationWorkbook(onScreen, heading, words ? `${note} Filtered: ${words}.` : note, summary, lumps);
      await onExport(taken, items.length);
      saveFile(new Blob([file], { type: XLSX_TYPE }), fileName);
    } catch (err: any) {
      if (!isLocked(err)) setError(err?.response?.data?.error || err?.message || 'The Excel file could not be made.');
    } finally {
      setBusy(false);
    }
  };

  const tab = (id: string, label: string, value: number) => (
    <button key={id} type="button" role="tab" aria-selected={type === id} onClick={() => { setType(id); setItemFilters({}); setShown(PAGE); }}
      className={`btn ${type === id ? 'btn-primary' : 'btn-secondary'}`}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0, padding: '8px 16px', minWidth: 150, lineHeight: 1.25 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800 }}>{rupees(value)}</span>
    </button>
  );
  const tabTypes = type !== 'ALL' && !types.includes(type) ? [...types, type] : types;
  const searchValue = server ? sf.search ?? '' : search;

  return (
    <>
      {/* Filters, laid out as on the Inventory screen */}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: 520 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--color-text-muted)' }} />
            <input className="form-input" style={{ paddingLeft: 32 }} aria-label="Search"
              placeholder={server ? 'Search SKU code, supplier, PO, invoice, brand, quality, shade, art no…' : 'Search items…'}
              value={searchValue} onChange={e => { if (server) setServer({ search: e.target.value }); else setSearch(e.target.value); setShown(PAGE); }} />
          </div>
          {server && server.fields?.dates !== false && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <DateField compact short="From" label="From inward date" value={sf.from ?? ''} onChange={v => setServer({ from: v || undefined })} max={sf.to || undefined} />
              <DateField compact short="To" label="To inward date" value={sf.to ?? ''} onChange={v => setServer({ to: v || undefined })} min={sf.from || undefined} />
            </div>
          )}
          <button type="button" className={`btn ${advanced ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAdvanced(a => !a)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <SlidersHorizontal size={15} /> Advanced Filters
          </button>
          {filtered && (
            <button type="button" className="btn btn-ghost" onClick={clearAll} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <RefreshCcw size={14} /> Reset
            </button>
          )}
          {server?.loading && <span className="spinner" aria-label="Loading" />}
        </div>

        {advanced && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Top row: the chosen item type's own columns */}
          {type === 'ALL' ? (
            <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              Choose Fabric, Readymade or Accessories below to filter by that type's columns (Brand, Quality, Item Name, Art No, Size…).
            </div>
          ) : (
            <div style={filterRow}>
              {ITEM_FILTERS[type as ItemTypeKey].map(def => (
                <div key={def.key} style={filterBox}>
                  <label style={filterLabel} htmlFor={`sv-${def.key}`}>{def.label}</label>
                  {def.key === 'fabricType' ? (
                    <select id={`sv-${def.key}`} className="form-input" value={fabricType} onChange={e => setItemFilter('fabricType', e.target.value)}>
                      <option value="">All fabric types</option>
                      {fabricTypes.filter(f => f.category).map(f => <option key={f.category} value={f.category}>{fabricCategoryLabel(f.category)}</option>)}
                    </select>
                  ) : def.key === 'brand' && brands.length > 0 ? (
                    <select id={`sv-${def.key}`} className="form-input" value={itemFilters.brand ?? ''} onChange={e => setItemFilter('brand', e.target.value)}>
                      <option value="">All brands</option>
                      {brands.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input id={`sv-${def.key}`} className="form-input" placeholder={def.placeholder} value={itemFilters[def.key] ?? ''} onChange={e => setItemFilter(def.key, e.target.value)} />
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Bottom row: about each lump or pack */}
          <div style={filterRow}>
            {server && (
              <>
                <div style={filterBox}>
                  <label style={filterLabel} htmlFor="sv-supplier">Supplier</label>
                  <select id="sv-supplier" className="form-input" value={sf.supplier ?? ''} onChange={e => setServer({ supplier: e.target.value || undefined })}>
                    <option value="">All suppliers</option>
                    {server.choices?.suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                    {server.choices?.noSupplier && <option value="NONE">No supplier recorded</option>}
                  </select>
                </div>
                <div style={filterBox}>
                  <label style={filterLabel} htmlFor="sv-source">PO / Source</label>
                  <select id="sv-source" className="form-input" value={sf.source ?? ''} onChange={e => setServer({ source: e.target.value || undefined })}>
                    <option value="">All</option>
                    {SOURCE_FILTER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {server.fields?.status !== false && <div style={filterBox}>
                  <label style={filterLabel} htmlFor="sv-status">Status</label>
                  <select id="sv-status" className="form-input" value={sf.status ?? ''} onChange={e => setServer({ status: e.target.value || undefined })}>
                    <option value="">All stock (full, cut and QC hold)</option>
                    {STATUS_FILTER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>}
                <div style={filterBox}>
                  <label style={filterLabel} htmlFor="sv-cost">Cost</label>
                  <select id="sv-cost" className="form-input" value={sf.cost ?? ''} onChange={e => setServer({ cost: e.target.value || undefined })}>
                    <option value="">With or without a cost</option>
                    {COST_FILTER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>
          </div>
        )}
      </div>

      <div role="tablist" aria-label="Item type" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(types.length > 1 || type === 'ALL') && tab('ALL', 'All stock', data.totals.value)}
        {tabTypes.map(t => tab(t, TYPE_NAME[t] ?? t, data.byType.find(g => g.itemType === t)?.value ?? 0))}
      </div>

      {/* Fabric Type breakdown: tap one to see only that type */}
      {type === 'FABRIC' && fabricTypes.length > 1 && (
        <div aria-label="Fabric type breakdown" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {fabricTypes.map(f => {
            const active = fabricType === f.category;
            return (
              <button key={f.category || 'none'} type="button" onClick={() => setItemFilter('fabricType', active ? '' : f.category)} aria-pressed={active}
                style={{
                  border: `1px solid ${active ? 'var(--color-brand)' : 'var(--color-border)'}`, background: active ? '#f5f3ff' : '#fff',
                  borderRadius: 8, padding: '6px 12px', textAlign: 'left', cursor: 'pointer', minWidth: 130,
                }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{f.category ? fabricCategoryLabel(f.category) : 'No fabric type'}</div>
                <div style={{ fontSize: 14.5, fontWeight: 800 }}>{rupees(f.value)}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{f.rolls} {f.rolls === 1 ? 'lump' : 'lumps'}</div>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {items.length} {items.length === 1 ? 'item' : 'items'} · {shownTotals.rolls} {countWord(type).toLowerCase()}
          {filtered && <> · <strong style={{ color: 'var(--color-text-main)' }}>{rupees(shownTotals.value)}</strong> shown</>}
        </span>
        <button type="button" className="btn btn-secondary" onClick={download} disabled={busy || items.length === 0} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title={filtered ? 'Exports what is shown' : undefined}>
          {busy ? <span className="spinner" /> : <Download size={15} />} Export to Excel
        </button>
      </div>
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden', opacity: server?.loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 13, margin: 0, width: '100%' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {rollsFor && <th style={{ width: 44 }} />}
                {columns.map(c => <th key={c.header}>{c.header}</th>)}
                <th style={{ textAlign: 'right' }}>In stock</th>
                <th style={{ textAlign: 'right' }}>{countWord(type)}</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={span} style={{ textAlign: 'center', padding: 30, color: 'var(--color-text-muted)' }}>No stock found.</td></tr>}
              {items.slice(0, shown).map(i => {
                const opened = open[i.key]?.shown ? open[i.key] : undefined;
                return (
                  <Fragment key={i.key}>
                    <tr onClick={() => toggle(i)} style={{ cursor: rollsFor ? 'pointer' : undefined, background: opened ? '#f8fafc' : undefined }}>
                      {rollsFor && (
                        <td>
                          <button type="button" className="btn btn-ghost btn-icon" aria-label={opened ? 'Hide rolls' : 'Show rolls'} aria-expanded={!!opened}
                            onClick={e => { e.stopPropagation(); toggle(i); }}>
                            {opened ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                      )}
                      {columns.map(c => <td key={c.header}>{c.value(i)}</td>)}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{formatQty(i.quantity, i.uom)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {i.rolls}
                        {i.rollsWithoutCost > 0 && <div style={{ color: '#b45309', fontSize: 11.5 }}>{i.rollsWithoutCost} without a cost</div>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><ItemCost item={i} /></td>
                      <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{i.value > 0 ? rupees(i.value) : ''}</td>
                    </tr>
                    {opened && (
                      <tr>
                        <td colSpan={span} style={{ padding: '8px 12px 14px 56px', background: '#f8fafc' }}>
                          <ItemRolls item={i} rolls={opened.rolls} error={opened.error} />
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
      <LoadMore shown={Math.min(shown, items.length)} total={items.length} hasMore={items.length > shown} loading={false} onMore={() => setShown(s => s + PAGE)} noun="items" />
    </>
  );
}
