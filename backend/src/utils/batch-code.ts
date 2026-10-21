/**
 * Generates a clean, compact batch code prefix for warehouse barcode tracking.
 * Avoids awkward "UNKNOWN" tags and keeps Code 128 barcodes compact (< 18 chars).
 */
export function generateSmartBatchCodePrefix(
  brand?: string | null,
  quality?: string | null,
  shade?: string | null,
  extra?: { itemType?: string; name?: string; size?: string; category?: string }
): string {
  // 1. Clean Brand code (Max 4-5 chars)
  let cleanBrand = (brand || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanBrand || cleanBrand === 'UNKNOWN' || cleanBrand.startsWith('OLINO')) {
    cleanBrand = 'OLN';
  } else if (cleanBrand.length > 5) {
    cleanBrand = cleanBrand.substring(0, 4);
  }

  // 2. Clean Quality / Product segment (Max 4-5 chars)
  let cleanQual = (quality || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanQual || cleanQual === 'UNKNOWN') {
    // Check extra name or category for Ready-Made / Accessories
    const altName = (extra?.name || extra?.category || '').trim().toUpperCase();
    if (altName.includes('TROUSER') || altName.includes('PANT')) {
      cleanQual = 'TRSR';
    } else if (altName.includes('SHIRT')) {
      cleanQual = 'SHRT';
    } else if (altName.includes('BLAZER') || altName.includes('COAT')) {
      cleanQual = 'BLZR';
    } else if (altName.includes('SKIRT')) {
      cleanQual = 'SKRT';
    } else if (altName.includes('FROCK') || altName.includes('PINAFORE')) {
      cleanQual = 'FRCK';
    } else if (altName.includes('TIE')) {
      cleanQual = 'TIE';
    } else if (altName.includes('BELT')) {
      cleanQual = 'BELT';
    } else if (altName.includes('BUTTON')) {
      cleanQual = 'BTN';
    } else if (extra?.itemType === 'READY_MADE') {
      cleanQual = 'GARMT';
    } else if (extra?.itemType === 'ACCESSORY') {
      cleanQual = 'ACC';
    } else {
      cleanQual = 'FAB';
    }
  } else if (cleanQual.length > 5) {
    cleanQual = cleanQual.substring(0, 4);
  }

  // 3. Clean Shade / Size segment (Max 4 chars)
  const rawShade = (shade || extra?.size || '').trim().toUpperCase();
  let cleanShade = '';
  if (rawShade && rawShade !== 'UNKNOWN') {
    const words = rawShade.split(/[\s-]+/);
    if (words.length === 1) {
      cleanShade = words[0].substring(0, 4).replace(/[^A-Z0-9]/g, '');
    } else {
      // First letter of each word + any trailing digits
      const digits = rawShade.replace(/[^0-9]/g, '');
      const initials = words.map(w => w.charAt(0)).join('');
      cleanShade = `${initials}${digits}`.substring(0, 4);
    }
  }
  if (!cleanShade) {
    cleanShade = '01';
  }

  return `${cleanBrand}-${cleanQual}-${cleanShade}-`;
}
