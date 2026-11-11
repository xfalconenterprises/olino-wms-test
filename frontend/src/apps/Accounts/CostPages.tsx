import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Search, Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { apiError } from '../../utils/printPage';
import { formatDate } from '../../utils/format';
import { formatQty, unitLabel } from '../../utils/units';
import LoadMore from '../../components/Common/LoadMore';
import { PageTitle, StatCard, TYPE_NAME, cardGrid, isLocked, rupees, useCostApi, useLoadMore } from './shared';

// Costs per unit in rupees: on PO lines, and on rolls received without a PO (Direct Inward).

const muted = { color: 'var(--color-text-muted)' };

/** A cost cell that turns into a box to type the new cost. */
function CostCell({ cost, uom, editing, onEdit, onCancel, onSave, saving }: {
  cost: number | null; uom: string; editing: boolean; saving: boolean;
  onEdit: () => void; onCancel: () => void; onSave: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  useEffect(() => { if (editing) setValue(cost !== null ? String(cost) : ''); }, [editing, cost]);
  if (editing) {
    return (
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input type="number" className="form-input" style={{ width: 110, height: 32 }} step="0.01" min="0" autoFocus aria-label="Cost per unit"
          value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSave(value); } if (e.key === 'Escape') onCancel(); }} />
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => onSave(value)} disabled={saving} title="Save"><Check size={16} color="#166534" /></button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel} title="Cancel"><X size={16} /></button>
      </div>
    );
  }
  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {cost !== null
        ? <strong>{rupees(cost)} <span style={{ fontWeight: 400, ...muted }}>/ {unitLabel(uom)}</span></strong>
        : <span style={{ color: '#b45309', fontSize: 12 }}>No cost</span>}
      <button type="button" className="btn btn-ghost btn-icon" title="Change cost price" onClick={onEdit}><Pencil size={14} /></button>
    </div>
  );
}

function SearchBar({ placeholder, onSearch, children }: { placeholder: string; onSearch: (q: string) => void; children?: ReactNode }) {
  const [text, setText] = useState('');
  return (
    <form onSubmit={e => { e.preventDefault(); onSearch(text.trim()); }} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: 460 }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 11, ...muted }} />
        <input className="form-input" style={{ paddingLeft: 32 }} placeholder={placeholder} value={text} onChange={e => setText(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-secondary">Search</button>
      {children}
    </form>
  );
}

// ─── PO line costs ──────────────────────────────────────────────────────────

interface CostLine {
  id: string; poId: string; poNumber: string; supplierName: string; poDate: string;
  description: string; uom: string; orderedQty: number; receivedQty: number; inStockQty: number;
  costPrice: number | null; code: string; stockValue: number | null;
}
interface LinesReply { total: number; lines: CostLine[] }

/**
 * PO lines and their costs: the lines of one PO (`poId`, opened from Purchase Costs), or else the
 * lines with stock in hand and no cost (Missing Costs).
 */
function PurchaseCostsTable({ poId, onChanged }: { poId?: string; onChanged?: () => void }) {
  const costApi = useCostApi();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchRows = useCallback((range: { offset: number; limit: number }) => costApi<LinesReply>({
    url: '/api/accounts/po-costs',
    params: poId ? { poId } : { search: query || undefined, missing: '1', inStock: '1', ...range },
  }), [costApi, query, poId]);
  const list = useLoadMore(fetchRows, r => r.lines, err => { if (!isLocked(err)) setError(apiError(err, 'Failed to load PO costs')); });
  const data = list.reply;

  const save = async (id: string, value: string) => {
    if (!value.trim() && !window.confirm('Remove the cost price from this line?')) return;
    setSaving(true); setError('');
    try {
      await costApi({ method: 'PUT', url: `/api/accounts/po-costs/${id}`, data: { costPrice: value.trim() || null } });
      setEditing(null);
      await list.refresh();
      onChanged?.();
    } catch (err) {
      if (!isLocked(err)) setError(apiError(err, 'Failed to save the cost price'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {!poId && (
        <SearchBar placeholder="Search PO number, supplier, brand, quality, item…" onSearch={setQuery} />
      )}
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      {poId && !data && !error && <div style={{ padding: 12 }}><span className="spinner" /></div>}
      <div className="card" style={{ padding: 0, overflow: 'hidden', display: poId && !data ? 'none' : undefined }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 13, margin: 0, width: '100%' }}>
            <thead>
              <tr style={{ background: poId ? '#f1f5f9' : '#f8fafc' }}>
                {!poId && <><th>PO</th><th>Supplier</th></>}<th>Item</th>
                <th style={{ textAlign: 'right' }}>Ordered</th>{poId && <th style={{ textAlign: 'right' }}>Received</th>}<th style={{ textAlign: 'right' }}>In stock</th>
                <th style={{ textAlign: 'right', width: 200 }}>Cost / unit</th><th>Code</th><th style={{ textAlign: 'right' }}>Stock value</th>
              </tr>
            </thead>
            <tbody>
              {data && list.rows.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, ...muted }}>{poId ? 'No lines on this PO.' : 'Every PO line with stock in hand has a cost.'}</td></tr>
              )}
              {list.rows.map(l => (
                <tr key={l.id}>
                  {!poId && (
                    <>
                      <td>
                        <Link to={`/purchase-orders/${l.poId}/view`} style={{ fontWeight: 700 }}>{l.poNumber}</Link>
                        <div style={{ fontSize: 11.5, ...muted }}>{formatDate(l.poDate)}</div>
                      </td>
                      <td>{l.supplierName}</td>
                    </>
                  )}
                  <td>{l.description}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatQty(l.orderedQty, l.uom)}</td>
                  {poId && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{l.receivedQty > 0 ? formatQty(l.receivedQty, l.uom) : ''}</td>}
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{l.inStockQty > 0 ? formatQty(l.inStockQty, l.uom) : ''}</td>
                  <td style={{ textAlign: 'right' }}>
                    <CostCell cost={l.costPrice} uom={l.uom} editing={editing === l.id} saving={saving}
                      onEdit={() => setEditing(l.id)} onCancel={() => setEditing(null)} onSave={v => save(l.id, v)} />
                  </td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }} title="Labels add 2 decoy letters before and 1 after">{l.code}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.stockValue ? rupees(l.stockValue) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {data && !poId && <LoadMore shown={list.rows.length} total={list.total} hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} noun="lines" />}
    </>
  );
}

// ─── Purchase orders at cost: one row each, opening to their lines ───────────

interface PoRow {
  id: string; poNumber: string; supplierName: string; poDate: string; status: string;
  lines: number; linesWithoutCost: number; orderValue: number; receivedValue: number; stockValue: number;
}
interface PoReply { total: number; pageSize: number; summary: { missingPos: number }; orders: PoRow[] }

const PO_STATUS: Record<string, string> = { PENDING: 'Pending', PARTIALLY_RECEIVED: 'Part received', RECEIVED: 'Received' };

function PurchaseOrdersTable() {
  const costApi = useCostApi();
  const [query, setQuery] = useState('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const fetchRows = useCallback((range: { offset: number; limit: number }) => costApi<PoReply>({
    url: '/api/accounts/po-orders', params: { search: query || undefined, missing: missing ? '1' : undefined, ...range },
  }), [costApi, query, missing]);
  const list = useLoadMore(fetchRows, r => r.orders, err => { if (!isLocked(err)) setError(apiError(err, 'Failed to load purchase orders')); });
  const data = list.reply;

  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });

  return (
    <>
      {data && (
        <div style={cardGrid}>
          <StatCard label="POs with lines without a cost" value={data.summary.missingPos} tone={data.summary.missingPos ? 'warn' : 'good'}>
            {data.summary.missingPos > 0 && !missing && <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={() => setMissing(true)}>Show them</button>}
          </StatCard>
        </div>
      )}
      <SearchBar placeholder="Search PO number, supplier, brand, quality, item…" onSearch={setQuery}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={missing} onChange={e => setMissing(e.target.checked)} /> Only POs with lines without a cost
        </label>
      </SearchBar>
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 13, margin: 0, width: '100%' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ width: 44 }} />
                <th>PO</th><th>Supplier</th><th>Status</th><th style={{ textAlign: 'right' }}>Lines</th>
                <th style={{ textAlign: 'right' }}>Order value</th><th style={{ textAlign: 'right' }}>Received value</th><th style={{ textAlign: 'right' }}>Stock in hand</th>
              </tr>
            </thead>
            <tbody>
              {data && list.rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, ...muted }}>No purchase orders found.</td></tr>}
              {list.rows.map(o => {
                const opened = open.has(o.id);
                return (
                  <Fragment key={o.id}>
                    <tr onClick={() => toggle(o.id)} style={{ cursor: 'pointer', background: opened ? '#f8fafc' : undefined }}>
                      <td>
                        <button type="button" className="btn btn-ghost btn-icon" aria-label={opened ? 'Hide lines' : 'Show lines'} aria-expanded={opened}
                          onClick={e => { e.stopPropagation(); toggle(o.id); }}>
                          {opened ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td>
                        <Link to={`/purchase-orders/${o.id}/view`} onClick={e => e.stopPropagation()} style={{ fontWeight: 700 }}>{o.poNumber}</Link>
                        <div style={{ fontSize: 11.5, ...muted }}>{formatDate(o.poDate)}</div>
                      </td>
                      <td>{o.supplierName}</td>
                      <td>{PO_STATUS[o.status] ?? o.status}</td>
                      <td style={{ textAlign: 'right' }}>
                        {o.lines}
                        {o.linesWithoutCost > 0 && <div style={{ color: '#b45309', fontSize: 11.5 }}>{o.linesWithoutCost} without a cost</div>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{o.orderValue > 0 ? rupees(o.orderValue) : ''}</td>
                      <td style={{ textAlign: 'right' }}>{o.receivedValue > 0 ? rupees(o.receivedValue) : ''}</td>
                      <td style={{ textAlign: 'right' }}>{o.stockValue > 0 ? rupees(o.stockValue) : ''}</td>
                    </tr>
                    {opened && (
                      <tr>
                        <td colSpan={8} style={{ padding: '8px 12px 14px 56px', background: '#f8fafc' }}>
                          <PurchaseCostsTable poId={o.id} onChanged={list.refresh} />
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
      {data && <LoadMore shown={list.rows.length} total={list.total} hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} noun="purchase orders" />}
    </>
  );
}

export function PurchaseCostsPage() {
  return (
    <>
      <PageTitle title="Purchase Costs" text="Each purchase order at cost. Open a PO to see its lines and change a line's cost per unit; every roll received against the line takes that cost." />
      <PurchaseOrdersTable />
    </>
  );
}

// ─── Direct Inward costs ────────────────────────────────────────────────────

interface DirectRoll {
  id: string; batchCode: string; description: string; uom: string; quantity: number; inStock: boolean;
  supplierName: string | null; grnNumber: string | null; invoiceRef: string | null; receivedAt: string;
  costPrice: number | null; code: string; stockValue: number | null;
}
interface DirectReply { total: number; rolls: DirectRoll[] }

/** Rolls received without a PO, one cost for one or many at a time. */
function DirectCostsTable({ onChanged }: { onChanged?: () => void }) {
  const costApi = useCostApi();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCost, setBulkCost] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchRows = useCallback((range: { offset: number; limit: number }) => costApi<DirectReply>({
    url: '/api/accounts/direct-costs',
    params: { search: query || undefined, missing: '1', inStock: '1', ...range },
  }), [costApi, query]);
  const list = useLoadMore(fetchRows, r => r.rolls, err => { if (!isLocked(err)) setError(apiError(err, 'Failed to load Direct Inward costs')); });
  const data = list.reply;
  useEffect(() => { setSelected(new Set()); }, [query]);

  const setCost = async (batchIds: string[], value: string) => {
    if (!value.trim() && !window.confirm(batchIds.length === 1 ? 'Remove the cost price from this roll?' : `Remove the cost price from ${batchIds.length} rolls?`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const r = await costApi<{ updated: number }>({ method: 'PUT', url: '/api/accounts/direct-costs', data: { batchIds, costPrice: value.trim() || null } });
      setEditing(null); setSelected(new Set()); setBulkCost('');
      if (batchIds.length > 1) setNotice(`Cost saved on ${r.updated} ${r.updated === 1 ? 'roll' : 'rolls'}.`);
      await list.refresh();
      onChanged?.();
    } catch (err) {
      if (!isLocked(err)) setError(apiError(err, 'Failed to save the cost price'));
    } finally {
      setSaving(false);
    }
  };

  const rows = list.rows;
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  return (
    <>
      <SearchBar placeholder="Search SKU code, supplier, invoice, GRN, brand, quality…" onSearch={setQuery} />

      {selected.size > 0 && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#eef2ff' }}>
          <strong>{selected.size} selected</strong>
          <span style={{ fontSize: 13 }}>Cost per unit</span>
          <input type="number" className="form-input" style={{ width: 130, height: 34 }} step="0.01" min="0" aria-label="Cost per unit for the selected rolls"
            value={bulkCost} onChange={e => setBulkCost(e.target.value)} />
          <button type="button" className="btn btn-primary btn-sm" disabled={saving || !bulkCost.trim()} onClick={() => setCost([...selected], bulkCost)}>Set cost</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setCost([...selected], '')}>Remove cost</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto' }}>Clear</button>
        </div>
      )}
      {notice && <div className="alert alert-success" style={{ marginBottom: 12 }}>{notice}</div>}
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 13, margin: 0, width: '100%' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ width: 36 }}>
                  <input type="checkbox" aria-label="Select all shown" checked={allSelected} disabled={!rows.length}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)))} />
                </th>
                <th>Roll</th><th>Supplier / Invoice</th><th>Item</th><th style={{ textAlign: 'right' }}>In stock</th>
                <th style={{ textAlign: 'right', width: 200 }}>Cost / unit</th><th>Code</th><th style={{ textAlign: 'right' }}>Stock value</th>
              </tr>
            </thead>
            <tbody>
              {data && rows.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, ...muted }}>Every roll received without a PO that is in stock has a cost.</td></tr>
              )}
              {rows.map(r => (
                <tr key={r.id}>
                  <td><input type="checkbox" aria-label={`Select ${r.batchCode}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.batchCode}</div>
                    <div style={{ fontSize: 11.5, ...muted }}>{formatDate(r.receivedAt)}</div>
                  </td>
                  <td>
                    {r.supplierName && <div>{r.supplierName}</div>}
                    {(r.invoiceRef || r.grnNumber) && <div style={{ fontSize: 11.5, ...muted }}>{[r.invoiceRef && `Inv ${r.invoiceRef}`, r.grnNumber].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td>{r.description}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r.inStock ? formatQty(r.quantity, r.uom) : <span style={muted}>Out</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <CostCell cost={r.costPrice} uom={r.uom} editing={editing === r.id} saving={saving}
                      onEdit={() => setEditing(r.id)} onCancel={() => setEditing(null)} onSave={v => setCost([r.id], v)} />
                  </td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }} title="Labels add 2 decoy letters before and 1 after">{r.code}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.stockValue ? rupees(r.stockValue) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {data && <LoadMore shown={list.rows.length} total={list.total} hasMore={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} noun="rolls" />}
    </>
  );
}

// ─── Missing costs: stock in hand with no cost ──────────────────────────────

interface MissingSummary { rollsWithoutCost: number; rolls: number; items: number; byType: { itemType: string; rollsWithoutCost: number }[] }

export function MissingCostsPage() {
  const costApi = useCostApi();
  const [summary, setSummary] = useState<MissingSummary | null>(null);
  const loadSummary = useCallback(() => {
    costApi<MissingSummary>({ url: '/api/accounts/missing-summary' }).then(setSummary).catch(() => {});
  }, [costApi]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  return (
    <>
      <PageTitle title="Missing Costs" text="Stock in hand that has no cost, so it is left out of the stock value. Labels printed before the cost was added carry no code: reprint them to show it." />
      {summary && (
        <div style={cardGrid}>
          <StatCard label="In stock without a cost" value={summary.rollsWithoutCost} tone={summary.rollsWithoutCost ? 'warn' : 'good'}
            note={summary.rollsWithoutCost ? `Of ${summary.rolls} lumps and packs; not in the stock value` : 'Every lump and pack has a cost'} />
          {summary.rollsWithoutCost > 0 && <StatCard label="Items affected" value={summary.items} note="Items with at least one lump or pack without a cost" />}
          {summary.byType.map(t => (
            <StatCard key={t.itemType} label={TYPE_NAME[t.itemType] ?? t.itemType} value={t.rollsWithoutCost}
              note={t.itemType === 'FABRIC' ? 'Lumps without a cost' : 'Packs without a cost'} />
          ))}
        </div>
      )}
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 10px' }}>PO lines</h3>
      <PurchaseCostsTable onChanged={loadSummary} />
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '28px 0 10px' }}>Rolls received without a PO</h3>
      <DirectCostsTable onChanged={loadSummary} />
    </>
  );
}
