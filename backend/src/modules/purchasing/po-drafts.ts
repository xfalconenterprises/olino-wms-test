import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parseCostPrice } from '../administration/cost-prices';

// Unfinished purchase orders. A draft belongs to the person who made it: every query here is
// limited to the logged-in user, whatever their access. Drafts have no PO number and nothing
// else reads this table, so they can't reach Stock In or reports. Costs stay in their own
// column and are never sent back: the screen only learns that a line has one.
const router = Router();
router.use(requireAuth, requirePermission('po.create'));

const ownDraft = (req: Request) => prisma.poDraft.findFirst({
  where: { id: String(req.params.id), userId: req.user!.userId },
});

/** Separates typed costs from the draft, keeping saved costs of lines left blank. */
function splitCosts(body: any, savedCosts: Record<string, number>) {
  const data = body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.poType) return 'Choose a product category first.';

  const costs: Record<string, number> = {};
  const lines = [];
  for (const [i, line] of (Array.isArray(data.lines) ? data.lines : []).entries()) {
    if (!line || typeof line !== 'object') return `Line ${i + 1} is not valid.`;
    const { costPrice, hasCost: _hasCost, ...rest } = line;
    const cost = parseCostPrice(costPrice, `Line ${i + 1}`);
    if (typeof cost === 'string') return cost;
    const draftKey = typeof line.draftKey === 'string' && line.draftKey ? line.draftKey : randomUUID();
    const kept = cost ?? savedCosts[draftKey];
    if (kept !== undefined) costs[draftKey] = kept;
    lines.push({ ...rest, draftKey });
  }
  return { data: { ...data, lines } as Prisma.InputJsonObject, costs };
}

// GET /api/po-drafts — the logged-in user's drafts, newest first
router.get('/', async (req: Request, res: Response) => {
  const drafts = await prisma.poDraft.findMany({
    where: { userId: req.user!.userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, data: true, updatedAt: true },
  });
  res.json(drafts.map(d => {
    const data = d.data as any;
    return {
      id: d.id,
      poType: data.poType,
      supplierName: data.form?.supplierName || null,
      lineCount: Array.isArray(data.lines) ? data.lines.length : 0,
      updatedAt: d.updatedAt,
    };
  }));
});

// GET /api/po-drafts/:id — one draft to carry on with
router.get('/:id', async (req: Request, res: Response) => {
  const draft = await ownDraft(req);
  if (!draft) { res.status(404).json({ error: 'This draft no longer exists.' }); return; }
  const data = draft.data as any;
  const costs = draft.costs as Record<string, number>;
  res.json({
    id: draft.id,
    updatedAt: draft.updatedAt,
    data: { ...data, lines: (data.lines ?? []).map((l: any) => ({ ...l, hasCost: costs[l.draftKey] !== undefined })) },
  });
});

// POST /api/po-drafts — saves a new draft
router.post('/', async (req: Request, res: Response) => {
  const split = splitCosts(req.body, {});
  if (typeof split === 'string') { res.status(400).json({ error: split }); return; }
  const draft = await prisma.poDraft.create({
    data: { userId: req.user!.userId, data: split.data, costs: split.costs },
    select: { id: true, updatedAt: true },
  });
  res.status(201).json(draft);
});

// PUT /api/po-drafts/:id — saves changes; a cost left blank keeps the saved one
router.put('/:id', async (req: Request, res: Response) => {
  const existing = await ownDraft(req);
  if (!existing) { res.status(404).json({ error: 'This draft no longer exists.' }); return; }
  const split = splitCosts(req.body, existing.costs as Record<string, number>);
  if (typeof split === 'string') { res.status(400).json({ error: split }); return; }
  const draft = await prisma.poDraft.update({
    where: { id: existing.id },
    data: { data: split.data, costs: split.costs },
    select: { id: true, updatedAt: true },
  });
  res.json(draft);
});

// DELETE /api/po-drafts/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = await prisma.poDraft.deleteMany({ where: { id: String(req.params.id), userId: req.user!.userId } });
  if (!removed.count) { res.status(404).json({ error: 'This draft no longer exists.' }); return; }
  res.json({ success: true });
});

export default router;
