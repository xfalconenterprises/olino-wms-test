import prisma from '../lib/prisma';

/**
 * Rolls with `quantity` set to what arrived at the gate. A roll's quantity falls as it is cut or
 * dispatched, but a receipt records what came in, so it is read from the roll's STOCK_IN.
 */
export async function withReceivedQuantity<T extends { id: string; quantity: number }>(rolls: T[]): Promise<T[]> {
  const rows = await prisma.transaction.groupBy({
    by: ['batchId'],
    where: { batchId: { in: rolls.map(r => r.id) }, type: 'STOCK_IN' },
    _sum: { quantityMoved: true },
  });
  const received = new Map(rows.map(r => [r.batchId, r._sum.quantityMoved]));
  return rolls.map(r => ({ ...r, quantity: received.get(r.id) ?? r.quantity }));
}
