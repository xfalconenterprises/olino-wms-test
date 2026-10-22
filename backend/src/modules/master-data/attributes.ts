import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { FABRIC_UNITS, fabricCategoryCode, fabricCategoryLabel } from '../../utils/units';

const router = Router();
router.use(requireAuth);

// Fabric types (Suiting, Shirting, Knits…) are master data with a unit each: METERS or KG.
// Their code is stored on PO lines and rolls, so a type in use keeps its code and unit.
const FABRIC_CATEGORY = 'FABRIC_CATEGORY';

// Alphabetical, with "Other" last
const byFabricOrder = (a: { value: string }, b: { value: string }) =>
  (a.value === 'OTHER' ? 1 : 0) - (b.value === 'OTHER' ? 1 : 0) || a.value.localeCompare(b.value);

/** How many PO lines and rolls use a fabric type code. */
async function fabricCategoryUsage(code: string): Promise<number> {
  const [lines, batches] = await Promise.all([
    prisma.purchaseOrderLine.count({ where: { itemType: 'FABRIC', category: code } }),
    prisma.itemBatch.count({ where: { itemType: 'FABRIC', category: code } }),
  ]);
  return lines + batches;
}

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
    const fabricCategories = items.filter(i => i.type === FABRIC_CATEGORY).sort(byFabricOrder);

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
    // CATEGORY lists fabric type codes; FABRIC_CATEGORIES adds each type's label and unit
    const grouped: Record<string, any[]> = {
      BRAND: [],
      QUALITY: [],
      QUALITY_NAME: [],
      SHADE: [],
      ITEM_NAME: [],
      ART_NO: [],
      FABRIC_TYPE: [],
      ACCESSORY_CATEGORY: [],
      CATEGORY: fabricCategories.map(c => c.value),
      FABRIC_CATEGORIES: fabricCategories.map(c => ({ value: c.value, label: fabricCategoryLabel(c.value), unit: c.unit === 'KG' ? 'KG' : 'METERS' })),
    };

    for (const item of items) {
      if (item.type === FABRIC_CATEGORY) continue;
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
    let cleanValue = String(value).trim();

    // A new fabric type needs a code and how it is measured
    if (cleanType === FABRIC_CATEGORY) {
      cleanValue = fabricCategoryCode(cleanValue);
      const unit = String(req.body.unit ?? '').toUpperCase();
      if (!cleanValue) { res.status(400).json({ error: 'Enter the fabric type name' }); return; }
      if (!(FABRIC_UNITS as readonly string[]).includes(unit)) { res.status(400).json({ error: 'Choose how this fabric is measured: meters or kg' }); return; }
      const clash = await prisma.masterAttribute.findUnique({ where: { type_value: { type: FABRIC_CATEGORY, value: cleanValue } } });
      if (clash) { res.status(409).json({ error: `Fabric type "${fabricCategoryLabel(cleanValue)}" already exists` }); return; }
      const created = await prisma.masterAttribute.create({ data: { type: FABRIC_CATEGORY, value: cleanValue, unit, usageCount: 0 } });
      res.status(201).json({ ...created, isNew: true });
      return;
    }

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
    if (cleanType === FABRIC_CATEGORY) continue; // fabric types are only added in the master catalogue
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

    const current = await prisma.masterAttribute.findUnique({ where: { id: id as string } });
    if (!current) { res.status(404).json({ error: 'Attribute not found' }); return; }
    if ((type && String(type).toUpperCase() !== current.type) && (current.type === FABRIC_CATEGORY || String(type).toUpperCase() === FABRIC_CATEGORY)) {
      res.status(400).json({ error: 'Fabric types cannot be turned into other attributes or back' });
      return;
    }
    if (current.type === FABRIC_CATEGORY) {
      const newCode = value ? fabricCategoryCode(String(value)) : current.value;
      const newUnit = req.body.unit ? String(req.body.unit).toUpperCase() : current.unit;
      if (!newCode) { res.status(400).json({ error: 'Enter the fabric type name' }); return; }
      if (!(FABRIC_UNITS as readonly string[]).includes(newUnit ?? '')) { res.status(400).json({ error: 'Choose meters or kg' }); return; }
      if ((newCode !== current.value || newUnit !== current.unit) && await fabricCategoryUsage(current.value) > 0) {
        res.status(409).json({ error: `${fabricCategoryLabel(current.value)} is already used on purchase orders or stock, so its name and unit cannot change.` });
        return;
      }
      const updatedType = await prisma.masterAttribute.update({ where: { id: current.id }, data: { value: newCode, unit: newUnit } });
      res.json(updatedType);
      return;
    }

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
    const current = await prisma.masterAttribute.findUnique({ where: { id: id as string } });
    if (!current) { res.status(404).json({ error: 'Attribute not found' }); return; }
    if (current.type === FABRIC_CATEGORY && await fabricCategoryUsage(current.value) > 0) {
      res.status(409).json({ error: `${fabricCategoryLabel(current.value)} is used on purchase orders or stock and cannot be deleted.` });
      return;
    }
    await prisma.masterAttribute.delete({ where: { id: id as string } });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting master attribute:', error);
    res.status(500).json({ error: 'Failed to delete master attribute' });
  }
});

export default router;
