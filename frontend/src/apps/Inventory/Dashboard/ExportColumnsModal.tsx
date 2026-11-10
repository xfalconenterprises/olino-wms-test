import { useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import api from '../../../utils/api';
import { saveFile } from '../../../utils/download';
import { formatDate } from '../../../utils/format';
import { buildStockWorkbook, headerOf, SHEETS } from './inventoryExport';
import type { ExportColumn } from './inventoryExport';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ExportChoice {
  off?: string[];
  skipped?: Record<string, string[]>;
}

/**
 * Asks which of Fabric, Readymade and Accessories to export and which columns each one gets,
 * starting from what this user chose last time, then logs the export and downloads the file.
 * A tab only offers columns that hold data for that item type.
 */
export default function ExportColumnsModal({ view, filters, lastChoice, heading, note, columns, rows, typeOf, valueTotals, onClose }: {
  view: string;
  filters: Record<string, string>;
  lastChoice: ExportChoice | null;
  heading: string;
  note: string;
  columns: ExportColumn[];
  rows: any[];
  valueTotals?: Record<string, string>;
  typeOf: (row: any) => string;
  onClose: () => void;
}) {
  const sections = useMemo(() => SHEETS
    .map(sheet => {
      const sheetRows = rows.filter(r => typeOf(r) === sheet.type);
      const choices = columns.filter(c => !c.required && sheetRows.some(r => {
        const value = c.value(r);
        return value !== null && value !== undefined && value !== '';
      }));
      return { ...sheet, count: sheetRows.length, choices };
    })
    .filter(s => s.count > 0), [columns, rows, typeOf]);

  const [included, setIncluded] = useState(() => new Set(sections.map(s => s.type).filter(t => !lastChoice?.off?.includes(t))));
  const [chosen, setChosen] = useState(() => Object.fromEntries(sections.map(s => [
    s.type,
    new Set(s.choices.map(c => c.key).filter(k => !lastChoice?.skipped?.[s.type]?.includes(k))),
  ])) as Record<string, Set<string>>);
  const [activeType, setActiveType] = useState(sections[0]?.type);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const active = sections.find(s => s.type === activeType);
  const always = columns.filter(c => c.required).map(c => c.header).join(', ');

  const toggleSheet = (type: string) => {
    setActiveType(type);
    setIncluded(current => {
      const next = new Set(current);
      if (!next.delete(type)) next.add(type);
      return next;
    });
  };

  const toggleColumn = (type: string, key: string) => setChosen(current => {
    const next = new Set(current[type]);
    if (!next.delete(key)) next.add(key);
    return { ...current, [type]: next };
  });

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const columnsFor = (type: string) => (included.has(type)
        ? columns.filter(c => c.required || chosen[type]?.has(c.key))
        : []);
      const file = await buildStockWorkbook({ heading, note, columnsFor, rows, typeOf, valueTotals });
      const taken = sections.filter(s => included.has(s.type));
      // Logged before the file is handed over: no record, no file
      await api.post('/api/inventory/export/log', {
        view,
        filters,
        rowCount: taken.reduce((sum, s) => sum + s.count, 0),
        columns: Object.fromEntries(taken.map(s => [s.name, columnsFor(s.type).map(c => headerOf(c, s.type))])),
        choice: {
          off: sections.filter(s => !included.has(s.type)).map(s => s.type),
          skipped: Object.fromEntries(sections.map(s => [s.type, s.choices.filter(c => !chosen[s.type]?.has(c.key)).map(c => c.key)])),
        },
      });
      saveFile(new Blob([file], { type: XLSX_TYPE }), `Olino_Stock_${heading.replace(/\s+/g, '_')}_${formatDate(new Date())}.xlsx`);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'The Excel file could not be created.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Export to Excel" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <div className="modal-title">Export to Excel</div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">
          {!active && <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No stock matches the current filters.</p>}
          {active && (
            <>
              <div className="export-tabs" role="tablist">
                {sections.map(s => (
                  <div key={s.type} className={`export-tab${s.type === active.type ? ' is-active' : ''}`}>
                    <label className="export-tab-check">
                      <input type="checkbox" aria-label={`Include ${s.name}`} checked={included.has(s.type)} onChange={() => toggleSheet(s.type)} />
                    </label>
                    <button type="button" role="tab" aria-selected={s.type === active.type} onClick={() => setActiveType(s.type)}>
                      <strong>{s.name}</strong>
                      <span>{s.count} {s.count === 1 ? 'row' : 'rows'}</span>
                    </button>
                  </div>
                ))}
              </div>
              <div className="export-panel">
                {!included.has(active.type) && <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{active.name} is left out of the file.</p>}
                {included.has(active.type) && (
                  <>
                    <div className="export-panel-head">
                      <span>Always included: {columns.filter(c => c.required).map(c => headerOf(c, active.type)).join(', ') || always}</span>
                      {active.choices.length > 0 && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen(c => ({ ...c, [active.type]: new Set(active.choices.map(x => x.key)) }))}>Select all</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen(c => ({ ...c, [active.type]: new Set() }))}>Clear</button>
                        </div>
                      )}
                    </div>
                    <div className="export-columns">
                      {active.choices.map(c => (
                        <label key={c.key} className={`export-column${chosen[active.type]?.has(c.key) ? ' is-on' : ''}`}>
                          <input type="checkbox" checked={chosen[active.type]?.has(c.key) ?? false} onChange={() => toggleColumn(active.type, c.key)} />
                          {headerOf(c, active.type)}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          {error && <div className="alert alert-danger" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !included.size} onClick={download}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> {busy ? 'Preparing...' : 'Download Excel'}
          </button>
        </div>
      </div>
    </div>
  );
}
