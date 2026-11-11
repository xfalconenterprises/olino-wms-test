import argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { encodeCost, type CostCodeConfig } from '../../utils/cost-code';
import { itemDescription } from '../inventory/returns';

// Cost helpers shared by purchase orders, Direct Inward, labels, Inventory and Accounts. Costs in
// rupees are read only in the Accounts module (Cost Prices permission, unlocked with the password).


// ─── Shared with purchase orders and labels ─────────────────────────────────

/** A cost as typed on a PO line: undefined when left blank, a message when invalid. */
export function parseCostPrice(value: unknown, label: string): number | undefined | string {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n >= 1e10) return `${label}: enter a cost price above 0.`;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return `${label}: cost price can have at most 2 decimals.`;
  return Math.round(n * 100) / 100;
}

export async function logCostChange(
  tx: Prisma.TransactionClient,
  entry: { poId?: string | null; poNumber?: string | null; lineLabel: string; oldPrice?: number | null; newPrice?: number | null; source: string },
  user: { userId: string; name: string },
) {
  await tx.costPriceLog.create({
    data: { ...entry, oldPrice: entry.oldPrice ?? null, newPrice: entry.newPrice ?? null, changedById: user.userId, changedByName: user.name },
  });
}

export function poLineLabel(line: Parameters<typeof itemDescription>[0]): string {
  return itemDescription(line) || line.itemType;
}

async function loadConfig(): Promise<CostCodeConfig | null> {
  const row = await prisma.costCodeSettings.findUnique({ where: { id: 1 } });
  return row ? { codeWord: row.codeWord } : null;
}
export const costCodeConfig = loadConfig;

type Roll = { id: string; poLineId: string | null };

/**
 * A roll's cost per unit in rupees, or null. A roll received against a PO line takes that line's
 * cost; a roll received without a PO takes its own (Direct Inward Excel); a roll created by a
 * customer return takes the cost of the roll it was shipped from. Never sent to a screen.
 */
async function costOfRoll(roll: Roll): Promise<number | null> {
  let current: Roll | null = roll;
  for (let hops = 0; current && hops < 6; hops++) {
    if (current.poLineId) {
      const cost = await prisma.poLineCost.findUnique({ where: { poLineId: current.poLineId } });
      return cost ? Number(cost.costPrice) : null;
    }
    const own = await prisma.batchCost.findUnique({ where: { batchId: current.id } });
    if (own) return Number(own.costPrice);
    const returned: { dcLine: { batch: Roll } } | null = await prisma.customerReturnLine.findFirst({
      where: { batchId: current.id },
      select: { dcLine: { select: { batch: { select: { id: true, poLineId: true } } } } },
    });
    current = returned?.dcLine.batch ?? null;
  }
  return null;
}

/** The same for many rolls at once: roll id → cost (rolls without a cost are left out). */
export async function costsOfRolls(rolls: Roll[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (rolls.length === 0) return result;
  const lineIds = [...new Set(rolls.map(r => r.poLineId).filter((id): id is string => !!id))];
  const lineCosts = new Map((lineIds.length ? await prisma.poLineCost.findMany({ where: { poLineId: { in: lineIds } } }) : [])
    .map(c => [c.poLineId, Number(c.costPrice)]));
  const withoutLine = rolls.filter(r => !r.poLineId).map(r => r.id);
  const ownCosts = new Map((withoutLine.length ? await prisma.batchCost.findMany({ where: { batchId: { in: withoutLine } } }) : [])
    .map(c => [c.batchId, Number(c.costPrice)]));
  const rest: string[] = [];
  for (const r of rolls) {
    const cost = r.poLineId ? lineCosts.get(r.poLineId) : ownCosts.get(r.id);
    if (cost !== undefined) result.set(r.id, cost);
    else if (!r.poLineId) rest.push(r.id);
  }
  // Rolls made by a customer return (few): followed back one by one
  if (rest.length) {
    const returned = await prisma.customerReturnLine.findMany({ where: { batchId: { in: rest } }, select: { batchId: true } });
    for (const { batchId } of returned) {
      const cost = await costOfRoll({ id: batchId, poLineId: null });
      if (cost !== null) result.set(batchId, cost);
    }
  }
  return result;
}

/** The secret cost code for a roll's label ('' when no code word is set or no cost was entered). */
export async function costCodeForBatch(batch: { id: string; poLineId: string | null; batchCode: string }): Promise<string> {
  const config = await loadConfig();
  if (!config) return '';
  const costPrice = await costOfRoll(batch);
  // Decoys are chosen for the roll being labelled, so each roll's code looks different
  return costPrice !== null ? encodeCost(costPrice, config, batch.batchCode) : '';
}

// ─── Unlock ─────────────────────────────────────────────────────────────────

const failedUnlocks = new Map<string, { count: number; lockedUntil: number }>();
const MAX_UNLOCK_ATTEMPTS = 5;

/**
 * Checks a user's own password before a confidential action, and refuses after too many wrong
 * tries. Returns the refusal, or null when the password is right.
 */
export async function ownPasswordRefusal(userId: string, username: string, password: unknown): Promise<{ status: number; error: string } | null> {
  const record = failedUnlocks.get(userId);
  if (record && Date.now() < record.lockedUntil) {
    return { status: 429, error: `Too many wrong passwords. Try again in ${Math.ceil((record.lockedUntil - Date.now()) / 60000)} minute(s).` };
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const valid = Boolean(user && password && await argon2.verify(user.passwordHash, String(password)));
  if (!valid) {
    const cur = record ?? { count: 0, lockedUntil: 0 };
    cur.count++;
    if (cur.count >= MAX_UNLOCK_ATTEMPTS) {
      cur.lockedUntil = Date.now() + 15 * 60 * 1000;
      cur.count = 0;
    }
    failedUnlocks.set(userId, cur);
    console.warn(`[COST] Wrong password from '${username}'`);
    return { status: 403, error: 'Incorrect password.' };
  }
  failedUnlocks.delete(userId);
  return null;
}
