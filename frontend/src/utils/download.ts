import api from './api';

/** Error text from an API failure, including file requests whose error body arrives as a Blob. */
export async function apiErrorMessage(err: any, fallback: string): Promise<string> {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).error || fallback; } catch { return fallback; }
  }
  return data?.error || err?.message || fallback;
}

/** Downloads an authenticated API file using the name the server suggests. */
export async function downloadFromApi(url: string, fallbackName: string): Promise<void> {
  const res = await api.get(url, { responseType: 'blob' });
  const disposition: string = res.headers['content-disposition'] || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  saveFile(res.data, name);
}

/** Hands a file made in the browser to the user as a download. */
export function saveFile(file: Blob, name: string): void {
  const href = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
