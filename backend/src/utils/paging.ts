import type { Request } from 'express';

/**
 * Long lists go to the screens a page at a time: a screen asks with ?limit=50&offset=100 and gets
 * { rows, total, hasMore, ...counts }. Callers that leave out ?limit get the plain list as before
 * (exports, other screens). Filtering and search always happen here, so they cover every row.
 */
export const PAGE_SIZE = 50;
const MAX_PAGE = 200;

export type Page = { take: number; skip: number };

/** The page asked for, or null when the caller wants the plain list. */
export function pageOf(query: Request['query']): Page | null {
  if (query.limit === undefined) return null;
  const take = Math.min(MAX_PAGE, Math.max(1, parseInt(String(query.limit), 10) || PAGE_SIZE));
  const skip = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);
  return { take, skip };
}

export function pageReply<T>(rows: T[], total: number, page: Page, extra: Record<string, unknown> = {}) {
  return { rows, total, hasMore: page.skip + rows.length < total, ...extra };
}
