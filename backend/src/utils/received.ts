import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

// Stock that comes back in without being a receipt: never counted as "received"
const NOT_RECEIPTS = new Set(['SUPERVISOR_ADJUSTMENT', 'STOCK_COUNT', 'RETURN_CANCELLED']);

/** What arrived at the gate for each roll, after any receipt corrections. */
export async function receivedQuantities(batchIds: string[]): Promise<Map<string, number>> {
  const rows = await prisma.transaction.findMany({
    where: { batchId: { in: batchIds }, OR: [{ type: 'STOCK_IN' }, { referenceType: 'RECEIPT_CORRECTION' }] },
    select: { batchId: true, type: true, quantityMoved: true, referenceType: true },
  });
  const received = new Map<string, number>();
  for (const r of rows) {
    let change = 0;
    if (r.referenceType === 'RECEIPT_CORRECTION') change = r.type === 'STOCK_IN' ? r.quantityMoved : -r.quantityMoved;
    else if (r.type === 'STOCK_IN' && !NOT_RECEIPTS.has(r.referenceType ?? '')) change = r.quantityMoved;
    received.set(r.batchId, Math.round(((received.get(r.batchId) ?? 0) + change) * 1000) / 1000);
  }
  return received;
}

/**
 * Rolls with \`quantity\` set to what arrived at the gate. A roll's quantity falls as it is cut or
 * dispatched, but a receipt records what came in.
 */
export async function withReceivedQuantity<T extends { id: string; quantity: number }>(rolls: T[]): Promise<T[]> {
  const received = await receivedQuantities(rolls.map(r => r.id));
  return rolls.map(r => ({ ...r, quantity: received.get(r.id) ?? r.quantity }));
}

/**
 * The first dispatch or return to supplier that still stands for a roll, or null. A return to the
 * supplier that was later cancelled counts as never having happened.
 */
export async function lastingUse(tx: Prisma.TransactionClient, batchId: string) {
  const uses = await tx.transaction.findMany({
    where: { batchId, type: { in: ['STOCK_OUT', 'PARTIAL_CUT'] }, referenceType: { in: ['DELIVERY_CHALLAN', 'SUPPLIER_RETURN'] } },
    select: { referenceType: true, referenceId: true },
  });
  const returnNumbers = uses.filter(u => u.referenceType === 'SUPPLIER_RETURN' && u.referenceId).map(u => u.referenceId!);
  const cancelled = returnNumbers.length === 0 ? new Set<string>() : new Set((await tx.supplierReturn.findMany({
    where: { returnNumber: { in: returnNumbers }, cancelledAt: { not: null } },
    select: { returnNumber: true },
  })).map(r => r.returnNumber));
  return uses.find(u => !(u.referenceType === 'SUPPLIER_RETURN' && cancelled.has(u.referenceId ?? ''))) ?? null;
}

/**
 * True when goods came in but their GRN isn't finalized yet: they aren't accepted into stock, so
 * they can't be dispatched or returned. Rolls from a customer return never get a GRN.
 */
export async function awaitingGrn(db: Prisma.TransactionClient, batch: { id: string; grnId: string | null }) {
  if (batch.grnId) return false;
  return !(await db.customerReturnLine.findFirst({ where: { batchId: batch.id }, select: { id: true } }));
}
