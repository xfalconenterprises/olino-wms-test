import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);

// Helper to generate next sequential supplier code: SUP-0001, SUP-0002...
async function generateNextSupplierCode(): Promise<string> {
  const prefix = 'SUP-';
  const latestSupplier = await prisma.supplier.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true }
  });

  let nextNum = 1;
  if (latestSupplier && latestSupplier.code) {
    const parts = latestSupplier.code.split('-');
    const parsed = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(parsed)) {
      nextNum = parsed + 1;
    }
  }

  let code = `${prefix}${String(nextNum).padStart(4, '0')}`;
  while (await prisma.supplier.findUnique({ where: { code } })) {
    nextNum++;
    code = `${prefix}${String(nextNum).padStart(4, '0')}`;
  }
  return code;
}

// ─── GET /api/suppliers ──────────────────────────────────────────────────────
// Returns all suppliers with optional search and active filtering
router.get('/', requirePermission('admin.suppliers', 'inv.suppliers', 'po.create', 'ops.entry_gate', 'admin.dashboard', 'ops.returns'), async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ALL';

    const where: any = {};

    if (status === 'ACTIVE') {
      where.isActive = true;
    } else if (status === 'INACTIVE') {
      where.isActive = false;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      include: {
        _count: {
          select: { purchaseOrders: true }
        },
        purchaseOrders: {
          where: { 
            status: { in: ['PENDING', 'PARTIALLY_RECEIVED'] },
            isDeleted: false
          },
          select: { id: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    const formatted = suppliers.map(s => ({
      id: s.id,
      code: s.code,
      name: s.name,
      contactPerson: s.contactPerson,
      phone: s.phone,
      email: s.email,
      address: s.address,
      city: s.city,
      state: s.state,
      gstin: s.gstin,
      notes: s.notes,
      isActive: s.isActive,
      totalPOs: s._count.purchaseOrders,
      openPOs: s.purchaseOrders.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

// ─── GET /api/suppliers/inventory-tracking ───────────────────────────────────
// Returns all suppliers enriched with real-time warehouse inventory and supply metrics
router.get('/inventory-tracking', requirePermission('inv.suppliers'), async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ALL';

    const where: any = {};
    if (status === 'ACTIVE') where.isActive = true;
    else if (status === 'INACTIVE') where.isActive = false;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
      ];
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      include: {
        _count: {
          select: { purchaseOrders: true, inboundDiscrepancies: true }
        },
        purchaseOrders: {
          where: { 
            status: { in: ['PENDING', 'PARTIALLY_RECEIVED'] },
            isDeleted: false
          },
          select: { id: true, poNumber: true, expectedDate: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    // Aggregate warehouse inventory per supplier
    const activeBatches = await prisma.itemBatch.findMany({
      where: {
        status: { not: 'OUT' },
        quantity: { gt: 0 },
        poLine: {
          po: {
            supplierId: { not: null }
          }
        }
      },
      select: {
        id: true,
        quantity: true,
        itemType: true,
        uom: true,
        poLine: {
          select: {
            po: { select: { supplierId: true, supplierName: true } }
          }
        }
      }
    });

    const supplierStockMap: Record<string, { inStockBatches: number; inStockMeters: number; inStockKg: number; inStockUnits: number }> = {};

    for (const b of activeBatches) {
      const sId = b.poLine?.po?.supplierId;
      if (!sId) continue;
      if (!supplierStockMap[sId]) {
        supplierStockMap[sId] = { inStockBatches: 0, inStockMeters: 0, inStockKg: 0, inStockUnits: 0 };
      }
      supplierStockMap[sId].inStockBatches += 1;
      if (b.itemType === 'FABRIC' && b.uom === 'KG') {
        supplierStockMap[sId].inStockKg += b.quantity;
      } else if (b.itemType === 'FABRIC' || !b.itemType) {
        supplierStockMap[sId].inStockMeters += b.quantity;
      } else {
        supplierStockMap[sId].inStockUnits += b.quantity;
      }
    }

    const formatted = suppliers.map(s => {
      const stock = supplierStockMap[s.id] || { inStockBatches: 0, inStockMeters: 0, inStockKg: 0, inStockUnits: 0 };
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        city: s.city,
        state: s.state,
        gstin: s.gstin,
        notes: s.notes,
        isActive: s.isActive,
        totalPOs: s._count.purchaseOrders,
        openPOs: s.purchaseOrders.length,
        discrepanciesCount: s._count.inboundDiscrepancies,
        inStockBatches: stock.inStockBatches,
        inStockMeters: Math.round(stock.inStockMeters * 10) / 10,
        inStockKg: Math.round(stock.inStockKg * 100) / 100,
        inStockUnits: Math.round(stock.inStockUnits),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    });

    res.json(formatted);
  } catch (error: any) {
    console.error('Error fetching supplier inventory tracking:', error);
    res.status(500).json({ error: 'Failed to fetch supplier inventory tracking' });
  }
});

// ─── GET /api/suppliers/:id/stock ────────────────────────────────────────────
// Get all warehouse batches supplied by this supplier with exact bin locations and PO links
router.get('/:id/stock', requirePermission('inv.suppliers'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'IN_STOCK';

    const supplier = await prisma.supplier.findUnique({
      where: { id: id as string },
      select: { id: true, name: true }
    });

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    const where: any = {
      poLine: {
        po: {
          OR: [
            { supplierId: supplier.id },
            { supplierName: { equals: supplier.name, mode: 'insensitive' } }
          ]
        }
      }
    };

    if (statusFilter === 'IN_STOCK') {
      where.status = { not: 'OUT' };
      where.quantity = { gt: 0 };
    } else if (statusFilter === 'OUT') {
      where.OR = [
        { status: 'OUT' },
        { quantity: { lte: 0 } }
      ];
    }

    const batches = await prisma.itemBatch.findMany({
      where,
      include: {
        poLine: {
          select: {
            id: true,
            orderedQty: true,
            receivedQty: true,
            uom: true,
            po: {
              select: {
                id: true,
                poNumber: true,
                createdAt: true,
                expectedDate: true,
                status: true,
                targetClient: true
              }
            }
          }
        },
        batchLocations: {
          include: {
            location: {
              include: { bay: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(batches);
  } catch (err: any) {
    console.error('Failed to get supplier stock:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/suppliers/:id ──────────────────────────────────────────────────
// Returns a single supplier, complete PO verification history, and inbound discrepancies
router.get('/:id', requirePermission('admin.suppliers', 'inv.suppliers'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supplier = await prisma.supplier.findUnique({
      where: { id: id as string },
      include: {
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            createdBy: { select: { name: true } },
            lines: {
              include: {
                batches: {
                  select: {
                    id: true,
                    batchCode: true,
                    quantity: true,
                    status: true,
                    supplierBundle: true,
                    invoiceRef: true,
                    batchLocations: {
                      select: {
                        quantity: true,
                        location: { select: { code: true } }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        inboundDiscrepancies: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            reportedBy: { select: { name: true } }
          }
        }
      }
    });

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    res.json(supplier);
  } catch (error: any) {
    console.error('Error fetching supplier details:', error);
    res.status(500).json({ error: 'Failed to fetch supplier details' });
  }
});

// ─── POST /api/suppliers ─────────────────────────────────────────────────────
// Create a new supplier in master data
router.post('/', requirePermission('admin.suppliers', 'inv.suppliers', 'po.create', 'ops.entry_gate'), async (req: Request, res: Response) => {
  try {
    const {
      name,
      contactPerson,
      phone,
      email,
      address,
      city,
      state,
      gstin,
      notes,
    } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Supplier legal/mill name is required' });
      return;
    }

    // Supplier code is strictly auto-generated: SUP-0001, SUP-0002...
    const finalCode = await generateNextSupplierCode();

    const supplier = await prisma.supplier.create({
      data: {
        code: finalCode,
        name: name.trim(),
        contactPerson: contactPerson?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        gstin: gstin?.trim().toUpperCase() || null,
        notes: notes?.trim() || null,
        isActive: true,
      }
    });

    res.status(201).json(supplier);
  } catch (error: any) {
    console.error('Error creating supplier:', error);
    res.status(500).json({ error: error.message || 'Failed to create supplier' });
  }
});

// ─── PUT /api/suppliers/:id ──────────────────────────────────────────────────
// Update existing supplier
router.put('/:id', requirePermission('admin.suppliers', 'inv.suppliers'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      contactPerson,
      phone,
      email,
      address,
      city,
      state,
      gstin,
      notes,
      isActive,
    } = req.body;

    const existing = await prisma.supplier.findUnique({ where: { id: id as string } });
    if (!existing) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    const updated = await prisma.supplier.update({
      where: { id: id as string },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(contactPerson !== undefined && { contactPerson: contactPerson ? contactPerson.trim() : null }),
        ...(phone !== undefined && { phone: phone ? phone.trim() : null }),
        ...(email !== undefined && { email: email ? email.trim() : null }),
        ...(address !== undefined && { address: address ? address.trim() : null }),
        ...(city !== undefined && { city: city ? city.trim() : null }),
        ...(state !== undefined && { state: state ? state.trim() : null }),
        ...(gstin !== undefined && { gstin: gstin ? gstin.trim().toUpperCase() : null }),
        ...(notes !== undefined && { notes: notes ? notes.trim() : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      }
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ error: error.message || 'Failed to update supplier' });
  }
});

export default router;
