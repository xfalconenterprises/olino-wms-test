import api from './api';

/**
 * Shows a print document inside the app, over the current screen, with Print and Close buttons.
 * Nothing opens in a new window, so it works in kiosk mode, where a new window has no way back.
 */
export function openPrintViewer(what = 'document') {
  const overlay = document.createElement('div');
  overlay.className = 'print-viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', what);

  const bar = document.createElement('div');
  bar.className = 'print-viewer-bar';
  const title = document.createElement('strong');
  title.textContent = what.charAt(0).toUpperCase() + what.slice(1);
  const actions = document.createElement('div');
  actions.className = 'print-viewer-actions';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn-secondary';
  closeButton.textContent = 'Close';
  const printButton = document.createElement('button');
  printButton.type = 'button';
  printButton.className = 'btn btn-primary';
  printButton.textContent = 'Print';
  printButton.disabled = true;
  actions.append(closeButton, printButton);
  bar.append(title, actions);

  const body = document.createElement('div');
  body.className = 'print-viewer-body';
  const loading = document.createElement('div');
  loading.className = 'print-viewer-loading';
  loading.textContent = `Loading ${what}…`;
  body.append(loading);
  overlay.append(bar, body);
  document.body.append(overlay);

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let frame: HTMLIFrameElement | null = null;

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    document.body.style.overflow = previousOverflow;
    overlay.remove();
  };
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKeyDown);
  closeButton.addEventListener('click', close);
  printButton.addEventListener('click', () => {
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  });

  return {
    show(html: string) {
      frame = document.createElement('iframe');
      frame.className = 'print-viewer-frame';
      frame.title = what;
      frame.addEventListener('load', () => { printButton.disabled = false; printButton.focus(); }, { once: true });
      frame.srcdoc = html;
      loading.replaceWith(frame);
    },
    close,
  };
}

/** Fetches a server-rendered print document (it needs the login) and shows it in the viewer. */
export async function openPrintPage(url: string, what = 'document'): Promise<void> {
  const viewer = openPrintViewer(what);
  try {
    const res = await api.get(url, { responseType: 'text' });
    viewer.show(res.data);
  } catch (err) {
    viewer.close();
    throw err;
  }
}

/** Error text from an API failure, for showing to the user. */
export function apiError(err: any, fallback: string): string {
  return err?.response?.data?.error || err?.message || fallback;
}
