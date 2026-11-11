import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, ChevronLeft, ChevronRight, Star, Trash2, X } from 'lucide-react';
import { apiError } from '../../utils/printPage';
import { MAX_PHOTOS, deletePhoto, lookupPhotos, setMainPhoto, uploadPhoto, type ItemPhoto, type PhotoItem } from '../../utils/itemPhotos';

/**
 * An item's photos (up to 3, shared by all its lumps or packs): small pictures that open full size.
 * With `canManage`, photos can be added (picked or taken with the camera), made the main one or
 * removed. Shows nothing (heading included) when the item has no photos and the user can't add any.
 * `onChange` is told after a photo is added, removed or made the main one.
 */
export default function ItemPhotos({ item, canManage, onChange, heading, initial, mainHeight = 260 }: {
  item: PhotoItem; canManage: boolean; onChange?: (photos: ItemPhoto[]) => void; heading?: ReactNode;
  /** Photos already looked up: no request on opening. */
  initial?: ItemPhoto[];
  mainHeight?: number;
}) {
  const [photos, setPhotos] = useState<ItemPhoto[] | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const itemKey = JSON.stringify([item.itemType, item.category, item.brand, item.quality, item.shade, item.name, item.artNo]);

  const load = useCallback(async () => {
    try {
      const [list] = await lookupPhotos([item]);
      setPhotos(list ?? []);
      return list ?? [];
    } catch {
      setPhotos([]);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);
  useEffect(() => {
    setError('');
    if (initial) { setPhotos(initial); return; }
    setPhotos(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const act = async (work: () => Promise<unknown>, failMessage: string) => {
    setBusy(true); setError('');
    try {
      await work();
      onChange?.(await load());
    } catch (err) {
      setError(apiError(err, failMessage));
    } finally {
      setBusy(false);
    }
  };

  const add = (file: File | undefined) => {
    if (!file) return;
    if (fileInput.current) fileInput.current.value = '';
    act(() => uploadPhoto(item, file), 'The photo could not be added.');
  };

  // Keys in the full-size view: arrows to move, Escape to close
  useEffect(() => {
    if (viewing === null || !photos?.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewing(null);
      if (e.key === 'ArrowRight') setViewing(v => (v === null ? v : (v + 1) % photos.length));
      if (e.key === 'ArrowLeft') setViewing(v => (v === null ? v : (v - 1 + photos.length) % photos.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing, photos]);

  if (photos === null) return null;
  if (photos.length === 0 && !canManage) return null;

  const tile = { width: 96, height: 96, borderRadius: 8, border: '1px solid var(--color-border)', position: 'relative' as const, overflow: 'hidden', flex: '0 0 auto' };
  const iconButton = { position: 'absolute' as const, top: 4, width: 26, height: 26, borderRadius: 6, border: 'none', background: 'rgba(15,23,42,0.65)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 };

  return (
    <div>
      {heading}
      {/* The main photo large (the whole picture shows), the others small beside the Add tile */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {photos.map((p, i) => (
          <div key={p.id} style={i === 0 ? { ...tile, width: '100%', height: mainHeight, background: '#f1f5f9' } : tile}>
            <button type="button" onClick={() => setViewing(i)} title="View full size" aria-label={`Photo ${i + 1}, view full size`}
              style={{ border: 'none', padding: 0, margin: 0, width: '100%', height: '100%', cursor: 'zoom-in', background: i === 0 ? '#f1f5f9' : '#f8fafc' }}>
              <img src={i === 0 ? p.url : p.thumbUrl} alt={`Item photo ${i + 1}`}
                style={{ width: '100%', height: '100%', objectFit: i === 0 ? 'contain' : 'cover', display: 'block' }} />
            </button>
            {i === 0 && photos.length > 1 && (
              <span style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 10.5, fontWeight: 700, color: '#fff', background: 'var(--color-brand)', borderRadius: 4, padding: '1px 6px' }}>Main</span>
            )}
            {canManage && (
              <>
                {i > 0 && (
                  <button type="button" style={{ ...iconButton, left: 4 }} disabled={busy} title="Make this the main photo" aria-label="Make this the main photo"
                    onClick={() => act(() => setMainPhoto(p.id), 'The photo could not be changed.')}>
                    <Star size={14} />
                  </button>
                )}
                <button type="button" style={{ ...iconButton, right: 4 }} disabled={busy} title="Remove this photo" aria-label="Remove this photo"
                  onClick={() => { if (window.confirm('Remove this photo from the item? Every lump of the item loses it.')) act(() => deletePhoto(p.id), 'The photo could not be removed.'); }}>
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
        {canManage && photos.length < MAX_PHOTOS && (
          <label style={{ ...tile, borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: busy ? 'wait' : 'pointer', color: 'var(--color-brand)', fontSize: 12, fontWeight: 600, background: '#faf5ff' }}>
            {busy ? <span className="spinner" /> : <><Camera size={22} /> Add photo</>}
            <input ref={fileInput} type="file" accept="image/*" disabled={busy} style={{ display: 'none' }} aria-label="Add a photo"
              onChange={e => add(e.target.files?.[0])} />
          </label>
        )}
      </div>
      {canManage && (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 6 }}>
          Up to {MAX_PHOTOS} photos, shared by every lump of this item. They are made smaller automatically.
        </div>
      )}
      {error && <div className="alert alert-danger" style={{ marginTop: 8, marginBottom: 0 }}>{error}</div>}

      {viewing !== null && photos[viewing] && (
        <div role="dialog" aria-label="Item photo" onClick={() => setViewing(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(15,23,42,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <img src={photos[viewing].url} alt={`Item photo ${viewing + 1}`} onClick={e => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }} />
          <button type="button" aria-label="Close" onClick={() => setViewing(null)}
            style={{ position: 'absolute', top: 16, right: 16, width: 44, height: 44, borderRadius: 22, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={22} />
          </button>
          {photos.length > 1 && (
            <>
              <button type="button" aria-label="Previous photo" onClick={e => { e.stopPropagation(); setViewing((viewing - 1 + photos.length) % photos.length); }}
                style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 48, height: 48, borderRadius: 24, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <ChevronLeft size={26} />
              </button>
              <button type="button" aria-label="Next photo" onClick={e => { e.stopPropagation(); setViewing((viewing + 1) % photos.length); }}
                style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', width: 48, height: 48, borderRadius: 24, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <ChevronRight size={26} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
