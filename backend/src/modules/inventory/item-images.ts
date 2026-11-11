import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import prisma from '../../lib/prisma';
import { getJwtSecret, requireAuth, requirePermission } from '../../middleware/auth';
import { itemDescription } from './returns';

// Item photos: up to 3 per item, kept once on the item (not on each lump), so every lump or pack of
// that item shows them. Each photo is stored as two WebP files: a large one (1600 px) and a small
// one (300 px) for lists. The original upload is never kept. Pictures are served through signed
// links that expire, so an <img> can show them without the login header and nobody outside the
// app can open them.

const router = Router();

export const MAX_PHOTOS_PER_ITEM = 3;
const LARGE_PX = 1600;
const SMALL_PX = 300;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const LINK_HOURS = 12;

/** Where the pictures live: ITEM_IMAGES_DIR, else an item-images folder beside the backend. */
export const IMAGES_DIR = path.resolve(process.env.ITEM_IMAGES_DIR || path.join(process.cwd(), 'item-images'));
const fileFor = (id: string, size: 'large' | 'small') => path.join(IMAGES_DIR, `${id}${size === 'small' ? '-small' : ''}.webp`);

type ItemFields = { itemType?: unknown; category?: unknown; brand?: unknown; quality?: unknown; shade?: unknown; name?: unknown; artNo?: unknown };

/**
 * Which item a photo belongs to. Fabric: type + brand + quality + shade. Readymade: name + art no +
 * colour (every size shares the photos). Accessory: category + name + colour. Case and spaces ignored.
 */
export function itemPhotoKey(f: ItemFields): string | null {
  const n = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim().toUpperCase();
  const type = n(f.itemType) || 'FABRIC';
  const parts = type === 'FABRIC' ? [n(f.category), n(f.brand), n(f.quality), n(f.shade)]
    : type === 'READY_MADE' ? [n(f.name), n(f.artNo), n(f.shade)]
      : type === 'ACCESSORY' ? [n(f.category), n(f.name), n(f.shade)]
        : null;
  if (!parts || parts.every(p => !p)) return null;
  return [type, ...parts].join('|');
}

/** A link to one picture that works for a while without the login header. */
function signedUrl(id: string, size: 'large' | 'small'): string {
  const exp = Math.floor(Date.now() / 1000) + LINK_HOURS * 3600;
  return `/api/item-images/file/${id}/${size}?e=${exp}&s=${sign(id, size, exp)}`;
}
function sign(id: string, size: string, exp: number): string {
  return crypto.createHmac('sha256', getJwtSecret()).update(`item-image|${id}|${size}|${exp}`).digest('base64url');
}

const toPhoto = (img: { id: string; position: number; width: number; height: number }) => ({
  id: img.id, position: img.position, width: img.width, height: img.height,
  url: signedUrl(img.id, 'large'), thumbUrl: signedUrl(img.id, 'small'),
});

// GET /api/item-images/file/:id/:size?e=&s= — the picture itself (signed link, no login header)
router.get('/file/:id/:size', async (req: Request, res: Response) => {
  const { id, size } = req.params as { id: string; size: string };
  const exp = Number(req.query.e);
  const given = String(req.query.s ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id) || (size !== 'large' && size !== 'small') || !Number.isFinite(exp) || exp < Date.now() / 1000) {
    res.status(403).json({ error: 'This picture link has expired. Reload the page.' });
    return;
  }
  const expected = Buffer.from(sign(id, size, exp));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    res.status(403).json({ error: 'Not a valid picture link.' });
    return;
  }
  try {
    const data = await fs.readFile(fileFor(id, size));
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': `private, max-age=${LINK_HOURS * 3600}, immutable` });
    res.send(data);
  } catch {
    res.status(404).json({ error: 'Picture not found' });
  }
});

router.use(requireAuth);

// Seeing photos: anyone who works with stock. Adding, removing or reordering: Item Photos only.

// POST /api/item-images/lookup { items: [{ itemType, category, brand, quality, shade, name, artNo }] }
// — the photos of several items at once, in the same order (a list page asks once)
router.post('/lookup', requirePermission('inv.dashboard', 'inv.photos', 'ops.entry_gate', 'ops.exit_gate', 'ops.put_away', 'ops.dock_queue'), async (req: Request, res: Response) => {
  const items: ItemFields[] = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
  const keys = items.map(itemPhotoKey);
  const wanted = [...new Set(keys.filter((k): k is string => !!k))];
  const rows = wanted.length
    ? await prisma.itemImage.findMany({ where: { itemKey: { in: wanted } }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
    : [];
  const byKey = new Map<string, ReturnType<typeof toPhoto>[]>();
  for (const r of rows) byKey.set(r.itemKey, [...(byKey.get(r.itemKey) ?? []), toPhoto(r)]);
  res.json({ photos: keys.map(k => (k ? byKey.get(k) ?? [] : [])) });
});

// POST /api/item-images?itemType=&category=&brand=&quality=&shade=&name=&artNo= with the picture as
// the body (image/jpeg, png, webp or heic) — adds a photo to the item (at most 3)
router.post('/', requirePermission('inv.photos'), express.raw({ type: 'image/*', limit: MAX_UPLOAD_BYTES }), async (req: Request, res: Response) => {
  const fields = req.query as ItemFields;
  const key = itemPhotoKey(fields);
  if (!key) { res.status(400).json({ error: 'Which item is this photo for?' }); return; }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: 'Choose a photo (JPG, PNG or WEBP).' });
    return;
  }
  const count = await prisma.itemImage.count({ where: { itemKey: key } });
  if (count >= MAX_PHOTOS_PER_ITEM) {
    res.status(400).json({ error: `An item can have ${MAX_PHOTOS_PER_ITEM} photos. Remove one to add another.` });
    return;
  }

  // Turned the right way up, shrunk, and saved without the phone's hidden details (location, model)
  let large: { data: Buffer; info: sharp.OutputInfo }, small: Buffer;
  try {
    const source = sharp(req.body, { limitInputPixels: 80_000_000, failOn: 'error' }).rotate();
    large = await source.clone().resize(LARGE_PX, LARGE_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    small = await source.clone().resize(SMALL_PX, SMALL_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  } catch {
    res.status(400).json({ error: 'That file is not a photo the app can read. Use a JPG, PNG or WEBP picture.' });
    return;
  }

  const id = crypto.randomUUID();
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.writeFile(fileFor(id, 'large'), large.data);
  await fs.writeFile(fileFor(id, 'small'), small);
  try {
    const label = itemDescription({
      itemType: String(fields.itemType || 'FABRIC'), category: fields.category ? String(fields.category) : null,
      brand: fields.brand ? String(fields.brand) : null, quality: fields.quality ? String(fields.quality) : null, qualityName: null,
      shade: fields.shade ? String(fields.shade) : null, name: fields.name ? String(fields.name) : null,
      artNo: fields.artNo ? String(fields.artNo) : null, size: null, uom: 'PCS',
    }) || key;
    const created = await prisma.$transaction(async (tx) => {
      const now = await tx.itemImage.count({ where: { itemKey: key } });
      if (now >= MAX_PHOTOS_PER_ITEM) return null;   // someone else added one meanwhile
      return tx.itemImage.create({
        data: {
          id, itemKey: key, itemType: String(fields.itemType || 'FABRIC').toUpperCase(), label, position: now,
          width: large.info.width, height: large.info.height, sizeBytes: large.data.length + small.length,
          uploadedById: req.user!.userId, uploadedByName: req.user!.name,
        },
      });
    });
    if (!created) throw Object.assign(new Error('full'), { full: true });
    console.log(`[PHOTO] '${req.user!.username}' added a photo to ${label}`);
    res.status(201).json(toPhoto(created));
  } catch (err: any) {
    await removeFiles(id);
    if (err?.full) { res.status(400).json({ error: `An item can have ${MAX_PHOTOS_PER_ITEM} photos. Remove one to add another.` }); return; }
    throw err;
  }
});

async function removeFiles(id: string) {
  await Promise.all([fs.rm(fileFor(id, 'large'), { force: true }), fs.rm(fileFor(id, 'small'), { force: true })]);
}

/** Positions 0, 1, 2… in the given order. */
async function renumber(itemKey: string, firstId?: string) {
  const rows = await prisma.itemImage.findMany({ where: { itemKey }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  const ordered = firstId ? [...rows.filter(r => r.id === firstId), ...rows.filter(r => r.id !== firstId)] : rows;
  await prisma.$transaction(ordered.map((r, i) => prisma.itemImage.update({ where: { id: r.id }, data: { position: i } })));
}

// PUT /api/item-images/:id/main — makes this the item's main photo
router.put('/:id/main', requirePermission('inv.photos'), async (req: Request, res: Response) => {
  const img = await prisma.itemImage.findUnique({ where: { id: String(req.params.id) } });
  if (!img) { res.status(404).json({ error: 'Photo not found' }); return; }
  await renumber(img.itemKey, img.id);
  res.json({ ok: true });
});

// DELETE /api/item-images/:id — removes a photo (its files too)
router.delete('/:id', requirePermission('inv.photos'), async (req: Request, res: Response) => {
  const img = await prisma.itemImage.findUnique({ where: { id: String(req.params.id) } });
  if (!img) { res.status(404).json({ error: 'Photo not found' }); return; }
  await prisma.itemImage.delete({ where: { id: img.id } });
  await removeFiles(img.id);
  await renumber(img.itemKey);
  console.log(`[PHOTO] '${req.user!.username}' removed a photo of ${img.label}`);
  res.json({ ok: true });
});

export default router;
