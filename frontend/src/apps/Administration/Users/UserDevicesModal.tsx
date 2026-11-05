import { useEffect, useState } from 'react';
import { LogOut, MonitorSmartphone, X } from 'lucide-react';
import api from '../../../utils/api';
import { apiError } from '../../../utils/printPage';
import { formatDateTime } from '../../../utils/format';
import { useConfirm } from '../../../components/Common/ConfirmDialog';

interface Device {
  id: string;
  device: string;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

/** The devices a user is signed in on, with sign-out per device or everywhere at once. */
export default function UserDevicesModal({ user, onClose, onChanged }: {
  user: { id: string; name: string; maxSessions?: number | null };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDialog, ask] = useConfirm();

  const load = () => api.get(`/api/users/${user.id}/sessions`)
    .then(r => setDevices(r.data))
    .catch(err => setError(apiError(err, 'Could not load the devices.')));
  useEffect(() => { load(); }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async (d: Device) => {
    if (d.current && !(await ask('This is the device you are using now. You will be signed out here.', { confirm: 'Sign me out', cancel: 'Keep me signed in' }))) return;
    setBusy(d.id);
    setError('');
    try {
      await api.delete(`/api/users/${user.id}/sessions/${d.id}`);
      onChanged();
      await load();
    } catch (err) {
      setError(apiError(err, 'Could not sign the device out.'));
    } finally {
      setBusy(null);
    }
  };

  const signOutAll = async () => {
    const includesMe = devices?.some(d => d.current);
    const message = `Sign ${user.name} out on every device?${includesMe ? ' That includes this one, so you will be signed out too.' : ''}`;
    if (!(await ask(message, { confirm: 'Sign out all devices', cancel: 'Cancel' }))) return;
    setBusy('ALL');
    setError('');
    try {
      await api.post(`/api/users/${user.id}/sign-out-all`);
      onChanged();
      await load();
    } catch (err) {
      setError(apiError(err, 'Could not sign out the devices.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 560, boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafbfc' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MonitorSmartphone size={18} /> Devices · {user.name}
          </h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ padding: 4, color: 'var(--color-text-muted)' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {user.maxSessions
              ? `Allowed on ${user.maxSessions} device${user.maxSessions === 1 ? '' : 's'} at the same time. A new sign-in beyond that signs out the device used least recently.`
              : 'No limit on devices at the same time. Set one in Edit.'}
          </p>
          {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

          {devices === null ? (
            <div style={{ padding: 24, textAlign: 'center' }}><span className="spinner" /></div>
          ) : devices.length === 0 ? (
            <div style={{ padding: '18px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13.5 }}>Not signed in on any device.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {devices.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {d.device}
                      {d.current && <span className="badge badge-brand" style={{ fontSize: 10.5 }}>This device</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {[d.ipAddress, `Signed in ${formatDateTime(d.createdAt)}`, `Last active ${formatDateTime(d.lastSeenAt)}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => signOut(d)} disabled={busy !== null}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, whiteSpace: 'nowrap' }}>
                    {busy === d.id ? <span className="spinner" /> : <LogOut size={15} />} Sign out
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, paddingTop: 14, marginTop: 16, borderTop: '1px solid var(--color-border)' }}>
            <button type="button" className="btn btn-danger" onClick={signOutAll} disabled={busy !== null}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {busy === 'ALL' ? <span className="spinner" /> : <LogOut size={15} />} Sign out all devices
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
