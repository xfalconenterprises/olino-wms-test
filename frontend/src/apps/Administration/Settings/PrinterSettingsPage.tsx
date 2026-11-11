import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Pencil, Plus, Printer, RefreshCw, Search, Star, Trash2, X } from 'lucide-react';
import {
  addPrinterDevice,
  checkPrinterConnection,
  deletePrinterDevice,
  discoverPrinters,
  getPrinterSettings,
  getWorkstationPrinterId,
  savePrinterSettings,
  setDefaultPrinter,
  setWorkstationPrinterId,
  testPrintDirect,
  updatePrinterDevice,
  useAutoPrint,
  type DiscoveredPrinter,
  type MultiPrinterSettings,
  type PrinterDevice,
} from '../../../utils/printer';
import { apiError } from '../../../utils/printPage';
import '../../../styles/components.css';

// Label printers: which printers exist, whether they are reachable, and how labels print.

type LinkStatus = 'checking' | 'online' | 'offline';
type Notice = { type: 'success' | 'error'; text: string } | null;

interface PrinterForm {
  name: string;
  ip: string;
  port: number;
  dpi: number;
  gapMm: number;
  direction: number;
  isDefault: boolean;
}

const COPY_OPTIONS = [1, 2, 3, 4, 5];

export default function PrinterSettingsPage() {
  const [config, setConfig] = useState<MultiPrinterSettings>({ printers: [], copies: 1 });
  const [autoPrint, setAutoPrint] = useAutoPrint();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [links, setLinks] = useState<Record<string, LinkStatus>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [thisComputer, setThisComputer] = useState<string | null>(getWorkstationPrinterId());
  const [editing, setEditing] = useState<PrinterDevice | 'new' | null>(null);

  const show = (type: 'success' | 'error', text: string) => setNotice({ type, text });

  useEffect(() => {
    if (notice?.type !== 'success') return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const checkLink = async (printer: PrinterDevice) => {
    setLinks(prev => ({ ...prev, [printer.id]: 'checking' }));
    try {
      await checkPrinterConnection({ ip: printer.ip, port: printer.port });
      setLinks(prev => ({ ...prev, [printer.id]: 'online' }));
    } catch {
      setLinks(prev => ({ ...prev, [printer.id]: 'offline' }));
    }
  };

  useEffect(() => {
    getPrinterSettings()
      .then(data => { setConfig(data); data.printers.forEach(checkLink); })
      .catch(err => show('error', apiError(err, 'Could not load the printers.')))
      .finally(() => setLoading(false));
  }, []);

  const applyConfig = (next?: MultiPrinterSettings) => {
    if (!next) return;
    setConfig(next);
  };

  const testLabel = async (printer: PrinterDevice) => {
    setTesting(printer.id);
    try {
      await testPrintDirect({ printerId: printer.id, ip: printer.ip, port: printer.port, dpi: printer.dpi });
      setLinks(prev => ({ ...prev, [printer.id]: 'online' }));
      show('success', `Test label sent to ${printer.name}.`);
    } catch (err) {
      setLinks(prev => ({ ...prev, [printer.id]: 'offline' }));
      show('error', `${printer.name} did not respond. Check that it is switched on and connected.`);
      console.warn(apiError(err, 'Test print failed'));
    } finally {
      setTesting(null);
    }
  };

  const makeDefault = async (printer: PrinterDevice) => {
    try {
      const res = await setDefaultPrinter(printer.id);
      applyConfig(res.config);
      show('success', `${printer.name} is now the default printer.`);
    } catch (err) {
      show('error', apiError(err, 'Could not change the default printer.'));
    }
  };

  const remove = async (printer: PrinterDevice) => {
    if (!confirm(`Remove ${printer.name} (${printer.ip})?`)) return;
    try {
      const res = await deletePrinterDevice(printer.id);
      applyConfig(res.config);
      if (thisComputer === printer.id) chooseForThisComputer(null);
      show('success', `${printer.name} removed.`);
    } catch (err) {
      show('error', apiError(err, 'Could not remove the printer.'));
    }
  };

  const chooseForThisComputer = (id: string | null) => {
    setWorkstationPrinterId(id);
    setThisComputer(id);
  };

  // Copies per label (shared by every computer) saves as soon as it is changed
  const saveOption = async (change: Pick<MultiPrinterSettings, 'copies'>) => {
    const previous = config;
    setConfig(prev => ({ ...prev, ...change }));
    try {
      await savePrinterSettings(change);
      show('success', 'Saved.');
    } catch (err) {
      setConfig(previous);
      show('error', apiError(err, 'Could not save the setting.'));
    }
  };

  if (loading) return <div className="loading-center"><span className="spinner spinner-lg" /></div>;

  const printers = config.printers;
  const defaultPrinter = printers.find(p => p.isDefault) ?? printers[0];
  const chosenForComputer = printers.some(p => p.id === thisComputer) ? thisComputer : null;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', paddingBottom: 60 }}>
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Printer size={28} /> Label Printers
          </h1>
          <p className="page-subtitle">Printers for the roll and pack barcode labels (100 × 50 mm)</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Add Printer
        </button>
      </div>

      {notice && (
        <div className={`alert ${notice.type === 'success' ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          {notice.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{notice.text}</span>
        </div>
      )}

      <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
        {printers.map((printer, i) => (
          <div key={printer.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', flexWrap: 'wrap', borderTop: i ? '1px solid var(--color-border)' : 'none' }}>
            <LinkBadge status={links[printer.id]} onRetry={() => checkLink(printer)} />
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                {printer.name}
                {printer.isDefault && <span className="badge badge-success" style={{ fontSize: 10.5, padding: '1px 7px' }}>Default</span>}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', fontFamily: 'monospace', marginTop: 2 }}>{printer.ip}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => testLabel(printer)} disabled={testing === printer.id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 6 }}>
                {testing === printer.id ? <span className="spinner spinner-sm" /> : <Printer size={14} />} Test Label
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => makeDefault(printer)} title="Make default" aria-label="Make default"
                style={{ padding: '4px 8px', visibility: printer.isDefault ? 'hidden' : 'visible' }}>
                <Star size={15} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(printer)} title="Edit" aria-label="Edit" style={{ padding: '4px 8px' }}>
                <Pencil size={15} />
              </button>
              {printers.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(printer)} title="Remove" aria-label="Remove" style={{ padding: '4px 8px', color: 'var(--color-danger)' }}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '6px 18px' }}>
        {printers.length > 1 && (
          <SettingRow title="This computer prints to" hint="Saved on this computer only">
            <select className="form-select" value={chosenForComputer ?? ''} onChange={e => chooseForThisComputer(e.target.value || null)} style={{ width: 260, flex: 'none' }}>
              <option value="">Default printer ({defaultPrinter?.name})</option>
              {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </SettingRow>
        )}
        <SettingRow title="Print labels automatically on this computer" hint="As soon as a roll or pack is received here. Saved on this computer only; also on the Stock In screens">
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoPrint} onChange={e => setAutoPrint(e.target.checked)}
              aria-label="Print labels automatically on this computer" style={{ width: 24, height: 24, accentColor: 'var(--color-brand)' }} />
          </label>
        </SettingRow>
        <SettingRow title="Copies of each label" last>
          <select className="form-select" value={config.copies} onChange={e => saveOption({ copies: Number(e.target.value) })} aria-label="Copies of each label" style={{ width: 80, flex: 'none' }}>
            {[...new Set([...COPY_OPTIONS, config.copies])].sort((a, b) => a - b).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </SettingRow>
      </div>

      {editing && (
        <PrinterDialog
          printer={editing === 'new' ? null : editing}
          isFirst={printers.length === 0}
          onClose={() => setEditing(null)}
          onSaved={(next, message) => {
            applyConfig(next);
            setEditing(null);
            show('success', message);
            next?.printers.forEach(checkLink);
          }}
        />
      )}
    </div>
  );
}

function LinkBadge({ status, onRetry }: { status?: LinkStatus; onRetry: () => void }) {
  if (status === 'online') {
    return <span className="badge badge-success" style={{ fontSize: 11.5, width: 84, flex: 'none', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={12} /> Online</span>;
  }
  if (status === 'offline') {
    return (
      <button type="button" onClick={onRetry} title="Check again" className="badge badge-danger"
        style={{ fontSize: 11.5, width: 84, flex: 'none', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer' }}>
        <AlertCircle size={12} /> Offline
      </button>
    );
  }
  return <span className="badge badge-neutral" style={{ fontSize: 11.5, width: 84, flex: 'none', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 4 }}><RefreshCw size={11} className="spinner" /> Checking</span>;
}

function SettingRow({ title, hint, last, children }: { title: string; hint?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: last ? 'none' : '1px solid var(--color-border)' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function PrinterDialog({ printer, isFirst, onClose, onSaved }: {
  printer: PrinterDevice | null;
  isFirst: boolean;
  onClose: () => void;
  onSaved: (config: MultiPrinterSettings | undefined, message: string) => void;
}) {
  const [form, setForm] = useState<PrinterForm>({
    name: printer?.name ?? '',
    ip: printer?.ip ?? '',
    port: printer?.port ?? 9100,
    dpi: printer?.dpi ?? 203,
    gapMm: printer?.gapMm ?? 3,
    direction: printer?.direction === 0 ? 0 : 1,
    isDefault: printer?.isDefault ?? isFirst,
  });
  const [check, setCheck] = useState<{ status: 'checking' | 'ok' | 'failed'; text: string } | null>(null);
  const [found, setFound] = useState<DiscoveredPrinter[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (change: Partial<PrinterForm>) => setForm(prev => ({ ...prev, ...change }));

  const testConnection = async () => {
    if (!form.ip.trim()) return;
    setCheck({ status: 'checking', text: 'Checking…' });
    try {
      await checkPrinterConnection({ ip: form.ip.trim(), port: form.port });
      setCheck({ status: 'ok', text: 'Printer found' });
    } catch {
      setCheck({ status: 'failed', text: 'No printer found at this address' });
    }
  };

  const scan = async () => {
    setScanning(true);
    setError('');
    setFound(null);
    try {
      setFound((await discoverPrinters()).printers);
    } catch (err) {
      setError(apiError(err, 'Could not search the network.'));
    } finally {
      setScanning(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, name: form.name.trim(), ip: form.ip.trim() };
      const res = printer ? await updatePrinterDevice(printer.id, payload) : await addPrinterDevice(payload);
      onSaved(res.config, printer ? `${payload.name} updated.` : `${payload.name} added.`);
    } catch (err) {
      setError(apiError(err, 'Could not save the printer.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <form onSubmit={save} className="card" style={{ width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{printer ? 'Edit Printer' : 'Add Printer'}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close" style={{ padding: 4 }}><X size={18} /></button>
        </div>

        {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

        <div className="form-group" style={{ marginBottom: 14 }}>
          <label className="form-label">Printer name <span className="required">*</span></label>
          <input className="form-input" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Receiving Dock" maxLength={60} required autoFocus />
        </div>

        <div className="form-group" style={{ marginBottom: 8 }}>
          <label className="form-label">IP address <span className="required">*</span></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" value={form.ip} onChange={e => { set({ ip: e.target.value.trim() }); setCheck(null); }}
              placeholder="e.g. 192.168.1.150" required style={{ fontFamily: 'monospace', flex: 1 }} />
            <button type="button" className="btn btn-secondary" onClick={testConnection} disabled={!form.ip.trim() || check?.status === 'checking'}>Check</button>
          </div>
          {check && (
            <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6, color: check.status === 'ok' ? 'var(--color-success)' : check.status === 'failed' ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
              {check.text}
            </div>
          )}
        </div>

        {!printer && (
          <div style={{ marginBottom: 14 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={scan} disabled={scanning} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 0', color: 'var(--color-brand)' }}>
              {scanning ? <span className="spinner spinner-sm" /> : <Search size={14} />} {scanning ? 'Searching the network…' : "Don't know the IP? Find printers"}
            </button>
            {found && found.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {found.map(p => (
                  <button key={p.ip} type="button" className="btn btn-secondary btn-sm" onClick={() => { set({ ip: p.ip, port: p.port }); setCheck({ status: 'ok', text: 'Printer found' }); }}
                    style={{ justifyContent: 'space-between', display: 'flex' }}>
                    <span style={{ fontFamily: 'monospace' }}>{p.ip}</span><span>Use this printer</span>
                  </button>
                ))}
              </div>
            )}
            {found && found.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.5 }}>
                No printers found. Check the printer is on and its network cable is plugged in. To print its IP address, switch it off, hold <strong>FEED</strong>, and switch it on.
              </div>
            )}
          </div>
        )}

        {!printer?.isDefault && !isFirst && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, marginBottom: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isDefault} onChange={e => set({ isDefault: e.target.checked })} /> Make this the default printer
          </label>
        )}

        <details style={{ marginBottom: 16, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontWeight: 600 }}>More options</summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div className="form-group">
              <label className="form-label">Print resolution</label>
              <select className="form-select" value={form.dpi} onChange={e => set({ dpi: Number(e.target.value) })}>
                <option value={203}>203 DPI (most printers)</option>
                <option value={300}>300 DPI</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Label direction</label>
              <select className="form-select" value={form.direction} onChange={e => set({ direction: Number(e.target.value) })}>
                <option value={1}>Normal</option>
                <option value={0}>Upside down</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Gap between labels (mm)</label>
              <input type="number" className="form-input" min="1" max="10" step="0.5" value={form.gapMm} onChange={e => set({ gapMm: Number(e.target.value) || 3 })} />
            </div>
            <div className="form-group">
              <label className="form-label">Port</label>
              <input type="number" className="form-input" min="1" max="65535" value={form.port} onChange={e => set({ port: Number(e.target.value) || 9100 })} />
            </div>
          </div>
        </details>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <span className="spinner spinner-sm" /> : printer ? 'Save' : 'Add Printer'}</button>
        </div>
      </form>
    </div>
  );
}
