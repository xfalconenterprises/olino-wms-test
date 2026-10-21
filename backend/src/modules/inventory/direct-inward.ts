import { Router, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';

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
    ? await prisma.itemBatch.findMany({ where: { id: { in: ids }, grnId: null } })
    : [];
  const byId = new Map(open.map(b => [b.id, b]));
  data.sessionBatches = ids.map(id => byId.get(id)).filter(Boolean);

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
  const saved = await prisma.directInwardDraft.upsert({
    where: { userId },
    create: { userId, data: data as Prisma.InputJsonValue },
    update: { data: data as Prisma.InputJsonValue },
  });
  res.json({ updatedAt: saved.updatedAt });
});

// DELETE /api/direct-inward/draft — nothing left to keep
router.delete('/draft', async (req: Request, res: Response) => {
  await prisma.directInwardDraft.deleteMany({ where: { userId: req.user!.userId } });
  res.json({ success: true });
});

export default router;
