import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import './styles/components.css';

import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout/Layout';
import LoginPage from './apps/Core/Login/LoginPage';
import ModuleSelectorPage from './apps/Core/ModuleSelector/ModuleSelectorPage';

// Purchasing
import PurchaseOrdersPage from './apps/Purchasing/PurchaseOrders/PurchaseOrdersPage';
import CreatePOPage from './apps/Purchasing/PurchaseOrders/CreatePOPage';
import ViewPOPage from './apps/Purchasing/PurchaseOrders/ViewPOPage';

// Warehouse Operations
import EntryGatePage from './apps/Inventory/EntryGate/EntryGatePage';
import ReceivePOPage from './apps/Inventory/EntryGate/ReceivePOPage';
import ExitGatePage from './apps/Inventory/ExitGate/ExitGatePage';
import PutAwayPage from './apps/Inventory/PutAway/PutAwayPage';
import BatchesPage from './apps/Inventory/Batches/BatchesPage';
import GRNListPage from './apps/Inventory/GRN/GRNListPage';
import ViewGRNPage from './apps/Inventory/GRN/ViewGRNPage';

// Supervisory Inventory
import InventoryDashboardPage from './apps/Inventory/Dashboard/InventoryDashboardPage';
import AuditLogPage from './apps/Inventory/AuditLog/AuditLogPage';
import DeliveryChallansPage from './apps/Inventory/DeliveryChallans/DeliveryChallansPage';
import StockAdjustmentsPage from './apps/Inventory/Adjustments/StockAdjustmentsPage';
import StockRelocationPage from './apps/Inventory/Relocations/StockRelocationPage';
import StockAgingPage from './apps/Inventory/Aging/StockAgingPage';
import ClientsTrackingPage from './apps/Inventory/Clients/ClientsTrackingPage';
import SuppliersTrackingPage from './apps/Inventory/Suppliers/SuppliersTrackingPage';
import StockCountsPage from './apps/Inventory/StockCount/StockCountsPage';
import StockCountPage from './apps/Inventory/StockCount/StockCountPage';
import ReturnsPage from './apps/Inventory/Returns/ReturnsPage';

// Administration
import DashboardPage from './apps/Administration/Dashboard/DashboardPage';
import SuppliersPage from './apps/Administration/Suppliers/SuppliersPage';
import ItemsPage from './apps/Administration/Items/ItemsPage';
import LocationsPage from './apps/Administration/Locations/LocationsPage';
import ReportsPage from './apps/Administration/Reports/ReportsPage';
import UsersPage from './apps/Administration/Users/UsersPage';
import PrinterSettingsPage from './apps/Administration/Settings/PrinterSettingsPage';

import { hasPermission, getDefaultRoute, type UserModule } from './utils/roles';
import ErrorBoundary from './components/Common/ErrorBoundary';

function ProtectedRoute({ 
  children, 
  permission, 
  check 
}: { 
  children: ReactNode; 
  permission?: string; 
  check?: (modules: UserModule[]) => boolean 
}) {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><span className="spinner spinner-lg" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(user, permission)) return <Navigate to="/" replace />;
  if (check && !check(user.modules)) return <Navigate to="/" replace />;

  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/select-module" element={<ModuleSelectorPage />} />

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
      <Route path="/inventory/stock-counts" element={<ProtectedRoute permission="inv.stock_count"><StockCountsPage /></ProtectedRoute>} />
      <Route path="/inventory/stock-counts/:id" element={<ProtectedRoute permission="inv.stock_count"><StockCountPage /></ProtectedRoute>} />
      <Route path="/inventory/returns" element={<ProtectedRoute permission="inv.returns"><ReturnsPage /></ProtectedRoute>} />
      
      {/* ── 4. Administration / Management ── */}
      <Route path="/dashboard" element={<ProtectedRoute permission="admin.dashboard"><DashboardPage /></ProtectedRoute>} />
      <Route path="/clients" element={<ProtectedRoute permission="admin.clients"><ClientsTrackingPage /></ProtectedRoute>} />
      <Route path="/suppliers" element={<ProtectedRoute permission="admin.suppliers"><SuppliersPage /></ProtectedRoute>} />
      <Route path="/items" element={<ProtectedRoute permission="admin.items"><ItemsPage /></ProtectedRoute>} />
      <Route path="/locations" element={<ProtectedRoute permission="admin.locations"><LocationsPage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute permission="admin.reports"><ReportsPage /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute permission="admin.users"><UsersPage /></ProtectedRoute>} />
      <Route path="/settings/printer" element={<ProtectedRoute permission="ops.printer"><PrinterSettingsPage /></ProtectedRoute>} />

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
