/**
 * Text that is safe to show the user for a failed request: the message of our own errors (e.g.
 * "Batch not found"), but never database or programming errors, whose text can reveal tables,
 * columns or code. Those get the fallback; the caller logs the real error.
 */
export function userMessage(err: unknown, fallback: string): string {
  const e = err as { message?: unknown; name?: unknown; code?: unknown; clientVersion?: unknown } | null;
  if (!e || typeof e.message !== 'string' || !e.message.trim()) return fallback;
  const name = String(e.name ?? '');
  const isDatabase = typeof e.clientVersion === 'string' || name.startsWith('Prisma') || /^P\d{4}$/.test(String(e.code ?? ''));
  const isProgramming = ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(name);
  return isDatabase || isProgramming ? fallback : e.message;
}
