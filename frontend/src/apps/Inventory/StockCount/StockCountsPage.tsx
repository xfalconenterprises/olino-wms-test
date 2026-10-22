import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, ChevronRight } from 'lucide-react';
import api from '../../../utils/api';
import { apiError } from '../../../utils/printPage';
import { formatDateTime } from '../../../utils/format';
import '../../../styles/components.css';

interface CountRow {
  id: string;
  countNumber: string;
  scopeLabel: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  closedAt: string | null;
  createdBy: { name: string };
  closedBy: { name: string } | null;
  locationCount: number;
  countedCount: number;
}

interface Scopes {
  racks: { id: string; name: string; locationCount: number }[];
  floorCount: number;
  totalCount: number;
}

const STATUS_BADGE: Record<CountRow['status'], string> = { OPEN: 'badge-warning', COMPLETED: 'badge-success', CANCELLED: 'badge-neutral' };

export default function StockCountsPage() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<CountRow[]>([]);
  const [scopes, setScopes] = useState<Scopes | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'RACKS' | 'FLOOR' | 'ALL'>('RACKS');
  const [rackIds, setRackIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/api/stock-counts'), api.get('/api/stock-counts/scopes')])
      .then(([c, s]) => { setCounts(c.data); setScopes(s.data); })
      .catch(err => setError(apiError(err, 'Failed to load stock counts')))
      .finally(() => setLoading(false));
  }, []);

  const selectedLocations = !scopes ? 0
    : scope === 'ALL' ? scopes.totalCount
    : scope === 'FLOOR' ? scopes.floorCount
    : scopes.racks.filter(r => rackIds.includes(r.id)).reduce((t, r) => t + r.locationCount, 0);

  const start = async () => {
    setCreating(true);
    setError('');
    try {
      const { data } = await api.post('/api/stock-counts', { scope, rackIds: scope === 'RACKS' ? rackIds : undefined, notes });
      navigate(`/stock-counts/${data.id}`);
    } catch (err) {
      setError(apiError(err, 'Could not start the count'));
    } finally {
      setCreating(false);
    }
  };

  const toggleRack = (id: string) => setRackIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ClipboardCheck size={26} /> Stock Count</h1>
          <p className="page-subtitle">Count shelves, review the differences, and correct stock in one approval</p>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><h2 className="card-title">Start a count</h2></div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            {([['RACKS', 'Selected racks'], ['FLOOR', 'Floor spots'], ['ALL', 'Whole warehouse']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setScope(value)} style={{
                padding: '8px 16px', borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                border: `1.5px solid ${scope === value ? 'var(--color-brand)' : 'var(--color-border)'}`,
                background: scope === value ? 'var(--color-brand-faded)' : '#fff',
                color: scope === value ? 'var(--color-brand)' : 'var(--color-text-main)',
              }}>
                {label}
              </button>
            ))}
          </div>

          {scope === 'RACKS' && (
            <div style={{ marginBottom: 14 }}>
              {!scopes?.racks.length ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No racks are set up yet (Administration → Locations).</div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {scopes.racks.map(r => {
                    const on = rackIds.includes(r.id);
                    return (
                      <button key={r.id} type="button" onClick={() => toggleRack(r.id)} style={{
                        padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        border: `1.5px solid ${on ? 'var(--color-brand)' : 'var(--color-border)'}`,
                        background: on ? 'var(--color-brand)' : '#fff', color: on ? '#fff' : 'var(--color-text-main)',
                      }}>
                        Rack {r.name} <span style={{ opacity: 0.75, fontWeight: 500 }}>({r.locationCount})</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 14 }}>
            <label className="form-label">Notes</label>
            <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Monthly count, Rack A after rearrangement" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {selectedLocations} location(s) will be counted.
              {scope === 'ALL' && ' Items not found anywhere are written off by default.'}
            </span>
            <button className="btn btn-primary" onClick={start} disabled={creating || selectedLocations === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {creating ? <span className="spinner" /> : <Plus size={16} />} Start Count
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="card-title">Counts</h2></div>
        {loading ? (
          <div className="loading-center" style={{ minHeight: 160 }}><span className="spinner spinner-lg" /></div>
        ) : counts.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>No counts yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', margin: 0, fontSize: 13 }}>
              <thead>
                <tr><th>Count</th><th>Area</th><th>Status</th><th>Progress</th><th>Started</th><th>Closed</th><th /></tr>
              </thead>
              <tbody>
                {counts.map(c => (
                  <tr key={c.id} onClick={() => navigate(`/stock-counts/${c.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.countNumber}</td>
                    <td>{c.scopeLabel}</td>
                    <td><span className={`badge ${STATUS_BADGE[c.status]}`}>{c.status === 'OPEN' ? 'Open' : c.status === 'COMPLETED' ? 'Completed' : 'Cancelled'}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 90, height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${c.locationCount ? (c.countedCount / c.locationCount) * 100 : 0}%`, height: '100%', background: 'var(--color-brand)' }} />
                        </div>
                        {c.countedCount}/{c.locationCount}
                      </div>
                    </td>
                    <td>{formatDateTime(c.createdAt)}<div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{c.createdBy.name}</div></td>
                    <td>{c.closedAt ? <>{formatDateTime(c.closedAt)}<div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{c.closedBy?.name}</div></> : '—'}</td>
                    <td><ChevronRight size={16} color="var(--color-text-muted)" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
