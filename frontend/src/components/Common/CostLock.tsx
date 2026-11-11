import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LockKeyhole, Unlock, Lock } from 'lucide-react';
import type { AxiosRequestConfig } from 'axios';
import api from '../../utils/api';
import { apiError } from '../../utils/printPage';

// Accounts opens only after the user re-enters their password.
// They stay open for a few minutes and lock again when the time is up or the user leaves them.

export interface CostUnlock { token: string; expiresAt: number }
export type CostApi = <T>(config: AxiosRequestConfig) => Promise<T>;

/** The unlock, a countdown, and an API caller that sends the unlock and locks on a 423 answer. */
export function useCostUnlock() {
  const [unlock, setUnlock] = useState<CostUnlock | null>(null);
  const [lockMessage, setLockMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const lock = useCallback((message = '') => { setUnlock(null); setLockMessage(message); }, []);
  const unlocked = useCallback((u: CostUnlock) => { setUnlock(u); setLockMessage(''); setNow(Date.now()); }, []);

  useEffect(() => {
    if (!unlock) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= unlock.expiresAt) lock('Locked again after a few minutes. Enter your password to continue.');
    }, 1000);
    return () => clearInterval(t);
  }, [unlock, lock]);

  const costApi = useCallback(async <T,>(config: AxiosRequestConfig): Promise<T> => {
    try {
      const res = await api.request<T>({ ...config, headers: { ...config.headers, 'X-Cost-Unlock': unlock?.token ?? '' } });
      return res.data;
    } catch (err: any) {
      if (err?.response?.status === 423) lock(err.response.data?.error);
      throw err;
    }
  }, [unlock, lock]) as CostApi;

  const secondsLeft = unlock ? Math.max(0, Math.round((unlock.expiresAt - now) / 1000)) : 0;
  return { unlock, lockMessage, lock, unlocked, costApi, secondsLeft };
}

export function CostLockScreen({ title, text, unlockUrl, message, onUnlocked }: {
  title: string;
  text: string;
  unlockUrl: string;
  message: string;
  onUnlocked: (u: CostUnlock) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true); setError('');
    try {
      const res = await api.post(unlockUrl, { password });
      setPassword('');
      onUnlocked({ token: res.data.token, expiresAt: res.data.expiresAt });
    } catch (err) {
      setError(apiError(err, 'Could not unlock'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container" style={{ padding: '60px 24px', display: 'flex', justifyContent: 'center' }}>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 420, padding: 28, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', background: '#fef3c7', padding: 14, borderRadius: '50%', marginBottom: 12 }}>
          <LockKeyhole size={30} color="#b45309" />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px' }}>{title}</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 18px' }}>{text}</p>
        {(error || message) && <div className={`alert ${error ? 'alert-danger' : 'alert-warning'}`} style={{ marginBottom: 14, textAlign: 'left' }}>{error || message}</div>}
        <input type="password" className="form-input" placeholder="Your password" value={password} onChange={e => setPassword(e.target.value)}
          autoFocus autoComplete="current-password" style={{ marginBottom: 12 }} />
        <button type="submit" className="btn btn-primary" disabled={busy || !password} style={{ width: '100%', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          {busy ? <span className="spinner" /> : <><Unlock size={15} /> Unlock</>}
        </button>
      </form>
    </div>
  );
}

/** "Unlocked · locks in 12:34" and a Lock now button. */
export function UnlockedBadge({ secondsLeft, onLock }: { secondsLeft: number; onLock: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12.5, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Unlock size={14} /> Unlocked · locks in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
      </span>
      <button type="button" className="btn btn-secondary" onClick={onLock} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Lock size={15} /> Lock now
      </button>
    </div>
  );
}
