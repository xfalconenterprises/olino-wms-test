import fs from 'fs';
import path from 'path';

/**
 * Escapes text for safe insertion into server-rendered HTML (print documents, label previews).
 * Every database or request value placed in a template must pass through this.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let cachedLogo: string | undefined;

/**
 * Company logo for print headers as a data URI ('' when not found).
 * Resolves the same from src/ (tsx) and dist/ (compiled builds).
 */
export function companyLogoDataUri(): string {
  if (cachedLogo !== undefined) return cachedLogo;
  const candidates = [
    path.resolve(__dirname, '../../../frontend/dist/logo.png'),
    path.resolve(__dirname, '../../../frontend/public/logo.png'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  cachedLogo = found ? `data:image/png;base64,${fs.readFileSync(found).toString('base64')}` : '';
  return cachedLogo;
}
