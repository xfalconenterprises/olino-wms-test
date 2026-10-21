import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { canAccessApp, hasPermission } from '../../../utils/roles';
import { ShoppingCart, LayoutDashboard, Power, Package, ClipboardCheck } from 'lucide-react';
import '../../../styles/components.css';

export default function ModuleSelectorPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return <Navigate to="/login" replace />;

  const getWarehousePath = () => {
    if (hasPermission(user, 'ops.entry_gate')) return '/entry-gate';
    if (hasPermission(user, 'ops.put_away')) return '/put-away';
    if (hasPermission(user, 'ops.dock_queue')) return '/batches';
    if (hasPermission(user, 'ops.exit_gate')) return '/exit-gate';
    if (hasPermission(user, 'ops.printer')) return '/settings/printer';
    return '/entry-gate';
  };

  const getInventoryPath = () => {
    if (hasPermission(user, 'inv.dashboard')) return '/inventory/dashboard';
    if (hasPermission(user, 'inv.audit_log')) return '/inventory/audit-log';
    if (hasPermission(user, 'inv.grn')) return '/inventory/grn';
    if (hasPermission(user, 'inv.delivery_challans')) return '/inventory/delivery-challans';
    if (hasPermission(user, 'inv.suppliers')) return '/inventory/suppliers';
    if (hasPermission(user, 'inv.adjustments')) return '/inventory/adjustments';
    if (hasPermission(user, 'inv.relocations')) return '/inventory/relocations';
    if (hasPermission(user, 'inv.aging')) return '/inventory/aging';
    return '/inventory/dashboard';
  };

  const getPurchasePath = () => {
    if (hasPermission(user, 'po.view')) return '/purchase-orders';
    if (hasPermission(user, 'po.create')) return '/purchase-orders/new';
    return '/purchase-orders';
  };

  const getAdminPath = () => {
    if (hasPermission(user, 'admin.dashboard')) return '/dashboard';
    if (hasPermission(user, 'admin.clients')) return '/clients';
    if (hasPermission(user, 'admin.suppliers')) return '/suppliers';
    if (hasPermission(user, 'admin.items')) return '/items';
    if (hasPermission(user, 'admin.locations')) return '/locations';
    if (hasPermission(user, 'admin.reports')) return '/reports';
    if (hasPermission(user, 'admin.users')) return '/users';
    return '/dashboard';
  };

  const apps = [
    {
      id: 'PURCHASE',
      label: 'Purchase',
      desc: 'Purchase orders, supplier mill procurement',
      icon: ShoppingCart,
      path: getPurchasePath(),
      show: canAccessApp.PURCHASE(user)
    },
    {
      id: 'WAREHOUSE',
      label: 'Warehouse',
      desc: 'Stock In, rack shelving, queue, dispatches',
      icon: Package,
      path: getWarehousePath(),
      show: canAccessApp.WAREHOUSE(user)
    },
    {
      id: 'INVENTORY',
      label: 'Inventory',
      desc: 'Global dashboard, audit log, adjustments, aging, GRNs',
      icon: ClipboardCheck,
      path: getInventoryPath(),
      show: canAccessApp.INVENTORY(user)
    },
    {
      id: 'ADMINISTRATION',
      label: 'Administration',
      desc: 'Clients & suppliers master, reports, users, locations',
      icon: LayoutDashboard,
      path: getAdminPath(),
      show: canAccessApp.ADMINISTRATION(user)
    }
  ].filter(a => a.show);

  if (apps.length === 1) return <Navigate to={apps[0].path} replace />;
  if (apps.length === 0) return <Navigate to="/login" replace />;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg-subtle)',
      padding: '40px 20px',
      position: 'relative'
    }}>
      {/* Top Right Logout */}
      <div style={{ position: 'absolute', top: 24, right: 24 }}>
        <button
          className="btn btn-secondary"
          onClick={logout}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 13 }}
        >
          <Power size={16} /> Logout
        </button>
      </div>

      {/* Hero: Big Logo + Welcome */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <img
          src="/logo.png"
          alt="Olino Uniforms"
          style={{
            maxHeight: '90px',
            maxWidth: '320px',
            objectFit: 'contain',
            marginBottom: '20px'
          }}
        />

        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text-main)', margin: 0 }}>
          Welcome, {user.name}
        </h1>
      </div>

      {/* Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 260px))',
        gap: 20,
        justifyContent: 'center',
        maxWidth: 1100,
        width: '100%'
      }}>
        {apps.map(app => {
          const Icon = app.icon;
          return (
            <button
              key={app.id}
              onClick={() => navigate(app.path)}
              style={{
                height: 220,
                background: '#fff',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 24,
                gap: 12,
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: 'var(--shadow-sm)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-brand)';
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = 'var(--shadow-md)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
              }}
            >
              <div style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: 'var(--color-brand-faded)',
                color: 'var(--color-brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 2
              }}>
                <Icon size={30} />
              </div>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-main)' }}>
                {app.label}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                {app.desc}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
