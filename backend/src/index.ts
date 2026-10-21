import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';

import authRoutes from './modules/core/auth';
import batchesRoutes from './modules/inventory/batches';
import locationsRoutes from './modules/inventory/locations';
import transactionsRoutes from './modules/inventory/transactions';
import labelsRoutes from './modules/inventory/labels';
import deliveryChallansRoutes from './modules/inventory/delivery-challans';
import inventoryRoutes from './modules/inventory/inventory';
import reportsRoutes from './modules/administration/reports';
import usersRoutes from './modules/administration/users';
import purchaseOrdersRoutes from './modules/purchasing/purchase-orders';
import suppliersRoutes from './modules/purchasing/suppliers';
import masterAttributesRoutes from './modules/master-data/attributes';
import printerRoutes from './modules/inventory/printer';
import clientsRoutes from './modules/inventory/clients';
import grnRoutes from './modules/inventory/grn';

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());

// ─── Request Logging Middleware ─────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const time = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date());
    console.log(`[${time}] ${method} ${originalUrl} ${status} (${duration}ms)`);
  });

  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/batches', batchesRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/labels', labelsRoutes);
app.use('/api/delivery-challans', deliveryChallansRoutes);
app.use('/api/grn', grnRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/master-data', masterAttributesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/printer', printerRoutes);
app.use('/api/clients', clientsRoutes);

// Unknown API paths are a 404, never the frontend page
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Frontend (production build) ─────────────────────────────────────────────
// Serves frontend/dist so the whole app runs on one port. Resolves the same way
// from src/ (tsx) and dist/ (compiled). Only the built folder is exposed.
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const frontendIndex = path.join(frontendDist, 'index.html');

if (fs.existsSync(frontendIndex)) {
  app.use(express.static(frontendDist, { index: false }));
  // Client-side routes (e.g. /entry-gate) all load the single-page app
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(frontendIndex);
  });
} else {
  console.log('Frontend build not found; run "npm run build" to serve the app from this server.');
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(Number(PORT), () => {
  console.log(`Olino WMS running on port ${PORT}`);
});

// Server instance export
export default app;
