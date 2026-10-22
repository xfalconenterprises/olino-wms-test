import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../utils/api';
import {
  Layers, Search, Plus, Edit, Trash2, Tag, Palette, Shirt, Sparkles, X, Hash, Scissors,
  CheckCircle2, AlertCircle, RotateCcw, Boxes, Scale, FileText,
} from 'lucide-react';
import { fabricCategoryLabel, loadFabricCategories, unitName } from '../../../utils/units';
import '../../../styles/components.css';

export interface MasterAttributeItem {
  id: string;
  type: string;
  value: string;
  category?: string | null;
  unit?: string | null;
  usageCount: number;
}

type Group = 'FABRIC' | 'READY_MADE' | 'ACCESSORY';

interface ListDef {
  id: string;
  type: string;                                // attribute type stored in the database
  label: string;
  icon: React.FC<any>;
  placeholder: string;
  hint: string;
  context?: 'FABRIC_CATEGORY';                 // entries belong to a fabric type
  itemCategory?: 'READY_MADE' | 'ACCESSORY';   // garment vs accessory item names share one type
  shared?: boolean;
}

// The catalogue is arranged by what the stock is; each list keeps its own attribute type
const GROUPS: { key: Group; label: string; icon: React.FC<any>; lists: ListDef[] }[] = [
  {
    key: 'FABRIC', label: 'Fabric', icon: Layers,
    lists: [
      { id: 'FABRIC_CATEGORY', type: 'FABRIC_CATEGORY', label: 'Fabric Types', icon: Scale, placeholder: 'e.g. Suiting, Knits, Denim', hint: 'Each fabric type is measured in meters or kilograms. Its unit is used for purchase orders, receiving, labels and reports.' },
      { id: 'BRAND', type: 'BRAND', label: 'Brands', icon: Tag, placeholder: 'e.g. Raymond, Siyaram', hint: 'Fabric mills and brands.' },
      { id: 'QUALITY', type: 'QUALITY', label: 'Qualities', icon: Scissors, placeholder: 'e.g. PV-2041, Cotton Oxford', hint: 'Quality codes, per fabric type.', context: 'FABRIC_CATEGORY' },
      { id: 'QUALITY_NAME', type: 'QUALITY_NAME', label: 'Quality Names', icon: FileText, placeholder: 'e.g. Poly Viscose Twill', hint: 'Optional descriptive names shown after the quality.', context: 'FABRIC_CATEGORY' },
      { id: 'SHADE', type: 'SHADE', label: 'Shades', icon: Palette, placeholder: 'e.g. Navy Blue 04', hint: 'Shades and colours, shared by fabric, ready-made and accessories.', shared: true },
    ],
  },
  {
    key: 'READY_MADE', label: 'Ready-Made', icon: Shirt,
    lists: [
      { id: 'RM_ITEM', type: 'ITEM_NAME', label: 'Garment Items', icon: Shirt, placeholder: 'e.g. Boys Half Sleeve Shirt', hint: 'Garment names.', itemCategory: 'READY_MADE' },
      { id: 'FABRIC_TYPE', type: 'FABRIC_TYPE', label: 'Ready-Made Fabric Types', icon: Sparkles, placeholder: 'e.g. Poly Cotton, Single Jersey', hint: 'The material a garment is made of.' },
      { id: 'ART_NO', type: 'ART_NO', label: 'Art Numbers', icon: Hash, placeholder: 'e.g. ART-2041', hint: 'Article / style numbers.' },
      { id: 'SHADE', type: 'SHADE', label: 'Shades', icon: Palette, placeholder: 'e.g. White', hint: 'Shades and colours, shared by fabric, ready-made and accessories.', shared: true },
    ],
  },
  {
    key: 'ACCESSORY', label: 'Accessories', icon: Boxes,
    lists: [
      { id: 'ACCESSORY_CATEGORY', type: 'ACCESSORY_CATEGORY', label: 'Accessory Categories', icon: Boxes, placeholder: 'e.g. Buttons, Zippers, Belts', hint: 'Kinds of accessories.' },
      { id: 'ACC_ITEM', type: 'ITEM_NAME', label: 'Accessory Items', icon: Tag, placeholder: 'e.g. 24L 4-Hole Navy Button', hint: 'Accessory item names.', itemCategory: 'ACCESSORY' },
      { id: 'SHADE', type: 'SHADE', label: 'Shades', icon: Palette, placeholder: 'e.g. Silver', hint: 'Shades and colours, shared by fabric, ready-made and accessories.', shared: true },
    ],
  },
];

const belongs = (item: MasterAttributeItem, list: ListDef) => {
  if (item.type !== list.type) return false;
  if (list.itemCategory === 'ACCESSORY') return item.category === 'ACCESSORY';
  if (list.itemCategory === 'READY_MADE') return item.category !== 'ACCESSORY';
  return true;
};

const shownValue = (item: MasterAttributeItem) => (item.type === 'FABRIC_CATEGORY' ? fabricCategoryLabel(item.value) : item.value);

export default function ItemsPage() {
  const [group, setGroup] = useState<Group>('FABRIC');
  const [listId, setListId] = useState('FABRIC_CATEGORY');
  const [attributes, setAttributes] = useState<MasterAttributeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [contextFilter, setContextFilter] = useState('ALL');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Quick add
  const [quickValue, setQuickValue] = useState('');
  const [quickContext, setQuickContext] = useState('');
  const [quickUnit, setQuickUnit] = useState<'METERS' | 'KG'>('METERS');
  const [saving, setSaving] = useState(false);

  // Edit / delete
  const [editing, setEditing] = useState<MasterAttributeItem | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editContext, setEditContext] = useState('');
  const [editUnit, setEditUnit] = useState<'METERS' | 'KG'>('METERS');
  const [toDelete, setToDelete] = useState<MasterAttributeItem | null>(null);

  const groupDef = GROUPS.find(g => g.key === group)!;
  const list = groupDef.lists.find(l => l.id === listId) ?? groupDef.lists[0];
  const fabricTypes = useMemo(
    () => attributes.filter(a => a.type === 'FABRIC_CATEGORY').sort((a, b) => (a.value === 'OTHER' ? 1 : 0) - (b.value === 'OTHER' ? 1 : 0) || a.value.localeCompare(b.value)),
    [attributes]
  );

  const fetchAttributes = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/master-data?detailed=true');
      if (Array.isArray(res.data)) setAttributes(res.data);
    } catch {
      setError('Could not load the master catalogue.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAttributes(); }, []);

  useEffect(() => {
    if (!success && !error) return;
    const t = setTimeout(() => { setSuccess(''); setError(''); }, 5000);
    return () => clearTimeout(t);
  }, [success, error]);

  // A list with a fabric-type context starts on the first fabric type
  useEffect(() => {
    setSearch('');
    setContextFilter('ALL');
    if (list.context && !quickContext && fabricTypes[0]) setQuickContext(fabricTypes[0].value);
  }, [listId, group]); // eslint-disable-line react-hooks/exhaustive-deps

  const countFor = (l: ListDef) => attributes.filter(a => belongs(a, l)).length;

  const rows = useMemo(() => attributes.filter(a => {
    if (!belongs(a, list)) return false;
    if (list.context && contextFilter !== 'ALL' && a.category !== contextFilter) return false;
    const q = search.trim().toLowerCase();
    return !q || shownValue(a).toLowerCase().includes(q) || (a.category ?? '').toLowerCase().includes(q);
  }).sort((a, b) => list.type === 'FABRIC_CATEGORY'
    ? (a.value === 'OTHER' ? 1 : 0) - (b.value === 'OTHER' ? 1 : 0) || a.value.localeCompare(b.value)
    : b.usageCount - a.usageCount || a.value.localeCompare(b.value)), [attributes, list, contextFilter, search]);

  const afterFabricTypeChange = () => { loadFabricCategories(true).catch(() => {}); };

  const quickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = quickValue.trim();
    if (!value) return;
    setSaving(true); setError('');
    try {
      const res = await api.post('/api/master-data', {
        type: list.type,
        value,
        category: list.context ? quickContext || undefined : list.itemCategory,
        unit: list.type === 'FABRIC_CATEGORY' ? quickUnit : undefined,
      });
      setAttributes(prev => {
        const i = prev.findIndex(p => p.id === res.data.id);
        if (i >= 0) { const copy = [...prev]; copy[i] = res.data; return copy; }
        return [res.data, ...prev];
      });
      setQuickValue('');
      setSuccess(res.data.isNew === false ? `"${value}" is already in ${list.label}.` : `Added "${shownValue(res.data)}" to ${list.label}.`);
      if (list.type === 'FABRIC_CATEGORY') afterFabricTypeChange();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not add it.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (item: MasterAttributeItem) => {
    setEditing(item);
    setEditValue(shownValue(item));
    setEditContext(item.category ?? '');
    setEditUnit(item.unit === 'KG' ? 'KG' : 'METERS');
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editValue.trim()) return;
    setSaving(true); setError('');
    try {
      const res = await api.put(`/api/master-data/${editing.id}`, {
        value: editValue.trim(),
        ...(list.context ? { category: editContext || null } : {}),
        ...(editing.type === 'FABRIC_CATEGORY' ? { unit: editUnit } : {}),
      });
      setAttributes(prev => prev.map(p => (p.id === editing.id ? { ...p, ...res.data } : p)));
      setSuccess(`Saved "${shownValue(res.data)}".`);
      if (editing.type === 'FABRIC_CATEGORY') afterFabricTypeChange();
      setEditing(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setSaving(true); setError('');
    try {
      await api.delete(`/api/master-data/${toDelete.id}`);
      setAttributes(prev => prev.filter(p => p.id !== toDelete.id));
      setSuccess(`Deleted "${shownValue(toDelete)}".`);
      if (toDelete.type === 'FABRIC_CATEGORY') afterFabricTypeChange();
      setToDelete(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not delete.');
      setToDelete(null);
    } finally {
      setSaving(false);
    }
  };

  const fabricTypeSelect = (value: string, onChange: (v: string) => void, withAll = false) => (
    <select className="form-select" value={value} onChange={e => onChange(e.target.value)} style={{ width: 180, height: 38, fontSize: 13 }}>
      {withAll && <option value="ALL">All fabric types</option>}
      {!withAll && <option value="">Any fabric type</option>}
      {fabricTypes.map(f => <option key={f.id} value={f.value}>{fabricCategoryLabel(f.value)}</option>)}
    </select>
  );

  return (
    <div className="page-container" style={{ padding: '24px 32px', maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: '#f1f5f9', padding: 8, borderRadius: 8, display: 'flex' }}><Layers size={28} color="var(--color-brand)" /></div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Master Catalogue</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              The approved values for fabric, ready-made garments and accessories. New values typed on other screens are checked against these lists.
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={fetchAttributes} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38 }}>
          <RotateCcw size={15} /> Refresh
        </button>
      </div>

      {success && (
        <div className="alert alert-success" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle2 size={16} /> {success}</div>
      )}
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><AlertCircle size={16} /> {error}</div>
      )}

      {/* Fabric / Ready-Made / Accessories */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {GROUPS.map(g => {
          const active = g.key === group;
          const Icon = g.icon;
          return (
            <button key={g.key} type="button" onClick={() => { setGroup(g.key); setListId(g.lists[0].id); }} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              fontSize: 14, fontWeight: 700, border: `1.5px solid ${active ? 'var(--color-brand)' : 'var(--color-border)'}`,
              background: active ? 'var(--color-brand)' : '#fff', color: active ? '#fff' : 'var(--color-text-main)',
            }}>
              <Icon size={16} /> {g.label}
            </button>
          );
        })}
      </div>

      {/* Lists in this group */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--color-border)', marginBottom: 16, flexWrap: 'wrap' }}>
        {groupDef.lists.map(l => {
          const active = l.id === list.id;
          const Icon = l.icon;
          return (
            <button key={l.id} type="button" onClick={() => setListId(l.id)} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', marginBottom: -2,
              borderBottom: active ? '3px solid var(--color-brand)' : '3px solid transparent',
              color: active ? 'var(--color-brand)' : 'var(--color-text-muted)', fontWeight: active ? 700 : 500, fontSize: 13.5,
            }}>
              <Icon size={15} /> {l.label}
              <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: active ? '#eff6ff' : '#f1f5f9', fontWeight: 600 }}>
                {loading ? '—' : countFor(l)}
              </span>
            </button>
          );
        })}
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
        {list.hint}{list.shared && <strong> Changes here apply to all three groups.</strong>}
      </p>

      {/* Quick add */}
      <form onSubmit={quickAdd} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 16px', marginBottom: 14 }}>
        <input className="form-input" value={quickValue} onChange={e => setQuickValue(e.target.value)} placeholder={`Add to ${list.label} (${list.placeholder})`}
          style={{ flex: '1 1 260px', height: 38, fontSize: 13 }} />
        {list.context && fabricTypeSelect(quickContext, setQuickContext)}
        {list.type === 'FABRIC_CATEGORY' && (
          <select className="form-select" value={quickUnit} onChange={e => setQuickUnit(e.target.value as 'METERS' | 'KG')} style={{ width: 180, height: 38, fontSize: 13 }}>
            <option value="METERS">Measured in meters</option>
            <option value="KG">Measured in kilograms</option>
          </select>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving || !quickValue.trim()} style={{ height: 38, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Add
        </button>
      </form>

      {/* Search */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '0 1 380px' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
          <input className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${list.label.toLowerCase()}…`} style={{ paddingLeft: 32, height: 36, fontSize: 13 }} />
        </div>
        {list.context && fabricTypeSelect(contextFilter, setContextFilter, true)}
        <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>{rows.length} shown</span>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%', margin: 0 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={{ width: 50, textAlign: 'center' }}>#</th>
              <th>{list.label.replace(/s$/, '')}</th>
              {list.type === 'FABRIC_CATEGORY' && <th style={{ width: 160 }}>Measured in</th>}
              {list.type === 'FABRIC_CATEGORY' && <th style={{ width: 170 }}>Code</th>}
              {list.context && <th style={{ width: 180 }}>Fabric Type</th>}
              {list.type !== 'FABRIC_CATEGORY' && <th style={{ width: 120, textAlign: 'center' }}>Times used</th>}
              <th style={{ width: 110, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 36, color: 'var(--color-text-muted)' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 36, color: 'var(--color-text-muted)' }}>Nothing here yet. Use the bar above to add one.</td></tr>
            ) : rows.map((item, i) => (
              <tr key={item.id}>
                <td style={{ textAlign: 'center', color: '#64748b', fontSize: 12 }}>{i + 1}</td>
                <td style={{ fontWeight: 600 }}>{shownValue(item)}</td>
                {list.type === 'FABRIC_CATEGORY' && (
                  <td><span className={`badge ${item.unit === 'KG' ? 'badge-warning' : 'badge-info'}`}>{unitName(item.unit === 'KG' ? 'KG' : 'METERS')}</span></td>
                )}
                {list.type === 'FABRIC_CATEGORY' && <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-muted)' }}>{item.value}</td>}
                {list.context && <td>{item.category ? fabricCategoryLabel(item.category) : <span style={{ color: '#94a3b8' }}>Any</span>}</td>}
                {list.type !== 'FABRIC_CATEGORY' && <td style={{ textAlign: 'center', fontSize: 12.5 }}>{item.usageCount || 0}</td>}
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => openEdit(item)} style={{ padding: '4px 8px', height: 28 }} title="Edit"><Edit size={13} /></button>
                    <button type="button" className="btn btn-secondary" onClick={() => setToDelete(item)} style={{ padding: '4px 8px', height: 28, color: '#dc2626' }} title="Delete"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <form onSubmit={saveEdit} style={{ background: '#fff', borderRadius: 8, width: '100%', maxWidth: 460, padding: '22px 26px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Edit {list.label.replace(/s$/, '')}</h3>
              <button type="button" onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Name</label>
              <input className="form-input" value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus required />
            </div>
            {list.context && (
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Fabric Type</label>
                {fabricTypeSelect(editContext, setEditContext)}
              </div>
            )}
            {editing.type === 'FABRIC_CATEGORY' && (
              <div className="form-group" style={{ marginBottom: 6 }}>
                <label className="form-label">Measured in</label>
                <select className="form-select" value={editUnit} onChange={e => setEditUnit(e.target.value as 'METERS' | 'KG')}>
                  <option value="METERS">Meters</option>
                  <option value="KG">Kilograms</option>
                </select>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                  Once a fabric type is used on a purchase order or in stock, its name and unit are locked so existing stock keeps its unit.
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !editValue.trim()}>Save</button>
            </div>
          </form>
        </div>
      )}

      {/* Delete */}
      {toDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 8, width: '100%', maxWidth: 420, padding: '22px 26px' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Trash2 size={18} color="#dc2626" /> Delete "{shownValue(toDelete)}"?</h3>
            <p style={{ fontSize: 13, color: '#475569', margin: '0 0 18px' }}>
              It will no longer be suggested. Stock and documents that already use it are not changed.
              {toDelete.type === 'FABRIC_CATEGORY' && ' A fabric type that is in use cannot be deleted.'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setToDelete(null)}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={saving}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
