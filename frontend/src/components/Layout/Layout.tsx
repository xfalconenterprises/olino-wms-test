import type { ReactNode } from 'react';
import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { 
  LogIn, 
  LogOut, 
  LayoutDashboard, 
  Layers, 
  MapPin, 
  ArrowRightLeft, 
  FileBarChart2, 
  Users, 
  Power, 
  ShoppingCart, 
  Plus, 
  LayoutGrid, 
  ChevronLeft, 
  ChevronRight, 
  Clock,
  SlidersHorizontal,
  FileText,
  Building2,
  Printer,
  FileCheck
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useSession } from '../../hooks/useSession';
import { hasPermission, canAccessApp, MODULE_LABELS, type UserModule, type AppName } from '../../utils/roles';
import '../../styles/layout.css';

type NavItem = {
  label: string;
  path: string;
  icon: any;
  permission: string;
  app: AppName;
  section?: string;
};

const NAV_ITEMS: NavItem[] = [
  // ─── 1. Purchase Module ──────────────────────────────────────────────────
  { label: 'Purchase Orders', path: '/purchase-orders',     icon: ShoppingCart, permission: 'po.view',   app: 'PURCHASE', section: 'Procurement' },
  { label: 'Create PO',       path: '/purchase-orders/new', icon: Plus,         permission: 'po.create', app: 'PURCHASE' },

  // ─── 2. Warehouse Module (Floor Operations) ──────────────────────────────
  { label: 'Stock In',        path: '/entry-gate',          icon: LogIn,        permission: 'ops.entry_gate', app: 'WAREHOUSE', section: 'Inbound' },
  { label: 'Put Away',        path: '/put-away',            icon: MapPin,       permission: 'ops.put_away',   app: 'WAREHOUSE' },
  { label: 'Inbound Dock Queue', path: '/batches',          icon: Layers,       permission: 'ops.dock_queue', app: 'WAREHOUSE', section: 'Floor Inventory' },
  { label: 'Stock Out',       path: '/exit-gate',           icon: LogOut,       permission: 'ops.exit_gate',  app: 'WAREHOUSE', section: 'Outbound' },
  { label: 'Printer Settings', path: '/settings/printer',   icon: Printer,      permission: 'ops.printer',    app: 'WAREHOUSE', section: 'Hardware' },

  // ─── 3. Inventory Module (Supervisory Control) ───────────────────────────
  { label: 'Global Dashboard',   path: '/inventory/dashboard',          icon: LayoutDashboard,   permission: 'inv.dashboard',         app: 'INVENTORY', section: 'Master Inventory' },
  { label: 'Audit Log',          path: '/inventory/audit-log',          icon: ArrowRightLeft,    permission: 'inv.audit_log',         app: 'INVENTORY', section: 'Tracking & Movements' },
  { label: 'Goods Receipt Notes', path: '/inventory/grn',               icon: FileCheck,         permission: 'inv.grn',               app: 'INVENTORY' },
  { label: 'Delivery Challans',  path: '/inventory/delivery-challans',  icon: FileText,          permission: 'inv.delivery_challans', app: 'INVENTORY' },
  { label: 'Suppliers Tracking', path: '/inventory/suppliers',          icon: Building2,         permission: 'inv.suppliers',         app: 'INVENTORY', section: 'Stakeholders & Stock' },
  { label: 'Adjustments',        path: '/inventory/adjustments',        icon: SlidersHorizontal, permission: 'inv.adjustments',       app: 'INVENTORY', section: 'Stock Supervision' },
  { label: 'Relocations',        path: '/inventory/relocations',        icon: MapPin,            permission: 'inv.relocations',       app: 'INVENTORY' },
  { label: 'Stock Aging',        path: '/inventory/aging',              icon: Clock,             permission: 'inv.aging',             app: 'INVENTORY' },

  // ─── 4. Administration Module (System Masters) ───────────────────────────
  { label: 'Dashboard',          path: '/dashboard',           icon: LayoutDashboard, permission: 'admin.dashboard', app: 'ADMINISTRATION' },
  { label: 'Clients Master',     path: '/clients',             icon: Users,           permission: 'admin.clients',   app: 'ADMINISTRATION', section: 'Master Data' },
  { label: 'Suppliers Master',   path: '/suppliers',           icon: Building2,       permission: 'admin.suppliers', app: 'ADMINISTRATION' },
  { label: 'Master Attributes',  path: '/items',               icon: Layers,          permission: 'admin.items',     app: 'ADMINISTRATION' },
  { label: 'Locations Setup',    path: '/locations',           icon: MapPin,          permission: 'admin.locations', app: 'ADMINISTRATION' },
  { label: 'Reports',            path: '/reports',             icon: FileBarChart2,   permission: 'admin.reports',   app: 'ADMINISTRATION', section: 'System & Control' },
  { label: 'Users & Roles',      path: '/users',               icon: Users,           permission: 'admin.users',     app: 'ADMINISTRATION' },
  { label: 'Printer Settings',   path: '/settings/printer',    icon: Printer,         permission: 'admin.dashboard', app: 'ADMINISTRATION' },
];


// Always starts collapsed initially when loading the application
let sessionSidebarCollapsed = true;

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [isCollapsed, setIsCollapsed] = useState(sessionSidebarCollapsed);

  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      sessionSidebarCollapsed = next;
      return next;
    });
  };

  const handleExpire = () => {
    logout();
  };

  const { showWarning, minutesRemaining, extendSession } = useSession(
    user?.modules as UserModule[] | null,
    handleExpire
  );

  if (!user) return null;

  const modules = user.modules;
  const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Determine current active app based on route
  let currentApp: AppName = 'WAREHOUSE';
  const currentPath = location.pathname;
  if (currentPath.startsWith('/purchase-orders')) {
    currentApp = 'PURCHASE';
  } else if (currentPath.startsWith('/entry-gate') || currentPath.startsWith('/exit-gate') || currentPath.startsWith('/put-away') || currentPath.startsWith('/batches')) {
    currentApp = 'WAREHOUSE';
  } else if (currentPath.startsWith('/inventory')) {
    currentApp = 'INVENTORY';
  } else if (currentPath.startsWith('/dashboard') || currentPath.startsWith('/reports') || currentPath.startsWith('/users') || currentPath.startsWith('/locations') || currentPath.startsWith('/suppliers') || currentPath.startsWith('/clients') || currentPath.startsWith('/items')) {
    currentApp = 'ADMINISTRATION';
  } else if (currentPath.startsWith('/settings')) {
    const hasWarehouse = canAccessApp.WAREHOUSE(user);
    const hasAdmin = canAccessApp.ADMINISTRATION(user);
    currentApp = hasWarehouse && !hasAdmin ? 'WAREHOUSE' : 'ADMINISTRATION';
  }

  // Filter nav items for the current app based on assigned granular permissions
  const appNavItems = NAV_ITEMS.filter(item => item.app === currentApp && hasPermission(user, item.permission));

  // Helper to determine active state cleanly without double-selection on child paths
  const isItemActive = (itemPath: string) => {
    // 1. Exact match
    if (location.pathname === itemPath) return true;

    // 2. If another nav item has an exact match with the current path, only that exact item is active
    const hasExactMatch = appNavItems.some(i => i.path === location.pathname);
    if (hasExactMatch) return false;

    // 3. For sub-routes (e.g. /purchase-orders/123/view), match the prefix if no more specific nav item matches
    if (location.pathname.startsWith(itemPath + '/')) {
      const hasMoreSpecific = appNavItems.some(
        other => other.path !== itemPath && 
                 other.path.startsWith(itemPath + '/') && 
                 location.pathname.startsWith(other.path)
      );
      return !hasMoreSpecific;
    }

    return false;
  };

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        
        {/* Brand Logo & Controls */}
        <div style={{
          padding: isCollapsed ? '16px 8px' : '14px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          flexDirection: isCollapsed ? 'column' : 'row',
          gap: isCollapsed ? 12 : 0
        }}>
          <button
            type="button"
            onClick={() => navigate('/select-module')}
            title="Go to Home / Module Selection"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <img 
              src="/logo.png" 
              alt="Company Logo" 
              style={{ 
                maxHeight: isCollapsed ? '28px' : '44px', 
                maxWidth: isCollapsed ? '48px' : '155px', 
                objectFit: 'contain', 
                transition: 'all 0.2s' 
              }} 
            />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexDirection: isCollapsed ? 'column' : 'row' }}>
            <button 
              type="button"
              className="btn btn-ghost btn-icon" 
              onClick={() => navigate('/select-module')}
              title="Home / Switch Module"
              style={{
                padding: 6,
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-brand)'
              }}
            >
              <LayoutGrid size={18} />
            </button>

            <button 
              type="button"
              className="btn btn-ghost btn-icon" 
              onClick={toggleCollapsed}
              title={isCollapsed ? "Extend Sidebar" : "Collapse Sidebar"}
              style={{
                padding: 6,
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-muted)'
              }}
            >
              {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>
        </div>

        <nav className="sidebar-nav" style={{ flex: 1, overflowY: 'auto', padding: isCollapsed ? '12px 8px' : '12px 0' }}>

          {appNavItems.map((item, index) => {
            const prevSection = index > 0 ? appNavItems[index - 1].section : null;
            const showSection = Boolean(item.section && item.section !== prevSection);

            return (
              <div key={item.path}>
                {showSection && !isCollapsed && (
                  <div className="sidebar-section-label">{item.section}</div>
                )}
                {showSection && isCollapsed && (
                  <div style={{ height: 1, background: 'var(--color-border)', margin: '12px 8px 8px 8px' }} />
                )}
                <NavLink
                  to={item.path}
                  title={isCollapsed ? item.label : undefined}
                  className={() =>
                    `sidebar-nav-item${isItemActive(item.path) ? ' active' : ''} ${isCollapsed ? 'collapsed' : ''}`
                  }
                >
                  <span className="nav-icon"><item.icon size={18} /></span>
                  {!isCollapsed && item.label}
                </NavLink>
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer" style={{ padding: isCollapsed ? '12px 8px' : '12px 16px', display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
          <div className="sidebar-user" style={{ flexDirection: isCollapsed ? 'column' : 'row', gap: isCollapsed ? 8 : 12, width: '100%', justifyContent: isCollapsed ? 'center' : 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="sidebar-user-avatar">{initials}</div>
              {!isCollapsed && (
                <div className="sidebar-user-info">
                  <div className="sidebar-user-name truncate">{user.name}</div>
                  <div className="sidebar-user-role" title={modules.map(m => MODULE_LABELS[m]).join(', ')}>
                    {modules.length === 1 ? MODULE_LABELS[modules[0]] : `${modules.length} Modules`}
                  </div>
                </div>
              )}
            </div>
            <button
              className="sidebar-logout"
              onClick={logout}
              title="Logout"
            >
              <Power size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="main-area">
        <div className="page-content">{children}</div>
      </div>

      {/* ── Session Warning ── */}
      {showWarning && (
        <div className="session-warning" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={16} /> Session expires in {minutesRemaining} min
          <button className="btn btn-sm btn-secondary" onClick={extendSession}>
            Stay Logged In
          </button>
        </div>
      )}
    </div>
  );
}
