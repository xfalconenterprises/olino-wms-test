import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { requireAuth, requireCostAccess, requireCostUnlock, signCostUnlockToken, COST_UNLOCK_MINUTES } from '../../middleware/auth';
import { istDateKey } from '../../utils/format';
import { costLetters, decodeCost, encodeCost, normaliseCostCodeConfig } from '../../utils/cost-code';
import { costCodeConfig, logCostChange, ownPasswordRefusal, parseCostPrice, poLineLabel } from '../administration/cost-prices';
import { stockYears } from '../administration/reports';
import { itemDescription } from '../inventory/returns';
import { closingLumps, filterChoices, filteredRolls, filterLumps, lumpSuppliers, orderedAtCost, receivedAtCost, rollsAtCost, rollsInStock, saveClosingStock, stockFilters, supplierPurchases, valueLumps, valueRolls, type ClosingLump } from './valuation';

// Accounts: everything about money. Only users given Confidential Cost Prices by name can open it
// (full access '*' does not include it), and each visit is unlocked with their own password.
// Rupees appear only in these answers; everywhere else costs are shown as the secret code.

const router = Router();
router.use(requireAuth, requireCostAccess);
// Rupees are never kept by the browser or anything in between
router.use((_req: Request, res: Response, next: NextFunction) => { res.set('Cache-Control', 'no-store'); next(); });

const IN_STOCK = ['IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD'] as const;
const PAGE_SIZE = 50;
const money = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
const flag = (v: unknown) => v === '1' || v === 'true';
const pageOf = (v: unknown) => Math.max(1, parseInt(String(v ?? '1'), 10) || 1);
/** Rows to skip and take: ?offset=&limit= (Load more, or the same rows again after a change), else ?page= of 50. */
const rowsOf = (q: Request['query']) => {
  const limit = Math.min(1000, Math.max(1, parseInt(String(q.limit ?? ''), 10) || PAGE_SIZE));
  const offset = q.offset !== undefined ? Math.max(0, parseInt(String(q.offset), 10) || 0) : (pageOf(q.page) - 1) * PAGE_SIZE;
  return { skip: offset, take: limit };
};
const isDayKey = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

router.post('/unlock', async (req: Request, res: Response) => {
  const refusal = await ownPasswordRefusal(req.user!.userId, req.user!.username, req.body?.password);
  if (refusal) { res.status(refusal.status).json({ error: refusal.error }); return; }
  res.json({ ...signCostUnlockToken(req.user!.userId), minutes: COST_UNLOCK_MINUTES });
});

router.use(requireCostUnlock);

// ─── Stock value ────────────────────────────────────────────────────────────

/** The current stock year so far (null on the day a year was ended: the new one starts tomorrow). */
async function currentYearAtCost() {
  const { currentStarts } = await stockYears();
  const today = istDateKey();
  if (currentStarts > today) return null;
  const [received, ordered] = await Promise.all([receivedAtCost(currentStarts, today), orderedAtCost(currentStarts, today)]);
  return { ...received, ordered };
}

// GET /api/accounts/stock-value?<filters>[&withYear=1] — stock at cost matching the filters; the
// stock year's figures (whole warehouse) only when asked for
router.get('/stock-value', async (req: Request, res: Response) => {
  const f = stockFilters(req.query);
  const valued = filteredRolls(f).then(({ rolls, costs }) => valueRolls(rolls, costs));
  const [valuation, year, config] = await Promise.all([valued, req.query.withYear === '1' ? currentYearAtCost() : null, costCodeConfig()]);
  res.json({ ...valuation, year, codeWordSet: Boolean(config) });
});

// GET /api/accounts/stock-value/choices — suppliers and clients with stock, for the filters
router.get('/stock-value/choices', async (_req: Request, res: Response) => {
  res.json(await filterChoices());
});

// GET /api/accounts/stock-value/rolls?key= — the rolls or packs inside one item, with their costs
router.get('/stock-value/rolls', async (req: Request, res: Response) => {
  const key = String(req.query.key ?? '');
  if (!key || key.length > 600) { res.status(400).json({ error: 'Choose an item.' }); return; }
  res.json(await rollsAtCost(key, stockFilters(req.query)));
});

// GET /api/accounts/stock-value/all-rolls — every roll and pack in stock with its cost (the Excel's lump sheets)
router.get('/stock-value/all-rolls', async (req: Request, res: Response) => {
  res.json(await rollsAtCost(undefined, stockFilters(req.query)));
});

// GET /api/accounts/suppliers — stock in hand at cost by supplier, and what each supplied this stock year
// GET /api/accounts/suppliers?from=&to= — purchases by supplier for those days (all time when
// left out), with each PO and Direct Inward invoice, and what of theirs is in stock now
router.get('/suppliers', async (req: Request, res: Response) => {
  const today = istDateKey();
  const from = isDayKey(req.query.from) ? req.query.from : '2000-01-01';
  const to = isDayKey(req.query.to) && req.query.to < today ? req.query.to : today;
  if (from > to) { res.status(400).json({ error: 'The first day must be on or before the last day.' }); return; }
  const [{ currentStarts }, purchases] = await Promise.all([stockYears(), supplierPurchases(from, to)]);
  res.json({ from: isDayKey(req.query.from) ? from : null, to, today, currentYearStarts: currentStarts, ...purchases });
});

// GET /api/accounts/missing-summary — stock in hand with no cost
router.get('/missing-summary', async (_req: Request, res: Response) => {
  const valuation = await rollsInStock().then(valueRolls);
  const withoutCost = valuation.items.filter(i => i.rollsWithoutCost > 0);
  res.json({
    rollsWithoutCost: valuation.totals.rollsWithoutCost,
    rolls: valuation.totals.rolls,
    items: withoutCost.length,
    byType: valuation.byType.filter(t => t.rollsWithoutCost > 0).map(t => ({ itemType: t.itemType, rollsWithoutCost: t.rollsWithoutCost })),
  });
});

// ─── Purchase (PO line) costs ───────────────────────────────────────────────

router.get('/po-costs', async (req: Request, res: Response) => {
  const search = String(req.query.search ?? '').trim();
  const page = pageOf(req.query.page);
  const contains = (field: string) => ({ [field]: { contains: search, mode: 'insensitive' } });
  const activePo = { po: { isDeleted: false, status: { not: 'CANCELLED' as const } } };
  const withStock = { batches: { some: { status: { in: [...IN_STOCK] }, quantity: { gt: 0 } } } };
  const poId = typeof req.query.poId === 'string' ? req.query.poId : '';
  const where: Prisma.PurchaseOrderLineWhereInput = {
    ...activePo,
    ...(poId && { poId }),
    ...(flag(req.query.missing) && { cost: { is: null } }),
    ...(flag(req.query.inStock) && withStock),
    ...(search && {
      OR: [
        { po: { OR: [contains('poNumber'), contains('supplierName')] } },
        ...['brand', 'quality', 'qualityName', 'shade', 'name', 'artNo', 'category'].map(contains),
      ] as Prisma.PurchaseOrderLineWhereInput[],
    }),
  };

  const [total, lines, config] = await Promise.all([
    prisma.purchaseOrderLine.count({ where }),
    prisma.purchaseOrderLine.findMany({
      where,
      include: { cost: true, po: { select: { id: true, poNumber: true, supplierName: true, createdAt: true, status: true } } },
      orderBy: [{ po: { createdAt: 'desc' } }, { createdAt: 'asc' }],
      ...(poId ? {} : rowsOf(req.query)),
    }),
    costCodeConfig(),
  ]);
  const stock = await prisma.itemBatch.groupBy({
    by: ['poLineId'],
    where: { poLineId: { in: lines.map(l => l.id) }, status: { in: [...IN_STOCK] }, quantity: { gt: 0 } },
    _sum: { quantity: true },
  });
  const inStock = new Map(stock.map(s => [s.poLineId, s._sum.quantity ?? 0]));

  res.json({
    page, pageSize: PAGE_SIZE, total,
    lines: lines.map(l => {
      const cost = money(l.cost?.costPrice);
      const qty = Math.round((inStock.get(l.id) ?? 0) * 1000) / 1000;
      return {
        id: l.id,
        poId: l.po.id, poNumber: l.po.poNumber, supplierName: l.po.supplierName, poDate: l.po.createdAt, poStatus: l.po.status,
        itemType: l.itemType, description: poLineLabel(l), uom: l.uom,
        orderedQty: l.orderedQty, receivedQty: l.receivedQty, inStockQty: qty,
        costPrice: cost,
        code: cost !== null && config ? costLetters(cost, config) : '',
        stockValue: cost !== null ? Math.round(cost * qty * 100) / 100 : null,
      };
    }),
  });
});

// GET /api/accounts/po-orders?search=&missing=1&page= — one row per purchase order, with its value at cost
router.get('/po-orders', async (req: Request, res: Response) => {
  const search = String(req.query.search ?? '').trim();
  const page = pageOf(req.query.page);
  const contains = (field: string) => ({ [field]: { contains: search, mode: 'insensitive' } });
  const where: Prisma.PurchaseOrderWhereInput = {
    isDeleted: false,
    status: { not: 'CANCELLED' },
    ...(flag(req.query.missing) && { lines: { some: { cost: { is: null } } } }),
    ...(search && {
      OR: [
        contains('poNumber'), contains('supplierName'),
        { lines: { some: { OR: ['brand', 'quality', 'qualityName', 'shade', 'name', 'artNo', 'category'].map(contains) } } },
      ] as Prisma.PurchaseOrderWhereInput[],
    }),
  };
  const [total, orders, missingPos] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      select: {
        id: true, poNumber: true, supplierName: true, createdAt: true, status: true,
        lines: { select: { id: true, orderedQty: true, receivedQty: true, uom: true, cost: { select: { costPrice: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      ...rowsOf(req.query),
    }),
    prisma.purchaseOrder.count({ where: { isDeleted: false, status: { not: 'CANCELLED' }, lines: { some: { cost: { is: null } } } } }),
  ]);
  const lineIds = orders.flatMap(o => o.lines.map(l => l.id));
  const stock = lineIds.length ? await prisma.itemBatch.groupBy({
    by: ['poLineId'],
    where: { poLineId: { in: lineIds }, status: { in: [...IN_STOCK] }, quantity: { gt: 0 } },
    _sum: { quantity: true },
  }) : [];
  const inStock = new Map(stock.map(s => [s.poLineId, s._sum.quantity ?? 0]));
  const r2 = (n: number) => Math.round(n * 100) / 100;

  res.json({
    page, pageSize: PAGE_SIZE, total,
    summary: { missingPos },
    orders: orders.map(o => {
      let orderValue = 0, receivedValue = 0, stockValue = 0, withoutCost = 0;
      for (const l of o.lines) {
        const cost = money(l.cost?.costPrice);
        if (cost === null) { withoutCost++; continue; }
        orderValue += l.orderedQty * cost;
        receivedValue += l.receivedQty * cost;
        stockValue += (inStock.get(l.id) ?? 0) * cost;
      }
      return {
        id: o.id, poNumber: o.poNumber, supplierName: o.supplierName, poDate: o.createdAt, status: o.status,
        lines: o.lines.length, linesWithoutCost: withoutCost,
        orderValue: r2(orderValue), receivedValue: r2(receivedValue), stockValue: r2(stockValue),
      };
    }),
  });
});

router.put('/po-costs/:lineId', async (req: Request, res: Response) => {
  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: String(req.params.lineId) },
    include: { cost: true, po: { select: { id: true, poNumber: true, isDeleted: true } } },
  });
  if (!line || line.po.isDeleted) { res.status(404).json({ error: 'PO line not found' }); return; }

  const clearing = req.body?.costPrice === null || String(req.body?.costPrice ?? '').trim() === '';
  const parsed = clearing ? undefined : parseCostPrice(req.body.costPrice, 'Cost price');
  if (typeof parsed === 'string') { res.status(400).json({ error: parsed }); return; }

  const oldPrice = money(line.cost?.costPrice);
  const newPrice = parsed ?? null;
  if (oldPrice !== newPrice) {
    await prisma.$transaction(async (tx) => {
      if (newPrice === null) await tx.poLineCost.deleteMany({ where: { poLineId: line.id } });
      else await tx.poLineCost.upsert({
        where: { poLineId: line.id },
        create: { poLineId: line.id, costPrice: newPrice, updatedById: req.user!.userId },
        update: { costPrice: newPrice, updatedById: req.user!.userId },
      });
      await logCostChange(tx, { poId: line.po.id, poNumber: line.po.poNumber, lineLabel: poLineLabel(line), oldPrice, newPrice, source: 'ACCOUNTS' }, req.user!);
    });
  }
  const config = await costCodeConfig();
  res.json({ id: line.id, costPrice: newPrice, code: newPrice !== null && config ? costLetters(newPrice, config) : '' });
});

// ─── Direct Inward costs (rolls received without a PO) ──────────────────────
// A roll created by a customer return takes the cost of the roll it was shipped from, so it is
// not listed; nor is a receipt that was undone.

const directRoll: Prisma.ItemBatchWhereInput = { poLineId: null, receiptVoidedAt: null, customerReturnLines: { none: {} } };
const inStockRoll: Prisma.ItemBatchWhereInput = { status: { in: [...IN_STOCK] }, quantity: { gt: 0 } };

router.get('/direct-costs', async (req: Request, res: Response) => {
  const search = String(req.query.search ?? '').trim();
  const page = pageOf(req.query.page);
  const contains = (field: string) => ({ [field]: { contains: search, mode: 'insensitive' } });
  const where: Prisma.ItemBatchWhereInput = {
    ...directRoll,
    ...(flag(req.query.missing) && { cost: { is: null } }),
    ...(flag(req.query.inStock) && inStockRoll),
    ...(search && {
      OR: [
        ...['batchCode', 'invoiceRef', 'brand', 'quality', 'qualityName', 'shade', 'name', 'artNo', 'category'].map(contains),
        { grn: { is: { OR: [contains('supplierName'), contains('grnNumber')] } } },
      ] as Prisma.ItemBatchWhereInput[],
    }),
  };
  const [total, rolls, config] = await Promise.all([
    prisma.itemBatch.count({ where }),
    prisma.itemBatch.findMany({
      where,
      include: { cost: true, grn: { select: { grnNumber: true, supplierName: true } } },
      orderBy: [{ createdAt: 'desc' }, { batchCode: 'asc' }],
      ...rowsOf(req.query),
    }),
    costCodeConfig(),
  ]);
  res.json({
    page, pageSize: PAGE_SIZE, total,
    rolls: rolls.map(b => {
      const cost = money(b.cost?.costPrice);
      const inStock = IN_STOCK.includes(b.status as typeof IN_STOCK[number]) && b.quantity > 0;
      return {
        id: b.id, batchCode: b.batchCode, itemType: b.itemType, description: itemDescription(b) || b.itemType, uom: b.uom,
        quantity: b.quantity, inStock,
        supplierName: b.grn?.supplierName ?? null, grnNumber: b.grn?.grnNumber ?? null, invoiceRef: b.invoiceRef, receivedAt: b.createdAt,
        costPrice: cost,
        code: cost !== null && config ? costLetters(cost, config) : '',
        stockValue: cost !== null && inStock ? Math.round(cost * b.quantity * 100) / 100 : null,
      };
    }),
  });
});

// PUT /api/accounts/direct-costs { batchIds, costPrice } — one cost for one or many rolls; blank removes it
router.put('/direct-costs', async (req: Request, res: Response) => {
  const ids: unknown = req.body?.batchIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || ids.some(id => typeof id !== 'string')) {
    res.status(400).json({ error: 'Choose between 1 and 500 rolls.' });
    return;
  }
  const batchIds = [...new Set(ids as string[])];
  const clearing = req.body?.costPrice === null || String(req.body?.costPrice ?? '').trim() === '';
  const parsed = clearing ? undefined : parseCostPrice(req.body.costPrice, 'Cost price');
  if (typeof parsed === 'string') { res.status(400).json({ error: parsed }); return; }
  const newPrice = parsed ?? null;

  const rolls = await prisma.itemBatch.findMany({ where: { id: { in: batchIds }, ...directRoll }, include: { cost: true } });
  if (rolls.length !== batchIds.length) {
    res.status(400).json({ error: 'Some of these rolls take their cost from a PO line or a return, so it cannot be set here.' });
    return;
  }
  const changed = rolls.filter(b => money(b.cost?.costPrice) !== newPrice);
  if (changed.length) {
    await prisma.$transaction(async (tx) => {
      for (const b of changed) {
        if (newPrice === null) await tx.batchCost.deleteMany({ where: { batchId: b.id } });
        else await tx.batchCost.upsert({
          where: { batchId: b.id },
          create: { batchId: b.id, costPrice: newPrice, updatedById: req.user!.userId },
          update: { costPrice: newPrice, updatedById: req.user!.userId },
        });
        await logCostChange(tx, {
          lineLabel: `${itemDescription(b) || b.itemType} · ${b.batchCode}`,
          oldPrice: money(b.cost?.costPrice), newPrice, source: 'ACCOUNTS',
        }, req.user!);
      }
    }, { timeout: 60_000 });
  }
  res.json({ updated: changed.length });
});

// ─── Closing stock ──────────────────────────────────────────────────────────

const savedInfo = (s: { savedAt: Date; savedByName: string; totalValue: Prisma.Decimal } | null) =>
  s ? { savedAt: s.savedAt, savedByName: s.savedByName, totalValue: Number(s.totalValue) } : null;

router.get('/closing-stock/years', async (_req: Request, res: Response) => {
  const { ended, currentStarts } = await stockYears();
  const saved = await prisma.closingStock.findMany({
    where: { yearId: { in: ended.map(y => y.id) } },
    select: { yearId: true, savedAt: true, savedByName: true, totalValue: true },
  });
  const savedFor = new Map(saved.map(s => [s.yearId, s]));
  res.json({
    today: istDateKey(),
    currentStarts,
    ended: ended.map(y => ({ id: y.id, from: dayKey(y.startsOn), to: dayKey(y.endsOn), saved: savedInfo(savedFor.get(y.id) ?? null) })),
  });
});

/**
 * The closing stock asked for: an ended year (?yearId=: its saved lumps, else worked out now) or a
 * day (?asOn=YYYY-MM-DD, worked out now). Sends the refusal itself and returns null when it can't.
 */
async function closingFor(req: Request, res: Response) {
  if (req.query.yearId) {
    const year = await prisma.stockYear.findUnique({ where: { id: String(req.query.yearId) }, include: { closingStock: true } });
    if (!year) { res.status(404).json({ error: 'That year was not found.' }); return null; }
    const asOn = dayKey(year.endsOn);
    const meta = { asOn, from: dayKey(year.startsOn), yearId: year.id, saved: savedInfo(year.closingStock) };
    const lumps = (year.closingStock?.data as { lumps?: ClosingLump[] } | null)?.lumps;
    return { meta, lumps: lumps ?? await closingLumps(asOn) };
  }
  const asOn = req.query.asOn;
  if (!isDayKey(asOn)) { res.status(400).json({ error: 'Choose a date.' }); return null; }
  if (asOn > istDateKey()) { res.status(400).json({ error: 'Choose today or an earlier date.' }); return null; }
  return { meta: { asOn, saved: null }, lumps: await closingLumps(asOn) };
}

// GET /api/accounts/closing-stock?yearId=|asOn=&<filters> — valued by item, with the supplier list
router.get('/closing-stock', async (req: Request, res: Response) => {
  const found = await closingFor(req, res);
  if (!found) return;
  res.json({ ...found.meta, ...(await valueLumps(filterLumps(found.lumps, stockFilters(req.query)))), choices: lumpSuppliers(found.lumps) });
});

// GET /api/accounts/closing-stock/rolls?yearId=|asOn=&key=&<filters> — the lumps of one item then
router.get('/closing-stock/rolls', async (req: Request, res: Response) => {
  const key = String(req.query.key ?? '');
  if (!key || key.length > 600) { res.status(400).json({ error: 'Choose an item.' }); return; }
  const found = await closingFor(req, res);
  if (!found) return;
  res.json(filterLumps(found.lumps, stockFilters(req.query)).filter(l => l.key === key));
});

// GET /api/accounts/closing-stock/all-rolls?yearId=|asOn=&<filters> — every lump then (the Excel)
router.get('/closing-stock/all-rolls', async (req: Request, res: Response) => {
  const found = await closingFor(req, res);
  if (!found) return;
  res.json(filterLumps(found.lumps, stockFilters(req.query)));
});

// POST /api/accounts/closing-stock/:yearId/save — saves (again) at today's costs
router.post('/closing-stock/:yearId/save', async (req: Request, res: Response) => {
  const saved = await saveClosingStock(String(req.params.yearId), req.user!);
  if (!saved) { res.status(404).json({ error: 'That year was not found.' }); return; }
  res.json({ saved: savedInfo(saved) });
});

// ─── Secret code word ───────────────────────────────────────────────────────

router.get('/code-settings', async (_req: Request, res: Response) => {
  const row = await prisma.costCodeSettings.findUnique({ where: { id: 1 } });
  res.json(row ? { codeWord: row.codeWord, updatedAt: row.updatedAt } : { codeWord: '', updatedAt: null });
});

router.put('/code-settings', async (req: Request, res: Response) => {
  const config = normaliseCostCodeConfig(req.body ?? {});
  if (typeof config === 'string') { res.status(400).json({ error: config }); return; }
  await prisma.$transaction(async (tx) => {
    await tx.costCodeSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...config, updatedById: req.user!.userId },
      update: { ...config, updatedById: req.user!.userId },
    });
    await logCostChange(tx, { lineLabel: 'Secret code settings changed', source: 'CODE_SETTINGS' }, req.user!);
  });
  res.json(config);
});

// Codes for sample prices with the given (unsaved) settings, or the saved ones
router.post('/code-preview', async (req: Request, res: Response) => {
  const config = req.body?.settings ? normaliseCostCodeConfig(req.body.settings) : await costCodeConfig();
  if (!config) { res.status(400).json({ error: 'Set the secret code word first.' }); return; }
  if (typeof config === 'string') { res.status(400).json({ error: config }); return; }
  const prices = (Array.isArray(req.body?.prices) ? req.body.prices : [req.body?.price]).slice(0, 20).map(Number);
  if (prices.length === 0 || prices.some((p: number) => !Number.isFinite(p) || p < 0)) { res.status(400).json({ error: 'Enter a price.' }); return; }
  // The cost letters, and how three different rolls of that cost could look on their labels
  res.json({ codes: prices.map((p: number) => ({
    price: p,
    code: costLetters(p, config),
    examples: [1, 2, 3].map(n => encodeCost(p, config, `example-${p}-${n}`)),
  })) });
});

// ─── Code decoder ───────────────────────────────────────────────────────────

router.post('/decode', async (req: Request, res: Response) => {
  const config = await costCodeConfig();
  if (!config) { res.status(400).json({ error: 'The secret code word has not been set yet.' }); return; }
  const price = decodeCost(String(req.body?.code ?? ''), config);
  if (price === null) { res.status(400).json({ error: 'That is not a valid code for the current code word.' }); return; }
  res.json({ price });
});

// ─── Change log ─────────────────────────────────────────────────────────────

// Only what matters: a cost changed or removed, the code word changed, closing stock saved. A cost
// typed in for the first time (on a new PO, the Excel, or later) is recorded but not listed.
const LOG_SHOWN: Prisma.CostPriceLogWhereInput = { OR: [{ oldPrice: { not: null } }, { source: { in: ['CODE_SETTINGS', 'CLOSING_STOCK'] } }] };

router.get('/logs', async (req: Request, res: Response) => {
  const page = pageOf(req.query.page);
  const [total, rows] = await Promise.all([
    prisma.costPriceLog.count({ where: LOG_SHOWN }),
    prisma.costPriceLog.findMany({ where: LOG_SHOWN, orderBy: { changedAt: 'desc' }, ...rowsOf(req.query) }),
  ]);
  res.json({ page, pageSize: PAGE_SIZE, total, logs: rows.map(r => ({ ...r, oldPrice: money(r.oldPrice), newPrice: money(r.newPrice) })) });
});

// ─── Excel downloads ────────────────────────────────────────────────────────
// Files are made in the browser; each is recorded first (no record, no file). The log keeps
// who took what, never the figures.

const EXPORT_KINDS: Record<string, string> = { STOCK_VALUE: 'ACCOUNTS_STOCK_VALUE', CLOSING_STOCK: 'ACCOUNTS_CLOSING_STOCK' };

router.post('/export-log', async (req: Request, res: Response) => {
  const view = EXPORT_KINDS[String(req.body?.kind)];
  if (!view) { res.status(400).json({ error: 'Unknown export.' }); return; }
  const asOn = req.body?.asOn;
  // Sheet name → column headers, as the other exports record them
  const columns: Record<string, string[]> = {};
  const given = req.body?.columns;
  if (given && typeof given === 'object' && !Array.isArray(given)) {
    for (const [sheet, headers] of Object.entries(given).slice(0, 10)) {
      if (Array.isArray(headers)) columns[String(sheet).slice(0, 40)] = headers.slice(0, 40).map(h => String(h).slice(0, 60));
    }
  }
  await prisma.exportLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.name,
      view,
      filters: isDayKey(asOn) ? { asOnDate: asOn } : {},
      rowCount: Math.max(0, Number(req.body?.rowCount) || 0),
      columns,
    },
  });
  res.status(201).json({ ok: true });
});

export default router;
