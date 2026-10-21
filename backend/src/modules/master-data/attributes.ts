import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

// Fixed fabric classification used by PO validation and reports (not learned data)
const FABRIC_CATEGORIES = ['SUITING', 'SHIRTING', 'PLAIN_SHIRTING'];

// ─── GET /api/master-data ───────────────────────────────────────────────────
// Returns all learned attributes, or a flat list for one type, for live autocomplete
router.get('/', async (req: Request, res: Response) => {
  try {
    const { type, search } = req.query;

    const where: any = {};
    if (type && typeof type === 'string') {
      where.type = type.toUpperCase();
    }
    if (search && typeof search === 'string') {
      where.value = { contains: search.trim(), mode: 'insensitive' };
    }

    const items = await prisma.masterAttribute.findMany({
      where,
      orderBy: [{ usageCount: 'desc' }, { value: 'asc' }],
    });

    // If detailed list is requested (e.g. for Master Attributes Admin Page)
    if (req.query.detailed === 'true') {
      res.json(items);
      return;
    }

    // If specific type was requested, return flat list of strings
    if (type) {
      res.json(items.map(i => i.value));
      return;
    }

    // Otherwise group into dictionary: { BRAND: [...], QUALITY: [...], ... }
    const grouped: Record<string, string[]> = {
      BRAND: [],
      QUALITY: [],
      SHADE: [],
      ITEM_NAME: [],
      ART_NO: [],
      FABRIC_TYPE: [],
      ACCESSORY_CATEGORY: [],
      CATEGORY: FABRIC_CATEGORIES,
    };

    for (const item of items) {
      if (!grouped[item.type]) {
        grouped[item.type] = [];
      }
      if (!grouped[item.type].includes(item.value)) {
        grouped[item.type].push(item.value);
      }
    }

    res.json(grouped);
  } catch (error: any) {
    console.error('Error fetching master attributes:', error);
    res.status(500).json({ error: 'Failed to fetch master attributes' });
  }
});

// ─── POST /api/master-data/attributes ─────────────────────────────────────────
// Learn a single attribute word
router.post('/', requirePermission('admin.items'), async (req: Request, res: Response) => {
  try {
    const { type, value, category } = req.body;
    if (!type || !value || !value.trim()) {
      res.status(400).json({ error: 'type and value are required' });
      return;
    }

    const cleanType = String(type).trim().toUpperCase();
    const cleanValue = String(value).trim();

    const existing = await prisma.masterAttribute.findUnique({
      where: { type_value: { type: cleanType, value: cleanValue } },
    });

    if (existing) {
      const updated = await prisma.masterAttribute.update({
        where: { id: existing.id },
        data: { usageCount: { increment: 1 } },
      });
      res.json({ ...updated, isNew: false });
      return;
    }

    const created = await prisma.masterAttribute.create({
      data: {
        type: cleanType,
        value: cleanValue,
        category: category ? String(category).trim() : null,
        usageCount: 1,
      },
    });

    res.status(201).json({ ...created, isNew: true });
  } catch (error: any) {
    console.error('Error learning master attribute:', error);
    res.status(500).json({ error: 'Failed to save master attribute' });
  }
});

// ─── POST /api/master-data/attributes/batch-learn ────────────────────────────
// Auto-learns multiple attributes from a Purchase Order or Inward receipt
export async function autoLearnAttributes(items: Array<{ type: string; value?: string | null; category?: string | null }>) {
  for (const item of items) {
    if (!item.value || !item.value.trim() || !item.type) continue;
    const cleanType = item.type.toUpperCase();
    const cleanVal = item.value.trim();
    try {
      await prisma.masterAttribute.upsert({
        where: { type_value: { type: cleanType, value: cleanVal } },
        create: {
          type: cleanType,
          value: cleanVal,
          category: item.category || null,
          usageCount: 1,
        },
        update: {
          usageCount: { increment: 1 },
        },
      });
    } catch {
      // Ignore parallel upsert conflict
    }
  }
}

router.post('/batch-learn', requirePermission('po.create', 'ops.entry_gate', 'admin.items'), async (req: Request, res: Response) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'items array is required' });
      return;
    }

    await autoLearnAttributes(items);
    res.json({ success: true, learnedCount: items.length });
  } catch (error: any) {
    console.error('Error batch learning master attributes:', error);
    res.status(500).json({ error: 'Failed to batch learn attributes' });
  }
});

// ─── PUT /api/master-data/attributes/:id ────────────────────────────────────
router.put('/:id', requirePermission('admin.items'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { value, category, type } = req.body;
    const updated = await prisma.masterAttribute.update({
      where: { id: id as string },
      data: {
        ...(value ? { value: String(value).trim() } : {}),
        ...(category !== undefined ? { category: category ? String(category).trim() : null } : {}),
        ...(type ? { type: String(type).trim().toUpperCase() } : {}),
      },
    });
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating master attribute:', error);
    res.status(500).json({ error: 'Failed to update master attribute' });
  }
});

// ─── DELETE /api/master-data/attributes/:id ──────────────────────────────────
router.delete('/:id', requirePermission('admin.items'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.masterAttribute.delete({ where: { id: id as string } });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting master attribute:', error);
    res.status(500).json({ error: 'Failed to delete master attribute' });
  }
});

export default router;
