import { useEffect, useState, useMemo } from 'react';
import api from '../../../utils/api';
import { 
  Users, 
  Plus, 
  X, 
  Printer, 
  ScanLine, 
  KeyRound, 
  ShieldCheck, 
  CheckSquare, 
  Square, 
  RefreshCw, 
  AlertCircle,
  FileText,
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
  ROLE_PRESETS,
  ALL_PERMISSION_KEYS,
  COST_PRICE_PERMISSION,
  hasCostAccess
} from '../../../utils/roles';
import { useAuth } from '../../../hooks/useAuth';
import { formatDate } from '../../../utils/format';
import { printTSPL } from '../../../utils/printer';
import BadgeBarcode from '../../../components/Common/BadgeBarcode';
import '../../../styles/components.css';

interface UserItem {
  id: string;
  name: string;
  username: string;
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
  const [accessFilter, setAccessFilter] = useState<'ALL' | 'WITH_BADGE' | 'STANDARD_ONLY'>('ALL');

  // Modal State
  const [modalTab, setModalTab] = useState<ModalTab>('PROFILE');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [badgeCode, setBadgeCode] = useState('');
  const [pin, setPin] = useState('');
  const [showPinText, setShowPinText] = useState(false);
  const [modules, setModules] = useState<UserModule[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('CUSTOM');
  const [isActive, setIsActive] = useState(true);
  // Confidential cost access is kept apart from the module / tab permissions (and from '*')
  const [costAccess, setCostAccess] = useState(false);
  const { user: me } = useAuth();

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

  // Print Badge Modal State
  const [printingUser, setPrintingUser] = useState<UserItem | null>(null);
  const [printingThermal, setPrintingThermal] = useState(false);

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

      // 4. Warehouse Access Filter
      if (accessFilter === 'WITH_BADGE' && !u.badgeCode) return false;
      if (accessFilter === 'STANDARD_ONLY' && u.badgeCode) return false;

      return true;
    });
  }, [users, searchQuery, moduleFilter, statusFilter, accessFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter(u => u.isActive).length;
    const withBadge = users.filter(u => !!u.badgeCode).length;
    const superAdmins = users.filter(u => u.permissions.includes('*')).length;
    return { total, active, withBadge, superAdmins };
  }, [users]);

  // Open Add User Dialog
  const openAdd = () => {
    setEditing(null);
    setModalTab('PROFILE');
    setName('');
    setUsername('');
    setPassword('');
    setBadgeCode('');
    setPin('');
    setShowPinText(false);
    setIsActive(true);
    setModules([]);
    setPermissions([]);
    setCostAccess(false);
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
    setPassword('');
    setBadgeCode(u.badgeCode || '');
    setPin('');
    setShowPinText(false);
    setIsActive(u.isActive);

    const userPerms = (u.permissions || []).filter(k => k !== COST_PRICE_PERMISSION);
    setModules(u.modules || []);
    setPermissions(userPerms);
    setCostAccess((u.permissions || []).includes(COST_PRICE_PERMISSION));

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

  const generateRandomBadge = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    setBadgeCode(`EMP-${randomNum}`);
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

    const withCostAccess = [...permissions.filter(k => k !== COST_PRICE_PERMISSION), ...(costAccess ? [COST_PRICE_PERMISSION] : [])];

    setSubmitting(true);
    try {
      const finalBadgeCode = hasWarehouseSelected ? (badgeCode.trim().toUpperCase() || null) : null;
      const finalPin = hasWarehouseSelected ? (pin.trim() || undefined) : undefined;

      if (editing) {
        const payload: Record<string, unknown> = {
          name: name.trim(),
          modules,
          permissions: withCostAccess,
          isActive,
          badgeCode: finalBadgeCode,
        };
        if (password) payload.password = password;
        if (hasWarehouseSelected) {
          if (pin) payload.pin = pin.trim();
        } else {
          // Clear pin and badge if warehouse access revoked
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
          password,
          badgeCode: finalBadgeCode,
          pin: finalPin,
          modules,
          permissions: withCostAccess,
        });
      }

      setShowModal(false);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to save user.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (u: UserItem) => {
    await api.patch(`/api/users/${u.id}`, { isActive: !u.isActive });
    load();
  };

  // TSPL direct hardware printer command for Employee Badges
  const handlePrintThermalBadge = async (u: UserItem) => {
    if (!u.badgeCode) {
      alert('This user does not have a Badge Code assigned yet. Edit user to assign a badge ID.');
      return;
    }

    setPrintingThermal(true);
    try {
      const tsplCommand = `SIZE 75 mm, 50 mm
DIRECTION 1
CLS
TEXT 300,25,"3",0,1,1,2,"OLINO UNIFORMS"
TEXT 300,55,"2",0,1,1,2,"WAREHOUSE ACCESS BADGE"
BAR 30,80,540,2
TEXT 300,105,"4",0,1,1,2,"${u.name.toUpperCase()}"
TEXT 300,145,"2",0,1,1,2,"ID: ${u.badgeCode} | ${u.username}"
BARCODE 300,185,"128",75,1,0,2,4,"${u.badgeCode}"
PRINT 1,1
`;
      await printTSPL(tsplCommand);
      alert(`Employee badge for ${u.name} (${u.badgeCode}) transmitted to thermal printer!`);
    } catch {
      alert('Failed to transmit badge to thermal printer. Verify printer network connectivity.');
    } finally {
      setPrintingThermal(false);
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
        <div className="page-actions">
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

          {/* Access Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Login Type:</span>
            <select
              className="form-select"
              value={accessFilter}
              onChange={e => setAccessFilter(e.target.value as any)}
              style={{ height: 38, fontSize: 12.5, padding: '0 28px 0 10px' }}
            >
              <option value="ALL">All Logins</option>
              <option value="WITH_BADGE">Warehouse Login (Badge/PIN)</option>
              <option value="STANDARD_ONLY">Standard Password Only</option>
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
              onClick={() => { setSearchQuery(''); setModuleFilter('ALL'); setStatusFilter('ALL'); setAccessFilter('ALL'); }}
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
                              title="Copy Badge Code"
                              style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: copiedId === u.id ? 'var(--color-success)' : 'var(--color-text-light)' }}
                            >
                              {copiedId === u.id ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted text-xs" style={{ fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <X size={12} /> No Badge Code
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
                        {u.badgeCode && (
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setPrintingUser(u)}
                            title="Print Employee Badge Barcode"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', height: 32 }}
                          >
                            <Printer size={13} /> Badge
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
              maxWidth: 820, 
              width: '92%', 
              maxHeight: '92vh', 
              display: 'flex', 
              flexDirection: 'column', 
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-md)',
              overflow: 'hidden'
            }}
          >
            {/* Modal Header */}
            <div className="modal-header" style={{ padding: '16px 22px', borderBottom: '1px solid var(--color-border)', background: '#fff' }}>
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
              padding: '0 22px',
              gap: 4
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
                <Users size={15} /> 1. Account Profile
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
                <ShieldCheck size={15} /> 2. Modules & Tab Permissions
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
                  <ScanLine size={15} /> 3. Warehouse Floor Login (Badge & PIN)
                  <span style={{ fontSize: 10.5, background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0', padding: '1px 7px', borderRadius: 'var(--radius-sm)', fontWeight: 700 }}>
                    Warehouse Enabled
                  </span>
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '22px' }}>
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

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <label className="form-label" style={{ fontSize: 13, marginBottom: 0 }}>
                          Password {editing ? <span className="text-muted">(leave blank to keep current)</span> : <span className="required">*</span>}
                        </label>
                        <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>
                          Hashed securely with Argon2
                        </span>
                      </div>
                      <input 
                        id="user-password" 
                        type="password" 
                        className="form-input" 
                        placeholder={editing ? '••••••••  (Unchanged)' : 'Enter strong password (minimum 6 characters)'}
                        value={password} 
                        onChange={e => setPassword(e.target.value)} 
                        required={!editing} 
                        style={{ height: 40 }}
                      />
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

                    {/* Confidential access: separate from modules, tabs and full access */}
                    <div style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 'var(--radius-md)', padding: 14 }}>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: canGrantCostAccess ? 'pointer' : 'not-allowed', opacity: canGrantCostAccess ? 1 : 0.7 }}>
                        <input
                          type="checkbox"
                          checked={costAccess}
                          disabled={!canGrantCostAccess}
                          onChange={e => setCostAccess(e.target.checked)}
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
                    </div>

                    {/* Notification Banner when Warehouse Operations is chosen */}
                    {hasWarehouseSelected && (
                      <div style={{
                        background: '#F0FDF4',
                        border: '1px solid #BBF7D0',
                        borderRadius: 'var(--radius-md)',
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <ScanLine size={20} color="#15803D" style={{ flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#15803D' }}>Warehouse Operations Enabled</div>
                            <div style={{ fontSize: 11.5, color: '#166534' }}>
                              This account can access warehouse operations. Configure their Handheld Terminal Badge & 6-Digit PIN in Step 3.
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setModalTab('WAREHOUSE')}
                          style={{ borderColor: '#86EFAC', color: '#15803D', background: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
                        >
                          <ScanLine size={13} /> Configure Badge & PIN →
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step 3: Warehouse Floor Login (Badge & 6-Digit PIN) ── (Only if warehouse operations chosen) */}
                {hasWarehouseSelected && modalTab === 'WAREHOUSE' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{
                      background: 'var(--color-bg-subtle)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      padding: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12
                    }}>
                      <ScanLine size={24} color="var(--color-brand)" style={{ flexShrink: 0 }} />
                      <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                        Warehouse floor staff can sign in on handheld terminals by scanning their <strong>Badge Barcode</strong> and entering their <strong>6-digit security PIN</strong>.
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 18 }}>
                      {/* Badge ID Input */}
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <label className="form-label" style={{ fontSize: 13, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ScanLine size={15} color="var(--color-brand)" /> Employee Badge Code
                          </label>
                          <button
                            type="button"
                            onClick={generateRandomBadge}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: 'var(--color-brand)',
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                          >
                            <RefreshCw size={12} /> Auto-Generate
                          </button>
                        </div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. EMP-1042"
                          value={badgeCode}
                          onChange={e => setBadgeCode(e.target.value.toUpperCase())}
                          style={{ height: 42, letterSpacing: '0.04em', fontWeight: 600 }}
                        />

                        {/* Live Barcode Preview */}
                        {badgeCode.trim() ? (
                          <div style={{ marginTop: 12, padding: '10px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: '#fff', textAlign: 'center' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                              Barcode Preview
                            </div>
                            <BadgeBarcode value={badgeCode.trim()} width={220} height={44} showText={false} />
                            <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, marginTop: 4, letterSpacing: '0.1em' }}>
                              {badgeCode.trim()}
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: 'var(--color-text-light)', marginTop: 6 }}>
                            Leave blank if this user only logs in from desktop with username & password.
                          </div>
                        )}
                      </div>

                      {/* 6-Digit PIN Input */}
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <label className="form-label" style={{ fontSize: 13, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <KeyRound size={15} color="var(--color-success)" /> 6-Digit Security PIN
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowPinText(!showPinText)}
                            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text-muted)', cursor: 'pointer' }}
                            title={showPinText ? 'Hide PIN' : 'Show PIN'}
                          >
                            {showPinText ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>

                        <input
                          type={showPinText ? 'text' : 'password'}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          className="form-input"
                          placeholder={editing && editing.hasPin ? '•••••• (Configured)' : 'Enter 6 digits'}
                          value={pin}
                          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          style={{ height: 42, letterSpacing: '0.25em', fontWeight: 700, textAlign: 'center', fontSize: 16 }}
                        />

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: pin.length === 6 ? 'var(--color-success)' : 'var(--color-text-muted)', fontWeight: 600 }}>
                            {pin ? `${pin.length} / 6 digits entered` : editing && editing.hasPin ? 'Existing PIN active' : 'Numeric digits only'}
                          </span>
                          {editing && editing.hasPin && (
                            <span className="badge badge-neutral" style={{ fontSize: 10 }}>PIN Active</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer with Step-by-Step Navigation */}
              <div className="modal-footer" style={{ padding: '12px 22px', borderTop: '1px solid var(--color-border)', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                      Next: Modules & Permissions →
                    </button>
                  )}

                  {modalTab === 'PERMISSIONS' && hasWarehouseSelected && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handlePermissionsNext}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'var(--color-brand)', color: 'var(--color-brand)', fontWeight: 600 }}
                    >
                      <ScanLine size={14} /> Next: Warehouse Floor Login →
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

      {/* ── Modal: Print Employee ID Badge (Card Visualizer) ── */}
      {printingUser && (
        <div className="modal-overlay" onClick={() => setPrintingUser(null)}>
          <div 
            className="modal" 
            onClick={e => e.stopPropagation()} 
            style={{ maxWidth: 440, width: '92%', padding: 24, borderRadius: 'var(--radius-lg)' }}
          >
            <div className="modal-header" style={{ marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--color-border)' }}>
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}>
                <Printer size={18} color="var(--color-brand)" /> Print Employee ID Badge
              </h3>
              <button 
                type="button" 
                className="btn btn-ghost btn-icon" 
                onClick={() => setPrintingUser(null)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Badge Preview Physical Card */}
            <div 
              id="printable-employee-badge"
              style={{
                border: '2px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: '24px 20px',
                background: '#fff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                boxShadow: 'var(--shadow-sm)',
                marginBottom: 20
              }}
            >
              <img 
                src="/logo.png" 
                alt="Olino Uniforms" 
                style={{ maxHeight: '40px', objectFit: 'contain', marginBottom: 8 }} 
              />
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--color-brand)', textTransform: 'uppercase', marginBottom: 14 }}>
                Warehouse Terminal Access Pass
              </div>

              {/* User Avatar Circle */}
              <div style={{
                width: 54,
                height: 54,
                borderRadius: '50%',
                background: 'var(--color-brand-light)',
                color: 'var(--color-brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                fontWeight: 700,
                marginBottom: 10
              }}>
                {printingUser.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </div>

              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text-main)', marginBottom: 2 }}>
                {printingUser.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
                <code>@{printingUser.username}</code>
              </div>

              {/* Barcode Visualization */}
              {printingUser.badgeCode && (
                <div style={{ padding: '8px 14px', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', marginBottom: 10 }}>
                  <BadgeBarcode value={printingUser.badgeCode} width={250} height={48} />
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--color-text-light)' }}>
                Scan this barcode gun on warehouse floor terminals to sign in
              </div>
            </div>

            {/* Print Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handlePrintThermalBadge(printingUser)}
                disabled={printingThermal}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 16px' }}
              >
                {printingThermal ? (
                  <><span className="spinner" /> Transmitting TSPL…</>
                ) : (
                  <><Printer size={18} /> Print on Thermal TSC Label Printer</>
                )}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.print()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px' }}
              >
                <FileText size={18} /> Print via Browser / Office Card Printer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
