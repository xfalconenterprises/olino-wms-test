import { useEffect, useState } from 'react';
import { FileDown, X } from 'lucide-react';
import api from '../../../utils/api';
import DateField from '../../../components/Common/DateField';
import { formatDate, formatDateTime } from '../../../utils/format';
import { ITEM_FILTER_NAMES } from '../../../utils/itemFilters';
import '../../../styles/components.css';

interface ExportEntry {
  id: string;
  userName: string;
  view: string;
  filters: Record<string, string>;
  rowCount: number;
  columns: Record<string, string[]> | null;
  createdAt: string;
}

const FILTER_NAMES: Record<string, string> = {
  ...ITEM_FILTER_NAMES,
  search: 'Search', status: 'Status', location: 'Location',
  itemType: 'Type', startDate: 'From', endDate: 'To', client: 'Client', asOnDate: 'As on',
};

const VIEW_NAMES: Record<string, string> = {
  GRANULAR: 'Granular', ROLLUP: 'SKU Rollup', ACCOUNTS_STOCK_VALUE: 'Accounts: Stock Value', ACCOUNTS_CLOSING_STOCK: 'Accounts: Closing Stock',
};

const filterText = (filters: Record<string, string>) => Object.entries(filters)
  .map(([key, value]) => `${FILTER_NAMES[key] ?? key}: ${key.endsWith('Date') ? formatDate(value) : value}`)
  .join(' · ');

// Who took stock data out of the system as Excel, and exactly what they took.
export default function ExportLogPage() {
  const [entries, setEntries] = useState<ExportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (startDate) params.from = startDate;
    if (endDate) params.to = endDate;
    api.get('/api/inventory/export-log', { params })
      .then(r => setEntries(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  const anyFilters = entries.some(e => Object.keys(e.filters).length > 0);

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileDown size={28} /> Export Log
          </h1>
          <p className="page-subtitle">Every stock export to Excel: who took it, when, and what was in it</p>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DateField compact short="From" label="From date" value={startDate} onChange={setStartDate} max={endDate || undefined} />
          <DateField compact short="To" label="To date" value={endDate} onChange={setEndDate} min={startDate || undefined} />
          {(startDate || endDate) && (
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => { setStartDate(''); setEndDate(''); }}
              title="Clear date filter" aria-label="Clear date filter">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner spinner-lg" /></div>
      ) : entries.length === 0 ? (
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="empty-state-icon"><FileDown size={48} className="text-muted" /></div>
            <div className="empty-state-text">No exports found</div>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>User</th>
                <th>View</th>
                <th>Rows</th>
                <th>Sheets &amp; Columns</th>
                {anyFilters && <th>Filters</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.createdAt)}</td>
                  <td style={{ fontWeight: 600 }}>{e.userName}</td>
                  <td>{VIEW_NAMES[e.view] ?? e.view}</td>
                  <td>{e.rowCount.toLocaleString('en-IN')}</td>
                  <td style={{ fontSize: 12.5 }}>
                    {Object.entries(e.columns ?? {}).map(([sheet, headers]) => (
                      <div key={sheet}><strong>{sheet}:</strong> {headers.join(', ')}</div>
                    ))}
                  </td>
                  {anyFilters && <td style={{ fontSize: 12.5 }}>{filterText(e.filters)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
