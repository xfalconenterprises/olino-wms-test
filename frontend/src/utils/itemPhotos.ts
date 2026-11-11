import api from './api';

// Item photos: up to 3 per item, kept once on the item and shown for every lump or pack of it.
// The server decides which item a photo belongs to from these fields (see item-images.ts).

export const MAX_PHOTOS = 3;

export interface ItemPhoto { id: string; position: number; width: number; height: number; url: string; thumbUrl: string }

export interface PhotoItem {
  itemType?: string | null; category?: string | null; brand?: string | null; quality?: string | null;
  shade?: string | null; name?: string | null; artNo?: string | null;
}

const fieldsOf = (i: PhotoItem) => ({
  itemType: i.itemType || 'FABRIC', category: i.category || undefined, brand: i.brand || undefined, quality: i.quality || undefined,
  shade: i.shade || undefined, name: i.name || undefined, artNo: i.artNo || undefined,
});

/** The photos of several items at once, in the same order. */
export async function lookupPhotos(items: PhotoItem[]): Promise<ItemPhoto[][]> {
  const out: ItemPhoto[][] = [];
  for (let i = 0; i < items.length; i += 500) {
    const res = await api.post<{ photos: ItemPhoto[][] }>('/api/item-images/lookup', { items: items.slice(i, i + 500).map(fieldsOf) });
    out.push(...res.data.photos);
  }
  return out;
}

const LARGEST_PX = 1600;

/**
 * Shrinks a photo in the browser before it is sent (a 6 MB phone picture travels as about 300 KB),
 * turned the right way up. The server shrinks it again anyway, so a picture the browser can't read
 * (e.g. some phone formats) is just sent as it is.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, LARGEST_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.9));
    const webp = await encode('image/webp');
    if (webp && webp.type === 'image/webp') return webp;
    return (await encode('image/jpeg')) ?? file;
  } catch {
    return file;
  }
}

/** Adds a photo to an item (at most 3). */
export async function uploadPhoto(item: PhotoItem, file: File): Promise<ItemPhoto> {
  const blob = await shrinkPhoto(file);
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  const res = await api.post<ItemPhoto>('/api/item-images', blob, { params: fieldsOf(item), headers: { 'Content-Type': type } });
  return res.data;
}

export const setMainPhoto = (id: string) => api.put(`/api/item-images/${id}/main`);
export const deletePhoto = (id: string) => api.delete(`/api/item-images/${id}`);
