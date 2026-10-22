// Units of measure. Every roll, PO line and GRN line stores its own unit, so screens, prints and
// totals use that unit and never add different units together. Fabric is measured in meters,
// except fabric types set to kilograms in the master catalogue (e.g. Knits).

export const FABRIC_UNITS = ['METERS', 'KG'] as const;
export type FabricUnit = typeof FABRIC_UNITS[number];

const SHORT: Record<string, string> = {
  METERS: 'm', KG: 'kg', PCS: 'pcs', PAIRS: 'pairs', SETS: 'sets', GROSS: 'gross', BOXES: 'boxes', PACKETS: 'packets',
};
const LONG: Record<string, string> = {
  METERS: 'Meters', KG: 'Kg', PCS: 'Pieces', PAIRS: 'Pairs', SETS: 'Sets', GROSS: 'Gross', BOXES: 'Boxes', PACKETS: 'Packets',
};
const ORDER = ['METERS', 'KG', 'PCS', 'PAIRS', 'SETS', 'GROSS', 'BOXES', 'PACKETS'];

/** Short unit for numbers, e.g. "m", "kg", "pcs". */
export function unitLabel(uom?: string | null): string {
  const u = (uom || '').toUpperCase();
  return SHORT[u] ?? u.toLowerCase();
}

/** Unit as printed on roll labels: M, KG, PCS, … */
export function labelUnit(uom?: string | null, itemType?: string | null): string {
  const u = (uom || '').toUpperCase().trim();
  if (u === 'KG') return 'KG';
  if (u === 'METERS' || u === 'METER' || u === 'M' || (!u && (itemType || 'FABRIC') === 'FABRIC')) return 'M';
  if (u === 'PCS' || u === 'PIECES' || u === 'PIECE' || (!u && itemType === 'READY_MADE')) return 'PCS';
  return u || 'PCS';
}

/** Unit as a word, e.g. "Meters", "Kg", "Pieces". */
export function unitName(uom?: string | null): string {
  const u = (uom || '').toUpperCase();
  return LONG[u] ?? u;
}

/** Meters and kilograms are measured in decimals; everything else is counted whole. */
export function allowsDecimals(uom?: string | null): boolean {
  return (FABRIC_UNITS as readonly string[]).includes((uom || '').toUpperCase());
}

/** Totals per unit, in a stable order: [["METERS", 120.5], ["KG", 34.2], ...]. */
export function totalsByUnit(rows: { uom?: string | null; quantity: number }[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const u = (r.uom || 'PCS').toUpperCase();
    totals.set(u, (totals.get(u) ?? 0) + (Number(r.quantity) || 0));
  }
  return [...totals]
    .map(([u, q]) => [u, Math.round(q * 1000) / 1000] as [string, number])
    .sort((a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99));
}

/** e.g. "120.5 m + 34.2 kg" (or "120.5 Meters + 34.2 Kg" with long names). */
export function formatTotals(rows: { uom?: string | null; quantity: number }[], long = false): string {
  const parts = totalsByUnit(rows).map(([u, q]) => `${q} ${long ? unitName(u) : unitLabel(u)}`);
  return parts.join(' + ') || '0';
}

/** Fabric type code as people read it: PLAIN_SHIRTING → "Plain Shirting". */
export function fabricCategoryLabel(code?: string | null): string {
  if (!code) return '';
  return code.toLowerCase().split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** Fabric type code from a typed name: "Denim Twill" → "DENIM_TWILL". */
export function fabricCategoryCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

type AttributeReader = {
  masterAttribute: {
    findUnique(args: { where: { type_value: { type: string; value: string } } }): Promise<{ unit: string | null } | null>;
  };
};

/**
 * The unit for a fabric type from the master catalogue (METERS or KG), or null when the
 * fabric type is not in the catalogue.
 */
export async function fabricUnitFor(db: AttributeReader, category?: string | null): Promise<FabricUnit | null> {
  if (!category) return null;
  const row = await db.masterAttribute.findUnique({ where: { type_value: { type: 'FABRIC_CATEGORY', value: category.trim().toUpperCase() } } });
  if (!row) return null;
  return row.unit === 'KG' ? 'KG' : 'METERS';
}
