import { Fragment, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarRange, ChevronDown, ChevronRight, Download, Search, Undo2, Users, X } from 'lucide-react';
import api from '../../../utils/api';
import { apiError } from '../../../utils/printPage';
import { useAuth } from '../../../hooks/useAuth';
import { hasPermission } from '../../../utils/roles';
import { allowsDecimals, fabricCategoryLabel, formatTotals, formatUnitTotals, unitLabel } from '../../../utils/units';
import { writeXlsx, type Cell } from '../../../utils/xlsx';
import { saveFile } from '../../../utils/download';
import { formatDate } from '../../../utils/format';
import DateField from '../../../components/Common/DateField';
import { useConfirm } from '../../../components/Common/ConfirmDialog';

interface ItemKey {
  itemType: string; category: string | null; brand: string | null; quality: string | null; qualityName: string | null;
  shade: string | null; size: string | null; name: string | null; artNo: string | null; uom: string;
}
interface StatementItem extends ItemKey {
  opening: number; received: number; customerReturns: number; dispatched: number; supplierReturns: number; adjustments: number; closing: number;
}
interface ClientDispatch {
  customerName: string;
  challans: number;
  totals: [string, number][];
  items: (ItemKey & { quantity: number; challans: number })[];
}
interface EndedYear { id: string; from: string; to: string; endedByName: string; endedAt: string }
interface Statement {
  from: string; to: string; toToday: boolean;
  currentYear: { from: string; to: string };
  endedYears: EndedYear[];   // newest first
  currentStarted: boolean;   // false right after a year was ended today
  canEndYear: boolean;
  latestUndoUntil: string | null;   // the latest year-end can be undone until then
  items: StatementItem[];
  clients: ClientDispatch[];
}
// Which period is shown: the current year, an ended year, or dates chosen by hand
type Period = { kind: 'CURRENT' } | { kind: 'ENDED'; id: string } | { kind: 'CUSTOM'; from: string; to: string };

type TypeFilter = 'ALL' | 'FABRIC' | 'READY_MADE' | 'ACCESSORY';
const TYPE_TABS: { key: TypeFilter; label: string }[] = [
  { key: 'ALL', label: 'All' }, { key: 'FABRIC', label: 'Fabric' }, { key: 'READY_MADE', label: 'Ready-Made' }, { key: 'ACCESSORY', label: 'Accessories' },
];

const num = (n: number, uom: string) => String(allowsDecimals(uom) ? Math.round(n * 100) / 100 : Math.round(n));
const ddmmyyyy = (key: string) => key.split('-').reverse().join('-');
const nextDay = (key: string) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** "Siyaram · PV (Poly Viscose)" and "Suiting · Shade Navy": only what was entered */
function itemTitle(i: ItemKey): string {
  if (i.itemType === 'FABRIC') {
    return [[i.brand, i.quality].filter(Boolean).join(' · '), i.qualityName ? `(${i.qualityName})` : ''].filter(Boolean).join(' ') || fabricCategoryLabel(i.category) || 'Fabric';
  }
  return i.name || i.brand || i.quality || i.category || 'Item';
}
function itemDetails(i: ItemKey): string {
  const type = i.itemType === 'FABRIC' ? fabricCategoryLabel(i.category) : i.itemType === 'READY_MADE' ? i.category : (i.name ? i.category : '');
  return [type, i.shade && `Shade ${i.shade}`, i.artNo && `Art ${i.artNo}`, i.size && `Size ${i.size}`].filter(Boolean).join(' · ');
}

/**
 * Administration → Reports → Year-End Stock. For the business's own year (ended on any date, the next
 * starting the day after) or any chosen dates: each item's opening stock, what came in and went out,
 * and closing stock; and what each client was sent.
 */
export default function YearEndReport() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>({ kind: 'CURRENT' });
  const [years, setYears] = useState<{ current: Statement['currentYear']; ended: EndedYear[] } | null>(null);
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [search, setSearch] = useState('');
  const [openClient, setOpenClient] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);       // the End this year dialog
  const [endsOn, setEndsOn] = useState('');
  const [password, setPassword] = useState('');
  const [endError, setEndError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDialog, ask] = useConfirm();

  // The dates asked for: none for the current year (the server knows where it starts)
  const range = period.kind === 'CUSTOM' ? { from: period.from, to: period.to }
    : period.kind === 'ENDED' ? years?.ended.find(y => y.id === period.id) : undefined;
  const rangeKey = range ? `${range.from}|${range.to}` : '';
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    // A year just ended isn't in the list yet: this load brings the new list, then the year itself loads
    setLoading(true);
    setError('');
    api.get<Statement>('/api/reports/year-end', { params: range ? { from: range.from, to: range.to } : {} })
      .then(r => { setData(r.data); setYears({ current: r.data.currentYear, ended: r.data.endedYears }); })
      .catch(err => setError(apiError(err, 'Could not load the stock statement.')))
      .finally(() => setLoading(false));
  }, [rangeKey, period.kind, reloads]); // eslint-disable-line react-hooks/exhaustive-deps

  const choosePeriod = (value: string) => {
    if (value === 'CURRENT') setPeriod({ kind: 'CURRENT' });
    else if (value === 'CUSTOM') setPeriod({ kind: 'CUSTOM', from: data?.from ?? years?.current.from ?? '', to: data?.to ?? years?.current.to ?? '' });
    else setPeriod({ kind: 'ENDED', id: value.slice(6) });
  };
  const periodValue = period.kind === 'ENDED' ? `ENDED:${period.id}` : period.kind;
  const latestEnded = years?.ended[0];

  const openEndYear = () => {
    setEndsOn(years?.current.to ?? '');
    setPassword('');
    setEndError('');
    setEnding(true);
  };

  // Ending a year is confirmed with the person's own password
  const endYear = async () => {
    setBusy(true);
    setEndError('');
    try {
      const { data: year } = await api.post('/api/reports/year-end/end', { endsOn, password });
      setEnding(false);
      setReloads(n => n + 1);
      setPeriod({ kind: 'ENDED', id: year.id });
    } catch (err) {
      setEndError(apiError(err, 'Could not end the year.'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const undoYearEnd = async () => {
    if (!latestEnded) return;
    const yes = await ask(`Undo the year-end of ${ddmmyyyy(latestEnded.to)}? Its dates join the current year again.`, { confirm: 'Undo year-end', cancel: 'Keep it' });
    if (!yes) return;
    try {
      await api.delete('/api/reports/year-end/latest');
      setPeriod({ kind: 'CURRENT' });
      setReloads(n => n + 1);
    } catch (err) {
      setError(apiError(err, 'Could not undo the year-end.'));
    }
  };

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter(i =>
      (typeFilter === 'ALL' || i.itemType === typeFilter) &&
      (!q || `${itemTitle(i)} ${itemDetails(i)}`.toLowerCase().includes(q)));
  }, [data, typeFilter, search]);

  // Totals per unit (meters, kg and pieces are never added together)
  const total = (field: keyof StatementItem) => formatTotals(items.map(i => ({ uom: i.uom, quantity: i[field] as number })), true);
  // In the Total row a column with no movement at all shows a dash, like the item rows
  const totalCell = (field: keyof StatementItem) => items.some(i => Math.abs(i[field] as number) >= 0.0005)
    ? total(field) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>;

  const exportExcel = () => {
    if (!data) return;
    const header: Cell[] = ['Item', 'Details', 'Unit', 'Opening', 'Received', 'Customer returns', 'Dispatched', 'Returned to supplier', 'Adjustments & counts', 'Closing'];
    const statement: Cell[][] = [header, ...items.map(i => [
      itemTitle(i), itemDetails(i), unitLabel(i.uom), i.opening, i.received, i.customerReturns, i.dispatched, i.supplierReturns, i.adjustments, i.closing,
    ])];
    const clients: Cell[][] = [['Client', 'Challans', 'Item', 'Details', 'Unit', 'Dispatched'], ...data.clients.flatMap(c => c.items.map(i => [
      c.customerName, i.challans, itemTitle(i), itemDetails(i), unitLabel(i.uom), i.quantity,
    ] as Cell[]))];
    saveFile(writeXlsx([
      { name: 'Stock Statement', rows: statement, boldHeader: true, columnWidths: [30, 30, 7, 11, 11, 15, 11, 18, 18, 11] },
      { name: 'Client Dispatch', rows: clients, boldHeader: true, columnWidths: [28, 9, 30, 30, 7, 12] },
    ]), `Olino_Stock_Statement_${data.from}_to_${data.to}.xlsx`);
  };

  const cell = (v: number, uom: string, signed = false) => Math.abs(v) < 0.0005
    ? <span style={{ color: 'var(--color-text-muted)' }}>—</span>
    : <>{signed && v > 0 ? '+' : ''}{num(v, uom)}</>;

  return (
    <div>
      {/* Controls */}
      <div style={{ background: '#fff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5 }}>
            <CalendarRange size={17} color="var(--color-brand)" /> Period
            <select className="form-select" value={periodValue} onChange={e => choosePeriod(e.target.value)} style={{ height: 38, width: 280 }}>
              <option value="CURRENT">{years ? `Current year (from ${ddmmyyyy(years.current.from)})` : 'Current year'}</option>
              {years?.ended.map(y => <option key={y.id} value={`ENDED:${y.id}`}>Year ending {ddmmyyyy(y.to)}</option>)}
              <option value="CUSTOM">Choose dates…</option>
            </select>
          </label>
          {period.kind === 'CUSTOM' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <DateField compact short="From" label="First day" value={period.from} max={period.to || undefined}
                onChange={from => setPeriod({ ...period, from })} />
              <DateField compact short="To" label="Last day" value={period.to} min={period.from || undefined} max={years?.current.to}
                onChange={to => setPeriod({ ...period, to })} />
            </div>
          )}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: 3, borderRadius: 6, gap: 2 }}>
            {TYPE_TABS.map(t => (
              <button key={t.key} type="button" onClick={() => setTypeFilter(t.key)}
                style={{ border: 'none', background: typeFilter === t.key ? '#fff' : 'transparent', color: typeFilter === t.key ? 'var(--color-brand)' : 'var(--color-text-muted)', fontWeight: typeFilter === t.key ? 700 : 500, fontSize: 12.5, padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative', width: 260 }}>
            <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input className="form-input" placeholder="Search item, shade, art no..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 36, height: 38 }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {data?.canEndYear && data.latestUndoUntil && period.kind === 'ENDED' && latestEnded?.id === period.id && (
            <button className="btn btn-ghost" onClick={undoYearEnd} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38 }}>
              <Undo2 size={15} /> Undo this year-end (until {formatDate(data.latestUndoUntil)})
            </button>
          )}
          {data?.canEndYear && (
            <button className="btn btn-secondary" onClick={openEndYear} disabled={!years || !data?.currentStarted}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, height: 38 }}>
              <CalendarCheck size={15} /> End this year
            </button>
          )}
          {hasPermission(user, 'export.report_year_end') && (
            <button className="btn btn-secondary" onClick={exportExcel} disabled={!data || loading} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, height: 38 }}>
              <Download size={15} /> Download Excel
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
      {loading || !data ? (
        <div className="loading-center"><span className="spinner spinner-lg" /></div>
      ) : (
        <>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {ddmmyyyy(data.from)} to {ddmmyyyy(data.to)}.{' '}
            {data.toToday ? 'Closing stock is the stock on hand today.' : `Closing stock is the stock at the end of ${ddmmyyyy(data.to)}.`}
          </p>

          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            {([['Opening stock', 'opening'], ['Received', 'received'], ['Dispatched', 'dispatched'], ['Closing stock', 'closing']] as const).map(([label, field]) => (
              <div key={field} className="card" style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{total(field)}</div>
              </div>
            ))}
          </div>

          {/* Stock statement */}
          <div className="table-wrapper" style={{ marginBottom: 28 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Item</th>
                  <th style={{ textAlign: 'right' }}>Opening</th>
                  <th style={{ textAlign: 'right' }}>+ Received</th>
                  <th style={{ textAlign: 'right' }}>+ Customer returns</th>
                  <th style={{ textAlign: 'right' }}>− Dispatched</th>
                  <th style={{ textAlign: 'right' }}>− Returned to supplier</th>
                  <th style={{ textAlign: 'right' }}>± Adjustments &amp; counts</th>
                  <th style={{ textAlign: 'right' }}>Closing</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={idx}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{itemTitle(i)}</div>
                      {itemDetails(i) && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{itemDetails(i)}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{num(i.opening, i.uom)} {unitLabel(i.uom)}</td>
                    <td style={{ textAlign: 'right' }}>{cell(i.received, i.uom)}</td>
                    <td style={{ textAlign: 'right' }}>{cell(i.customerReturns, i.uom)}</td>
                    <td style={{ textAlign: 'right' }}>{cell(i.dispatched, i.uom)}</td>
                    <td style={{ textAlign: 'right' }}>{cell(i.supplierReturns, i.uom)}</td>
                    <td style={{ textAlign: 'right' }}>{cell(i.adjustments, i.uom, true)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{num(i.closing, i.uom)} {unitLabel(i.uom)}</td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>No stock movements in this period.</td></tr>
                ) : (
                  <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td>Total</td>
                    <td style={{ textAlign: 'right' }}>{total('opening')}</td>
                    <td style={{ textAlign: 'right' }}>{totalCell('received')}</td>
                    <td style={{ textAlign: 'right' }}>{totalCell('customerReturns')}</td>
                    <td style={{ textAlign: 'right' }}>{totalCell('dispatched')}</td>
                    <td style={{ textAlign: 'right' }}>{totalCell('supplierReturns')}</td>
                    <td style={{ textAlign: 'right' }}>{totalCell('adjustments')}</td>
                    <td style={{ textAlign: 'right' }}>{total('closing')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Client-wise dispatch */}
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={17} color="var(--color-brand)" /> Dispatched to each client
          </h3>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Client</th>
                  <th style={{ textAlign: 'right' }}>Challans</th>
                  <th style={{ textAlign: 'right' }}>Dispatched</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.map(c => {
                  const open = openClient === c.customerName;
                  return (
                    <Fragment key={c.customerName}>
                      <tr className="hover-row" onClick={() => setOpenClient(open ? null : c.customerName)} style={{ cursor: 'pointer' }}>
                        <td style={{ color: 'var(--color-text-muted)' }}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                        <td style={{ fontWeight: 600 }}>{c.customerName}</td>
                        <td style={{ textAlign: 'right' }}>{c.challans}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatUnitTotals(c.totals, true)}</td>
                      </tr>
                      {open && c.items.map((i, idx) => (
                        <tr key={idx} style={{ background: '#fafbfc' }}>
                          <td />
                          <td>
                            <div>{itemTitle(i)}</div>
                            {itemDetails(i) && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{itemDetails(i)}</div>}
                          </td>
                          <td style={{ textAlign: 'right' }}>{i.challans}</td>
                          <td style={{ textAlign: 'right' }}>{num(i.quantity, i.uom)} {unitLabel(i.uom)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {data.clients.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)' }}>Nothing was dispatched in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {ending && years && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><CalendarCheck size={18} /> End this year</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setEnding(false)} aria-label="Close" style={{ padding: 4, color: 'var(--color-text-muted)' }}><X size={18} /></button>
            </div>
            <div style={{ padding: 20 }}>
              <label className="form-label">Last day of this year</label>
              <DateField label="Last day of this year" value={endsOn} min={years.current.from} max={years.current.to} onChange={setEndsOn} />
              {endsOn && (
                <p style={{ margin: '14px 0 0', fontSize: 13.5, lineHeight: 1.5 }}>
                  The year <strong>{ddmmyyyy(years.current.from)} to {ddmmyyyy(endsOn)}</strong> will be ended. The next year starts on <strong>{ddmmyyyy(nextDay(endsOn))}</strong>.
                </p>
              )}
              <label className="form-label" htmlFor="year-end-password" style={{ display: 'block', marginTop: 18 }}>Your password</label>
              <input id="year-end-password" type="password" className="form-input" autoComplete="current-password" value={password}
                onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && endsOn && password) endYear(); }} style={{ height: 42 }} />
              {endError && <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: 'var(--color-danger)' }}>{endError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 14, marginTop: 16, borderTop: '1px solid var(--color-border)' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEnding(false)} disabled={busy}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={endYear} disabled={busy || !endsOn || !password}>{busy ? <span className="spinner" /> : 'End the year'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
