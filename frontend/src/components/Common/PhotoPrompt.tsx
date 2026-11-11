import { useEffect, useState } from 'react';
import { Camera, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { hasPermission } from '../../utils/roles';
import { lookupPhotos, type ItemPhoto, type PhotoItem } from '../../utils/itemPhotos';
import ItemPhotos from './ItemPhotos';

// At Stock In, after a lump is received: when its item has no photo yet, offers to add one there and
// then (the goods are in hand). Asked once per item in a session: an item that has a photo, or one
// the user said "Not now" to, isn't asked again. Only for users with Item Photos.

const known = new Map<string, 'has' | 'skip'>();

/** Same item as the server's photo key: Fabric type+brand+quality+shade, Readymade name+art no+colour, Accessory category+name+colour. */
function promptKey(i: PhotoItem): string {
  const n = (v: unknown) => String(v ?? '').trim().toUpperCase();
  const type = n(i.itemType) || 'FABRIC';
  const parts = type === 'FABRIC' ? [i.category, i.brand, i.quality, i.shade] : type === 'READY_MADE' ? [i.name, i.artNo, i.shade] : [i.category, i.name, i.shade];
  return [type, ...parts.map(n)].join('|');
}

function itemName(i: PhotoItem): string {
  const type = i.itemType || 'FABRIC';
  const parts = type === 'FABRIC' ? [i.brand, i.quality, i.shade] : type === 'READY_MADE' ? [i.name, i.artNo && `Art ${i.artNo}`, i.shade] : [i.category, i.name, i.shade];
  return parts.filter(Boolean).join(' · ') || 'This item';
}

export default function PhotoPrompt({ item }: { item: PhotoItem | null }) {
  const { user } = useAuth();
  const canAdd = hasPermission(user, 'inv.photos');
  const key = item ? promptKey(item) : '';
  const [state, setState] = useState<{ key: string; show: 'ask' | 'added' | null; photos: ItemPhoto[] }>({ key: '', show: null, photos: [] });

  useEffect(() => {
    if (!item || !canAdd || known.has(key)) { setState({ key, show: null, photos: [] }); return; }
    let live = true;
    lookupPhotos([item])
      .then(([photos]) => {
        if (!live) return;
        if (photos?.length) { known.set(key, 'has'); setState({ key, show: null, photos }); }
        else setState({ key, show: 'ask', photos: [] });
      })
      .catch(() => { if (live) setState({ key, show: null, photos: [] }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, canAdd]);

  // "Photo added" shows briefly, then the card goes
  useEffect(() => {
    if (state.show !== 'added') return;
    const t = setTimeout(() => setState(s => ({ ...s, show: null })), 3000);
    return () => clearTimeout(t);
  }, [state.show]);

  if (!item || state.key !== key || !state.show) return null;

  if (state.show === 'added') {
    return (
      <div role="status" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 'var(--radius)', padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: '#065f46', fontWeight: 600, fontSize: 13 }}>
        <CheckCircle2 size={18} /> Photo added. Every lump of {itemName(item)} shows it.
      </div>
    );
  }

  return (
    <div aria-label="Add a photo of this item" style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Camera size={18} color="var(--color-brand)" />
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#4c1d95' }}>{itemName(item)} has no photo yet</div>
            <div style={{ fontSize: 12, color: '#6b21a8' }}>Add one now while it is in hand; every lump of this item will show it.</div>
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { known.set(key, 'skip'); setState(s => ({ ...s, show: null })); }}>
          Not now
        </button>
      </div>
      <ItemPhotos
        item={item}
        canManage
        initial={state.photos}
        mainHeight={180}
        onChange={photos => { if (photos.length) { known.set(key, 'has'); setState(s => ({ ...s, show: 'added', photos })); } }}
      />
    </div>
  );
}
