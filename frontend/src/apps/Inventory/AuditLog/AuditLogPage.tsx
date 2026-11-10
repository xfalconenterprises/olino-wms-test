import { useState } from 'react';
import { ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Scissors, Search, RefreshCw, MapPin, X } from 'lucide-react';
import { formatDateTime, istDayEndISO, istDayStartISO } from '../../../utils/format';
import DateField from '../../../components/Common/DateField';
import { unitLabel, uomOf } from '../../../utils/units';
import { useDebounced, usePagedList } from '../../../hooks/usePagedList';
import LoadMore from '../../../components/Common/LoadMore';
import '../../../styles/components.css';

interface Tx {
  id: string;
  type: string;
  quantityMoved: number;
  previousQuantity: number | null;
  newQuantity: number | null;
  referenceType: string | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  notes: string | null;
  createdAt: string;
  batch?: {
    batchCode: string;
    itemType?: string | null;
    brand?: string | null;
    quality?: string | null;
    shade?: string | null;
    name?: string | null;
    artNo?: string | null;
    size?: string | null;
    uom?: string | null;
  } | null;
  operator: { name: string };
}

const isPutAway = (tx: Tx) => {
  if (tx.referenceType === 'PUT_AWAY') return true;
  if (tx.notes) {
    const n = tx.notes.toLowerCase();
    if (n.includes('put-away') || n.includes('put away') || n.includes('shelf placement') || n.includes('assigned') || n.includes('placed on shelf')) {
      return true;
    }
  }
  if (!tx.fromLocationId && tx.toLocationId) return true;
  return false;
};

export default function AuditLogPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');

  // The whole history, newest first, 50 at a time; type, dates and search are applied by the server
  const txs = usePagedList<Tx>('/api/transactions', {
    type: typeFilter || undefined,
    from: startDate ? istDayStartISO(startDate) : undefined,
    to: endDate ? istDayEndISO(endDate) : undefined,
    search: useDebounced(search.trim()) || undefined,
  });
  const loading = txs.loading;
  const load = txs.reload;

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ArrowRightLeft size={28} /> Audit Log & Stock Movements
          </h1>
          <p className="page-subtitle">Complete immutable audit trail of all warehouse activities</p>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', width: 320 }}>
          <Search size={16} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search SKU Code, Operator, Product..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 36, width: '100%' }}
          />
        </div>

        <select
          className="form-select"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{ width: 220 }}
        >
          <option value="">All Movement Types</option>
          <option value="STOCK_IN">Stock In (Receipts)</option>
          <option value="PUT_AWAY">Put Away (Shelf Placement)</option>
          <option value="RELOCATION">Relocations (Transfers)</option>
          <option value="STOCK_OUT">Stock Out (Dispatches)</option>
          <option value="PARTIAL_CUT">Partial Cut</option>
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DateField compact short="From" label="From date" value={startDate} onChange={setStartDate} max={endDate || undefined} />
          <DateField compact short="To" label="To date" value={endDate} onChange={setEndDate} min={startDate || undefined} />
          {(startDate || endDate) && (
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => { setStartDate(''); setEndDate(''); }}
              title="Clear date filter" aria-label="Clear date filter">
              <X size={15} />
            </button>
          )}
        </div>

        <button className="btn btn-secondary" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Audit Table */}
      {loading ? (
        <div className="loading-center"><span className="spinner spinner-lg" /></div>
      ) : txs.rows.length === 0 ? (
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="empty-state-icon"><ArrowRightLeft size={48} className="text-muted" /></div>
            <div className="empty-state-text">No movement logs found</div>
            {search && <p className="text-sm text-muted mt-2">Try clearing your search query</p>}
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>SKU Code</th>
                <th>Product Description</th>
                <th>Quantity Moved</th>
                <th>Audit Notes</th>
                <th>Operator</th>
                <th style={{ textAlign: 'right' }}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {txs.rows.map(tx => {
                const unit = unitLabel(uomOf(tx.batch));

                return (
                  <tr key={tx.id}>
                    <td>
                      {tx.type === 'STOCK_IN' && (
                        <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ArrowDownToLine size={12} /> STOCK IN
                        </span>
                      )}
                      {tx.type === 'STOCK_OUT' && (
                        <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ArrowUpFromLine size={12} /> STOCK OUT
                        </span>
                      )}
                      {tx.type === 'PARTIAL_CUT' && (
                        <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Scissors size={12} /> PARTIAL CUT
                        </span>
                      )}
                      {tx.type === 'INTERNAL_TRANSFER' && (
                        isPutAway(tx) ? (
                          <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}>
                            <MapPin size={12} /> PUT AWAY
                          </span>
                        ) : (
                          <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>
                            <ArrowRightLeft size={12} /> RELOCATED
                          </span>
                        )
                      )}
                    </td>
                    <td>
                      <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-brand)' }}>
                        {tx.batch?.batchCode || '—'}
                      </code>
                    </td>
                    <td className="text-sm">
                      <strong>{tx.batch?.name || tx.batch?.brand || 'Item'}</strong> {tx.batch?.quality ? `· ${tx.batch.quality}` : ''} {tx.batch?.shade ? `· ${tx.batch.shade}` : ''} {tx.batch?.size ? `(Size ${tx.batch.size})` : ''}
                    </td>
                    <td>
                      <strong style={{ fontSize: 14 }}>{tx.quantityMoved} {unit}</strong>
                    </td>
                    <td className="text-muted text-sm">
                      {tx.notes || tx.referenceType}
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{tx.operator?.name || 'System'}</span>
                    </td>
                    <td className="text-muted text-xs" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatDateTime(tx.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <LoadMore shown={txs.rows.length} total={txs.total} hasMore={txs.hasMore} loading={txs.loadingMore} onMore={txs.loadMore} noun="entries" />
        </div>
      )}
    </div>
  );
}
