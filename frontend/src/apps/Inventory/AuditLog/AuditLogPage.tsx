import { useEffect, useState } from 'react';
import api from '../../../utils/api';
import { ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Scissors, Search, RefreshCw, MapPin } from 'lucide-react';
import { formatDateTime } from '../../../utils/format';
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
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'YESTERDAY' | 'WEEK'>('ALL');
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    const params: any = {};
    if (typeFilter) {
      params.type = typeFilter;
    }

    const now = new Date();
    if (dateFilter === 'TODAY') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      params.from = todayStart.toISOString();
    } else if (dateFilter === 'YESTERDAY') {
      const yStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const yEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      params.from = yStart.toISOString();
      params.to = yEnd.toISOString();
    } else if (dateFilter === 'WEEK') {
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      params.from = weekStart.toISOString();
    }

    api.get('/api/transactions', { params })
      .then(r => setTxs(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [typeFilter, dateFilter]);

  const filteredTxs = txs.filter(tx => {
    if (typeFilter === 'PUT_AWAY' && (!isPutAway(tx) || tx.type !== 'INTERNAL_TRANSFER')) return false;
    if (typeFilter === 'RELOCATION' && (isPutAway(tx) || tx.type !== 'INTERNAL_TRANSFER')) return false;

    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (tx.batch?.batchCode || '').toLowerCase().includes(q) ||
      (tx.batch?.brand || '').toLowerCase().includes(q) ||
      (tx.batch?.shade || '').toLowerCase().includes(q) ||
      (tx.batch?.quality || '').toLowerCase().includes(q) ||
      (tx.batch?.name || '').toLowerCase().includes(q) ||
      (tx.operator?.name || '').toLowerCase().includes(q) ||
      (tx.notes && tx.notes.toLowerCase().includes(q))
    );
  });

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

      {/* Date Filter Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--color-border)', paddingBottom: 0 }}>
        {[
          { key: 'ALL', label: 'All History' },
          { key: 'TODAY', label: 'Today' },
          { key: 'YESTERDAY', label: 'Yesterday' },
          { key: 'WEEK', label: 'Last 7 Days' },
        ].map(tab => (
          <button
            key={tab.key}
            className="btn btn-ghost"
            onClick={() => setDateFilter(tab.key as any)}
            style={{
              borderBottom: dateFilter === tab.key ? '2px solid var(--color-brand)' : '2px solid transparent',
              borderRadius: 0,
              color: dateFilter === tab.key ? 'var(--color-brand)' : 'var(--color-text-muted)',
              fontWeight: dateFilter === tab.key ? 600 : 400,
              padding: '8px 16px',
              fontSize: 13
            }}
          >
            {tab.label}
          </button>
        ))}
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

        <button className="btn btn-secondary" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Audit Table */}
      {loading ? (
        <div className="loading-center"><span className="spinner spinner-lg" /></div>
      ) : filteredTxs.length === 0 ? (
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
              {filteredTxs.map(tx => {
                const isFabric = tx.batch?.itemType === 'FABRIC';
                const unit = tx.batch?.uom ? tx.batch.uom.toLowerCase() : (isFabric ? 'm' : 'pcs');

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
                      {tx.notes || tx.referenceType || '—'}
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
        </div>
      )}
    </div>
  );
}
