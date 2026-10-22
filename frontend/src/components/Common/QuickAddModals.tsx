import { useState, type FormEvent, type ReactNode } from 'react';
import { Building2, Users, X } from 'lucide-react';
import api from '../../utils/api';
import { apiError } from '../../utils/printPage';

// Quick Add Supplier / Quick Add Master Client, used wherever a supplier or client can be added
// on the spot (purchase orders, entry gate, exit gate). Only the essentials are asked for here;
// the rest can be filled in later on the Suppliers / Clients pages.

const optional = <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(Optional)</span>;
const required = <span className="required">*</span>;

function Field({ label, children, flex }: { label: ReactNode; children: ReactNode; flex?: boolean }) {
  return (
    <div className="form-group" style={flex ? { flex: 1 } : { marginBottom: 14 }}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

function QuickAddShell({ title, icon, error, submitting, submitLabel, onClose, onSubmit, children }: {
  title: string;
  icon: ReactNode;
  error: string;
  submitting: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 520, boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {icon} {title}
          </h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ padding: 4, color: 'var(--color-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ padding: 20 }}>
          {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
          {children}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 12, marginTop: 6, borderTop: '1px solid var(--color-border)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {submitting ? <span className="spinner" /> : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Supplier name, city and state are required; phone is optional. */
export function QuickAddSupplierModal({ initialName = '', onClose, onCreated }: {
  initialName?: string;
  onClose: () => void;
  onCreated: (supplier: any) => void;
}) {
  const [form, setForm] = useState({ name: initialName.trim(), city: '', state: '', phone: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim(), city = form.city.trim(), state = form.state.trim();
    if (!name || !city || !state) {
      setError('Supplier name, city and state are required.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/api/suppliers', { name, city, state, phone: form.phone.trim() || undefined });
      onCreated(res.data);
    } catch (err) {
      setError(apiError(err, 'Failed to create supplier'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <QuickAddShell title="Quick Add Supplier" icon={<Building2 size={18} />} error={error} submitting={submitting}
      submitLabel="Save & Select Supplier" onClose={onClose} onSubmit={submit}>
      <Field label={<>Supplier Name {required}</>}>
        <input type="text" className="form-input" placeholder="e.g. Siyaram Silk Mills Ltd." value={form.name} onChange={set('name')} required autoFocus />
      </Field>
      <div className="form-row" style={{ marginBottom: 14 }}>
        <Field flex label={<>City {required}</>}>
          <input type="text" className="form-input" placeholder="e.g. Surat" value={form.city} onChange={set('city')} required />
        </Field>
        <Field flex label={<>State {required}</>}>
          <input type="text" className="form-input" placeholder="e.g. Gujarat" value={form.state} onChange={set('state')} required />
        </Field>
      </div>
      <Field label={<>Phone Number {optional}</>}>
        <input type="tel" className="form-input" placeholder="e.g. +91 98200 12345" value={form.phone} onChange={set('phone')} />
      </Field>
    </QuickAddShell>
  );
}

const CLIENT_TYPES = ['School', 'Wholesaler', 'Retailer', 'Corporate', 'Institution', 'Uniform Distributor', 'Garment Manufacturer', 'Other'];

/** Client name, address and city are required; type of client, phone and contact person are optional. */
export function QuickAddClientModal({ initialName = '', initialType = '', initialCity = '', onClose, onCreated }: {
  initialName?: string;
  initialType?: string;
  initialCity?: string;
  onClose: () => void;
  onCreated: (client: any) => void;
}) {
  const [form, setForm] = useState({ name: initialName.trim(), address: '', city: initialCity.trim(), clientType: initialType, phone: '', contactPerson: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim(), address = form.address.trim(), city = form.city.trim();
    if (!name || !address || !city) {
      setError('Client name, address and city are required.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/api/clients', {
        name, address, city,
        clientType: form.clientType.trim() || undefined,
        phone: form.phone.trim() || undefined,
        contactPerson: form.contactPerson.trim() || undefined,
      });
      onCreated(res.data);
    } catch (err) {
      setError(apiError(err, 'Failed to save client details'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <QuickAddShell title="Quick Add Master Client" icon={<Users size={18} />} error={error} submitting={submitting}
      submitLabel="Save & Select Client" onClose={onClose} onSubmit={submit}>
      <Field label={<>Client / School / Customer Name {required}</>}>
        <input type="text" className="form-input" placeholder="e.g. Al-Ameen School, DPS International" value={form.name} onChange={set('name')} required autoFocus />
      </Field>
      <Field label={<>Address {required}</>}>
        <input type="text" className="form-input" placeholder="e.g. Main Campus, P.O. Box 14, Near Junction" value={form.address} onChange={set('address')} required />
      </Field>
      <div className="form-row" style={{ marginBottom: 14 }}>
        <Field flex label={<>City {required}</>}>
          <input type="text" className="form-input" placeholder="e.g. Manjeri" value={form.city} onChange={set('city')} required />
        </Field>
        <Field flex label={<>Type of Client {optional}</>}>
          <input type="text" className="form-input" list="quick-add-client-types" placeholder="e.g. School" value={form.clientType} onChange={set('clientType')} />
          <datalist id="quick-add-client-types">
            {CLIENT_TYPES.map(t => <option key={t} value={t} />)}
          </datalist>
        </Field>
      </div>
      <div className="form-row" style={{ marginBottom: 14 }}>
        <Field flex label={<>Phone Number {optional}</>}>
          <input type="tel" className="form-input" placeholder="e.g. +91 98470 12345" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field flex label={<>Contact Person {optional}</>}>
          <input type="text" className="form-input" placeholder="e.g. Mr. Rajesh / Principal" value={form.contactPerson} onChange={set('contactPerson')} />
        </Field>
      </div>
    </QuickAddShell>
  );
}
