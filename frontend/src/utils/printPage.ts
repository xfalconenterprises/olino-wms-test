import api from './api';

/**
 * Opens a server-rendered print document that needs the login. The window opens before the
 * request so pop-up blockers allow it, then the document is written into it.
 */
export async function openPrintPage(url: string, what = 'document'): Promise<void> {
  const win = window.open('', '_blank');
  win?.document.write(`<div style="font-family:sans-serif;padding:40px;text-align:center;color:#64748b;">Loading ${what}…</div>`);
  try {
    const res = await api.get(url, { responseType: 'text' });
    if (win) {
      win.document.open();
      win.document.write(res.data);
      win.document.close();
    }
  } catch (err) {
    win?.close();
    throw err;
  }
}

/** Error text from an API failure, for showing to the user. */
export function apiError(err: any, fallback: string): string {
  return err?.response?.data?.error || err?.message || fallback;
}
