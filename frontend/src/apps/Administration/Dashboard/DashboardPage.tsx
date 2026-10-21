import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../utils/api';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  Users, 
  MapPin, 
  FileBarChart2, 
  ArrowUpRight, 
  ShieldCheck,
  Building2,
  Clock
} from 'lucide-react';
import { useAuth } from '../../../hooks/useAuth';
import '../../../styles/components.css';

interface DashboardStats {
  totalAttributes: number;
  totalLocations: number;
  totalSuppliers: number;
  totalUsers: number;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    totalAttributes: 0,
    totalLocations: 0,
    totalSuppliers: 0,
    totalUsers: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get('/api/master-data?detailed=true'),
      api.get('/api/inventory/summary'),
      api.get('/api/suppliers'),
      api.get('/api/users'),
    ]).then(([attrsRes, summaryRes, suppsRes, usersRes]) => {
      setStats({
        totalAttributes: attrsRes.status === 'fulfilled' && Array.isArray(attrsRes.value.data) ? attrsRes.value.data.length : 0,
        totalLocations: summaryRes.status === 'fulfilled' ? summaryRes.value.data?.locations?.total ?? 0 : 0,
        totalSuppliers: suppsRes.status === 'fulfilled' && Array.isArray(suppsRes.value.data) ? suppsRes.value.data.length : 0,
        totalUsers: usersRes.status === 'fulfilled' && Array.isArray(usersRes.value.data) ? usersRes.value.data.length : 0,
      });
      setLoading(false);
    });
  }, []);

  const quickLinks = [
    { title: 'Global Inventory Dashboard', desc: 'Real-time stock balance & SKU rollup', path: '/inventory/dashboard', icon: LayoutDashboard, color: 'var(--color-brand)' },
    { title: 'System Reports & Throughput', desc: 'Inbound, outbound and capacity analytics', path: '/reports', icon: FileBarChart2, color: '#0284c7' },
    { title: 'User & Permissions Control', desc: 'Manage access, badge codes and 6-digit PINs', path: '/users', icon: Users, color: '#16a34a' },
    { title: 'Warehouse Locations Setup', desc: 'Racks, bays, positions and location barcodes', path: '/locations', icon: MapPin, color: '#ea580c' },
    { title: 'Procurement & Purchase Orders', desc: 'Create mill purchase orders and track shipments', path: '/purchase-orders', icon: ShoppingCart, color: '#9333ea' },
    { title: 'Suppliers Master Directory', desc: 'Manage textile mills and vendors list', path: '/suppliers', icon: Building2, color: '#0d9488' },
  ];

  return (
    <div>
      {/* ── Page Header ── */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LayoutDashboard size={28} /> Management Dashboard
          </h1>
          <p className="page-subtitle">
            Executive oversight, system master data metrics, and administrative shortcuts
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-brand" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12 }}>
            <ShieldCheck size={14} /> Active User: {user?.name}
          </span>
        </div>
      </div>

      {/* ── Top Metric Cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
        marginBottom: 24
      }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600 }}>Master Attributes</span>
            <Package size={20} color="var(--color-brand)" />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text-main)' }}>
            {loading ? <span className="spinner" /> : stats.totalAttributes}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-light)', marginTop: 4 }}>
            Active configured qualities & codes
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600 }}>Shelving Locations</span>
            <MapPin size={20} color="#ea580c" />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text-main)' }}>
            {loading ? <span className="spinner" /> : stats.totalLocations}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-light)', marginTop: 4 }}>
            Configured warehouse rack bays
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600 }}>Registered Suppliers</span>
            <Building2 size={20} color="#0d9488" />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text-main)' }}>
            {loading ? <span className="spinner" /> : stats.totalSuppliers}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-light)', marginTop: 4 }}>
            Textile mills & vendors
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600 }}>System Users</span>
            <Users size={20} color="#16a34a" />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text-main)' }}>
            {loading ? <span className="spinner" /> : stats.totalUsers}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-light)', marginTop: 4 }}>
            Configured floor & office accounts
          </div>
        </div>
      </div>

      {/* ── Quick Administrative Navigation Grid ── */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)', marginBottom: 14 }}>
        Management Control & Operations Access
      </h3>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
        marginBottom: 24
      }}>
        {quickLinks.map(link => {
          const Icon = link.icon;
          return (
            <button
              key={link.path}
              type="button"
              onClick={() => navigate(link.path)}
              style={{
                background: '#fff',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '18px 20px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
                boxShadow: 'var(--shadow-xs)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = link.color;
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'var(--shadow-xs)';
              }}
            >
              <div style={{
                width: 42,
                height: 42,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg-subtle)',
                color: link.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Icon size={22} />
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-main)' }}>
                    {link.title}
                  </span>
                  <ArrowUpRight size={16} color="var(--color-text-muted)" />
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3, lineHeight: 1.4 }}>
                  {link.desc}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── System Status Banner ── */}
      <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-bg-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Clock size={18} color="var(--color-brand)" />
          <span style={{ fontSize: 13, color: 'var(--color-text-main)', fontWeight: 600 }}>
            Olino Uniforms Enterprise Warehouse Management System · Version 1.0
          </span>
        </div>
        <span className="badge badge-success" style={{ fontSize: 11, fontWeight: 700 }}>
          System Operational
        </span>
      </div>
    </div>
  );
}
