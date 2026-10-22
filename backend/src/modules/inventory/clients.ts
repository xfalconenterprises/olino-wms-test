import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);

// Helper to generate sequential client code: CLI-0001, CLI-0002...
async function generateNextClientCode(): Promise<string> {
  const prefix = 'CLI-';
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT code FROM clients WHERE code LIKE 'CLI-%' ORDER BY code DESC LIMIT 1
    `);

    let nextNum = 1;
    if (rows.length > 0 && rows[0].code) {
      const parts = rows[0].code.split('-');
      const parsed = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(parsed)) {
        nextNum = parsed + 1;
      }
    }

    let code = `${prefix}${String(nextNum).padStart(4, '0')}`;
    let exists: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM clients WHERE code = $1 LIMIT 1`, code);
    while (exists.length > 0) {
      nextNum++;
      code = `${prefix}${String(nextNum).padStart(4, '0')}`;
      exists = await prisma.$queryRawUnsafe(`SELECT id FROM clients WHERE code = $1 LIMIT 1`, code);
    }
    return code;
  } catch {
    return `${prefix}${Date.now().toString().slice(-4)}`;
  }
}

// ─── GET /api/clients ────────────────────────────────────────────────────────
// Returns all clients with aggregated shipment stats
router.get('/', requirePermission('admin.clients', 'po.create', 'ops.entry_gate', 'inv.dashboard'), async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ALL';

    let query = `
      SELECT 
        c.id,
        c.code,
        c.name,
        c.client_type as "clientType",
        c.contact_person as "contactPerson",
        c.phone,
        c.email,
        c.address,
        c.city,
        c.state,
        c.gstin,
        c.notes,
        c.is_active as "isActive",
        c.created_at as "createdAt",
        c.updated_at as "updatedAt",
        COUNT(DISTINCT dc."id")::int as "totalShipments",
        COALESCE(SUM(CASE WHEN (b."itemType" = 'FABRIC' OR b."itemType" IS NULL) AND COALESCE(b.uom, 'METERS') <> 'KG' THEN dcl."quantity" ELSE 0 END), 0)::float as "totalFabricMeters",
        COALESCE(SUM(CASE WHEN b."itemType" = 'FABRIC' AND b.uom = 'KG' THEN dcl."quantity" ELSE 0 END), 0)::float as "totalFabricKg",
        COALESCE(SUM(CASE WHEN b."itemType" <> 'FABRIC' AND b."itemType" IS NOT NULL THEN dcl."quantity" ELSE 0 END), 0)::float as "totalOtherUnits",
        MAX(dc."dispatchedAt") as "lastDispatchedAt"
      FROM clients c
      LEFT JOIN delivery_challans dc ON (
        (dc.customer_id = c.id OR LOWER(TRIM(dc."customerName")) = LOWER(TRIM(c.name)))
        AND (dc.is_deleted = false OR dc.is_deleted IS NULL)
      )
      LEFT JOIN delivery_challan_lines dcl ON dc."id" = dcl."dcId"
      LEFT JOIN item_batches b ON dcl."batchId" = b."id"
      WHERE 1=1
    `;

    const params: any[] = [];
    let pIdx = 1;

    if (status === 'ACTIVE') {
      query += ` AND c.is_active = true`;
    } else if (status === 'INACTIVE') {
      query += ` AND c.is_active = false`;
    }

    if (search) {
      query += ` AND (
        c.name ILIKE $${pIdx} OR 
        c.code ILIKE $${pIdx} OR 
        c.client_type ILIKE $${pIdx} OR 
        c.city ILIKE $${pIdx} OR 
        c.contact_person ILIKE $${pIdx} OR 
        c.phone ILIKE $${pIdx}
      )`;
      params.push(`%${search}%`);
      pIdx++;
    }

    query += `
      GROUP BY c.id, c.code, c.name, c.client_type, c.contact_person, c.phone, c.email, c.address, c.city, c.state, c.gstin, c.notes, c.is_active, c.created_at, c.updated_at
      ORDER BY c.name ASC
    `;

    const clients: any[] = await prisma.$queryRawUnsafe(query, ...params);

    const formatted = clients.map(c => ({
      id: c.id,
      code: c.code,
      name: c.name,
      clientType: c.clientType || null,
      contactPerson: c.contactPerson,
      phone: c.phone,
      email: c.email,
      address: c.address,
      city: c.city,
      state: c.state,
      gstin: c.gstin,
      notes: c.notes,
      isActive: c.isActive,
      totalShipments: c.totalShipments || 0,
      totalFabricMeters: Math.round((c.totalFabricMeters || 0) * 10) / 10,
      totalFabricKg: Math.round((c.totalFabricKg || 0) * 100) / 100,
      totalOtherUnits: Math.round(c.totalOtherUnits || 0),
      lastDispatchedAt: c.lastDispatchedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    res.json(formatted);
  } catch (err: any) {
    console.error('Failed to get clients:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clients/:id ────────────────────────────────────────────────────
// Returns single client details with recent delivery challans history
router.get('/:id', requirePermission('admin.clients'), async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const clientRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        id, code, name, client_type as "clientType", contact_person as "contactPerson", phone, email, 
        address, city, state, gstin, notes, is_active as "isActive", 
        created_at as "createdAt", updated_at as "updatedAt"
      FROM clients 
      WHERE id = $1 LIMIT 1
    `, id);

    if (clientRows.length === 0) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const client = clientRows[0];

    // Fetch all delivery challans for this client
    const challans = await prisma.deliveryChallan.findMany({
      where: {
        OR: [
          { customerId: client.id },
          { customerName: { equals: client.name, mode: 'insensitive' } }
        ]
      },
      include: {
        createdBy: { select: { name: true } },
        lines: {
          include: {
            batch: {
              select: {
                batchCode: true,
                itemType: true,
                brand: true,
                quality: true,
                shade: true,
                size: true,
                name: true,
                uom: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Aggregate product breakdown of all items supplied to this client
    const productSummaryMap = new Map<string, {
      key: string;
      itemType: string;
      brand: string;
      quality: string;
      shade: string;
      size: string;
      name: string;
      uom: string;
      totalQuantity: number;
      batchCount: number;
      lastDispatchedAt: Date;
    }>();

    for (const dc of challans) {
      for (const line of dc.lines || []) {
        const b = line.batch;
        if (!b) continue;
        const brand = b.brand || '';
        const quality = b.quality || '';
        const shade = b.shade || '';
        const size = b.size || '';
        const name = b.name || '';
        const key = `${b.itemType}|${brand}|${quality}|${shade}|${size}|${name}`;
        
        const existing = productSummaryMap.get(key) || {
          key,
          itemType: b.itemType,
          brand,
          quality,
          shade,
          size,
          name,
          uom: b.uom || 'METERS',
          totalQuantity: 0,
          batchCount: 0,
          lastDispatchedAt: dc.dispatchedAt || dc.createdAt
        };

        existing.totalQuantity += line.quantity;
        existing.batchCount += 1;
        if (new Date(dc.dispatchedAt || dc.createdAt) > new Date(existing.lastDispatchedAt)) {
          existing.lastDispatchedAt = dc.dispatchedAt || dc.createdAt;
        }
        productSummaryMap.set(key, existing);
      }
    }

    const suppliedItems = Array.from(productSummaryMap.values()).map(p => ({
      ...p,
      totalQuantity: Math.round(p.totalQuantity * 10) / 10
    })).sort((a, b) => b.totalQuantity - a.totalQuantity);

    res.json({
      ...client,
      challans,
      suppliedItems
    });
  } catch (err: any) {
    console.error('Failed to get client details:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/clients ───────────────────────────────────────────────────────
// Creates a new client in the directory
router.post('/', requirePermission('admin.clients', 'po.create', 'ops.entry_gate', 'ops.exit_gate'), async (req: Request, res: Response) => {
  try {
    const { name, clientType, contactPerson, phone, email, address, city, state, gstin, notes } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Client / Customer name is required' });
      return;
    }

    const code = await generateNextClientCode();
    const id = `client-${Date.now()}`;

    await prisma.$executeRawUnsafe(`
      INSERT INTO clients (id, code, name, client_type, contact_person, phone, email, address, city, state, gstin, notes, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, NOW(), NOW())
    `, id, code, name.trim(), clientType?.trim() || null, contactPerson?.trim() || null, phone?.trim() || null, email?.trim() || null, address?.trim() || null, city?.trim() || null, state?.trim() || null, gstin?.trim() || null, notes?.trim() || null);

    const createdRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, code, name, client_type as "clientType", contact_person as "contactPerson", phone, email, address, city, state, gstin, notes, is_active as "isActive"
      FROM clients WHERE id = $1 LIMIT 1
    `, id);

    res.status(201).json(createdRows[0]);
  } catch (err: any) {
    console.error('Failed to create client:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/clients/:id ────────────────────────────────────────────────────
// Updates client details & syncs corrected client name to past delivery challans and PO allocations
router.put('/:id', requirePermission('admin.clients'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, clientType, contactPerson, phone, email, address, city, state, gstin, notes, isActive } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Client name is required' });
    return;
  }

  try {
    await prisma.$executeRawUnsafe(`
      UPDATE clients
      SET name = $1,
          client_type = $2,
          contact_person = $3,
          phone = $4,
          email = $5,
          address = $6,
          city = $7,
          state = $8,
          gstin = $9,
          notes = $10,
          is_active = $11,
          updated_at = NOW()
      WHERE id = $12
    `, name.trim(), clientType?.trim() || null, contactPerson?.trim() || null, phone?.trim() || null, email?.trim() || null, address?.trim() || null, city?.trim() || null, state?.trim() || null, gstin?.trim() || null, notes?.trim() || null, isActive !== false, id);

    // Sync the corrected name to everything linked to this client
    const newName = name.trim();
    const clientId = id as string;
    await prisma.$transaction([
      prisma.deliveryChallan.updateMany({ where: { customerId: clientId }, data: { customerName: newName } }),
      prisma.poLineAllocation.updateMany({ where: { clientId }, data: { clientName: newName } }),
      prisma.itemBatch.updateMany({ where: { clientId }, data: { clientName: newName } }),
    ]);

    const updatedRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, code, name, client_type as "clientType", contact_person as "contactPerson", phone, email, address, city, state, gstin, notes, is_active as "isActive"
      FROM clients WHERE id = $1 LIMIT 1
    `, id);

    if (updatedRows.length === 0) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    res.json(updatedRows[0]);
  } catch (err: any) {
    console.error('Failed to update client:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
