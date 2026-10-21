import React, { useEffect, useState, useMemo } from 'react';
import api from '../../../utils/api';
import { 
  Layers, 
  Search, 
  Plus, 
  Edit, 
  Trash2, 
  Tag, 
  Palette, 
  Shirt, 
  Sparkles, 
  X, 
  Hash,
  Scissors,
  CheckCircle2, 
  AlertCircle,
  RotateCcw,
  Boxes
} from 'lucide-react';
import '../../../styles/components.css';

export type AttributeType = 'BRAND' | 'QUALITY' | 'SHADE' | 'ITEM_NAME' | 'FABRIC_TYPE' | 'ACCESSORY_CATEGORY' | 'ART_NO' | 'CATEGORY';

export interface MasterAttributeItem {
  id: string;
  type: AttributeType;
  value: string;
  category?: string | null;
  usageCount: number;
  createdAt?: string;
  updatedAt?: string;
}

const ATTRIBUTE_TABS: { key: AttributeType; label: string; icon: React.FC<any>; placeholder: string; example: string }[] = [
  { key: 'BRAND', label: 'Brands', icon: Tag, placeholder: 'e.g. Raymond, Siyaram, Arvind', example: 'Raymond' },
  { key: 'QUALITY', label: 'Fabric Qualities', icon: Scissors, placeholder: 'e.g. Poly Viscose 65/35, Cotton Oxford', example: 'Poly Viscose 65/35' },
  { key: 'SHADE', label: 'Shades & Colors', icon: Palette, placeholder: 'e.g. Navy Blue 04, Sky Blue 01, Shade 101', example: 'Shade 101' },
  { key: 'ITEM_NAME', label: 'Garment Items', icon: Shirt, placeholder: 'e.g. Boys Half Sleeve Shirt, Formal Trouser', example: 'Boys Half Sleeve Shirt' },
  { key: 'FABRIC_TYPE', label: 'RM Fabric Types', icon: Sparkles, placeholder: 'e.g. Cotton Twill, Poplin, Denim, Single Jersey', example: 'Cotton Twill' },
  { key: 'ACCESSORY_CATEGORY', label: 'Accessory Categories', icon: Boxes, placeholder: 'e.g. Shoes, Belts, Badges, Buttons, Zippers', example: 'Buttons' },
  { key: 'ART_NO', label: 'Art Numbers', icon: Hash, placeholder: 'e.g. ART-101, ART-902', example: 'ART-101' },
];

const FABRIC_CATEGORIES = ['SUITING', 'SHIRTING', 'PLAIN_SHIRTING', 'READY_MADE', 'ACCESSORY', 'OTHER'];

const getCategoryLabel = (cat: string) => {
  if (cat === 'PLAIN_SHIRTING') return 'Plain Shirting';
  if (cat === 'SUITING') return 'Suiting';
  if (cat === 'SHIRTING') return 'Shirting';
  if (cat === 'READY_MADE') return 'Ready-Made';
  if (cat === 'ACCESSORY') return 'Accessory';
  return cat;
};

export default function ItemsPage() {
  const [activeTab, setActiveTab] = useState<AttributeType>('BRAND');
  const [attributes, setAttributes] = useState<MasterAttributeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Quick add input state
  const [quickValue, setQuickValue] = useState('');
  const [quickCategory, setQuickCategory] = useState('SUITING');
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');
  const [actionError, setActionError] = useState('');

  // Modal edit/create state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterAttributeItem | null>(null);
  const [formType, setFormType] = useState<AttributeType>('BRAND');
  const [formValue, setFormValue] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // Delete modal state
  const [itemToDelete, setItemToDelete] = useState<MasterAttributeItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAttributes = async () => {
    setLoading(true);
    setActionError('');
    try {
      const res = await api.get('/api/master-data?detailed=true');
      if (Array.isArray(res.data)) {
        setAttributes(res.data);
      }
    } catch {
      setActionError('Could not connect to database for master attributes. Showing cached defaults.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttributes();
  }, []);

  // Clear messages after 4 seconds
  useEffect(() => {
    if (actionSuccess || actionError) {
      const timer = setTimeout(() => {
        setActionSuccess('');
        setActionError('');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [actionSuccess, actionError]);

  // Filtered attributes for active tab
  const filteredAttributes = useMemo(() => {
    return attributes.filter(item => {
      if (item.type !== activeTab) return false;
      if (selectedCategory !== 'ALL' && item.category !== selectedCategory) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesValue = item.value.toLowerCase().includes(q);
        const matchesCategory = item.category?.toLowerCase().includes(q);
        if (!matchesValue && !matchesCategory) return false;
      }
      return true;
    });
  }, [attributes, activeTab, selectedCategory, search]);

  // Statistics counts
  const stats = useMemo(() => {
    const counts: Record<string, number> = {
      BRAND: 0,
      QUALITY: 0,
      SHADE: 0,
      ITEM_NAME: 0,
      FABRIC_TYPE: 0,
      ACCESSORY_CATEGORY: 0,
      ART_NO: 0,
    };
    for (const a of attributes) {
      if (counts[a.type] !== undefined) {
        counts[a.type]++;
      }
    }
    return counts;
  }, [attributes]);

  // Quick Add handler
  const handleQuickAdd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = quickValue.trim();
    if (!clean) return;

    setQuickSubmitting(true);
    setActionError('');
    try {
      const targetType = activeTab;
      const res = await api.post('/api/master-data', {
        type: targetType,
        value: clean,
        category: (targetType === 'QUALITY' || targetType === 'ITEM_NAME') ? quickCategory : undefined,
      });

      const newItem = res.data;
      setAttributes(prev => {
        const idx = prev.findIndex(p => p.type === targetType && p.value.toLowerCase() === clean.toLowerCase());
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], usageCount: (copy[idx].usageCount || 0) + 1 };
          return copy;
        }
        return [newItem, ...prev];
      });

      setQuickValue('');
      setActionSuccess(`Added "${clean}" to ${targetType} Master catalog!`);
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'Failed to save master attribute.');
    } finally {
      setQuickSubmitting(false);
    }
  };

  // Open modal for editing
  const handleOpenEdit = (item: MasterAttributeItem) => {
    setEditingItem(item);
    setFormType(item.type);
    setFormValue(item.value);
    setFormCategory(item.category || 'SUITING');
    setIsEditModalOpen(true);
  };

  // Open modal for creating
  const handleOpenCreate = () => {
    setEditingItem(null);
    setFormType((activeTab as string) === 'SKU' ? 'BRAND' : activeTab);
    setFormValue('');
    setFormCategory('SUITING');
    setIsEditModalOpen(true);
  };

  // Submit modal form
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = formValue.trim();
    if (!clean) {
      setActionError('Attribute value is required.');
      return;
    }

    setModalSubmitting(true);
    try {
      if (editingItem) {
        await api.put(`/api/master-data/${editingItem.id}`, {
          type: formType,
          value: clean,
          category: formCategory || null,
        });
        setAttributes(prev => prev.map(p => p.id === editingItem.id ? { ...p, type: formType, value: clean, category: formCategory || null } : p));
        setActionSuccess(`Updated ${formType.toLowerCase()} to "${clean}".`);
      } else {
        const res = await api.post('/api/master-data', {
          type: formType,
          value: clean,
          category: formCategory || null,
        });
        setAttributes(prev => [res.data, ...prev]);
        setActionSuccess(`Created new ${formType.toLowerCase()} "${clean}".`);
      }
      setIsEditModalOpen(false);
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'Failed to save attribute.');
    } finally {
      setModalSubmitting(false);
    }
  };

  // Delete attribute
  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/api/master-data/${itemToDelete.id}`);
      setAttributes(prev => prev.filter(p => p.id !== itemToDelete.id));
      setActionSuccess(`Deleted "${itemToDelete.value}" from ${itemToDelete.type} Master.`);
      setItemToDelete(null);
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'Failed to delete attribute.');
    } finally {
      setDeleting(false);
    }
  };

  const currentTabMeta = ATTRIBUTE_TABS.find(t => t.key === activeTab);

  return (
    <div className="page-container" style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      
      {/* ─── Header Section ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#f1f5f9', padding: 8, borderRadius: 8, display: 'flex' }}>
              <Layers size={28} color="var(--color-brand)" />
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--color-text-main)' }}>
                Master Attributes &amp; Catalog
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
                Enter and maintain individual Brands, Fabric Qualities, Shades, Garment Items, and Art Numbers. Master SKUs are completely optional.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fetchAttributes}
            title="Refresh Master Data"
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38 }}
          >
            <RotateCcw size={15} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleOpenCreate}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38 }}
          >
            <Plus size={18} /> Add Master Attribute
          </button>
        </div>
      </div>

      {/* ─── Notification Alerts ──────────────────────────────────────── */}
      {actionSuccess && (
        <div style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 6,
          padding: '10px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: '#166534',
          fontSize: 13,
          fontWeight: 500,
        }}>
          <CheckCircle2 size={16} color="#16a34a" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 6,
          padding: '10px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: '#991b1b',
          fontSize: 13,
          fontWeight: 500,
        }}>
          <AlertCircle size={16} color="#dc2626" />
          <span>{actionError}</span>
        </div>
      )}

      {/* ─── Metric Cards ──────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 14,
        marginBottom: 24,
      }}>
        {ATTRIBUTE_TABS.map(tab => {
          const Icon = tab.icon;
          const count = stats[tab.key] || 0;
          const isSelected = activeTab === tab.key;
          return (
            <div
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSearch(''); }}
              style={{
                background: isSelected ? 'var(--color-bg-subtle)' : '#ffffff',
                border: isSelected ? '2px solid var(--color-brand)' : '1px solid var(--color-border)',
                borderRadius: 8,
                padding: '14px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease',
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {tab.label}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-main)', marginTop: 2 }}>
                  {loading ? '—' : count}
                </div>
              </div>
              <div style={{
                background: isSelected ? 'var(--color-brand)' : '#f1f5f9',
                color: isSelected ? '#ffffff' : 'var(--color-brand)',
                padding: 10,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Icon size={20} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Primary Navigation Tabs ───────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '2px solid var(--color-border)',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {ATTRIBUTE_TABS.map(tab => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => { setActiveTab(tab.key); setSearch(''); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  border: 'none',
                  background: 'none',
                  borderBottom: isSelected ? '3px solid var(--color-brand)' : '3px solid transparent',
                  marginBottom: -2,
                  color: isSelected ? 'var(--color-brand)' : 'var(--color-text-muted)',
                  fontWeight: isSelected ? 700 : 500,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
                <span style={{
                  fontSize: 11,
                  padding: '1px 7px',
                  borderRadius: 10,
                  background: isSelected ? '#eff6ff' : '#f1f5f9',
                  color: isSelected ? 'var(--color-brand)' : '#64748b',
                  fontWeight: 600,
                }}>
                  {stats[tab.key] || 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Attribute Management Workspace ───────────────────────────── */}
      {currentTabMeta && (
        <div>
          {/* Quick Add Bar */}
          <form
            onSubmit={handleQuickAdd}
            style={{
              background: '#ffffff',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '14px 18px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 140, fontWeight: 600, fontSize: 13, color: 'var(--color-text-main)' }}>
              <currentTabMeta.icon size={16} color="var(--color-brand)" />
              <span>Quick Add {currentTabMeta.label.replace(/s$/, '')}:</span>
            </div>

            <input
              type="text"
              className="form-input"
              placeholder={`Type new ${currentTabMeta.label.toLowerCase()} (e.g. ${currentTabMeta.example}) and press Enter...`}
              value={quickValue}
              onChange={e => setQuickValue(e.target.value)}
              style={{ flex: 1, height: 38, fontSize: 13 }}
            />

            {(activeTab === 'QUALITY' || activeTab === 'ITEM_NAME') && (
              <select
                className="form-select"
                style={{ width: 160, height: 38, fontSize: 13 }}
                value={quickCategory}
                onChange={e => setQuickCategory(e.target.value)}
              >
                {FABRIC_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                ))}
              </select>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={quickSubmitting || !quickValue.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 18px', whiteSpace: 'nowrap' }}
            >
              <Plus size={16} /> Add to Master
            </button>
          </form>

          {/* Search and Filters Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, maxWidth: 450 }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 32, height: 36, fontSize: 13 }}
                  placeholder={`Search ${currentTabMeta.label.toLowerCase()}...`}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              {(activeTab === 'QUALITY' || activeTab === 'ITEM_NAME') && (
                <select
                  className="form-select"
                  style={{ width: 170, height: 36, fontSize: 13 }}
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                >
                  <option value="ALL">All Categories</option>
                  {FABRIC_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                  ))}
                </select>
              )}
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              Showing <strong>{filteredAttributes.length}</strong> {currentTabMeta.label.toLowerCase()}
            </div>
          </div>

          {/* Master Attributes Table */}
          <div className="table-responsive" style={{
            background: '#ffffff',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ width: 60, padding: '12px 16px', textAlign: 'center', fontSize: 12 }}>#</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12 }}>
                    {currentTabMeta.label.replace(/s$/, '')} Name / Value
                  </th>
                  <th style={{ width: 180, padding: '12px 16px', textAlign: 'left', fontSize: 12 }}>Category / Context</th>
                  <th style={{ width: 160, padding: '12px 16px', textAlign: 'center', fontSize: 12 }}>Times Used</th>
                  <th style={{ width: 140, padding: '12px 16px', textAlign: 'center', fontSize: 12 }}>Status</th>
                  <th style={{ width: 120, padding: '12px 16px', textAlign: 'right', fontSize: 12 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--color-text-muted)' }}>
                      Loading master attributes...
                    </td>
                  </tr>
                ) : filteredAttributes.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--color-text-muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                        <currentTabMeta.icon size={36} color="#cbd5e1" />
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#475569' }}>
                          No {currentTabMeta.label.toLowerCase()} found
                        </div>
                        <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
                          Use the quick-add bar above to register new {currentTabMeta.label.toLowerCase()} or type them dynamically while creating a Purchase Order.
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAttributes.map((attr, idx) => (
                    <tr
                      key={attr.id || `${attr.type}-${attr.value}-${idx}`}
                      style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.12s ease' }}
                    >
                      <td style={{ textAlign: 'center', padding: '12px 16px', color: '#64748b', fontSize: 12 }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, color: '#0f172a', fontSize: 13.5 }}>
                            {attr.value}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {attr.category ? (
                          <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: 4,
                            background: '#f1f5f9',
                            color: '#334155',
                            border: '1px solid #e2e8f0',
                          }}>
                            {getCategoryLabel(attr.category)}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>All Types</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                        <span style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: attr.usageCount > 0 ? '#f0fdf4' : '#f8fafc',
                          color: attr.usageCount > 0 ? '#166534' : '#64748b',
                          border: attr.usageCount > 0 ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                        }}>
                          {attr.usageCount || 0} times
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: '#ecfdf5',
                          color: '#047857',
                        }}>
                          Active
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(attr)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', height: 28 }}
                            title="Edit Attribute"
                          >
                            <Edit size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setItemToDelete(attr)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', height: 28, color: '#dc2626' }}
                            title="Delete Attribute"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}



      {/* ─── Add / Edit Attribute Modal ─────────────────────────────────── */}
      {isEditModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 8,
            width: '100%',
            maxWidth: 480,
            padding: '24px 28px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={20} color="var(--color-brand)" />
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
                  {editingItem ? 'Edit Master Attribute' : 'Add Master Attribute'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveModal}>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Attribute Type</label>
                <select
                  className="form-select"
                  value={formType}
                  onChange={e => setFormType(e.target.value as AttributeType)}
                  disabled={Boolean(editingItem)}
                >
                  <option value="BRAND">Brand</option>
                  <option value="QUALITY">Fabric Quality</option>
                  <option value="SHADE">Shade / Color</option>
                  <option value="ITEM_NAME">Garment Item Name</option>
                  <option value="FABRIC_TYPE">Ready-Made Fabric Type</option>
                  <option value="ACCESSORY_CATEGORY">Accessory Category</option>
                  <option value="ART_NO">Art Number</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Attribute Value / Name *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Siyaram, Navy Blue 04, Poly Viscose..."
                  value={formValue}
                  onChange={e => setFormValue(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {(formType === 'QUALITY' || formType === 'ITEM_NAME') && (
                <div className="form-group" style={{ marginBottom: 18 }}>
                  <label className="form-label">Category Context</label>
                  <select
                    className="form-select"
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                  >
                    {FABRIC_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={modalSubmitting || !formValue.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Plus size={16} /> {editingItem ? 'Save Changes' : 'Create Attribute'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Delete Confirmation Modal ─────────────────────────────────── */}
      {itemToDelete && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 8,
            width: '100%',
            maxWidth: 420,
            padding: '24px 28px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: '#dc2626' }}>
              <Trash2 size={22} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                Delete Master Attribute?
              </h3>
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, margin: '0 0 20px' }}>
              Are you sure you want to remove <strong>&ldquo;{itemToDelete.value}&rdquo;</strong> from {itemToDelete.type} Master? 
              This will not alter past received inventory batches.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setItemToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
