import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { Clock, MapPin, PackageCheck } from 'lucide-react';
import { formatDate } from '../../../utils/format';
import { unitLabel, uomOf } from '../../../utils/units';
import '../../../styles/components.css';

interface StockItem {
  id: string;
  batchCode: string;
  itemType: 'FABRIC' | 'READY_MADE' | 'ACCESSORY';
  category?: string | null;
  brand?: string | null;
  quality?: string | null;
  shade?: string | null;
  size?: string | null;
  name?: string | null;
  artNo?: string | null;
  uom?: string | null;
  quantity: number;
  status: string;
  createdAt: string;
  batchLocations: { location: { code: string }; quantity: number }[];
}

export default function StockAgingPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'UNASSIGNED' | 'AGING'>('UNASSIGNED');
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [agingThreshold, setAgingThreshold] = useState<number>(30);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/batches');
      setItems(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Filter unassigned (Dock items)
  const unassignedItems = items.filter(
    item => item.status !== 'OUT' && item.quantity > 0 && (!item.batchLocations || item.batchLocations.length === 0)
  );

  // Filter aging items
  const now = new Date().getTime();
  const agingItems = items.filter(item => {
    if (item.status === 'OUT' || item.quantity <= 0) return false;
    const created = new Date(item.createdAt).getTime();
    const daysOld = Math.floor((now - created) / (1000 * 60 * 60 * 24));
    return daysOld >= agingThreshold;
  });

  const getUnit = (item: StockItem) => unitLabel(uomOf(item));

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={28} /> Stock Aging Analysis
          </h1>
          <p className="page-subtitle">Track slow-moving, aging inventory lots and shelf dwell time across the warehouse</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        background: '#ffffff',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '5px',
        display: 'inline-flex',
        gap: 6,
        marginBottom: 20,
      }}>
        <button
          type="button"
          onClick={() => setActiveTab('UNASSIGNED')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: activeTab === 'UNASSIGNED' ? 'var(--color-brand)' : 'transparent',
            color: activeTab === 'UNASSIGNED' ? '#ffffff' : 'var(--color-text-muted)',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <MapPin size={15} />
          <span>Awaiting Put-Away (Dock Staging)</span>
          <span style={{
            fontSize: 11,
            background: activeTab === 'UNASSIGNED' ? 'rgba(255,255,255,0.25)' : 'var(--color-bg-subtle)',
            color: activeTab === 'UNASSIGNED' ? '#fff' : '#b45309',
            padding: '2px 8px',
            borderRadius: 10,
            fontWeight: 700
          }}>
            {unassignedItems.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('AGING')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: activeTab === 'AGING' ? 'var(--color-brand)' : 'transparent',
            color: activeTab === 'AGING' ? '#ffffff' : 'var(--color-text-muted)',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <Clock size={15} />
          <span>Slow Moving &amp; Aging Stock</span>
          <span style={{
            fontSize: 11,
            background: activeTab === 'AGING' ? 'rgba(255,255,255,0.25)' : 'var(--color-bg-subtle)',
            color: activeTab === 'AGING' ? '#fff' : 'var(--color-text-muted)',
            padding: '2px 8px',
            borderRadius: 10,
            fontWeight: 700
          }}>
            {agingItems.length}
          </span>
        </button>
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner spinner-lg" /></div>
      ) : activeTab === 'UNASSIGNED' ? (
        // ─── UNASSIGNED TAB ───────────────────────────────────────────────────
        <div>
          {unassignedItems.length === 0 ? (
            <div className="table-wrapper">
              <div className="empty-state">
                <div className="empty-state-icon"><PackageCheck size={48} color="var(--color-success)" /></div>
                <div className="empty-state-text">Receiving Dock is Clear!</div>
                <p className="text-sm text-muted mt-2">All received stock items have been put away into physical shelf locations.</p>
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Batch / Roll Code</th>
                    <th>Product</th>
                    <th>Available Qty</th>
                    <th>Received Date</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unassignedItems.map(item => {
                    const unit = getUnit(item);
                    return (
                      <tr key={item.id} className="hover-row">
                        <td>
                          <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-brand)' }}>
                            {item.batchCode}
                          </code>
                        </td>
                        <td>
                          <strong>{item.name || item.brand || 'Item'}</strong>
                          {item.quality ? ` — ${item.quality}` : ''}
                          {item.shade ? ` (${item.shade})` : ''}
                        </td>
                        <td>
                          <strong style={{ fontSize: 14 }}>
                            {item.quantity} {unit}
                          </strong>
                        </td>
                        <td className="text-muted text-sm">{formatDate(item.createdAt)}</td>
                        <td>
                          <span className="badge badge-warning" style={{ background: '#fef3c7', color: '#b45309', fontWeight: 600 }}>
                            Dock / Unassigned
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => navigate(`/put-away?batch=${encodeURIComponent(item.batchCode)}`)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            <MapPin size={14} /> Put Away
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
        // ─── AGING TAB ────────────────────────────────────────────────────────
        <div>
          <div className="toolbar" style={{ marginBottom: 16 }}>
            <label className="form-label" style={{ fontWeight: 600 }}>Aging Threshold:</label>
            <select
              className="form-select"
              value={agingThreshold}
              onChange={e => setAgingThreshold(parseInt(e.target.value))}
              style={{ width: 160 }}
            >
              <option value={15}>15+ Days</option>
              <option value={30}>30+ Days</option>
              <option value={60}>60+ Days</option>
              <option value={90}>90+ Days</option>
            </select>
          </div>

          {agingItems.length === 0 ? (
            <div className="table-wrapper">
              <div className="empty-state">
                <div className="empty-state-text">No inventory items exceeding {agingThreshold} days old</div>
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Batch / Roll Code</th>
                    <th>Product</th>
                    <th>Available Qty</th>
                    <th>Shelf Location</th>
                    <th>Days in Warehouse</th>
                    <th>Received Date</th>
                  </tr>
                </thead>
                <tbody>
                  {agingItems.map(item => {
                    const created = new Date(item.createdAt).getTime();
                    const daysOld = Math.floor((now - created) / (1000 * 60 * 60 * 24));
                    const unit = getUnit(item);

                    return (
                      <tr key={item.id} className="hover-row">
                        <td>
                          <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-brand)' }}>
                            {item.batchCode}
                          </code>
                        </td>
                        <td>
                          <strong>{item.name || item.brand || 'Item'}</strong>
                          {item.quality ? ` — ${item.quality}` : ''}
                          {item.shade ? ` (${item.shade})` : ''}
                        </td>
                        <td>
                          <strong style={{ fontSize: 14 }}>
                            {item.quantity} {unit}
                          </strong>
                        </td>
                        <td>
                          {item.batchLocations?.length === 0 ? (
                            <span style={{ color: '#b45309', fontWeight: 600 }}>Dock (Unassigned)</span>
                          ) : (
                            <span style={{ fontWeight: 600, color: 'var(--color-brand)' }}>
                              {item.batchLocations[0].location.code}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${daysOld > 90 ? 'badge-danger' : daysOld > 60 ? 'badge-warning' : 'badge-neutral'}`} style={{ fontWeight: 700 }}>
                            {daysOld} days
                          </span>
                        </td>
                        <td className="text-muted text-sm">{formatDate(item.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
