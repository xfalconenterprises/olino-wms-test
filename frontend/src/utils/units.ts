import { useEffect, useState } from 'react';
import api from './api';

// Units of measure. Every roll, PO line and GRN line carries its own unit; screens show that
// unit and never add different units together. Fabric is in meters unless its fabric type is
// weighed in kilograms (set per fabric type in the master catalogue, e.g. Knits).

const SHORT: Record<string, string> = {
  METERS: 'm', KG: 'kg', PCS: 'pcs', PAIRS: 'pairs', SETS: 'sets', GROSS: 'gross', BOXES: 'boxes', PACKETS: 'packets',
};
const LONG: Record<string, string> = {
  METERS: 'Meters', KG: 'Kg', PCS: 'Pieces', PAIRS: 'Pairs', SETS: 'Sets', GROSS: 'Gross', BOXES: 'Boxes', PACKETS: 'Packets',
};
const ORDER = ['METERS', 'KG', 'PCS', 'PAIRS', 'SETS', 'GROSS', 'BOXES', 'PACKETS'];

/** The unit of a record, falling back to the usual unit of its item type. */
export function uomOf(item: { uom?: string | null; itemType?: string | null } | null | undefined): string {
  return (item?.uom || ((item?.itemType || 'FABRIC') === 'FABRIC' ? 'METERS' : 'PCS')).toUpperCase();
}

/** Short unit for numbers: "m", "kg", "pcs". */
export function unitLabel(uom?: string | null): string {
  const u = (uom || '').toUpperCase();
  return SHORT[u] ?? u.toLowerCase();
}

/** Unit as a word: "Meters", "Kg", "Pieces". */
export function unitName(uom?: string | null): string {
  const u = (uom || '').toUpperCase();
  return LONG[u] ?? u;
}

/** Meters and kilograms take decimals; everything else is counted whole. */
export function allowsDecimals(uom?: string | null): boolean {
  const u = (uom || '').toUpperCase();
  return u === 'METERS' || u === 'KG';
}

/** Quantity with its unit, e.g. "52.5 m", "24 kg", "120 pcs". */
export function formatQty(quantity: number, uom?: string | null, long = false): string {
  const n = Number(quantity) || 0;
  const shown = allowsDecimals(uom) ? String(Math.round(n * 100) / 100) : String(Math.round(n));
  return `${shown} ${long ? unitName(uom) : unitLabel(uom)}`;
}

/** Totals per unit, e.g. "120.5 m + 34 kg" — meters and kg are never added. */
export function formatTotals(rows: { uom?: string | null; quantity: number }[], long = false): string {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const u = (r.uom || 'PCS').toUpperCase();
    totals.set(u, (totals.get(u) ?? 0) + (Number(r.quantity) || 0));
  }
  return [...totals]
    .sort((a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99))
    .map(([u, q]) => formatQty(q, u, long))
    .join(' + ') || '0';
}

/** Per-unit totals as the server sends them ([["METERS", 120], ["KG", 34]]) → "120 m + 34 kg". */
export function formatUnitTotals(totals: [string, number][] | null | undefined, long = false): string {
  return formatTotals((totals ?? []).map(([uom, quantity]) => ({ uom, quantity })), long);
}

/** Fabric type code as people read it: PLAIN_SHIRTING → "Plain Shirting". */
export function fabricCategoryLabel(code?: string | null): string {
  if (!code) return '';
  return code.toLowerCase().split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export interface FabricCategory { value: string; label: string; unit: 'METERS' | 'KG' }

let cache: FabricCategory[] | null = null;
let pending: Promise<FabricCategory[]> | null = null;

/** Fabric types from the master catalogue (each with its unit). Cached for the session. */
export function loadFabricCategories(force = false): Promise<FabricCategory[]> {
  if (cache && !force) return Promise.resolve(cache);
  if (!pending || force) {
    pending = api.get('/api/master-data')
      .then(res => {
        cache = Array.isArray(res.data?.FABRIC_CATEGORIES) ? res.data.FABRIC_CATEGORIES : [];
        return cache!;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

/** Fabric types for a screen; re-read after the master catalogue changes them. */
export function useFabricCategories(): FabricCategory[] {
  const [list, setList] = useState<FabricCategory[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    loadFabricCategories().then(l => { if (alive) setList(l); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return list;
}

/** The unit a fabric type is measured in (meters when unknown). */
export function fabricUnit(categories: FabricCategory[], code?: string | null): 'METERS' | 'KG' {
  return categories.find(c => c.value === (code || '').toUpperCase())?.unit ?? 'METERS';
}
