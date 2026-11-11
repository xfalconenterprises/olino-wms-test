import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiError } from '../../utils/printPage';
import { PageTitle, rupees, useCostApi } from './shared';

// The secret code word that turns a cost into letters on labels and in Inventory.

interface CodeSettings { codeWord: string }
const SAMPLE_PRICES = [245, 180, 200, 1150];

export function SecretCodePage() {
  const costApi = useCostApi();
  const [form, setForm] = useState<CodeSettings>({ codeWord: '' });
  const [saved, setSaved] = useState<CodeSettings | null>(null);
  const [preview, setPreview] = useState<{ price: number; code: string; examples: string[] }[]>([]);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    costApi<CodeSettings & { updatedAt: string | null }>({ url: '/api/accounts/code-settings' })
      .then(s => { const v = { codeWord: s.codeWord }; setForm(v); setSaved(s.codeWord ? v : null); })
      .catch(err => { if (err?.response?.status !== 423) setError(apiError(err, 'Failed to load the code settings')); });
  }, [costApi]);

  // Live preview of the codes these settings would print
  useEffect(() => {
    clearTimeout(timer.current);
    if (!form.codeWord) { setPreview([]); setPreviewError(''); return; }
    timer.current = setTimeout(() => {
      costApi<{ codes: { price: number; code: string; examples: string[] }[] }>({ method: 'POST', url: '/api/accounts/code-preview', data: { settings: form, prices: SAMPLE_PRICES } })
        .then(r => { setPreview(r.codes); setPreviewError(''); })
        .catch(err => { setPreview([]); if (err?.response?.status !== 423) setPreviewError(apiError(err, '')); });
    }, 300);
    return () => clearTimeout(timer.current);
  }, [form, costApi]);

  const setCodeWord = (e: React.ChangeEvent<HTMLInputElement>) => setForm({ codeWord: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saved && saved.codeWord !== form.codeWord &&
      !window.confirm('Labels already printed keep the code from the old word. Change the code word anyway?')) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const s = await costApi<CodeSettings>({ method: 'PUT', url: '/api/accounts/code-settings', data: form });
      setForm(s); setSaved(s); setSuccess('Saved. New labels will print codes with these settings.');
    } catch (err: any) {
      if (err?.response?.status !== 423) setError(apiError(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const letters = form.codeWord.padEnd(10, ' ').slice(0, 10).split('');

  return (
    <>
    <PageTitle title="Secret Code" text="The code word that prints costs on labels and in Inventory as letters." />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
      <form onSubmit={save} className="card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Secret code word</h2>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
          10 letters, none repeated. They stand for the digits 1, 2, 3, 4, 5, 6, 7, 8, 9, 0. Costs are coded in whole rupees. Avoid well-known words.
          Each label adds 2 random letters before the code and 1 after; they are never letters of the code word, so just skip the first two letters and the last one.
        </p>
        {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
        {success && <div className="alert alert-success" style={{ marginBottom: 12 }}>{success}</div>}

        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Code word <span className="required">*</span></label>
          <input className="form-input" maxLength={10} value={form.codeWord} onChange={setCodeWord} placeholder="10 different letters"
            style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 3 }} autoComplete="off" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4, marginBottom: 14, textAlign: 'center', fontFamily: 'monospace' }}>
          {letters.map((ch, i) => (
            <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 0', background: '#f8fafc' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{(i + 1) % 10}</div>
              <div style={{ fontWeight: 700 }}>{ch.trim() || '·'}</div>
            </div>
          ))}
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving || form.codeWord.length !== 10}>
          {saving ? <span className="spinner" /> : 'Save code settings'}
        </button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>How labels will look</h2>
          {previewError && <div className="alert alert-warning">{previewError}</div>}
          {!previewError && preview.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>Type a 10-letter code word to see examples.</p>}
          {preview.length > 0 && (
            <table className="table" style={{ fontSize: 13, margin: 0 }}>
              <thead><tr><th>Cost</th><th>Code</th><th>On three different rolls</th></tr></thead>
              <tbody>
                {preview.map(p => (
                  <tr key={p.price}>
                    <td>{rupees(p.price)}</td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 2 }}>{p.code}</td>
                    <td style={{ fontFamily: 'monospace', letterSpacing: 2 }}>{p.examples.join('   ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
