import { useEffect, useState, useMemo } from 'react';
import api from '../../../utils/api';
import { 
  Users, 
  Plus, 
  X, 
  ScanLine, 
  KeyRound, 
  ShieldCheck, 
  CheckSquare, 
  Square, 
  AlertCircle,
  Download,
  Search,
  Check,
  Edit2,
  Power,
  UserCheck,
  UserX,
  Copy,
  Eye,
  EyeOff,
  ShoppingCart,
  Package,
  ClipboardCheck,
  LayoutDashboard,
  LockKeyhole
} from 'lucide-react';
import type { UserModule } from '../../../utils/roles';
import { 
  MODULE_LABELS, 
  PERMISSION_GROUPS, 
  EXPORT_PERMISSIONS, 
  ROLE_PRESETS,
  ALL_PERMISSION_KEYS,
  hasPermission,
  COST_PRICE_PERMISSION,
  hasCostAccess
} from '../../../utils/roles';
import { useAuth } from '../../../hooks/useAuth';
import { formatDate } from '../../../utils/format';
import { apiErrorMessage, downloadFromApi } from '../../../utils/download';
import '../../../styles/components.css';

interface UserItem {
  id: string;
  name: string;
  username: string;
  phone?: string | null;
  badgeCode?: string | null;
  hasPin: boolean;
  mustResetPassword?: boolean;
  mustResetPin?: boolean;
  modules: UserModule[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
}

type ModalTab = 'PROFILE' | 'PERMISSIONS' | 'WAREHOUSE';

// ─── 4 Core Enterprise Modules ────────────────────────────────────────────────
const MODULE_OPTIONS: { 
  value: UserModule; 
  label: string; 
  desc: string; 
  icon: any; 
  color: string;
  badgeBg: string;
  badgeBorder: string;
}[] = [
  { 
    value: 'PURCHASE',       
    label: 'Purchase',       
    desc: 'Purchase orders, mill orders and supplier procurement', 
    icon: ShoppingCart,
    color: '#1D4ED8',
    badgeBg: '#EFF6FF',
    badgeBorder: '#BFDBFE'
  },
  { 
    value: 'WAREHOUSE',      
    label: 'Warehouse',      
    desc: 'Floor dock operations, shelving put-away, queue and dispatches', 
    icon: Package,
    color: '#15803D',
    badgeBg: '#F0FDF4',
    badgeBorder: '#BBF7D0'
  },
  { 
    value: 'INVENTORY',      
    label: 'Inventory',      
    desc: 'Global stock snapshot, audit log, adjustments, relocations and GRNs', 
    icon: ClipboardCheck,
    color: '#B45309',
    badgeBg: '#FFFBEB',
    badgeBorder: '#FDE68A'
  },
  { 
    value: 'ADMINISTRATION', 
    label: 'Administration', 
    desc: 'System masters, locations setup, reports and user access', 
    icon: LayoutDashboard,
    color: 'var(--color-brand)',
    badgeBg: 'var(--color-brand-light)',
    badgeBorder: '#DDD6FE'
  },
];

const MODULE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  PURCHASE:       { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
  WAREHOUSE:      { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0' },
  INVENTORY:      { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  ADMINISTRATION: { bg: 'var(--color-brand-light)', text: 'var(--color-brand)', border: '#DDD6FE' },
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<'ALL' | UserModule>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Modal State
  const [modalTab, setModalTab] = useState<ModalTab>('PROFILE');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPinText, setShowPinText] = useState(false);
  const [modules, setModules] = useState<UserModule[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('CUSTOM');
  const [isActive, setIsActive] = useState(true);
  // Confidential cost access is kept apart from the module / tab permissions (and from '*')
  const [costAccess, setCostAccess] = useState(false);
  const [costPassword, setCostPassword] = useState('');
  const [costPasswordError, setCostPasswordError] = useState('');
  const { user: me } = useAuth();
  // Needed on every new account; the first admin was created without one and can add it later
  const phoneRequired = !editing || Boolean(editing.phone);
  const phoneProblem = phone
    ? (/^[6-9]\d{9}$/.test(phone) ? '' : 'Enter a 10-digit mobile number.')
    : (phoneRequired ? 'Phone Number is required.' : '');
  const costChanged = costAccess !== Boolean(editing?.permissions?.includes(COST_PRICE_PERMISSION));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Whether warehouse operations module or any ops.* tab is selected
  const hasWarehouseSelected = useMemo(() => {
    return modules.includes('WAREHOUSE') || permissions.some(p => p.startsWith('ops.'));
  }, [modules, permissions]);

  // If warehouse was deselected while user was on warehouse tab, shift back to permissions tab
  useEffect(() => {
    if (!hasWarehouseSelected && modalTab === 'WAREHOUSE') {
      setModalTab('PERMISSIONS');
    }
  }, [hasWarehouseSelected, modalTab]);

  // Badge barcode downloads (for designing badges in the label software)
  const [exportingBadges, setExportingBadges] = useState<string | null>(null);
  const [badgeExportError, setBadgeExportError] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/api/users')
      .then(r => setUsers(r.data))
      .catch(err => {
        const msg = err.response?.data?.error || 'Failed to load users';
        setError(msg);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      // 1. Text Search (Name, Username, Badge)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = u.name.toLowerCase().includes(q);
        const matchUser = u.username.toLowerCase().includes(q);
        const matchBadge = (u.badgeCode || '').toLowerCase().includes(q);
        if (!matchName && !matchUser && !matchBadge) return false;
      }

      // 2. Module Filter
      if (moduleFilter !== 'ALL') {
        if (!u.modules.includes(moduleFilter)) return false;
      }

      // 3. Status Filter
      if (statusFilter === 'ACTIVE' && !u.isActive) return false;
      if (statusFilter === 'INACTIVE' && u.isActive) return false;

      return true;
    });
  }, [users, searchQuery, moduleFilter, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter(u => u.isActive).length;
    const withBadge = users.filter(u => u.hasPin).length;
    const superAdmins = users.filter(u => u.permissions.includes('*')).length;
    return { total, active, withBadge, superAdmins };
  }, [users]);

  // Open Add User Dialog
  const openAdd = () => {
    setEditing(null);
    setModalTab('PROFILE');
    setName('');
    setUsername('');
    setPhone('');
    setPassword('');
    setPin('');
    setShowPinText(false);
    setIsActive(true);
    setModules([]);
    setPermissions([]);
    setCostAccess(false);
    setCostPassword('');
    setCostPasswordError('');
    setSelectedPreset('CUSTOM');
    setError('');
    setShowModal(true);
  };

  // Open Edit User Dialog
  const openEdit = (u: UserItem) => {
    setEditing(u);
    setModalTab('PROFILE');
    setName(u.name);
    setUsername(u.username);
    setPhone(u.phone || '');
    setPassword('');
    setPin('');
    setShowPinText(false);
    setIsActive(u.isActive);

    const userPerms = (u.permissions || []).filter(k => k !== COST_PRICE_PERMISSION);
    setModules(u.modules || []);
    setPermissions(userPerms);
    setCostAccess((u.permissions || []).includes(COST_PRICE_PERMISSION));
    setCostPassword('');
    setCostPasswordError('');

    const matchedPreset = ROLE_PRESETS.find(p => {
      if (p.permissions.includes('*') && userPerms.includes('*')) return true;
      if (p.permissions.length === userPerms.length && p.permissions.every(k => userPerms.includes(k))) return true;
      return false;
    });
    setSelectedPreset(matchedPreset ? matchedPreset.id : 'CUSTOM');

    setError('');
    setShowModal(true);
  };

  const handleApplyPreset = (presetId: string) => {
    setSelectedPreset(presetId);
    if (presetId === 'CUSTOM') return;

    const preset = ROLE_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setModules([...preset.modules]);
      setPermissions([...preset.permissions]);
    }
  };

  // Toggle whole module ON / OFF
  const handleModuleToggle = (mod: UserModule) => {
    setSelectedPreset('CUSTOM');
    const group = PERMISSION_GROUPS.find(g => g.module === mod);
    const groupKeys = group ? group.permissions.map(p => p.key) : [];

    setModules(prev => {
      const isCurrentlySelected = prev.includes(mod);
      if (isCurrentlySelected) {
        // Remove module and clear its specific permissions
        setPermissions(perms => perms.filter(k => !groupKeys.includes(k)));
        return prev.filter(m => m !== mod);
      } else {
        // Add module and enable all its tabs by default
        setPermissions(perms => Array.from(new Set([...perms, ...groupKeys])));
        return [...prev, mod];
      }
    });
  };

  // Toggle single tab permission inside a module
  const handlePermissionToggle = (mod: UserModule, permKey: string) => {
    setSelectedPreset('CUSTOM');
    setPermissions(prev => {
      const isSelected = prev.includes('*') || prev.includes(permKey);
      if (isSelected) {
        if (prev.includes('*')) {
          const allKeys = ALL_PERMISSION_KEYS.filter(k => k !== permKey);
          return allKeys;
        }
        return prev.filter(k => k !== permKey);
      } else {
        // Auto-enable the parent module if user checks a tab
        setModules(m => m.includes(mod) ? m : [...m, mod]);
        return [...prev, permKey];
      }
    });
  };

  // Toggle all tabs within a specific module
  const handleToggleGroup = (mod: UserModule, allSelected: boolean) => {
    setSelectedPreset('CUSTOM');
    const group = PERMISSION_GROUPS.find(g => g.module === mod);
    const groupKeys = group ? group.permissions.map(p => p.key) : [];

    if (allSelected) {
      // Deselect all tabs in this module
      setPermissions(prev => prev.filter(k => !groupKeys.includes(k)));
    } else {
      // Select all tabs in this module and ensure module is active
      setPermissions(prev => Array.from(new Set([...prev, ...groupKeys])));
      setModules(prev => prev.includes(mod) ? prev : [...prev, mod]);
    }
  };

  // Export ticks are independent of the modules: ticking one never switches a module on
  const handleExportToggle = (key: string) => {
    setSelectedPreset('CUSTOM');
    setPermissions(prev => {
      const base = prev.includes('*') ? ALL_PERMISSION_KEYS : prev;
      return base.includes(key) ? base.filter(k => k !== key) : [...base, key];
    });
  };

  const handleToggleExports = (allSelected: boolean) => {
    setSelectedPreset('CUSTOM');
    const exportKeys = EXPORT_PERMISSIONS.map(p => p.key);
    setPermissions(prev => {
      const base = prev.includes('*') ? ALL_PERMISSION_KEYS : prev;
      return allSelected ? base.filter(k => !exportKeys.includes(k)) : Array.from(new Set([...base, ...exportKeys]));
    });
  };

  // Only someone who has cost access can give or remove it; the very first grant can be made by a
  // full-access administrator (the server checks the same rule)
  const nobodyHasCostAccess = !users.some(u => u.isActive && u.permissions.includes(COST_PRICE_PERMISSION));
  const canGrantCostAccess = hasCostAccess(me) || (nobodyHasCostAccess && Boolean(me?.permissions?.includes('*')));

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleProfileNext = () => {
    setError('');
    if (!name.trim()) {
      setError('Full Name is required.');
      return;
    }
    if (!username.trim()) {
      setError('Username is required.');
      return;
    }
    if (phoneProblem) {
      setError(phoneProblem);
      return;
    }
    if (!editing && !password) {
      setError('Password is required for new accounts.');
      return;
    }
    setModalTab('PERMISSIONS');
  };

  const handlePermissionsNext = () => {
    setError('');
    if (modules.length === 0) {
      setError('Please assign at least one of the 4 core modules.');
      return;
    }
    if (hasWarehouseSelected) {
      setModalTab('WAREHOUSE');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Full Name is required.');
      setModalTab('PROFILE');
      return;
    }

    if (!username.trim()) {
      setError('Username is required.');
      setModalTab('PROFILE');
      return;
    }

    if (phoneProblem) {
      setError(phoneProblem);
      setModalTab('PROFILE');
      return;
    }

    if (modules.length === 0) {
      setError('Please assign at least one of the 4 core modules.');
      setModalTab('PERMISSIONS');
      return;
    }

    if (hasWarehouseSelected && pin && !/^\d{6}$/.test(pin.trim())) {
      setError('Warehouse Terminal PIN must be exactly 6 numeric digits (0-9).');
      setModalTab('WAREHOUSE');
      return;
    }

    if (costChanged && !costPassword) {
      setCostPasswordError('Enter your password to confirm.');
      setModalTab('PERMISSIONS');
      return;
    }

    const withCostAccess = [...permissions.filter(k => k !== COST_PRICE_PERMISSION), ...(costAccess ? [COST_PRICE_PERMISSION] : [])];

    setSubmitting(true);
    try {
      const finalPin = hasWarehouseSelected ? (pin.trim() || undefined) : undefined;

      if (editing) {
        const payload: Record<string, unknown> = {
          name: name.trim(),
          phone,
          modules,
          permissions: withCostAccess,
          isActive,
          ...(costChanged && { confirmPassword: costPassword }),
        };
        if (password) payload.password = password;
        if (hasWarehouseSelected) {
          if (pin) payload.pin = pin.trim();
        } else {
          // Clear the PIN if warehouse access is revoked (the Employee ID stays)
          payload.pin = null;
        }

        await api.patch(`/api/users/${editing.id}`, payload);
      } else {
        if (!password) {
          setError('Password is required when creating a new user.');
          setModalTab('PROFILE');
          setSubmitting(false);
          return;
        }

        await api.post('/api/users', {
          name: name.trim(),
          username: username.trim(),
          phone,
          password,
          pin: finalPin,
          modules,
          permissions: withCostAccess,
          ...(costChanged && { confirmPassword: costPassword }),
        });
      }

      setShowModal(false);
      load();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { error?: string; code?: string } } })?.response?.data;
      if (data?.code === 'CONFIRM_PASSWORD') {
        setCostPasswordError(data.error || 'Incorrect password.');
        setModalTab('PERMISSIONS');
      } else {
        setError(data?.error || 'Failed to save user.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (u: UserItem) => {
    await api.patch(`/api/users/${u.id}`, { isActive: !u.isActive });
    load();
  };

  // One user's Employee ID as a PNG barcode, for designing their badge (same barcode size as the rack labels)
  const exportBadgeBarcode = async (target: UserItem) => {
    setExportingBadges(target.id);
    setBadgeExportError('');
    try {
      await downloadFromApi(`/api/users/${target.id}/badge-barcode`, `${target.badgeCode}.png`);
    } catch (e) {
      setBadgeExportError(await apiErrorMessage(e, 'Barcode download failed'));
    } finally {
      setExportingBadges(null);
    }
  };

  return (
    <div>
      {/* ── Page Header ── */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={28} /> Users & Roles
          </h1>
          <p className="page-subtitle">
            Manage system access across the 4 core modules: <strong>Purchase</strong>, <strong>Warehouse</strong>, <strong>Inventory</strong>, and <strong>Administration</strong>
          </p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 10 }}>
          <button 
            id="user-add-btn" 
            className="btn btn-primary" 
            onClick={openAdd} 
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px' }}
          >
            <Plus size={18} /> Add User
          </button>
        </div>
      </div>

      {badgeExportError && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>{badgeExportError}</div>
      )}

      {/* ── Metric KPI Cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 14,
        marginBottom: 20
      }}>
        {/* Total Accounts */}
        <div className="card" style={{ padding: '16px 18px', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Accounts
            </span>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-main)' }}>
              <Users size={16} />
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text-main)' }}>
            {stats.total}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontWeight: 600 }}>
            <UserCheck size={13} /> {stats.active} Active accounts
          </div>
        </div>

        {/* Warehouse Login Users */}
        <div className="card" style={{ padding: '16px 18px', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Warehouse Terminals
            </span>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16A34A' }}>
              <ScanLine size={16} />
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text-main)' }}>
            {stats.withBadge}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Badge ID & PIN configured
          </div>
        </div>

        {/* Super Administrators */}
        <div className="card" style={{ padding: '16px 18px', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Administrators
            </span>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-brand)' }}>
              <ShieldCheck size={16} />
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text-main)' }}>
            {stats.superAdmins}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-brand)', marginTop: 4, fontWeight: 600 }}>
            Administration module access
          </div>
        </div>

        {/* Deactivated Accounts */}
        <div className="card" style={{ padding: '16px 18px', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Deactivated
            </span>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}>
              <UserX size={16} />
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text-main)' }}>
            {stats.total - stats.active}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Suspended access
          </div>
        </div>
      </div>

      {/* ── Interactive Search & Filter Controls ── */}
      <div style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 16,
        boxShadow: 'var(--shadow-xs)'
      }}>
        {/* Search Input */}
        <div style={{ position: 'relative', minWidth: 260, flex: 1 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--color-text-light)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search by name, username, or badge ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 36, height: 38, fontSize: 13 }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: 10, top: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Filters Group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* 4 Core Modules Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Module:</span>
            <select
              className="form-select"
              value={moduleFilter}
              onChange={e => setModuleFilter(e.target.value as any)}
              style={{ height: 38, fontSize: 12.5, padding: '0 28px 0 10px' }}
            >
              <option value="ALL">All 4 Modules</option>
              <option value="PURCHASE">Purchase</option>
              <option value="WAREHOUSE">Warehouse</option>
              <option value="INVENTORY">Inventory</option>
              <option value="ADMINISTRATION">Administration</option>
            </select>
          </div>

          {/* Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Status:</span>
            <select
              className="form-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              style={{ height: 38, fontSize: 12.5, padding: '0 28px 0 10px' }}
            >
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Users Table ── */}
      {loading ? (
        <div className="loading-center" style={{ minHeight: 280 }}>
          <span className="spinner spinner-lg" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="table-wrapper">
          <div className="empty-state" style={{ padding: '48px 20px' }}>
            <div className="empty-state-icon" style={{ background: 'var(--color-bg-subtle)' }}>
              <Users size={36} color="var(--color-text-muted)" />
            </div>
            <div className="empty-state-title" style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>
              No users matching your filters
            </div>
            <p className="empty-state-text" style={{ fontSize: 13 }}>
              Try adjusting your search criteria or reset filters.
            </p>
            <button 
              type="button" 
              className="btn btn-secondary btn-sm"
              onClick={() => { setSearchQuery(''); setModuleFilter('ALL'); setStatusFilter('ALL'); }}
              style={{ marginTop: 8 }}
            >
              Reset Filters
            </button>
          </div>
        </div>
      ) : (
        <div className="table-wrapper" style={{ boxShadow: 'var(--shadow-xs)' }}>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '25%' }}>User Profile</th>
                <th style={{ width: '20%' }}>Warehouse Terminal Login</th>
                <th style={{ width: '23%' }}>Assigned Modules</th>
                <th style={{ width: '18%' }}>Granted Tab Access</th>
                <th style={{ width: '14%', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => {
                const initials = u.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                const isSuperAdmin = u.permissions.includes('*');
                const userCanonicalModules: string[] = u.modules;

                return (
                  <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.55 }}>
                    {/* User Profile */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 38,
                          height: 38,
                          borderRadius: '50%',
                          background: u.isActive ? 'var(--color-brand-light)' : 'var(--color-bg-subtle)',
                          color: u.isActive ? 'var(--color-brand)' : 'var(--color-text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 13,
                          fontWeight: 700,
                          flexShrink: 0
                        }}>
                          {initials}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <strong style={{ fontSize: 13.5, color: 'var(--color-text-main)' }}>{u.name}</strong>
                            {!u.isActive && (
                              <span className="badge badge-neutral" style={{ fontSize: 10, padding: '1px 6px' }}>
                                Inactive
                              </span>
                            )}
                            {u.permissions.includes(COST_PRICE_PERMISSION) && (
                              <span title="Confidential Cost Prices access" style={{ display: 'inline-flex', color: '#b45309' }}>
                                <LockKeyhole size={13} />
                              </span>
                            )}
                            {u.mustResetPassword && (
                              <span 
                                className="badge badge-warning" 
                                style={{ fontSize: 9.5, padding: '1px 5px', fontWeight: 600 }}
                                title="User must reset password upon their next login"
                              >
                                Pwd Reset Pending
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <code>@{u.username}</code>
                            {u.phone && <><span>·</span><span>{u.phone}</span></>}
                            <span>·</span>
                            <span>{formatDate(u.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Warehouse Floor Quick Login Status */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {u.badgeCode ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span 
                              className="badge badge-brand" 
                              style={{ 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: 5, 
                                fontSize: 11.5,
                                fontWeight: 700,
                                padding: '3px 8px',
                                letterSpacing: '0.04em'
                              }}
                            >
                              <ScanLine size={13} /> {u.badgeCode}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(u.badgeCode!, u.id)}
                              title="Copy Employee ID"
                              style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: copiedId === u.id ? 'var(--color-success)' : 'var(--color-text-light)' }}
                            >
                              {copiedId === u.id ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted text-xs" style={{ fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <X size={12} /> No Employee ID
                          </span>
                        )}

                        {u.hasPin ? (
                          <span 
                            style={{ 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: 4, 
                              fontSize: 11,
                              color: u.mustResetPin ? '#B45309' : 'var(--color-success)',
                              fontWeight: 600
                            }}
                            title={u.mustResetPin ? 'User must reset PIN upon their next floor terminal login' : 'PIN configured and active'}
                          >
                            <KeyRound size={12} /> {u.mustResetPin ? 'PIN Reset Pending' : '6-Digit PIN Set'}
                          </span>
                        ) : (
                          <span className="text-muted text-xs" style={{ fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <X size={12} /> No PIN Set
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Assigned Modules (among the 4 core modules) */}
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {userCanonicalModules.map(m => {
                          const col = MODULE_COLORS[m] || { bg: '#F3F4F6', text: '#374151', border: '#E5E7EB' };
                          return (
                            <span 
                              key={m} 
                              style={{ 
                                background: col.bg, 
                                color: col.text, 
                                border: `1px solid ${col.border}`,
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 7px'
                              }}
                            >
                              {MODULE_LABELS[m] || m}
                            </span>
                          );
                        })}
                      </div>
                    </td>

                    {/* Granted Tab Permissions */}
                    <td>
                      {isSuperAdmin ? (
                        <span 
                          className="badge badge-brand"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700 }}
                          title="Full unrestricted access across all 4 modules and tabs"
                        >
                          <ShieldCheck size={13} /> All Tabs (*)
                        </span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span 
                            className="badge badge-neutral"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, width: 'fit-content' }}
                            title={u.permissions.join(', ')}
                          >
                            <Check size={12} color="var(--color-brand)" /> {u.permissions.length} Tabs Allowed
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ textAlign: 'right' }}>
                      <div className="table-actions" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        {u.badgeCode && hasPermission(me, 'export.employee_barcodes') && (
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => exportBadgeBarcode(u)}
                            disabled={exportingBadges !== null}
                            title="Download this Employee ID barcode (PNG)"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', height: 32 }}
                          >
                            {exportingBadges === u.id ? <span className="spinner" /> : <Download size={13} />} Barcode
                          </button>
                        )}
                        <button 
                          type="button"
                          className="btn btn-sm btn-secondary" 
                          onClick={() => openEdit(u)}
                          title="Edit User Modules & Tabs"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', height: 32 }}
                        >
                          <Edit2 size={13} /> Edit
                        </button>
                        <button 
                          type="button"
                          className={`btn btn-sm ${u.isActive ? 'btn-ghost' : 'btn-secondary'}`} 
                          onClick={() => toggleActive(u)}
                          title={u.isActive ? 'Deactivate User Account' : 'Activate User Account'}
                          style={{ height: 32, padding: '5px 8px' }}
                        >
                          <Power size={13} color={u.isActive ? 'var(--color-danger)' : 'var(--color-success)'} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal: Add / Edit User (Clean 4-Module & Tab Architecture) ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div 
            className="modal" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: 1000, 
              width: '94%', 
              height: 'min(780px, 92vh)', 
              display: 'flex', 
              flexDirection: 'column', 
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-md)',
              overflow: 'hidden'
            }}
          >
            {/* Modal Header */}
            <div className="modal-header" style={{ padding: '18px 30px', borderBottom: '1px solid var(--color-border)', background: '#fff' }}>
              <div>
                <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 17, fontWeight: 700 }}>
                  <Users size={20} color="var(--color-brand)" />
                  {editing ? `Edit Account: ${editing.name}` : 'Create New User Account'}
                </h3>
                <p style={{ margin: '2px 0 0 28px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Assign access across the 4 modules and select exact permitted tabs
                </p>
              </div>
              <button 
                type="button"
                className="btn btn-ghost btn-icon" 
                onClick={() => setShowModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Tab Switcher */}
            <div style={{
              display: 'flex',
              background: 'var(--color-bg-subtle)',
              borderBottom: '1px solid var(--color-border)',
              padding: '0 30px',
              gap: 8
            }}>
              <button
                type="button"
                onClick={() => setModalTab('PROFILE')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '12px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: modalTab === 'PROFILE' ? '2px solid var(--color-brand)' : '2px solid transparent',
                  color: modalTab === 'PROFILE' ? 'var(--color-brand)' : 'var(--color-text-muted)',
                  fontWeight: modalTab === 'PROFILE' ? 700 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Users size={15} /> 1. Profile
              </button>

              <button
                type="button"
                onClick={() => setModalTab('PERMISSIONS')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '12px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: modalTab === 'PERMISSIONS' ? '2px solid var(--color-brand)' : '2px solid transparent',
                  color: modalTab === 'PERMISSIONS' ? 'var(--color-brand)' : 'var(--color-text-muted)',
                  fontWeight: modalTab === 'PERMISSIONS' ? 700 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <ShieldCheck size={15} /> 2. Modules & Permissions
              </button>

              {hasWarehouseSelected && (
                <button
                  type="button"
                  onClick={() => setModalTab('WAREHOUSE')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: modalTab === 'WAREHOUSE' ? '2px solid var(--color-brand)' : '2px solid transparent',
                    color: modalTab === 'WAREHOUSE' ? 'var(--color-brand)' : 'var(--color-text-muted)',
                    fontWeight: modalTab === 'WAREHOUSE' ? 700 : 500,
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <ScanLine size={15} /> 3. Warehouse PIN
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '26px 30px' }}>
                {error && (
                  <div className="alert alert-danger" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, fontSize: 13 }}>
                    <AlertCircle size={16} />
                    <span>{error}</span>
                  </div>
                )}

                {/* ── Step 1: Account Profile & Web Credentials ── */}
                {modalTab === 'PROFILE' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 13 }}>
                          Full Name <span className="required">*</span>
                        </label>
                        <input 
                          id="user-name" 
                          type="text" 
                          className="form-input" 
                          placeholder="e.g. Ramesh Kumar"
                          value={name} 
                          onChange={e => setName(e.target.value)} 
                          required 
                          style={{ height: 40 }}
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 13 }}>
                          Username <span className="required">*</span>
                        </label>
                        <input 
                          id="user-username" 
                          type="text" 
                          className="form-input" 
                          placeholder="e.g. ramesh.k"
                          value={username} 
                          onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))} 
                          required 
                          disabled={!!editing} 
                          style={{ height: 40 }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 13 }}>
                          Phone Number {phoneRequired && <span className="required">*</span>}
                        </label>
                        <input
                          id="user-phone"
                          type="tel"
                          inputMode="numeric"
                          className="form-input"
                          placeholder="10-digit mobile"
                          value={phone}
                          onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          required={phoneRequired}
                          style={{ height: 40 }}
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 13 }}>
                          Password {editing ? <span className="text-muted">(leave blank to keep current)</span> : <span className="required">*</span>}
                        </label>
                        <input
                          id="user-password"
                          type="password"
                          autoComplete="new-password"
                          className="form-input"
                          placeholder={editing ? '••••••••' : 'Minimum 8 characters'}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          required={!editing}
                          style={{ height: 40 }}
                        />
                      </div>
                    </div>

                    {editing && (
                      <div style={{
                        marginTop: 4,
                        padding: '12px 14px',
                        background: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)' }}>Account Status</div>
                          <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>Inactive accounts cannot log into the system or terminal</div>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                          <input
                            type="checkbox"
                            checked={isActive}
                            onChange={e => setIsActive(e.target.checked)}
                            style={{ accentColor: 'var(--color-brand)', width: 16, height: 16 }}
                          />
                          {isActive ? 'Active Account' : 'Deactivated'}
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step 2: The 4 Core Modules & Granular Tab Permissions ── */}
                {modalTab === 'PERMISSIONS' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Role Preset Selector */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-main)' }}>
                          Standard Role Presets
                        </span>
                        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                          Click a role to auto-assign modules and tabs
                        </span>
                      </div>

                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: 8,
                        marginBottom: 16
                      }}>
                        {ROLE_PRESETS.map(preset => {
                          const isSelected = selectedPreset === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => handleApplyPreset(preset.id)}
                              style={{
                                padding: '9px 12px',
                                textAlign: 'left',
                                border: isSelected ? '1.5px solid var(--color-brand)' : '1px solid var(--color-border)',
                                background: isSelected ? 'var(--color-brand-light)' : '#fff',
                                borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 12, fontWeight: isSelected ? 700 : 600, color: isSelected ? 'var(--color-brand)' : 'var(--color-text-main)' }}>
                                  {preset.name}
                                </span>
                                {isSelected && <Check size={13} color="var(--color-brand)" />}
                              </div>
                              <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.25 }}>
                                {preset.description.slice(0, 48)}...
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* The 4 Modules Containers with Tabs Inside Each */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-main)', display: 'block' }}>
                            Core Modules & Permitted Tabs
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                            Enable the modules this user can access, then select their permitted tabs inside each module.
                          </span>
                        </div>
                        {permissions.includes('*') && (
                          <span className="badge badge-brand" style={{ fontSize: 11, fontWeight: 700 }}>
                            Super Admin Wildcard Active (*)
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {PERMISSION_GROUPS.map(group => {
                          const isModuleEnabled = modules.includes(group.module);
                          const groupKeys = group.permissions.map(p => p.key);
                          const allSelected = permissions.includes('*') || groupKeys.every(k => permissions.includes(k));
                          const selectedCount = permissions.includes('*') ? groupKeys.length : groupKeys.filter(k => permissions.includes(k)).length;
                          const optMeta = MODULE_OPTIONS.find(m => m.value === group.module);
                          const Icon = optMeta?.icon || Package;

                          return (
                            <div 
                              key={group.module}
                              style={{ 
                                border: isModuleEnabled ? `1.5px solid ${optMeta?.color || 'var(--color-border)'}` : '1px solid var(--color-border)', 
                                borderRadius: 'var(--radius-md)', 
                                background: '#fff', 
                                overflow: 'hidden',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {/* Module Container Header: Main Checkbox to enable/disable module */}
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: isModuleEnabled ? (optMeta?.badgeBg || 'var(--color-bg-subtle)') : 'var(--color-bg-subtle)',
                                padding: '12px 16px',
                                borderBottom: isModuleEnabled ? '1px solid var(--color-border)' : 'none'
                              }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', margin: 0 }}>
                                  <input
                                    type="checkbox"
                                    checked={isModuleEnabled}
                                    onChange={() => handleModuleToggle(group.module)}
                                    style={{ width: 17, height: 17, accentColor: optMeta?.color || 'var(--color-brand)' }}
                                  />
                                  <div style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 'var(--radius-sm)',
                                    background: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: optMeta?.color || 'var(--color-brand)',
                                    border: '1px solid var(--color-border)'
                                  }}>
                                    <Icon size={16} />
                                  </div>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <strong style={{ fontSize: 13.5, color: 'var(--color-text-main)' }}>
                                        {group.title}
                                      </strong>
                                      {isModuleEnabled ? (
                                        <span 
                                          style={{ 
                                            background: optMeta?.badgeBg, 
                                            color: optMeta?.color, 
                                            border: `1px solid ${optMeta?.badgeBorder}`,
                                            fontSize: 10.5, 
                                            fontWeight: 700, 
                                            padding: '1px 7px', 
                                            borderRadius: 'var(--radius-sm)' 
                                          }}
                                        >
                                          Module Enabled · {selectedCount}/{groupKeys.length} tabs
                                        </span>
                                      ) : (
                                        <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
                                          Module Disabled
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                      {group.description}
                                    </div>
                                  </div>
                                </label>

                                {isModuleEnabled && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleGroup(group.module, allSelected)}
                                    style={{
                                      background: '#fff',
                                      border: '1px solid var(--color-border)',
                                      padding: '4px 10px',
                                      borderRadius: 'var(--radius-sm)',
                                      fontSize: 11,
                                      fontWeight: 600,
                                      color: 'var(--color-text-main)',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4
                                    }}
                                  >
                                    {allSelected ? (
                                      <><CheckSquare size={13} color="var(--color-brand)" /> Deselect All Tabs</>
                                    ) : (
                                      <><Square size={13} /> Select All Tabs</>
                                    )}
                                  </button>
                                )}
                              </div>

                              {/* Tabs inside this module (only visible when module is enabled) */}
                              {isModuleEnabled && (
                                <div style={{
                                  display: 'grid',
                                  gridTemplateColumns: '1fr 1fr',
                                  gap: 8,
                                  padding: 14,
                                  background: '#fff'
                                }}>
                                  {group.permissions.map(perm => {
                                    const isPermitted = permissions.includes('*') || permissions.includes(perm.key);
                                    return (
                                      <label
                                        key={perm.key}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'flex-start',
                                          gap: 9,
                                          cursor: 'pointer',
                                          padding: '8px 10px',
                                          borderRadius: 'var(--radius-sm)',
                                          background: isPermitted ? 'var(--color-brand-light)' : 'var(--color-bg-subtle)',
                                          border: isPermitted ? '1px solid var(--color-brand)' : '1px solid var(--color-border)',
                                          transition: 'all 0.1s ease'
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isPermitted}
                                          onChange={() => handlePermissionToggle(group.module, perm.key)}
                                          style={{ marginTop: 2, accentColor: 'var(--color-brand)' }}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                          <span style={{ fontSize: 12, fontWeight: isPermitted ? 700 : 500, color: isPermitted ? 'var(--color-brand)' : 'var(--color-text-main)' }}>
                                            {perm.label}
                                          </span>
                                          <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)', lineHeight: 1.25 }}>
                                            {perm.description}
                                          </span>
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Export permissions: separate from the modules */}
                    {(() => {
                      const has = (key: string) => permissions.includes('*') || permissions.includes(key);
                      const selectedCount = EXPORT_PERMISSIONS.filter(p => has(p.key)).length;
                      const allSelected = selectedCount === EXPORT_PERMISSIONS.length;
                      return (
                        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                            <div>
                              <span style={{ fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Download size={14} /> Export Permissions
                              </span>
                              <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', display: 'block', marginTop: 2 }}>
                                {selectedCount} of {EXPORT_PERMISSIONS.length} allowed. Opening a screen does not allow downloading from it.
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleToggleExports(allSelected)}
                              style={{
                                background: '#fff',
                                border: '1px solid var(--color-border)',
                                padding: '4px 10px',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 11,
                                fontWeight: 600,
                                color: 'var(--color-text-main)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                flexShrink: 0
                              }}
                            >
                              {allSelected ? (
                                <><CheckSquare size={13} color="var(--color-brand)" /> Deselect All</>
                              ) : (
                                <><Square size={13} /> Select All</>
                              )}
                            </button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                            {EXPORT_PERMISSIONS.map(perm => {
                              const isPermitted = has(perm.key);
                              return (
                                <label
                                  key={perm.key}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 9,
                                    cursor: 'pointer',
                                    padding: '8px 10px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: isPermitted ? 'var(--color-brand-light)' : 'var(--color-bg-subtle)',
                                    border: isPermitted ? '1px solid var(--color-brand)' : '1px solid var(--color-border)',
                                    transition: 'all 0.1s ease'
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isPermitted}
                                    onChange={() => handleExportToggle(perm.key)}
                                    style={{ marginTop: 2, accentColor: 'var(--color-brand)' }}
                                  />
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ fontSize: 12, fontWeight: isPermitted ? 700 : 500 }}>{perm.label}</span>
                                    <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)', lineHeight: 1.25 }}>{perm.description}</span>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Confidential access: separate from modules, tabs and full access */}
                    <div style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 'var(--radius-md)', padding: 14 }}>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: canGrantCostAccess ? 'pointer' : 'not-allowed', opacity: canGrantCostAccess ? 1 : 0.7 }}>
                        <input
                          type="checkbox"
                          checked={costAccess}
                          disabled={!canGrantCostAccess}
                          onChange={e => { setCostAccess(e.target.checked); setCostPassword(''); setCostPasswordError(''); }}
                          style={{ marginTop: 3, accentColor: '#b45309' }}
                        />
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#92400e', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <LockKeyhole size={14} /> Confidential Cost Prices
                          </span>
                          <span style={{ fontSize: 11.5, color: '#78350f', display: 'block', marginTop: 2, lineHeight: 1.35 }}>
                            Can open Administration → Cost Prices (after re-entering their password) to see and change item costs and the secret label code.
                            Not included in Super Admin. {canGrantCostAccess ? '' : 'Only a user who already has this access can give or remove it.'}
                          </span>
                        </div>
                      </label>
                      {costChanged && (
                        <div style={{ marginTop: 10, paddingLeft: 24, maxWidth: 360 }}>
                          <label className="form-label" htmlFor="cost-confirm-password" style={{ fontSize: 12.5, color: '#92400e' }}>
                            Your password, to {costAccess ? 'give' : 'remove'} this access
                          </label>
                          <input
                            id="cost-confirm-password"
                            type="password"
                            autoComplete="new-password"
                            className="form-input"
                            placeholder="Your password"
                            value={costPassword}
                            onChange={e => { setCostPassword(e.target.value); setCostPasswordError(''); }}
                            style={{ height: 40 }}
                          />
                          {costPasswordError && <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 4 }}>{costPasswordError}</div>}
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* ── Step 3: Warehouse Floor Login (Badge & 6-Digit PIN) ── (Only if warehouse operations chosen) */}
                {hasWarehouseSelected && modalTab === 'WAREHOUSE' && (
                  <div style={{ maxWidth: 400, margin: '40px auto 0', textAlign: 'center' }}>
                    <div style={{ width: 56, height: 56, margin: '0 auto 14px', borderRadius: '50%', background: 'var(--color-brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <KeyRound size={24} color="var(--color-brand)" />
                    </div>
                    <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Security PIN</h4>
                    <p style={{ margin: '6px 0 20px', fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                      Staff sign in on floor terminals by scanning their Employee ID barcode, then entering this PIN.
                    </p>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPinText ? 'text' : 'password'}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        autoComplete="new-password"
                        aria-label="Security PIN"
                        className="form-input"
                        placeholder={editing?.hasPin ? 'Enter new PIN' : 'Enter 6 digits'}
                        value={pin}
                        onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        style={{ height: 50, padding: '0 44px', textAlign: 'center', fontWeight: 600, fontSize: pin ? 20 : 15, letterSpacing: pin ? '0.3em' : 'normal' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPinText(!showPinText)}
                        aria-label={showPinText ? 'Hide PIN' : 'Show PIN'}
                        style={{ position: 'absolute', top: 0, right: 0, width: 44, height: '100%', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                      >
                        {showPinText ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {(pin || editing?.hasPin) && (
                      <div style={{ marginTop: 8, fontSize: 12, color: pin.length === 6 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                        {pin ? `${pin.length} of 6 digits` : 'A PIN is set. Leave blank to keep it.'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer with Step-by-Step Navigation */}
              <div className="modal-footer" style={{ padding: '14px 30px', borderTop: '1px solid var(--color-border)', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* Back Buttons */}
                  {modalTab === 'PERMISSIONS' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setModalTab('PROFILE')}
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      ← Back: Profile
                    </button>
                  )}
                  {modalTab === 'WAREHOUSE' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setModalTab('PERMISSIONS')}
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      ← Back: Permissions
                    </button>
                  )}

                  {/* Next Step Buttons */}
                  {modalTab === 'PROFILE' && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleProfileNext}
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      Next: Permissions →
                    </button>
                  )}

                  {modalTab === 'PERMISSIONS' && hasWarehouseSelected && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handlePermissionsNext}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'var(--color-brand)', color: 'var(--color-brand)', fontWeight: 600 }}
                    >
                      <ScanLine size={14} /> Next: Warehouse PIN →
                    </button>
                  )}

                  {/* Submit Button */}
                  {(modalTab === 'WAREHOUSE' || !hasWarehouseSelected || editing) && (
                    <button 
                      id="user-submit" 
                      type="submit" 
                      className="btn btn-primary" 
                      disabled={submitting}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120, justifyContent: 'center' }}
                    >
                      {submitting ? (
                        <><span className="spinner" /> Saving…</>
                      ) : (
                        <>{editing ? 'Save Changes' : 'Create Account'}</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
