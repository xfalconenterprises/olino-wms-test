/**
 * Olino WMS — Backend Date & Time Formatting Utilities
 * Standard: DD-MM-YYYY and Indian Standard Time (IST, Asia/Kolkata)
 */

function getIstParts(dateInput?: string | Date | null) {
  if (!dateInput) return null;

  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    const [year, month, day] = dateInput.trim().split('-');
    return { day, month, year, hour: '00', minute: '00', second: '00', dayPeriod: '' };
  }

  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (!d || isNaN(d.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
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

/**
 * Formats a date and time into DD-MM-YYYY hh:mm A in Indian Standard Time (IST).
 * Example: "20-10-2026 05:15 PM"
 */
export function formatDateTime(dateInput?: string | Date | null): string {
  const parts = getIstParts(dateInput);
  if (!parts) return '';
  const period = parts.dayPeriod ? ` ${parts.dayPeriod.toUpperCase()}` : '';
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}${period}`;
}

/**
 * Formats time only into hh:mm A in Indian Standard Time (IST).
 * Example: "05:15 PM"
 */
export function formatTime(dateInput?: string | Date | null): string {
  const parts = getIstParts(dateInput);
  if (!parts) return '';
  const period = parts.dayPeriod ? ` ${parts.dayPeriod.toUpperCase()}` : '';
  return `${parts.hour}:${parts.minute}${period}`;
}
