import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import './styles/components.css';

import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout/Layout';
import { hasPermission, getDefaultRoute, COST_PRICE_PERMISSION, type UserModule } from './utils/roles';
import ErrorBoundary from './components/Common/ErrorBoundary';

// Each screen is its own download, so the app starts fast. A tab left open across an update may
// ask for a file that no longer exists: reloading once picks up the new version.
function screen(load: () => Promise<{ default: ComponentType }>) {
  return lazy(async () => {
    try {
      const loaded = await load();
      sessionStorage.removeItem('wms_reloaded_for_update');
      return loaded;
    } catch (err) {
      if (sessionStorage.getItem('wms_reloaded_for_update')) throw err;
      sessionStorage.setItem('wms_reloaded_for_update', '1');
      window.location.reload();
      return new Promise<never>(() => {});
    }
  });
}

const screenLoading = <div className="loading-center" style={{ minHeight: '40vh' }}><span className="spinner spinner-lg" /></div>;

const LoginPage = screen(() => import('./apps/Core/Login/LoginPage'));
const ModuleSelectorPage = screen(() => import('./apps/Core/ModuleSelector/ModuleSelectorPage'));

// Purchasing
const PurchaseOrdersPage = screen(() => import('./apps/Purchasing/PurchaseOrders/PurchaseOrdersPage'));
const CreatePOPage = screen(() => import('./apps/Purchasing/PurchaseOrders/CreatePOPage'));
const ViewPOPage = screen(() => import('./apps/Purchasing/PurchaseOrders/ViewPOPage'));

// Warehouse Operations
const EntryGatePage = screen(() => import('./apps/Inventory/EntryGate/EntryGatePage'));
const ReceivePOPage = screen(() => import('./apps/Inventory/EntryGate/ReceivePOPage'));
const ExitGatePage = screen(() => import('./apps/Inventory/ExitGate/ExitGatePage'));
const PutAwayPage = screen(() => import('./apps/Inventory/PutAway/PutAwayPage'));
const BatchesPage = screen(() => import('./apps/Inventory/Batches/BatchesPage'));
const GRNListPage = screen(() => import('./apps/Inventory/GRN/GRNListPage'));
const ViewGRNPage = screen(() => import('./apps/Inventory/GRN/ViewGRNPage'));

// Supervisory Inventory
const InventoryDashboardPage = screen(() => import('./apps/Inventory/Dashboard/InventoryDashboardPage'));
const AuditLogPage = screen(() => import('./apps/Inventory/AuditLog/AuditLogPage'));
const DeliveryChallansPage = screen(() => import('./apps/Inventory/DeliveryChallans/DeliveryChallansPage'));
const StockAdjustmentsPage = screen(() => import('./apps/Inventory/Adjustments/StockAdjustmentsPage'));
const StockRelocationPage = screen(() => import('./apps/Inventory/Relocations/StockRelocationPage'));
const StockAgingPage = screen(() => import('./apps/Inventory/Aging/StockAgingPage'));
const ClientsTrackingPage = screen(() => import('./apps/Inventory/Clients/ClientsTrackingPage'));
const SuppliersTrackingPage = screen(() => import('./apps/Inventory/Suppliers/SuppliersTrackingPage'));
const StockCountsPage = screen(() => import('./apps/Inventory/StockCount/StockCountsPage'));
const StockCountPage = screen(() => import('./apps/Inventory/StockCount/StockCountPage'));
const ReturnsPage = screen(() => import('./apps/Inventory/Returns/ReturnsPage'));

// Administration
const DashboardPage = screen(() => import('./apps/Administration/Dashboard/DashboardPage'));
const SuppliersPage = screen(() => import('./apps/Administration/Suppliers/SuppliersPage'));
const ItemsPage = screen(() => import('./apps/Administration/Items/ItemsPage'));
const LocationsPage = screen(() => import('./apps/Administration/Locations/LocationsPage'));
const ReportsPage = screen(() => import('./apps/Administration/Reports/ReportsPage'));
const ExportLogPage = screen(() => import('./apps/Administration/ExportLog/ExportLogPage'));
const UsersPage = screen(() => import('./apps/Administration/Users/UsersPage'));
const PrinterSettingsPage = screen(() => import('./apps/Administration/Settings/PrinterSettingsPage'));

// Accounts (one screen with its own pages, so the unlock lasts while moving between them)
const AccountsPage = screen(() => import('./apps/Accounts/AccountsPage'));

function ProtectedRoute({ 
  children, 
  permission, 
  check 
}: { 
  children: ReactNode; 
  permission?: string | string[];   // any one of these 
  check?: (modules: UserModule[]) => boolean 
}) {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><span className="spinner spinner-lg" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (permission && ![permission].flat().some(p => hasPermission(user, p))) return <Navigate to="/" replace />;
  if (check && !check(user.modules)) return <Navigate to="/" replace />;

  return <Layout><Suspense fallback={screenLoading}>{children}</Suspense></Layout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Suspense fallback={screenLoading}><LoginPage /></Suspense>} />
      <Route path="/select-module" element={<Suspense fallback={screenLoading}><ModuleSelectorPage /></Suspense>} />

      <Route path="/" element={
        user
          ? <Navigate to={getDefaultRoute(user)} replace />
          : <Navigate to="/login" replace />
      } />

      {/* ── 1. Procurement / Purchase ── */}
      <Route path="/purchase-orders" element={<ProtectedRoute permission="po.view"><PurchaseOrdersPage /></ProtectedRoute>} />
      <Route path="/purchase-orders/new" element={<ProtectedRoute permission="po.create"><CreatePOPage /></ProtectedRoute>} />
      <Route path="/purchase-orders/:id/edit" element={<ProtectedRoute permission="po.create"><CreatePOPage /></ProtectedRoute>} />
      <Route path="/purchase-orders/:id/view" element={<ProtectedRoute permission="po.view"><ViewPOPage /></ProtectedRoute>} />

      {/* ── 2. Warehouse Operations (Floor Staff) ── */}
      <Route path="/entry-gate" element={<ProtectedRoute permission="ops.entry_gate"><EntryGatePage /></ProtectedRoute>} />
      <Route path="/entry-gate/:id" element={<ProtectedRoute permission="ops.entry_gate"><ReceivePOPage /></ProtectedRoute>} />
      <Route path="/put-away" element={<ProtectedRoute permission="ops.put_away"><PutAwayPage /></ProtectedRoute>} />
      <Route path="/batches" element={<ProtectedRoute permission="ops.dock_queue"><BatchesPage /></ProtectedRoute>} />
      <Route path="/exit-gate" element={<ProtectedRoute permission="ops.exit_gate"><ExitGatePage /></ProtectedRoute>} />

      {/* ── 3. Inventory (Supervisory Control Center) ── */}
      <Route path="/inventory/dashboard" element={<ProtectedRoute permission="inv.dashboard"><InventoryDashboardPage /></ProtectedRoute>} />
      <Route path="/inventory/audit-log" element={<ProtectedRoute permission="inv.audit_log"><AuditLogPage /></ProtectedRoute>} />
      <Route path="/inventory/grn" element={<ProtectedRoute permission="inv.grn"><GRNListPage /></ProtectedRoute>} />
      <Route path="/inventory/grn/:id" element={<ProtectedRoute permission="inv.grn"><ViewGRNPage /></ProtectedRoute>} />
      <Route path="/inventory/delivery-challans" element={<ProtectedRoute permission="inv.delivery_challans"><DeliveryChallansPage /></ProtectedRoute>} />
      <Route path="/inventory/suppliers" element={<ProtectedRoute permission="inv.suppliers"><SuppliersTrackingPage /></ProtectedRoute>} />
      <Route path="/inventory/adjustments" element={<ProtectedRoute permission="inv.adjustments"><StockAdjustmentsPage /></ProtectedRoute>} />
      <Route path="/inventory/relocations" element={<ProtectedRoute permission="inv.relocations"><StockRelocationPage /></ProtectedRoute>} />
      <Route path="/inventory/aging" element={<ProtectedRoute permission="inv.aging"><StockAgingPage /></ProtectedRoute>} />
      {/* Stock Count and Returns are warehouse operations; the old addresses still work */}
      <Route path="/stock-counts" element={<ProtectedRoute permission="ops.stock_count"><StockCountsPage /></ProtectedRoute>} />
      <Route path="/stock-counts/:id" element={<ProtectedRoute permission="ops.stock_count"><StockCountPage /></ProtectedRoute>} />
      <Route path="/returns" element={<ProtectedRoute permission="ops.returns"><ReturnsPage /></ProtectedRoute>} />
      <Route path="/inventory/stock-counts" element={<Navigate to="/stock-counts" replace />} />
      <Route path="/inventory/returns" element={<Navigate to="/returns" replace />} />
      
      {/* ── 4. Administration / Management ── */}
      <Route path="/dashboard" element={<ProtectedRoute permission="admin.dashboard"><DashboardPage /></ProtectedRoute>} />
      <Route path="/clients" element={<ProtectedRoute permission="admin.clients"><ClientsTrackingPage /></ProtectedRoute>} />
      <Route path="/suppliers" element={<ProtectedRoute permission="admin.suppliers"><SuppliersPage /></ProtectedRoute>} />
      <Route path="/items" element={<ProtectedRoute permission="admin.items"><ItemsPage /></ProtectedRoute>} />
      <Route path="/locations" element={<ProtectedRoute permission="admin.locations"><LocationsPage /></ProtectedRoute>} />
      <Route path="/export-log" element={<ProtectedRoute permission="export.log"><ExportLogPage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute permission="admin.reports"><ReportsPage /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute permission="admin.users"><UsersPage /></ProtectedRoute>} />
      <Route path="/cost-prices" element={<Navigate to="/accounts/secret-code" replace />} />

      {/* ── 5. Accounts (Confidential Cost Prices holders only) ── */}
      <Route path="/accounts/*" element={<ProtectedRoute permission={COST_PRICE_PERMISSION}><AccountsPage /></ProtectedRoute>} />
      <Route path="/settings/printer" element={<ProtectedRoute permission={['ops.printer', 'admin.dashboard']}><PrinterSettingsPage /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}
