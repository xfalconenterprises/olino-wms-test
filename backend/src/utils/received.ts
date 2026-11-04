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
