/**
 * Olino WMS — Backend Date Formatting Utilities
 * Standard: DD-MM-YYYY and Indian Standard Time (IST, Asia/Kolkata)
 */

function getIstParts(dateInput?: string | Date | null) {
  if (!dateInput) return null;

  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    const [year, month, day] = dateInput.trim().split('-');
    return { day, month, year };
  }

  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (!d || isNaN(d.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return map;
}

/**
 * Formats a date into DD-MM-YYYY in Indian Standard Time (IST).
 * Example: "20-10-2026"
 */
export function formatDate(dateInput?: string | Date | null): string {
  const parts = getIstParts(dateInput);
  if (!parts) return '';
  return `${parts.day}-${parts.month}-${parts.year}`;
}

/** The calendar day in IST as YYYY-MM-DD (today when no date is given). */
export function istDateKey(date: Date = new Date()): string {
  const parts = getIstParts(date)!;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The first moment of a YYYY-MM-DD day in IST, wherever the server runs; null if not a date. */
export function istDayStart(day: unknown): Date | null {
  const d = new Date(`${String(day).slice(0, 10)}T00:00:00.000+05:30`);
  return isNaN(d.getTime()) ? null : d;
}

/** The last moment of a YYYY-MM-DD day in IST; null if not a date. */
export function istDayEnd(day: unknown): Date | null {
  const d = new Date(`${String(day).slice(0, 10)}T23:59:59.999+05:30`);
  return isNaN(d.getTime()) ? null : d;
}

/** The receipt date on barcode labels: YYMMDD in IST, e.g. 4 November 2026 is 261104. */
export function labelDate(date: Date = new Date()): string {
  return istDateKey(date).replace(/-/g, '').slice(2);
}
