import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { MapPin, Plus, Trash2, Layers, Grid, Search, Package, X, Download, Pencil, LayoutGrid } from 'lucide-react';
import '../../../styles/components.css';

interface BatchLoc {
  id: string;
  quantity: number;
  batch: {
    batchCode: string;
    brand?: string | null;
    quality?: string | null;
    shade?: string | null;
    name?: string | null;
    itemType?: string | null;
    uom?: string | null;
  };
}

interface Position {
  id: string;
  code: string;
  level: number;
  position: number;
  _count: { batchLocations: number };
}

interface Bay {
  id: string;
  number: number;
  levels: number;
  positions: number; // per level
  locations: Position[];
}

interface Rack {
  id: string;
  name: string;
  bays: Bay[];
}

interface FloorSpot {
  id: string;
  code: string;
  _count: { batchLocations: number };
}

interface SlotDetail {
  id: string;
  code: string;
  type: 'BAY' | 'FLOOR';
  level?: number | null;
  position?: number | null;
  bay?: { number: number; rack: { name: string } } | null;
  batchLocations: BatchLoc[];
}

type Modal =
  | { kind: 'rack' }
  | { kind: 'bays'; rack: Rack }
  | { kind: 'size'; rack: Rack; bay: Bay }
  | null;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

async function apiErrorMessage(err: any, fallback: string): Promise<string> {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).error || fallback; } catch { return fallback; }
  }
  return data?.error || err?.message || fallback;
}

// Downloads an authenticated API file using the name the server suggests
async function downloadFromApi(url: string, fallbackName: string) {
  const res = await api.get(url, { responseType: 'blob' });
  const disposition: string = res.headers['content-disposition'] || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

const stockCount = (rack: Rack) =>
  rack.bays.reduce((sum, b) => sum + b.locations.filter(l => l._count.batchLocations > 0).length, 0);
const positionCount = (rack: Rack) => rack.bays.reduce((sum, b) => sum + b.locations.length, 0);

export default function LocationsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'racks' | 'floor'>('racks');
  const [racks, setRacks] = useState<Rack[]>([]);
  const [floorSpots, setFloorSpots] = useState<FloorSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRackId, setSelectedRackId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SlotDetail | null>(null);
  const [barcodeUrl, setBarcodeUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState('');

  const [modal, setModal] = useState<Modal>(null);
  const [form, setForm] = useState({ name: '', bays: 5, levels: 4, positions: 3 });
  const [saving, setSaving] = useState(false);
  const [savingFloor, setSavingFloor] = useState(false);

  const loadRacks = () => api.get('/api/locations/hierarchy').then(r => setRacks(r.data));
  const loadFloor = () => api.get('/api/locations/floor').then(r => setFloorSpots(r.data));

  useEffect(() => {
    Promise.all([loadRacks(), loadFloor()])
      .catch(e => setError(e.response?.data?.error || 'Failed to load locations'))
      .finally(() => setLoading(false));
  }, []);

  // Barcode preview for the open location; the object URL is released when it changes
  useEffect(() => {
    if (!selectedSlot) { setBarcodeUrl(null); return; }
    let url: string | null = null;
    api.get(`/api/locations/barcode/${encodeURIComponent(selectedSlot.code)}`, { responseType: 'blob' })
      .then(res => { url = URL.createObjectURL(res.data); setBarcodeUrl(url); })
      .catch(() => setBarcodeUrl(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [selectedSlot?.code]);

  const query = searchQuery.trim().toUpperCase();
  const filteredRacks = useMemo(() => {
    if (!query) return racks;
    return racks.filter(r => r.name.includes(query) || r.bays.some(b => b.locations.some(l => l.code.includes(query))));
  }, [racks, query]);

  // Select the only matching rack while searching, otherwise keep the choice valid
  useEffect(() => {
    if (query && filteredRacks.length === 1) setSelectedRackId(filteredRacks[0].id);
    else if (!racks.some(r => r.id === selectedRackId)) setSelectedRackId(racks[0]?.id ?? null);
  }, [query, filteredRacks, racks, selectedRackId]);

  const selectedRack = racks.find(r => r.id === selectedRackId) || null;
  const nextRackName = LETTERS.find(l => !racks.some(r => r.name === l)) || '';

  const openModal = (next: Modal) => {
    setError('');
    if (next?.kind === 'rack') setForm({ name: nextRackName, bays: 5, levels: 4, positions: 3 });
    if (next?.kind === 'bays') {
      const last = next.rack.bays.at(-1);
      setForm(f => ({ ...f, bays: 1, levels: last?.levels ?? 4, positions: last?.positions ?? 3 }));
    }
    if (next?.kind === 'size') setForm(f => ({ ...f, levels: next.bay.levels, positions: next.bay.positions }));
    setModal(next);
  };

  const saveModal = async () => {
    if (!modal) return;
    setSaving(true);
    setError('');
    try {
      if (modal.kind === 'rack') {
        const { data } = await api.post('/api/locations/racks', { name: form.name, bays: form.bays, levels: form.levels, positions: form.positions });
        setSelectedRackId(data.id);
      } else if (modal.kind === 'bays') {
        await api.post(`/api/locations/racks/${modal.rack.id}/bays`, { count: form.bays, levels: form.levels, positions: form.positions });
      } else {
        await api.patch(`/api/locations/bays/${modal.bay.id}`, { levels: form.levels, positions: form.positions });
      }
      await loadRacks();
      setModal(null);
    } catch (e: any) {
      setError(await apiErrorMessage(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const removeRack = async (rack: Rack) => {
    if (!window.confirm(`Remove Rack ${rack.name} and all its bays? This is refused while any position holds stock.`)) return;
    try {
      await api.delete(`/api/locations/racks/${rack.id}`);
      await loadRacks();
    } catch (e: any) {
      setError(await apiErrorMessage(e, 'Failed to remove rack'));
    }
  };

  const removeBay = async (rack: Rack, bay: Bay) => {
    if (!window.confirm(`Remove bay ${rack.name}-B${bay.number}? This is refused while it holds stock.`)) return;
    try {
      await api.delete(`/api/locations/bays/${bay.id}`);
      await loadRacks();
    } catch (e: any) {
      setError(await apiErrorMessage(e, 'Failed to remove bay'));
    }
  };

  const handleAddFloor = async () => {
    setSavingFloor(true);
    setError('');
    try {
      await api.post('/api/locations/floor', {});
      await loadFloor();
    } catch (e: any) {
      setError(await apiErrorMessage(e, 'Failed to add floor spot'));
    } finally {
      setSavingFloor(false);
    }
  };

  const exportLocations = async (rack?: Rack) => {
    setExporting(rack?.id ?? 'all');
    setError('');
    try {
      const query = rack ? `?rackId=${encodeURIComponent(rack.id)}` : '';
      await downloadFromApi(`/api/locations/export${query}`, 'olino-locations.zip');
    } catch (e: any) {
      setError(await apiErrorMessage(e, 'Export failed'));
    } finally {
      setExporting('');
    }
  };

  const downloadBarcode = async (code: string, format: 'svg' | 'png') => {
    try {
      await downloadFromApi(`/api/locations/barcode/${encodeURIComponent(code)}?format=${format}`, `${code}.${format}`);
    } catch (e: any) {
      setError(await apiErrorMessage(e, 'Barcode download failed'));
    }
  };

  const openSlot = async (code: string) => {
    try {
      const res = await api.get(`/api/locations/by-code/${encodeURIComponent(code)}`);
      setSelectedSlot(res.data);
    } catch (e: any) {
      setError(await apiErrorMessage(e, 'Failed to load location'));
    }
  };

  // Codes the open modal will create, shown before saving
  const modalPreview = (() => {
    if (!modal) return '';
    const perBay = form.levels * form.positions;
    const range = (rack: string, firstBay: number, lastBay: number) =>
      `${rack}-B${firstBay}-L1-P1 … ${rack}-B${lastBay}-L${form.levels}-P${form.positions}`;
    if (modal.kind === 'rack') {
      const name = form.name || '?';
      return form.bays > 0
        ? `${range(name, 1, form.bays)}  (${form.bays * perBay} locations)`
        : `Rack ${name} with no bays yet`;
    }
    const rack = modal.rack;
    if (modal.kind === 'bays') {
      const first = (rack.bays.at(-1)?.number ?? 0) + 1;
      return `${range(rack.name, first, first + form.bays - 1)}  (${form.bays * perBay} locations)`;
    }
    return `${range(rack.name, modal.bay.number, modal.bay.number)}  (${perBay} locations)`;
  })();

  const exportButton = (rack?: Rack) => (
    <button className="btn btn-primary btn-sm" onClick={() => exportLocations(rack)} disabled={!!exporting}
      title="ZIP for the label designer: location list, SVG + PNG barcodes and instructions"
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {exporting === (rack?.id ?? 'all') ? <span className="spinner" /> : <Download size={14} />}
      {rack ? `Export Rack ${rack.name}` : 'Export Barcodes'}
    </button>
  );

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={28} /> Warehouse Locations
          </h1>
          <p className="page-subtitle">Racks → Bays → Levels → Positions. Location codes look like <code>A-B1-L1-P1</code> (L1 = bottom shelf).</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 240 }}>
            <Search size={16} color="var(--color-text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input type="text" className="form-input" placeholder="Find code (e.g. A-B2-L1-P1)" value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)} style={{ paddingLeft: 36 }} />
          </div>
          {exportButton()}
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)', marginBottom: 20 }}>
        {[{ key: 'racks', label: 'Racks', icon: <Grid size={16} /> }, { key: 'floor', label: 'Floor Spots', icon: <Layers size={16} /> }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as 'racks' | 'floor')} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', border: 'none', background: 'none',
            borderBottom: tab === t.key ? '2px solid var(--color-brand)' : '2px solid transparent',
            color: tab === t.key ? 'var(--color-brand)' : 'var(--color-text-muted)',
            fontWeight: tab === t.key ? 600 : 500, cursor: 'pointer', fontSize: 14, marginBottom: -1,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-center" style={{ minHeight: 300 }}><span className="spinner spinner-lg" /></div>
      ) : tab === 'racks' ? (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Rack list */}
          <div style={{ width: 260, flex: '0 0 260px', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ padding: 12, borderBottom: '1px solid var(--color-border)' }}>
              <button className="btn btn-primary btn-sm" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }} onClick={() => openModal({ kind: 'rack' })}>
                <Plus size={14} /> Add Rack
              </button>
            </div>
            <div style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
              {filteredRacks.length === 0 ? (
                <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
                  {query ? 'No rack or code matches.' : 'No racks yet. Add Rack A to begin.'}
                </div>
              ) : filteredRacks.map(rack => {
                const active = rack.id === selectedRackId;
                return (
                  <div key={rack.id} onClick={() => setSelectedRackId(rack.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer',
                    background: active ? '#eff6ff' : 'transparent', borderLeft: `3px solid ${active ? 'var(--color-brand)' : 'transparent'}`,
                  }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: active ? 'var(--color-brand)' : '#e2e8f0', color: active ? '#fff' : '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                      {rack.name}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Rack {rack.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {rack.bays.length} bays · {positionCount(rack)} locations
                      </div>
                    </div>
                    {stockCount(rack) > 0 && (
                      <span title="Positions holding stock" style={{ fontSize: 11, background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                        {stockCount(rack)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected rack */}
          <div style={{ flex: '1 1 480px', minWidth: 0 }}>
            {selectedRack ? (
              <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>Rack {selectedRack.name}</div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      {selectedRack.bays.length} bays · {positionCount(selectedRack)} locations · {stockCount(selectedRack)} holding stock
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => openModal({ kind: 'bays', rack: selectedRack })}>
                      <Plus size={14} /> Add Bays
                    </button>
                    {selectedRack.bays.length > 0 && exportButton(selectedRack)}
                    <button className="btn btn-secondary btn-sm" style={{ color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => removeRack(selectedRack)}>
                      <Trash2 size={14} /> Remove Rack
                    </button>
                  </div>
                </div>

                {selectedRack.bays.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', border: '1px dashed #cbd5e1', borderRadius: 8 }}>
                    This rack has no bays yet. Use <strong>Add Bays</strong>.
                  </div>
                ) : (
                  // Front view of the rack: bays side by side, each with its levels and positions
                  <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
                    {selectedRack.bays.map(bay => (
                      <div key={bay.id} style={{ flex: '0 0 auto', minWidth: 28 + bay.positions * 56, border: '4px solid #94a3b8', borderRadius: 4, background: '#f8fafc' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: '#e2e8f0' }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: '#334155' }}>B{bay.number}</span>
                          <span style={{ display: 'flex', gap: 2 }}>
                            <button className="btn btn-ghost btn-icon" title="Change levels / positions" style={{ padding: 4 }} onClick={() => openModal({ kind: 'size', rack: selectedRack, bay })}>
                              <Pencil size={13} />
                            </button>
                            <button className="btn btn-ghost btn-icon" title="Remove bay" style={{ padding: 4, color: '#dc2626' }} onClick={() => removeBay(selectedRack, bay)}>
                              <Trash2 size={13} />
                            </button>
                          </span>
                        </div>
                        {/* Top level first, like looking at the shelf */}
                        {Array.from({ length: bay.levels }, (_, i) => bay.levels - i).map(level => (
                          <div key={level} style={{ display: 'flex', borderTop: '3px solid #94a3b8' }}>
                            <div style={{ width: 28, flexShrink: 0, background: '#e2e8f0', color: '#475569', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              L{level}
                            </div>
                            {bay.locations.filter(l => l.level === level).map((loc, i) => {
                              const hasStock = loc._count.batchLocations > 0;
                              const highlighted = !!query && loc.code.includes(query);
                              return (
                                <div key={loc.id} onClick={() => openSlot(loc.code)} title={loc.code} style={{
                                  flex: 1, minWidth: 56, padding: '8px 4px', cursor: 'pointer', textAlign: 'center',
                                  borderLeft: i > 0 ? '2px solid #cbd5e1' : 'none',
                                  background: hasStock ? '#eff6ff' : '#fff',
                                  boxShadow: highlighted ? 'inset 0 0 0 2px var(--color-brand)' : 'none',
                                }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: hasStock ? '#1e40af' : '#64748b' }}>P{loc.position}</div>
                                  <div style={{ height: 20, marginTop: 4 }}>
                                    {hasStock && (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#3b82f6', color: '#fff', fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 12 }}>
                                        <Package size={11} /> {loc._count.batchLocations}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 24, textAlign: 'center' }}>
                <LayoutGrid size={48} color="#94a3b8" />
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 16 }}>No rack selected</div>
                <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 8, maxWidth: 320 }}>
                  Add a rack (A, B, C…), give it bays (B1, B2…) and positions (P1, P2…).
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        // Floor spots
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn btn-primary btn-sm" onClick={handleAddFloor} disabled={savingFloor} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {savingFloor ? <span className="spinner" /> : <><Plus size={14} /> Add Floor Spot</>}
            </button>
          </div>
          {floorSpots.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', background: '#fff', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
              <Layers size={40} color="var(--color-text-muted)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
              <div style={{ fontSize: 16, fontWeight: 500 }}>No floor spots defined</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
              {floorSpots.map(spot => (
                <div key={spot.id} onClick={() => openSlot(spot.code)} style={{
                  background: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, cursor: 'pointer',
                  border: `1px solid ${spot._count.batchLocations > 0 ? '#93c5fd' : 'var(--color-border)'}`,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{spot.code}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {spot._count.batchLocations > 0
                      ? <><Package size={14} color="#3b82f6" /> <span style={{ color: '#1d4ed8', fontWeight: 600 }}>{spot._count.batchLocations} batch(es)</span></>
                      : 'Empty location'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add rack / add bays / change positions */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', padding: 28, width: 440, maxWidth: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>
              {modal.kind === 'rack' ? 'Add Rack' : modal.kind === 'bays' ? `Add Bays to Rack ${modal.rack.name}` : `Size of Bay ${modal.rack.name}-B${modal.bay.number}`}
            </h2>
            {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {modal.kind === 'rack' && (
                <div>
                  <label className="form-label">Rack name</label>
                  <input className="form-input" value={form.name} maxLength={5} placeholder="A"
                    onChange={e => setForm(f => ({ ...f, name: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: modal.kind === 'size' ? '1fr 1fr' : '1fr 1fr 1fr', gap: 12 }}>
                {modal.kind !== 'size' && (
                  <div>
                    <label className="form-label">{modal.kind === 'rack' ? 'Bays' : 'Bays to add'}</label>
                    <input type="number" className="form-input" min={modal.kind === 'rack' ? 0 : 1} max={50} value={form.bays}
                      onChange={e => setForm(f => ({ ...f, bays: Math.max(modal.kind === 'rack' ? 0 : 1, Math.min(50, parseInt(e.target.value) || 0)) }))} />
                  </div>
                )}
                <div>
                  <label className="form-label">Levels per bay</label>
                  <input type="number" className="form-input" min={1} max={20} value={form.levels}
                    onChange={e => setForm(f => ({ ...f, levels: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)) }))} />
                </div>
                <div>
                  <label className="form-label">Positions per level</label>
                  <input type="number" className="form-input" min={1} max={50} value={form.positions}
                    onChange={e => setForm(f => ({ ...f, positions: Math.max(1, Math.min(50, parseInt(e.target.value) || 1)) }))} />
                </div>
              </div>
              {modal.kind === 'size' && (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Levels are added or removed at the top, positions at the end of each level. Slots that hold stock cannot be removed.
                </div>
              )}
              <div style={{ background: '#f0f9ff', borderRadius: 6, padding: 12, fontSize: 13, color: '#0369a1', border: '1px solid #bae6fd', fontFamily: 'monospace' }}>
                {modalPreview}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setModal(null); setError(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={saveModal} disabled={saving || (modal.kind === 'rack' && !form.name)}>
                {saving ? <span className="spinner" /> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Location drawer */}
      {selectedSlot && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100 }} onClick={() => setSelectedSlot(null)}>
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 420, maxWidth: '100%', background: '#fff', boxShadow: '-8px 0 30px rgba(0,0,0,0.1)', padding: '28px 24px', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700 }}>{selectedSlot.code}</h2>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {selectedSlot.bay ? `Rack ${selectedSlot.bay.rack.name} · Bay B${selectedSlot.bay.number} · Level L${selectedSlot.level} · Position P${selectedSlot.position}` : 'Floor spot'}
                </div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setSelectedSlot(null)} style={{ background: '#f1f5f9', borderRadius: '50%' }}><X size={16} /></button>
            </div>

            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 16, textAlign: 'center', marginBottom: 12 }}>
              {barcodeUrl
                ? <img src={barcodeUrl} alt={`Barcode ${selectedSlot.code}`} style={{ maxWidth: '100%', height: 60 }} />
                : <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner" /></div>}
              <div style={{ fontFamily: 'monospace', fontWeight: 700, marginTop: 6 }}>{selectedSlot.code}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => downloadBarcode(selectedSlot.code, 'svg')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Download size={14} /> SVG
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => downloadBarcode(selectedSlot.code, 'png')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Download size={14} /> PNG
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => navigate(`/put-away?location=${encodeURIComponent(selectedSlot.code)}`)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                <MapPin size={14} /> Put Away Here
              </button>
            </div>

            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Package size={18} color="var(--color-brand)" /> Current Stock ({selectedSlot.batchLocations.length})
            </div>
            {selectedSlot.batchLocations.length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 14, background: '#f8fafc', padding: 20, borderRadius: 8, textAlign: 'center', border: '1px dashed #cbd5e1' }}>
                This location is empty.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedSlot.batchLocations.map(bl => (
                  <div key={bl.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{bl.batch.batchCode}</div>
                      {bl.batch.itemType && (
                        <span className={`badge ${bl.batch.itemType === 'FABRIC' ? 'badge-primary' : bl.batch.itemType === 'READY_MADE' ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                          {bl.batch.itemType.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      {bl.batch.name || [bl.batch.brand, bl.batch.quality, bl.batch.shade].filter(Boolean).join(' · ') || 'Item'}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8, background: '#f0fdf4', color: '#166534', display: 'inline-flex', padding: '4px 10px', borderRadius: 20 }}>
                      {bl.quantity} {bl.batch.uom ? bl.batch.uom.toLowerCase() : (bl.batch.itemType === 'FABRIC' ? 'm' : 'pcs')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
