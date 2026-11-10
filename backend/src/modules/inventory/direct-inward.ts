import { Router, Request, Response } from 'express';
import { withReceivedQuantity } from '../../utils/received';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parseCostPrice } from '../administration/cost-prices';

// Drafts for the Direct Inward Desk: one per user, so imported Excel items and lumps not yet on a
// GRN survive leaving the page, a refresh or another device. The screen decides the content.
const router = Router();
router.use(requireAuth, requirePermission('ops.entry_gate'));

// GET /api/direct-inward/draft — the user's unfinished work, or null.
// Lumps already put on a GRN (or gone) are dropped; the rest are reloaded so quantities are current.
router.get('/draft', async (req: Request, res: Response) => {
  const draft = await prisma.directInwardDraft.findUnique({ where: { userId: req.user!.userId } });
  if (!draft) { res.json({ draft: null }); return; }

  const data = { ...(draft.data as Record<string, unknown>) };
  const saved = Array.isArray(data.sessionBatches) ? data.sessionBatches : [];
  const ids = saved.map((b: any) => b?.id).filter((id: unknown): id is string => typeof id === 'string');
  const open = ids.length > 0
    ? await withReceivedQuantity(await prisma.itemBatch.findMany({ where: { id: { in: ids }, grnId: null, receiptVoidedAt: null } }))
    : [];
  const byId = new Map(open.map(b => [b.id, b]));
  // Which Excel line each lump came from is the screen's own note; it is kept as saved
  const lineOf = new Map(saved.map((b: any) => [b?.id, typeof b?.importLineId === 'string' ? b.importLineId : undefined]));
  data.sessionBatches = ids.map(id => {
    const row = byId.get(id);
    const importLineId = lineOf.get(id);
    return row && importLineId ? { ...row, importLineId } : row;
  }).filter(Boolean);

  res.json({ draft: { data, updatedAt: draft.updatedAt } });
});

// PUT /api/direct-inward/draft — save the user's draft (replaces the previous one)
router.put('/draft', async (req: Request, res: Response) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    res.status(400).json({ error: 'Draft data must be an object' });
    return;
  }
  const userId = req.user!.userId;

  // Excel cost prices are kept apart from the draft (which is sent back to the screen): new ones are
  // added to those already kept, and only lines still in the list keep theirs
  const lines: any[] = Array.isArray(data.importLines) ? data.importLines : [];
  data.importLines = lines.map(l => {
    if (!l || typeof l !== 'object') return l;
    const { costPrice: _hidden, ...rest } = l;
    return rest;
  });
  const lineIds = new Set(lines.map(l => l?.id).filter((id): id is string => typeof id === 'string'));
  const existing = await prisma.directInwardDraft.findUnique({ where: { userId }, select: { costs: true } });
  const incoming = req.body?.costs && typeof req.body.costs === 'object' && !Array.isArray(req.body.costs) ? req.body.costs : {};
  const costs: Record<string, number> = {};
  for (const [id, value] of Object.entries({ ...((existing?.costs as Record<string, unknown>) ?? {}), ...incoming })) {
    const price = parseCostPrice(value, 'Cost price');
    if (lineIds.has(id) && typeof price === 'number') costs[id] = price;
  }

  const saved = await prisma.directInwardDraft.upsert({
    where: { userId },
    create: { userId, data: data as Prisma.InputJsonValue, costs },
    update: { data: data as Prisma.InputJsonValue, costs },
  });
  res.json({ updatedAt: saved.updatedAt });
});

// DELETE /api/direct-inward/draft — nothing left to keep
router.delete('/draft', async (req: Request, res: Response) => {
  await prisma.directInwardDraft.deleteMany({ where: { userId: req.user!.userId } });
  res.json({ success: true });
});

export default router;
