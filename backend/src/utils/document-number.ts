/**
 * Next number in a yearly document series, e.g. "CR-26-0001".
 * `latest` returns the highest existing number that starts with the prefix (or null).
 */
export async function nextDocumentNumber(
  series: string,
  latest: (prefix: string) => Promise<string | null | undefined>
): Promise<string> {
  const prefix = `${series}-${String(new Date().getFullYear()).slice(-2)}-`;
  const last = await latest(prefix);
  const seq = last ? (parseInt(last.slice(prefix.length), 10) || 0) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}
