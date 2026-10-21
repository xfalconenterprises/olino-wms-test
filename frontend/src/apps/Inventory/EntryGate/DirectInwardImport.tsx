import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload, Printer, CheckCircle2, Trash2, AlertTriangle, ArrowDownToLine } from 'lucide-react';
import {
  IMPORT_COLUMNS, ITEM_TYPE_LABEL, buildImportTemplate, fieldValue, itemFieldColumns, readImportFile, remainingQty,
  unitLabel, validateImportRows, withoutDuplicates, type ImportLine, type InwardItemType,
} from '../../../utils/directInwardImport';

interface Props {
  itemType: InwardItemType;
  lines: ImportLine[]; // imported lines of every item type; this view shows its own type
  onLinesChange: (update: (prev: ImportLine[]) => ImportLine[]) => void;
  /** Saves one lump as a batch and prints its label; throws an Error with a message on failure. */
  inwardLump: (line: ImportLine, quantity: number, bundle: string) => Promise<void>;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export default function DirectInwardImport({ itemType, lines, onLinesChange, inwardLump }: Props) {
  const label = ITEM_TYPE_LABEL[itemType];
  const columns = IMPORT_COLUMNS[itemType];
  const fieldColumns = itemFieldColumns(itemType);
  const bundleLabel = itemType === 'ACCESSORY' ? 'Packet / Box No.' : 'Bundle No.';
  const ownLines = lines.filter(l => l.itemType === itemType);
  // Bundle and remarks are usually blank, so their columns appear only when a row has one
  const showBundle = ownLines.some(l => l.fields.bundle);
  const showNotes = ownLines.some(l => l.fields.notes);

  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [rejectedFile, setRejectedFile] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const firstToReceive = () => lines.find(l => l.itemType === itemType && remainingQty(l) > 0) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(() => firstToReceive()?.id ?? null);
  const [lumpQty, setLumpQty] = useState('');
  const [lumpBundle, setLumpBundle] = useState(() => firstToReceive()?.fields.bundle ?? '');
  const [saving, setSaving] = useState(false);
  const [lumpError, setLumpError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const qtyInput = useRef<HTMLInputElement>(null);

  const selected = ownLines.find(l => l.id === selectedId) ?? null;
  const remaining = selected ? remainingQty(selected) : 0;

  // Keep a valid selection: the chosen line, else the first one still to receive
  useEffect(() => {
    if (selected) return;
    const next = ownLines.find(l => remainingQty(l) > 0);
    setSelectedId(next?.id ?? null);
  }, [ownLines, selected]);

  // A newly selected line starts with its bundle number from the sheet
  useEffect(() => {
    setLumpQty('');
    setLumpError('');
    setLumpBundle(selected?.fields.bundle ?? '');
    if (selected) qtyInput.current?.focus();
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadTemplate = () => {
    const href = URL.createObjectURL(buildImportTemplate(itemType));
    const a = document.createElement('a');
    a.href = href;
    a.download = `olino-direct-inward-${itemType.toLowerCase().replace('_', '-')}-template.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setImportErrors([]);
    setRejectedFile('');
    setImportNotice('');
    try {
      const result = validateImportRows(itemType, await readImportFile(file));
      if (result.errors.length > 0) {
        setImportErrors(result.errors);
        setRejectedFile(file.name);
      } else {
        // Items already in the list (e.g. the same sheet imported again) are not added twice
        const { added, skipped } = withoutDuplicates(lines, result.lines);
        onLinesChange(prev => [...prev, ...added]);
        if (!selected && added.length > 0) setSelectedId(added[0].id);
        setImportNotice(added.length === 0
          ? `Nothing added: all ${skipped} row(s) in "${file.name}" are already in your list.`
          : `Added ${added.length} item(s) from "${file.name}".${skipped > 0 ? ` ${skipped} row(s) already in your list were skipped.` : ''}`);
      }
    } catch (err: any) {
      setImportErrors([err?.message || 'Could not read the file.']);
      setRejectedFile(file.name);
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const submitLump = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const qty = Number(lumpQty);
    if (!qty || qty <= 0) { setLumpError('Enter the quantity of this lump.'); return; }
    if (itemType === 'READY_MADE' && !Number.isInteger(qty)) { setLumpError('Pieces must be a whole number.'); return; }
    if (qty > remaining + 0.001) {
      setLumpError(`Only ${fmt(remaining)} ${unitLabel(selected.uom)} left on this item (total ${fmt(selected.quantity)}).`);
      return;
    }
    setSaving(true);
    setLumpError('');
    try {
      await inwardLump(selected, qty, lumpBundle);
      const done = qty >= remaining - 0.001;
      onLinesChange(prev => prev.map(l => l.id === selected.id
        ? { ...l, received: Math.round((l.received + qty) * 1000) / 1000, lumps: l.lumps + 1 }
        : l));
      setLumpQty('');
      if (done) {
        // Move on to the next item still to receive
        const next = ownLines.find(l => l.id !== selected.id && remainingQty(l) > 0);
        setSelectedId(next?.id ?? null);
      } else {
        qtyInput.current?.focus();
      }
    } catch (err: any) {
      setLumpError(err?.message || 'Failed to inward this lump.');
    } finally {
      setSaving(false);
    }
  };

  const clearList = () => {
    const pending = ownLines.filter(l => remainingQty(l) > 0).length;
    if (!window.confirm(pending > 0
      ? `Delete the imported ${label} list? ${pending} item(s) are not fully received. Lumps already inwarded stay in the session for the GRN.`
      : `Delete the imported ${label} list? Lumps already inwarded stay in the session for the GRN.`)) return;
    onLinesChange(prev => prev.filter(l => l.itemType !== itemType));
    setSelectedId(null);
  };

  const totals = ownLines.reduce((t, l) => ({ total: t.total + l.quantity, received: t.received + l.received }), { total: 0, received: 0 });
  const sameUnit = new Set(ownLines.map(l => l.uom)).size === 1 ? unitLabel(ownLines[0]?.uom ?? '') : '';

  return (
    <div>
      {/* Import bar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileSpreadsheet size={16} color="var(--color-brand)" /> Import {label} items from Excel
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
            One row per item with its total quantity. Columns:{' '}
            {columns.map((c, i) => (
              <span key={c.key}>
                <strong style={{ color: c.required ? '#0f172a' : undefined }}>{c.header}{c.required ? ' *' : ''}</strong>{i < columns.length - 1 ? ', ' : ''}
              </span>
            ))}
            . Files with other columns or invalid rows are rejected.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={downloadTemplate} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={14} /> {label} Template
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => fileInput.current?.click()} disabled={importing} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {importing ? <span className="spinner" /> : <Upload size={14} />} Import Excel
          </button>
          <input ref={fileInput} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
        </div>
      </div>

      {importNotice && importErrors.length === 0 && (
        <div className="alert alert-success" style={{ marginBottom: 16, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{importNotice}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportNotice('')} style={{ padding: '2px 8px' }}>OK</button>
        </div>
      )}

      {importErrors.length > 0 && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <AlertTriangle size={16} /> {rejectedFile ? `"${rejectedFile}" was rejected.` : 'File rejected.'} Fix these and import again:
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, maxHeight: 220, overflowY: 'auto' }}>
            {importErrors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      {ownLines.length === 0 ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13.5 }}>
          No {label} items imported yet. Download the template, fill one row per item, then click <strong>Import Excel</strong>.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>
              {ownLines.length} item(s) · {ownLines.filter(l => remainingQty(l) === 0).length} fully received
              {sameUnit && <> · {fmt(totals.received)} of {fmt(totals.total)} {sameUnit}</>}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearList} style={{ color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Trash2 size={13} /> Delete list
            </button>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
            <table className="table" style={{ width: '100%', margin: 0, fontSize: 13 }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>
                  <th style={{ width: 52 }}>Row</th>
                  {fieldColumns.map(c => <th key={c.key}>{c.header}</th>)}
                  {showBundle && <th>{bundleLabel}</th>}
                  {showNotes && <th>Remarks</th>}
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Received</th>
                  <th style={{ textAlign: 'right' }}>Remaining</th>
                  <th style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {ownLines.map(line => {
                  const left = remainingQty(line);
                  const unit = unitLabel(line.uom);
                  const active = line.id === selectedId;
                  return (
                    <tr key={line.id} onClick={() => left > 0 && setSelectedId(line.id)} style={{
                      cursor: left > 0 ? 'pointer' : 'default',
                      background: active ? 'var(--color-brand-faded)' : left === 0 ? '#f0fdf4' : undefined,
                      boxShadow: active ? 'inset 3px 0 0 var(--color-brand)' : undefined,
                    }}>
                      <td style={{ color: 'var(--color-text-muted)' }}>{line.rowNumber}</td>
                      {fieldColumns.map((c, i) => (
                        <td key={c.key} style={{ fontWeight: i === 0 ? 700 : 500, color: '#0f172a' }}>
                          {fieldValue(line, c.key) || <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>—</span>}
                        </td>
                      ))}
                      {showBundle && <td>{line.fields.bundle || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>}
                      {showNotes && <td style={{ color: 'var(--color-text-muted)' }}>{line.fields.notes || '—'}</td>}
                      <td style={{ textAlign: 'right' }}>{fmt(line.quantity)} {unit}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(line.received)} {unit}{line.lumps > 0 && <span style={{ color: 'var(--color-text-muted)' }}> ({line.lumps})</span>}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: left > 0 ? '#b45309' : '#047857' }}>{fmt(left)} {unit}</td>
                      <td>
                        {left === 0
                          ? <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={12} /> Done</span>
                          : line.lumps > 0
                            ? <span className="badge badge-warning">In progress</span>
                            : <span className="badge badge-neutral">Pending</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Lump entry for the selected item */}
          {selected && remaining > 0 ? (
            <form onSubmit={submitLump} style={{ marginTop: 16, border: '1.5px solid var(--color-brand)', borderRadius: 'var(--radius)', padding: 16, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 6 }}>RECEIVING ROW {selected.rowNumber}</div>
                  {/* Each field labelled, so similar items can't be mixed up */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {fieldColumns.filter(c => selected.fields[c.key]).map(c => (
                      <div key={c.key} style={{ background: '#f1f5f9', borderRadius: 6, padding: '4px 10px' }}>
                        <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{c.header}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{fieldValue(selected, c.key)}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>REMAINING</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#b45309' }}>
                    {fmt(remaining)} <span style={{ fontSize: 13, fontWeight: 600 }}>{unitLabel(selected.uom)} of {fmt(selected.quantity)}</span>
                  </div>
                </div>
              </div>

              {lumpError && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{lumpError}</div>}

              <div className="form-row" style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 160px' }}>
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>
                    This lump ({unitLabel(selected.uom)}) <span className="required">*</span>
                  </label>
                  <input ref={qtyInput} type="number" className="form-input" min={itemType === 'READY_MADE' ? 1 : 0.001}
                    step={itemType === 'READY_MADE' ? 1 : 'any'} placeholder={itemType === 'FABRIC' ? 'e.g. 52.40' : 'e.g. 24'}
                    value={lumpQty} onChange={e => setLumpQty(e.target.value)}
                    style={{ height: 40, fontSize: 15, fontWeight: 700 }} />
                </div>
                <div className="form-group" style={{ flex: '1 1 160px' }}>
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>
                    {itemType === 'ACCESSORY' ? 'Packet / Box Number' : 'Bundle Number'}{' '}
                    <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional)</span>
                  </label>
                  <input type="text" className="form-input" value={lumpBundle} onChange={e => setLumpBundle(e.target.value)}
                    placeholder="Leave blank if none" style={{ height: 40, fontSize: 13.5 }} />
                </div>
                <button type="button" onClick={() => { setLumpQty(fmt(remaining)); qtyInput.current?.focus(); }}
                  title={`Fill in the ${fmt(remaining)} ${unitLabel(selected.uom)} still to receive`}
                  style={{
                    height: 40, padding: '0 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', whiteSpace: 'nowrap',
                    border: '1.5px solid var(--color-brand)', background: 'var(--color-brand-faded)', color: 'var(--color-brand)',
                    fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                  <ArrowDownToLine size={15} /> All remaining ({fmt(remaining)})
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}
                  style={{ height: 40, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 220px', justifyContent: 'center' }}>
                  {saving ? <><span className="spinner" /> Inwarding…</> : <><Printer size={16} /> Inward Lump &amp; Print Label</>}
                </button>
              </div>
            </form>
          ) : (
            ownLines.every(l => remainingQty(l) === 0) && (
              <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 'var(--radius)', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={16} /> All imported {label} items are fully received. Finalize the inward to issue the GRN.
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
