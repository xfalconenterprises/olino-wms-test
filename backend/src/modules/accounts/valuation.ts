import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { istDayEnd, istDayStart } from '../../utils/format';
import { costsOfRolls, logCostChange } from '../administration/cost-prices';
import { itemDescription } from '../inventory/returns';

// Stock at cost, in rupees. Read only by the Accounts module (Cost Prices holders, unlocked).
// A roll's cost: its PO line's, else its own (Direct Inward), else that of the roll a customer
// return came from. Rolls with no cost are counted, never guessed.

export interface ValuedRoll {
  id: string; poLineId: string | null;
  itemType: string; category: string | null; brand: string | null; quality: string | null; qualityName: string | null;
  shade: string | null; size: string | null; name: string | null; artNo: string | null; uom: string;
  quantity: number; supplierName: string | null;
}

const ROLL_FIELDS = Prisma.sql`b.id, b."poLineId", b."itemType", b.category, b.brand, b.quality, b.quality_name AS "qualityName",
  b.shade, b.size, b.name, b."artNo", b.uom, COALESCE(g."supplierName", po."supplierName") AS "supplierName"`;
const SUPPLIER_JOINS = Prisma.sql`LEFT JOIN goods_receipt_notes g ON g.id = b."grnId"
  LEFT JOIN purchase_order_lines pl ON pl.id = b."poLineId"
  LEFT JOIN purchase_orders po ON po.id = pl."poId"`;

// ─── Filters (Stock Value), as on the Inventory screen ──────────────────────

export interface StockFilters {
  search?: string;      // SKU code, bundle, invoice, PO number, supplier, brand, quality, shade, item, art no, type
  from?: string;        // inward date, YYYY-MM-DD (IST)
  to?: string;
  status?: 'IN_STOCK' | 'PARTIALLY_USED' | 'QC_HOLD';
  supplier?: string;    // exact supplier name, or NONE
  source?: 'PO' | 'DIRECT' | 'RETURN';
  cost?: 'WITH' | 'WITHOUT';
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const text = (v: unknown, max = 100) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** The filters in a request's query (anything unknown is left out). */
export function stockFilters(q: Record<string, unknown>): StockFilters {
  const pick = <T extends string>(v: unknown, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : undefined);
  return {
    search: text(q.search), supplier: text(q.supplier, 200),
    from: isDay(q.from) ? q.from : undefined, to: isDay(q.to) ? q.to : undefined,
    status: pick(q.status, ['IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD'] as const),
    source: pick(q.source, ['PO', 'DIRECT', 'RETURN'] as const),
    cost: pick(q.cost, ['WITH', 'WITHOUT'] as const),
  };
}

function filterSql(f: StockFilters): Prisma.Sql[] {
  const where: Prisma.Sql[] = [];
  if (f.search) {
    const like = `%${f.search}%`;
    where.push(Prisma.sql`(b."batchCode" ILIKE ${like} OR b."supplierBundle" ILIKE ${like} OR b."invoiceRef" ILIKE ${like}
      OR b.brand ILIKE ${like} OR b.quality ILIKE ${like} OR b.quality_name ILIKE ${like} OR b.shade ILIKE ${like}
      OR b.name ILIKE ${like} OR b."artNo" ILIKE ${like} OR b.category ILIKE ${like} OR b.size ILIKE ${like}
      OR po."poNumber" ILIKE ${like} OR COALESCE(g."supplierName", po."supplierName") ILIKE ${like} OR b.client_name ILIKE ${like})`);
  }
  if (f.from) where.push(Prisma.sql`b."createdAt" >= ${istDayStart(f.from)!}`);
  if (f.to) where.push(Prisma.sql`b."createdAt" <= ${istDayEnd(f.to)!}`);
  if (f.status) where.push(Prisma.sql`b.status::text = ${f.status}`);
  if (f.supplier === 'NONE') where.push(Prisma.sql`COALESCE(g."supplierName", po."supplierName") IS NULL`);
  else if (f.supplier) where.push(Prisma.sql`COALESCE(g."supplierName", po."supplierName") = ${f.supplier}`);
  const fromReturn = Prisma.sql`EXISTS (SELECT 1 FROM customer_return_lines crl WHERE crl.batch_id = b.id)`;
  if (f.source === 'PO') where.push(Prisma.sql`b."poLineId" IS NOT NULL`);
  if (f.source === 'RETURN') where.push(Prisma.sql`b."poLineId" IS NULL AND ${fromReturn}`);
  if (f.source === 'DIRECT') where.push(Prisma.sql`b."poLineId" IS NULL AND NOT ${fromReturn}`);
  return where;
}

/** Every roll and pack in stock now, narrowed by the filters (all but the cost one: see filteredRolls). */
export function rollsInStock(f: StockFilters = {}): Promise<ValuedRoll[]> {
  const where = [Prisma.sql`b.status::text IN ('IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD') AND b.quantity > 0`, ...filterSql(f)];
  return prisma.$queryRaw<ValuedRoll[]>`
    SELECT ${ROLL_FIELDS}, b.quantity::float AS quantity
    FROM item_batches b ${SUPPLIER_JOINS}
    WHERE ${Prisma.join(where, ' AND ')}`;
}

/** Rolls in stock matching the filters, with their costs (the cost filter needs the costs). */
export async function filteredRolls(f: StockFilters) {
  const all = await rollsInStock(f);
  const costs = await costsOfRolls(all);
  const rolls = f.cost === 'WITH' ? all.filter(r => costs.has(r.id)) : f.cost === 'WITHOUT' ? all.filter(r => !costs.has(r.id)) : all;
  return { rolls, costs };
}

/** Suppliers that have stock now, for the Supplier filter. */
export async function filterChoices() {
  const rows = await prisma.$queryRaw<{ supplierName: string | null }[]>`
    SELECT DISTINCT COALESCE(g."supplierName", po."supplierName") AS "supplierName"
    FROM item_batches b ${SUPPLIER_JOINS}
    WHERE b.status::text IN ('IN_STOCK', 'PARTIALLY_USED', 'QC_HOLD') AND b.quantity > 0`;
  return {
    suppliers: [...new Set(rows.map(r => r.supplierName?.trim()).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b)),
    noSupplier: rows.some(r => !r.supplierName?.trim()),
  };
}

/**
 * Every roll in stock at the end of a day (IST), from its movements: each change to a roll's
 * quantity is a movement, so they add up to what it held that night.
 */
export function rollsOnDay(dayKey: string): Promise<ValuedRoll[]> {
  const end = istDayEnd(dayKey)!;
  return prisma.$queryRaw<ValuedRoll[]>`
    WITH q AS (
      SELECT t."batchId" AS id, SUM(CASE WHEN t.type = 'STOCK_IN' THEN t."quantityMoved" ELSE -t."quantityMoved" END) AS qty
      FROM transactions t
      WHERE t."createdAt" <= ${end} AND t.type <> 'INTERNAL_TRANSFER'
      GROUP BY 1
    )
    SELECT ${ROLL_FIELDS}, q.qty::float AS quantity
    FROM q JOIN item_batches b ON b.id = q.id ${SUPPLIER_JOINS}
    WHERE q.qty > 0.0005`;
}

/** Rolls of the same item (type, category, brand, quality, shade, size, name, art no, unit) share a key. */
export function itemKey(roll: Pick<ValuedRoll, 'itemType' | 'category' | 'brand' | 'quality' | 'qualityName' | 'shade' | 'size' | 'name' | 'artNo' | 'uom'>): string {
  return [roll.itemType || 'FABRIC', roll.category, roll.brand, roll.quality, roll.qualityName, roll.shade, roll.size, roll.name, roll.artNo, roll.uom || 'PCS']
    .map(v => (v ?? '').toString().trim().toUpperCase()).join('|');
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface ValuedItem {
  key: string;
  itemType: string; category: string | null; brand: string | null; quality: string | null; qualityName: string | null;
  shade: string | null; size: string | null; name: string | null; artNo: string | null; uom: string;
  description: string;
  quantity: number;          // all of it
  rolls: number;
  costedQuantity: number;    // the part with a cost
  value: number;
  rollsWithoutCost: number;
  costPerUnit: number | null;   // when every costed roll has the same cost
  averageCost: number | null;   // value ÷ costed quantity, when costs differ
  lowestCost: number | null;    // when costs differ (bought at different prices over time)
  highestCost: number | null;
  prices: number;               // how many different costs
}

interface Group { value: number; rolls: number; rollsWithoutCost: number }
export interface StockValuation {
  totals: Group & { costedRolls: number };
  byType: (Group & { itemType: string })[];
  items: ValuedItem[];
}

/** Values rolls at cost and groups them by item and item type. */
export async function valueRolls(rolls: ValuedRoll[], known?: Map<string, number>): Promise<StockValuation> {
  const costs = known ?? await costsOfRolls(rolls);
  const items = new Map<string, ValuedItem & { costs: Set<number> }>();
  const byType = new Map<string, Group>();
  const totals = { value: 0, rolls: 0, costedRolls: 0, rollsWithoutCost: 0 };
  const add = (g: Group, value: number, costed: boolean) => { g.value += value; g.rolls++; if (!costed) g.rollsWithoutCost++; };

  for (const roll of rolls) {
    const itemType = roll.itemType || 'FABRIC';
    const uom = roll.uom || 'PCS';
    const quantity = Number(roll.quantity) || 0;
    const cost = costs.get(roll.id);
    const costed = cost !== undefined;
    const value = costed ? quantity * cost : 0;

    const key = itemKey(roll);
    let item = items.get(key);
    if (!item) {
      item = {
        key, itemType, category: roll.category, brand: roll.brand, quality: roll.quality, qualityName: roll.qualityName,
        shade: roll.shade, size: roll.size, name: roll.name, artNo: roll.artNo, uom,
        description: itemDescription({ ...roll, itemType }) || itemType,
        quantity: 0, rolls: 0, costedQuantity: 0, value: 0, rollsWithoutCost: 0, costPerUnit: null, averageCost: null,
        lowestCost: null, highestCost: null, prices: 0,
        costs: new Set(),
      };
      items.set(key, item);
    }
    item.quantity += quantity;
    item.rolls++;
    if (costed) { item.costedQuantity += quantity; item.value += value; item.costs.add(cost); } else item.rollsWithoutCost++;

    add(byType.get(itemType) ?? (byType.set(itemType, { value: 0, rolls: 0, rollsWithoutCost: 0 }), byType.get(itemType)!), value, costed);
    totals.value += value; totals.rolls++;
    if (costed) totals.costedRolls++; else totals.rollsWithoutCost++;
  }

  const round = <T extends Group>(g: T): T => ({ ...g, value: r2(g.value) });
  return {
    totals: { ...totals, value: r2(totals.value) },
    byType: [...byType].map(([itemType, g]) => round({ itemType, ...g })).sort((a, b) => b.value - a.value),
    items: [...items.values()]
      .map(({ costs: set, ...i }) => ({
        ...i,
        quantity: r3(i.quantity),
        costedQuantity: r3(i.costedQuantity),
        value: r2(i.value),
        costPerUnit: set.size === 1 ? [...set][0] : null,
        averageCost: set.size > 1 && i.costedQuantity > 0 ? r2(i.value / i.costedQuantity) : null,
        lowestCost: set.size > 1 ? Math.min(...set) : null,
        highestCost: set.size > 1 ? Math.max(...set) : null,
        prices: set.size,
      }))
      .sort((a, b) => a.itemType.localeCompare(b.itemType) || a.description.localeCompare(b.description, undefined, { numeric: true })),
  };
}

const ddmmyyyy = (key: string) => key.split('-').reverse().join('-');

/**
 * Saves a year's closing stock at today's costs, so the books keep these figures even if a cost
 * is changed later. Done when the year is ended; can be done again from Accounts.
 */
export async function saveClosingStock(yearId: string, user: { userId: string; name: string }) {
  const year = await prisma.stockYear.findUnique({ where: { id: yearId } });
  if (!year) return null;
  const asOn = year.endsOn.toISOString().slice(0, 10);
  const lumps = await closingLumps(asOn);
  const valuation = await valueLumps(lumps);
  const data = { lumps } as unknown as Prisma.InputJsonValue;
  return prisma.$transaction(async (tx) => {
    const saved = await tx.closingStock.upsert({
      where: { yearId },
      create: { yearId, totalValue: valuation.totals.value, data, savedById: user.userId, savedByName: user.name },
      update: { totalValue: valuation.totals.value, data, savedById: user.userId, savedByName: user.name, savedAt: new Date() },
    });
    await logCostChange(tx, { lineLabel: `Closing stock as on ${ddmmyyyy(asOn)} saved`, newPrice: valuation.totals.value, source: 'CLOSING_STOCK' }, user);
    return saved;
  });
}

// ─── Received from suppliers, at cost ───────────────────────────────────────

interface MovedRoll { id: string; poLineId: string | null; supplierName: string | null;
  poId: string | null; poNumber: string | null; poDate: Date | null; invoiceRef: string | null; grnNumber: string | null; receivedAt: Date;
  received: number; supplierReturns: number }

/**
 * Per roll, between two days (IST, inclusive): what was received from the supplier and what was
 * returned to them, split as the Year-End Stock report splits movements.
 */
function movedRolls(fromKey: string, toKey: string): Promise<MovedRoll[]> {
  const start = istDayStart(fromKey)!, end = istDayEnd(toKey)!;
  return prisma.$queryRaw<MovedRoll[]>`
    WITH m AS (
      SELECT t."batchId",
        CASE WHEN t.type = 'STOCK_IN' THEN t."quantityMoved" ELSE -t."quantityMoved" END AS delta,
        CASE
          WHEN t."referenceType" = 'SUPPLIER_RETURN' THEN 'supplierReturns'
          WHEN t."referenceType" = 'RETURN_CANCELLED' AND t.type = 'STOCK_IN' THEN 'supplierReturns'
          WHEN t."referenceType" IN ('DELIVERY_CHALLAN', 'CUSTOMER_RETURN', 'RETURN_CANCELLED', 'SUPERVISOR_ADJUSTMENT', 'STOCK_COUNT') THEN 'other'
          WHEN t.type = 'STOCK_IN' OR t."referenceType" = 'RECEIPT_CORRECTION' THEN 'received'
          ELSE 'other'
        END AS bucket
      FROM transactions t
      WHERE t."createdAt" >= ${start} AND t."createdAt" <= ${end} AND t.type <> 'INTERNAL_TRANSFER'
    )
    SELECT b.id, b."poLineId", COALESCE(g."supplierName", po."supplierName") AS "supplierName",
      po.id AS "poId", po."poNumber" AS "poNumber", po."createdAt" AS "poDate", b."invoiceRef" AS "invoiceRef",
      g."grnNumber" AS "grnNumber", b."createdAt" AS "receivedAt",
      SUM(CASE WHEN m.bucket = 'received' THEN m.delta ELSE 0 END)::float AS received,
      (-SUM(CASE WHEN m.bucket = 'supplierReturns' THEN m.delta ELSE 0 END))::float AS "supplierReturns"
    FROM m JOIN item_batches b ON b.id = m."batchId" ${SUPPLIER_JOINS}
    WHERE m.bucket <> 'other'
    GROUP BY b.id, b."poLineId", 3, po.id, po."poNumber", po."createdAt", g."grnNumber"`;
}

/** What came in from suppliers between two days at today's costs, and what went back to them. */
export async function receivedAtCost(fromKey: string, toKey: string) {
  const moved = await movedRolls(fromKey, toKey);
  const costs = await costsOfRolls(moved);
  let received = 0, supplierReturns = 0;
  for (const r of moved) {
    const cost = costs.get(r.id);
    if (cost === undefined) continue;
    received += (Number(r.received) || 0) * cost;
    supplierReturns += (Number(r.supplierReturns) || 0) * cost;
  }
  return { from: fromKey, to: toKey, received: r2(received), supplierReturns: r2(supplierReturns) };
}

// ─── Lumps and packs with their costs ───────────────────────────────────────

/**
 * Rolls or packs in stock with their cost: those of one item (by its key), or all of them (for
 * the Excel). Each carries its item's details and key.
 */
export async function rollsAtCost(key?: string, f: StockFilters = {}) {
  const found = await filteredRolls(f);
  const costs = found.costs;
  const rolls = found.rolls.filter(r => !key || itemKey(r) === key);
  if (!rolls.length) return [];
  // Details in slices: a query can only carry so many ids
  const details: Awaited<ReturnType<typeof rollDetails>> = [];
  for (let i = 0; i < rolls.length; i += 5000) details.push(...await rollDetails(rolls.slice(i, i + 5000).map(r => r.id)));
  const byId = new Map(details.map(d => [d.id, d]));
  return rolls
    .map(r => {
      const b = byId.get(r.id);
      const cost = costs.get(r.id);
      return {
        id: r.id, key: itemKey(r),
        itemType: r.itemType || 'FABRIC', category: r.category, brand: r.brand, quality: r.quality, qualityName: r.qualityName,
        shade: r.shade, size: r.size, name: r.name, artNo: r.artNo,
        batchCode: b?.batchCode ?? '', bundle: b?.supplierBundle ?? null, status: b?.status ?? 'IN_STOCK',
        quantity: r.quantity, uom: r.uom, receivedAt: b?.createdAt ?? null, invoiceRef: b?.invoiceRef ?? null,
        supplierName: r.supplierName, shelves: b?.batchLocations.map(l => l.location.code) ?? [],
        // Where it came from: its PO, a customer return, or Direct Inward (no PO)
        origin: b?.poLine ? 'PO' : b?.customerReturnLines.length ? 'RETURN' : 'DIRECT',
        poNumber: b?.poLine?.po.poNumber ?? null, poId: b?.poLine?.po.id ?? null,
        costPrice: cost ?? null,
        value: cost !== undefined ? r2(r.quantity * cost) : null,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key) || a.batchCode.localeCompare(b.batchCode, undefined, { numeric: true }));
}

function rollDetails(ids: string[]) {
  return prisma.itemBatch.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, batchCode: true, supplierBundle: true, status: true, createdAt: true, invoiceRef: true,
      batchLocations: { where: { quantity: { gt: 0 } }, select: { location: { select: { code: true } } } },
      poLine: { select: { po: { select: { id: true, poNumber: true } } } },
      customerReturnLines: { select: { id: true }, take: 1 },
    },
  });
}

// ─── Purchases by supplier: received and ordered ────────────────────────────

/** POs raised between two days (IST), each with its value at cost (ordered quantity × the line's cost). */
async function ordersAtCost(fromKey: string, toKey: string) {
  const orders = await prisma.purchaseOrder.findMany({
    where: { isDeleted: false, status: { not: 'CANCELLED' }, createdAt: { gte: istDayStart(fromKey)!, lte: istDayEnd(toKey)! } },
    select: { id: true, poNumber: true, supplierName: true, createdAt: true, lines: { select: { orderedQty: true, cost: { select: { costPrice: true } } } } },
  });
  return orders.map(o => ({
    id: o.id, poNumber: o.poNumber, supplierName: o.supplierName, createdAt: o.createdAt,
    ordered: o.lines.reduce((sum, l) => sum + (l.cost ? l.orderedQty * Number(l.cost.costPrice) : 0), 0),
  }));
}

/** The value at cost of the POs raised between two days. */
export async function orderedAtCost(fromKey: string, toKey: string): Promise<number> {
  return r2((await ordersAtCost(fromKey, toKey)).reduce((sum, o) => sum + o.ordered, 0));
}

interface Amounts { received: number; ordered: number }
export interface SupplierSource extends Amounts {
  key: string; kind: 'PO' | 'DIRECT';
  poId: string | null; poNumber: string | null; invoiceRef: string | null; grnNumber: string | null;
  date: Date | null;
}
export interface SupplierPurchases extends Amounts { supplierName: string | null; lastReceived: Date | null; sources: SupplierSource[] }

/**
 * For each supplier, between two days: what was received at cost (less anything returned to
 * them) and what was ordered (POs raised in those days), split by PO and Direct Inward invoice.
 */
export async function supplierPurchases(fromKey: string, toKey: string) {
  const [moved, orders] = await Promise.all([movedRolls(fromKey, toKey), ordersAtCost(fromKey, toKey)]);
  const costs = await costsOfRolls(moved);
  const suppliers = new Map<string, SupplierPurchases & { sourceMap: Map<string, SupplierSource> }>();

  const supplierOf = (name: string | null) => {
    const k = (name ?? '').trim().toUpperCase();
    if (!suppliers.has(k)) suppliers.set(k, { supplierName: name?.trim() || null, received: 0, ordered: 0, lastReceived: null, sources: [], sourceMap: new Map() });
    return suppliers.get(k)!;
  };
  const sourceOf = (sup: SupplierPurchases & { sourceMap: Map<string, SupplierSource> }, init: Omit<SupplierSource, 'received' | 'ordered'>) => {
    if (!sup.sourceMap.has(init.key)) sup.sourceMap.set(init.key, { ...init, received: 0, ordered: 0 });
    return sup.sourceMap.get(init.key)!;
  };

  for (const r of moved) {
    const cost = costs.get(r.id);
    if (cost === undefined || (!r.received && !r.supplierReturns)) continue;
    const sup = supplierOf(r.supplierName);
    const src = sourceOf(sup, r.poId
      ? { key: `PO|${r.poId}`, kind: 'PO', poId: r.poId, poNumber: r.poNumber, invoiceRef: null, grnNumber: null, date: r.poDate }
      : { key: `DIRECT|${(r.invoiceRef || r.grnNumber || '').trim().toUpperCase()}`, kind: 'DIRECT', poId: null, poNumber: null, invoiceRef: r.invoiceRef, grnNumber: r.grnNumber, date: r.receivedAt });
    // A Direct Inward invoice is dated by its first roll
    if (!r.poId && src.date && r.receivedAt < src.date) src.date = r.receivedAt;
    const value = ((Number(r.received) || 0) - (Number(r.supplierReturns) || 0)) * cost;
    sup.received += value; src.received += value;
    if (r.received > 0 && (!sup.lastReceived || r.receivedAt > sup.lastReceived)) sup.lastReceived = r.receivedAt;
  }
  for (const o of orders) {
    if (!o.ordered) continue;
    const sup = supplierOf(o.supplierName);
    const src = sourceOf(sup, { key: `PO|${o.id}`, kind: 'PO', poId: o.id, poNumber: o.poNumber, invoiceRef: null, grnNumber: null, date: o.createdAt });
    sup.ordered += o.ordered; src.ordered += o.ordered;
  }

  const round = <T extends Amounts>(a: T): T => ({ ...a, received: r2(a.received), ordered: r2(a.ordered) });
  const list = [...suppliers.values()]
    .map(({ sourceMap, ...sup }) => round({
      ...sup,
      sources: [...sourceMap.values()].map(round)
        .filter(x => x.received || x.ordered)
        .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)),
    }))
    .filter(x => x.received || x.ordered)
    .sort((a, b) => b.received - a.received || b.ordered - a.ordered);
  const totals = round(list.reduce((t, x) => ({ received: t.received + x.received, ordered: t.ordered + x.ordered }), { received: 0, ordered: 0 }));
  return { totals, suppliers: list };
}

// ─── Closing stock: every lump as it stood at the end of a day ──────────────

export interface ClosingLump {
  id: string; key: string; poLineId: string | null;
  itemType: string; category: string | null; brand: string | null; quality: string | null; qualityName: string | null;
  shade: string | null; size: string | null; name: string | null; artNo: string | null; uom: string;
  quantity: number; supplierName: string | null;
  batchCode: string; bundle: string | null; invoiceRef: string | null; receivedAt: string | null;
  origin: 'PO' | 'DIRECT' | 'RETURN'; poNumber: string | null; poId: string | null;
  costPrice: number | null; value: number | null;
  shelves: string[];   // not kept for a past day
}

/** Every lump in stock at the end of a day, with its quantity then and its cost now. */
export async function closingLumps(dayKey: string): Promise<ClosingLump[]> {
  const rolls = await rollsOnDay(dayKey);
  if (!rolls.length) return [];
  const costs = await costsOfRolls(rolls);
  const details: Awaited<ReturnType<typeof rollDetails>> = [];
  for (let i = 0; i < rolls.length; i += 5000) details.push(...await rollDetails(rolls.slice(i, i + 5000).map(r => r.id)));
  const byId = new Map(details.map(d => [d.id, d]));
  return rolls
    .map(r => {
      const b = byId.get(r.id);
      const cost = costs.get(r.id);
      const quantity = r3(Number(r.quantity) || 0);
      return {
        id: r.id, key: itemKey(r), poLineId: r.poLineId,
        itemType: r.itemType || 'FABRIC', category: r.category, brand: r.brand, quality: r.quality, qualityName: r.qualityName,
        shade: r.shade, size: r.size, name: r.name, artNo: r.artNo, uom: r.uom || 'PCS',
        quantity, supplierName: r.supplierName,
        batchCode: b?.batchCode ?? '', bundle: b?.supplierBundle ?? null, invoiceRef: b?.invoiceRef ?? null,
        receivedAt: b?.createdAt ? b.createdAt.toISOString() : null,
        origin: (b?.poLine ? 'PO' : b?.customerReturnLines.length ? 'RETURN' : 'DIRECT') as ClosingLump['origin'],
        poNumber: b?.poLine?.po.poNumber ?? null, poId: b?.poLine?.po.id ?? null,
        costPrice: cost ?? null, value: cost !== undefined ? r2(quantity * cost) : null,
        shelves: [],
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key) || a.batchCode.localeCompare(b.batchCode, undefined, { numeric: true }));
}

/** The Stock Value filters (search, supplier, PO / Source, cost) on a list of lumps. */
export function filterLumps(lumps: ClosingLump[], f: StockFilters): ClosingLump[] {
  const q = f.search?.toLowerCase();
  const has = (v: string | null | undefined) => !!q && (v ?? '').toLowerCase().includes(q);
  return lumps.filter(l =>
    (!q || [l.batchCode, l.bundle, l.invoiceRef, l.poNumber, l.supplierName, l.brand, l.quality, l.qualityName, l.shade, l.name, l.artNo, l.category, l.size].some(has))
    && (!f.supplier || (f.supplier === 'NONE' ? !l.supplierName?.trim() : l.supplierName?.trim() === f.supplier))
    && (!f.source || l.origin === f.source)
    && (!f.cost || (f.cost === 'WITH' ? l.costPrice !== null : l.costPrice === null)));
}

/** Lumps valued and grouped by item and item type, with the costs they carry. */
export function valueLumps(lumps: ClosingLump[]): Promise<StockValuation> {
  const costs = new Map(lumps.filter(l => l.costPrice !== null).map(l => [l.id, l.costPrice as number]));
  return valueRolls(lumps, costs);
}

/** The suppliers among some lumps, for the Supplier filter. */
export function lumpSuppliers(lumps: ClosingLump[]) {
  return {
    suppliers: [...new Set(lumps.map(l => l.supplierName?.trim()).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b)),
    noSupplier: lumps.some(l => !l.supplierName?.trim()),
  };
}
