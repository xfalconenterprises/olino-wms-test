import type { Prisma } from '@prisma/client';

// Allocation rows use this name when a line has no specific client
const GENERAL_STOCK = 'general stock';

/**
 * Records a received quantity against a PO line's client allocations and returns the
 * client the roll should be earmarked for (null = general stock / no allocations).
 * A roll received for a named client fills that client's allocation; otherwise the
 * allocations fill in order, oldest first.
 */
export async function recordAllocationReceipt(
  tx: Prisma.TransactionClient,
  poLineId: string,
  qty: number,
  requested?: { clientId?: string | null; clientName?: string | null },
): Promise<{ clientId: string | null; clientName: string } | null> {
  const allocations = await tx.poLineAllocation.findMany({
    where: { poLineId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (allocations.length === 0) return null;

  const wantedName = (requested?.clientName || '').trim().toLowerCase();
  const target =
    allocations.find(a =>
      (requested?.clientId && a.clientId === requested.clientId) ||
      (wantedName && a.clientName.trim().toLowerCase() === wantedName)) ||
    allocations.find(a => a.receivedQty + 0.001 < a.allocatedQty) ||
    allocations[allocations.length - 1];

  const updated = await tx.poLineAllocation.update({
    where: { id: target.id },
    data: { receivedQty: { increment: qty } },
  });
  // Added-up decimals drift (2273.8999…); this update holds the row lock, so tidy it in place
  const tidy = Math.round(updated.receivedQty * 1000) / 1000;
  if (tidy !== updated.receivedQty) await tx.poLineAllocation.update({ where: { id: target.id }, data: { receivedQty: tidy } });

  if (target.clientName.trim().toLowerCase() === GENERAL_STOCK) return null;
  return { clientId: target.clientId, clientName: target.clientName };
}
