export type UserModule = 'PURCHASE' | 'WAREHOUSE' | 'INVENTORY' | 'ADMINISTRATION';

export interface WmsUser {
  id: string;
  name: string;
  username: string;
  badgeCode?: string | null;
  hasPin?: boolean;
  modules: UserModule[];
  permissions: string[];
  mustResetPassword?: boolean;
  mustResetPin?: boolean;
}

// Display labels for the 4 core modules
export const MODULE_LABELS: Record<string, string> = {
  PURCHASE: 'Purchase',
  WAREHOUSE: 'Warehouse',
  INVENTORY: 'Inventory',
  ADMINISTRATION: 'Administration',
};

export type AppName = 'PURCHASE' | 'WAREHOUSE' | 'INVENTORY' | 'ADMINISTRATION';

// ─── Granular Tab Permission Definitions Per Module ───────────────────────────
export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  app: AppName;
  path: string;
}

export const PERMISSION_GROUPS: {
  module: UserModule;
  app: AppName;
  title: string;
  description: string;
  permissions: PermissionDefinition[];
}[] = [
  {
    module: 'PURCHASE',
    app: 'PURCHASE',
    title: 'Purchase Module',
    description: 'Procurement, mill orders and supplier tracking',
    permissions: [
      { key: 'po.view',   label: 'Purchase Orders List', description: 'View and inspect supplier purchase orders', app: 'PURCHASE', path: '/purchase-orders' },
      { key: 'po.create', label: 'Create & Edit PO',     description: 'Draft and edit supplier purchase orders', app: 'PURCHASE', path: '/purchase-orders/new' },
    ],
  },
  {
    module: 'WAREHOUSE',
    app: 'WAREHOUSE',
    title: 'Warehouse Module',
    description: 'Floor dock operations, shelving, queue and dispatches',
    permissions: [
      { key: 'ops.entry_gate', label: 'Stock In (Entry Gate)', description: 'Receive supplier shipments and scan roll barcodes', app: 'WAREHOUSE', path: '/entry-gate' },
      { key: 'ops.put_away',   label: 'Put Away (Shelving)',    description: 'Assign physical shelf locations to dock items', app: 'WAREHOUSE', path: '/put-away' },
      { key: 'ops.dock_queue', label: 'Inbound Dock Queue',     description: 'View unassigned rolls waiting at receiving dock', app: 'WAREHOUSE', path: '/batches' },
      { key: 'ops.exit_gate',  label: 'Stock Out (Exit Gate)',  description: 'Scan and dispatch goods out of warehouse', app: 'WAREHOUSE', path: '/exit-gate' },
      { key: 'ops.printer',    label: 'Printer Settings',       description: 'Configure thermal label barcode printers', app: 'WAREHOUSE', path: '/settings/printer' },
    ],
  },
  {
    module: 'INVENTORY',
    app: 'INVENTORY',
    title: 'Inventory Module',
    description: 'Stock management, movements, audit logs and stock balance',
    permissions: [
      { key: 'inv.dashboard',         label: 'Global Dashboard',            description: 'Executive stock snapshot, SKU rollup, item passport', app: 'INVENTORY', path: '/inventory/dashboard' },
      { key: 'inv.audit_log',          label: 'Audit Log & History',         description: 'Chronological timeline of all roll movements & cuts', app: 'INVENTORY', path: '/inventory/audit-log' },
      { key: 'inv.grn',                label: 'Goods Receipt Notes (GRN)',   description: 'View official inward stock receipt documents', app: 'INVENTORY', path: '/inventory/grn' },
      { key: 'inv.delivery_challans',  label: 'Delivery Challans (DC)',      description: 'Generate and review dispatch gate passes', app: 'INVENTORY', path: '/inventory/delivery-challans' },
      { key: 'inv.suppliers',          label: 'Suppliers Stock Tracking',    description: 'Track inventory distribution by supplier mills', app: 'INVENTORY', path: '/inventory/suppliers' },
      { key: 'inv.adjustments',        label: 'Stock Adjustments',           description: 'Perform manual quantity adjustments & count corrections', app: 'INVENTORY', path: '/inventory/adjustments' },
      { key: 'inv.relocations',        label: 'Stock Relocations',           description: 'Transfer items between warehouse bays and shelves', app: 'INVENTORY', path: '/inventory/relocations' },
      { key: 'inv.aging',              label: 'Stock Aging Analysis',        description: 'Track slow-moving stock and shelf dwell time', app: 'INVENTORY', path: '/inventory/aging' },
    ],
  },
  {
    module: 'ADMINISTRATION',
    app: 'ADMINISTRATION',
    title: 'Administration Module',
    description: 'System master data, locations, reports and user access',
    permissions: [
      { key: 'admin.dashboard', label: 'Management Dashboard',   description: 'High-level business analytics & KPI dashboard', app: 'ADMINISTRATION', path: '/dashboard' },
      { key: 'admin.clients',   label: 'Clients Master Directory', description: 'Manage corporate & institutional client accounts', app: 'ADMINISTRATION', path: '/clients' },
      { key: 'admin.suppliers', label: 'Suppliers Master Directory', description: 'Manage textile mills and vendor contacts', app: 'ADMINISTRATION', path: '/suppliers' },
      { key: 'admin.items',     label: 'Master Column Attributes', description: 'Configure brands, qualities, shades, and styles', app: 'ADMINISTRATION', path: '/items' },
      { key: 'admin.locations', label: 'Locations Setup',         description: 'Configure racks, bays and positions; export location barcodes', app: 'ADMINISTRATION', path: '/locations' },
      { key: 'admin.reports',   label: 'System Reports',          description: 'Export operational reports and inventory summaries', app: 'ADMINISTRATION', path: '/reports' },
      { key: 'admin.users',     label: 'Users & Permissions',    description: 'Create users, assign badges, PINs, and permissions', app: 'ADMINISTRATION', path: '/users' },
    ],
  },
];

// Flat list of all permission keys
export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));

// ─── Standard Role Presets ────────────────────────────────────────────────────
export interface RolePreset {
  id: string;
  name: string;
  description: string;
  modules: UserModule[];
  permissions: string[];
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'WAREHOUSE_SUPERVISOR',
    name: 'Warehouse Supervisor',
    description: 'Full operational oversight over Warehouse Floor and Inventory Control',
    modules: ['WAREHOUSE', 'INVENTORY'],
    permissions: [
      'ops.entry_gate', 'ops.put_away', 'ops.dock_queue', 'ops.exit_gate', 'ops.printer',
      'inv.dashboard', 'inv.audit_log', 'inv.grn', 'inv.delivery_challans', 'inv.suppliers',
      'inv.adjustments', 'inv.relocations', 'inv.aging'
    ],
  },
  {
    id: 'INBOUND_RECEIVER',
    name: 'Inbound Receiving Staff',
    description: 'Receiving dock operations: scan rolls, receive POs, dock queue, and view GRNs',
    modules: ['WAREHOUSE', 'INVENTORY'],
    permissions: ['ops.entry_gate', 'ops.dock_queue', 'inv.grn', 'ops.printer'],
  },
  {
    id: 'FORKLIFT_PUTAWAY',
    name: 'Put-Away & Relocation Operator',
    description: 'Floor shelving: move dock rolls to physical racks and handle bay transfers',
    modules: ['WAREHOUSE', 'INVENTORY'],
    permissions: ['ops.put_away', 'ops.dock_queue', 'inv.relocations'],
  },
  {
    id: 'OUTBOUND_DISPATCH',
    name: 'Outbound / Dispatch Staff',
    description: 'Gate pass dispatch: scan rolls out and generate delivery challans',
    modules: ['WAREHOUSE', 'INVENTORY'],
    permissions: ['ops.exit_gate', 'inv.delivery_challans', 'ops.printer'],
  },
  {
    id: 'INVENTORY_AUDITOR',
    name: 'Inventory Auditor / Quality Lead',
    description: 'Monitor stock balance, item passports, stock adjustments, and aging dwell time',
    modules: ['INVENTORY'],
    permissions: ['inv.dashboard', 'inv.audit_log', 'inv.adjustments', 'inv.aging', 'inv.relocations'],
  },
  {
    id: 'PURCHASE_OFFICER',
    name: 'Purchase Officer',
    description: 'Create and track mill purchase orders and manage supplier vendor directory',
    modules: ['PURCHASE', 'ADMINISTRATION'],
    permissions: ['po.view', 'po.create', 'admin.suppliers'],
  },
];

// Helper to check if a user has a specific module
export function hasModuleAccess(user: WmsUser | null | undefined, module: UserModule): boolean {
  if (!user) return false;
  // Listing an app here grants nothing by itself: every screen inside still checks hasPermission
  if (user.permissions?.includes('*') || user.modules.includes('ADMINISTRATION')) {
    return true;
  }
  return user.modules.includes(module);
}

// Check if user has permission for a specific granular tab
export function hasPermission(user: WmsUser | null | undefined, permissionKey: string): boolean {
  if (!user) return false;
  
  // Wildcard super-user bypass
  if (user.permissions && user.permissions.includes('*')) {
    return true;
  }

  // Exact permission match
  if (user.permissions && user.permissions.includes(permissionKey)) {
    return true;
  }

  // Users with no permission list fall back to their modules (same rule as the backend)
  if (!user.permissions || user.permissions.length === 0) {
    if (permissionKey.startsWith('po.') && user.modules.includes('PURCHASE')) return true;
    if (permissionKey.startsWith('ops.') && user.modules.includes('WAREHOUSE')) return true;
    if (permissionKey.startsWith('inv.') && (user.modules.includes('INVENTORY') || user.modules.includes('WAREHOUSE'))) return true;
    if (permissionKey.startsWith('admin.') && user.modules.includes('ADMINISTRATION')) return true;
  }

  return false;
}

export const canAccessApp = {
  PURCHASE: (user: WmsUser | null) => hasModuleAccess(user, 'PURCHASE') && (
    hasPermission(user, 'po.view') || hasPermission(user, 'po.create')
  ),
  WAREHOUSE: (user: WmsUser | null) => hasModuleAccess(user, 'WAREHOUSE') && (
    hasPermission(user, 'ops.entry_gate') || 
    hasPermission(user, 'ops.put_away') || 
    hasPermission(user, 'ops.dock_queue') || 
    hasPermission(user, 'ops.exit_gate') ||
    hasPermission(user, 'ops.printer')
  ),
  INVENTORY: (user: WmsUser | null) => hasModuleAccess(user, 'INVENTORY') && (
    hasPermission(user, 'inv.dashboard') || 
    hasPermission(user, 'inv.audit_log') || 
    hasPermission(user, 'inv.grn') || 
    hasPermission(user, 'inv.delivery_challans') ||
    hasPermission(user, 'inv.suppliers') ||
    hasPermission(user, 'inv.adjustments') ||
    hasPermission(user, 'inv.relocations') ||
    hasPermission(user, 'inv.aging')
  ),
  ADMINISTRATION: (user: WmsUser | null) => hasModuleAccess(user, 'ADMINISTRATION') && (
    hasPermission(user, 'admin.dashboard') || 
    hasPermission(user, 'admin.clients') || 
    hasPermission(user, 'admin.suppliers') || 
    hasPermission(user, 'admin.items') || 
    hasPermission(user, 'admin.locations') || 
    hasPermission(user, 'admin.reports') || 
    hasPermission(user, 'admin.users')
  ),
};

// Determine default route on login based on user's allowed permissions
export const getDefaultRoute = (user: WmsUser | null): string => {
  if (!user) return '/login';

  const accessibleApps = (['PURCHASE', 'WAREHOUSE', 'INVENTORY', 'ADMINISTRATION'] as const).filter(
    app => canAccessApp[app](user)
  );

  if (accessibleApps.length > 1) {
    return '/select-module';
  }

  // If exactly 1 app, find the first permitted tab path in that app
  if (accessibleApps.length === 1) {
    const targetApp = accessibleApps[0];
    const group = PERMISSION_GROUPS.find(g => g.app === targetApp);
    if (group) {
      const firstAllowed = group.permissions.find(p => hasPermission(user, p.key));
      if (firstAllowed) return firstAllowed.path;
    }
  }

  // General fallback: iterate through all permission groups to find any allowed path
  for (const group of PERMISSION_GROUPS) {
    const allowed = group.permissions.find(p => hasPermission(user, p.key));
    if (allowed) return allowed.path;
  }

  // If user has admin bypass or wildcard
  if (user.permissions?.includes('*') || user.modules?.includes('ADMINISTRATION')) {
    return '/dashboard';
  }

  return '/select-module';
};
