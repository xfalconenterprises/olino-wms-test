// The item filters for each item type, named as the type's own columns are named where items are
// entered (purchase orders, Stock In and the Direct Inward Excel). Used by the Inventory screen and
// Accounts. The key is also the filter's name sent to the server.

export type ItemFilterKey = 'fabricType' | 'brand' | 'quality' | 'qualityName' | 'shade' | 'itemName' | 'category' | 'artNo' | 'size' | 'spec';
export type ItemTypeKey = 'FABRIC' | 'READY_MADE' | 'ACCESSORY';

export interface ItemFilterDef {
  key: ItemFilterKey;
  label: string;
  placeholder: string;
}

export const ITEM_FILTERS: Record<ItemTypeKey, ItemFilterDef[]> = {
  FABRIC: [
    { key: 'fabricType', label: 'Fabric Type', placeholder: '' },   // a list of the fabric types
    { key: 'brand', label: 'Brand', placeholder: 'e.g. Siyaram' },
    { key: 'quality', label: 'Quality', placeholder: 'e.g. PV-2041' },
    { key: 'qualityName', label: 'Quality Name', placeholder: 'e.g. Poly Viscose Twill' },
    { key: 'shade', label: 'Shade', placeholder: 'e.g. Navy Blue' },
  ],
  READY_MADE: [
    { key: 'itemName', label: 'Item Name', placeholder: 'e.g. Half Sleeve Shirt' },
    { key: 'category', label: 'Fabric Type', placeholder: 'e.g. Poly Cotton' },
    { key: 'shade', label: 'Color / Shade', placeholder: 'e.g. White' },
    { key: 'artNo', label: 'Art No', placeholder: 'e.g. ART-2041' },
    { key: 'size', label: 'Size', placeholder: 'e.g. 32, M, XL' },
  ],
  ACCESSORY: [
    { key: 'category', label: 'Category', placeholder: 'e.g. Buttons' },
    { key: 'itemName', label: 'Accessory Item', placeholder: 'e.g. 4-Hole Button' },
    { key: 'spec', label: 'Spec / Quality', placeholder: 'e.g. 24L' },
    { key: 'shade', label: 'Color', placeholder: 'e.g. Navy' },
    { key: 'size', label: 'Size', placeholder: 'e.g. 7 inch' },
  ],
};

/** Each filter's name, for the export log. */
export const ITEM_FILTER_NAMES: Record<ItemFilterKey, string> = {
  fabricType: 'Fabric Type', brand: 'Brand', quality: 'Quality', qualityName: 'Quality Name', shade: 'Shade / Color',
  itemName: 'Item Name', category: 'Category / Fabric Type', artNo: 'Art No', size: 'Size', spec: 'Spec',
};

type ItemFields = {
  category?: string | null; brand?: string | null; quality?: string | null; qualityName?: string | null;
  shade?: string | null; name?: string | null; artNo?: string | null; size?: string | null;
};

/** Whether an item matches the filters (part of the field, any case; the fabric type exactly). */
export function matchesItemFilters(item: ItemFields, filters: Partial<Record<ItemFilterKey, string>>): boolean {
  const has = (field: string | null | undefined, q: string | undefined) => !q?.trim() || (field ?? '').toLowerCase().includes(q.trim().toLowerCase());
  return (!filters.fabricType || item.category === filters.fabricType)
    && has(item.brand, filters.brand) && has(item.quality, filters.quality) && has(item.qualityName, filters.qualityName)
    && has(item.shade, filters.shade) && has(item.name, filters.itemName) && has(item.category, filters.category)
    && has(item.artNo, filters.artNo) && has(item.size, filters.size)
    && (!filters.spec?.trim() || has(item.quality, filters.spec) || has(item.size, filters.spec));
}
