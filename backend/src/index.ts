import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import compression from 'compression';

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
import directInwardRoutes from './modules/inventory/direct-inward';
import poDraftRoutes from './modules/purchasing/po-drafts';
import receiptCorrectionRoutes from './modules/inventory/receipt-corrections';
import returnsRoutes from './modules/inventory/returns';
import stockCountsRoutes from './modules/inventory/stock-counts';
import costPricesRoutes from './modules/administration/cost-prices';

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Security headers ────────────────────────────────────────────────────────
// No server banner; browsers must not guess content types, show the app inside another site's
// frame (clickjacking), or send full URLs to other sites.
app.disable('x-powered-by');
// Nginx on this same machine passes the browser's address in X-Forwarded-For. Only a proxy on this
// machine is believed, so a computer on the network can't fake its address.
app.set('trust proxy', 'loopback');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Referrer-Policy': 'same-origin',
  });
  next();
});

// ─── Middleware ───────────────────────────────────────────────────────────────
// Large lists and the app itself shrink to about a tenth, which matters on warehouse Wi-Fi
app.use(compression());

// Direct Inward drafts carry whole imported sheets; every other request keeps the 100 KB default
app.use('/api/direct-inward/draft', express.json({ limit: '2mb' }));
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
app.use('/api/direct-inward', directInwardRoutes);
app.use('/api/po-drafts', poDraftRoutes);
app.use('/api/receipt-corrections', receiptCorrectionRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/stock-counts', stockCountsRoutes);
app.use('/api/cost-prices', costPricesRoutes);

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
  // Built files have a content hash in their name, so browsers may keep them for good
  app.use('/assets', express.static(path.join(frontendDist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use('/assets', (_req, res) => { res.status(404).end(); });
  app.use(express.static(frontendDist, { index: false }));
  // Client-side routes (e.g. /entry-gate) all load the single-page app
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(frontendIndex);
  });
} else {
  console.log('Frontend build not found; run "npm run build" to serve the app from this server.');
}

// Anything that fails unexpectedly: logged here, answered with a plain message. The details
// (database errors, stack traces) never reach the browser.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === 'entity.parse.failed') { res.status(400).json({ error: 'The request body is not valid JSON.' }); return; }
  if (err?.type === 'entity.too.large') { res.status(413).json({ error: 'The request is too large.' }); return; }
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

// A failed background task must not take the warehouse down; it is logged with its reason
process.on('unhandledRejection', reason => {
  console.error('Unhandled background failure:', reason);
});

// ─── Start ────────────────────────────────────────────────────────────────────
// HOST=127.0.0.1 when Nginx is in front, so the app can only be reached through it
app.listen(Number(PORT), process.env.HOST || '0.0.0.0', () => {
  console.log(`Olino WMS running on port ${PORT}`);
});

// Server instance export
export default app;
