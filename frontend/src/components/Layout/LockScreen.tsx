import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, LogOut } from 'lucide-react';
import api from '../../utils/api';
import { apiError } from '../../utils/printPage';
import { restartSessionClock } from '../../hooks/useSession';
import type { WmsUser } from '../../utils/roles';

/**
 * Covers the app when a floor terminal's session time is up. The page underneath stays as it was,
 * half-filled forms included; the same person unlocks with their password or PIN and carries on.
 * Someone else uses "Sign out" instead.
 */
export default function LockScreen({ user, onUnlocked, onSignOut }: {
  user: WmsUser;
  onUnlocked: () => void;
  onSignOut: () => void;
}) {
  // Badge sign-ins have a PIN, and unlock with it by default (password still possible)
  const canUsePin = !!user.badgeCode && localStorage.getItem('wms_login_method') === 'badge';
  const [mode, setMode] = useState<'password' | 'pin'>(canUsePin ? 'pin' : 'password');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/api/auth/unlock', mode === 'pin' ? { pin: value } : { password: value });
      localStorage.setItem('wms_token', data.token);
      restartSessionClock();
      onUnlocked();
    } catch (err) {
      setError(apiError(err, 'Could not unlock. Try again.'));
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(m => (m === 'pin' ? 'password' : 'pin'));
    setValue('');
    setError('');
  };

  return createPortal(
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Screen locked">
      <form className="lock-screen-card" onSubmit={unlock}>
        <div className="lock-screen-icon"><Lock size={28} /></div>
        <h2>Screen locked</h2>
        <p className="lock-screen-who">Signed in as <strong>{user.name}</strong></p>
        <p className="lock-screen-hint">Your work is kept. Enter your {mode === 'pin' ? 'PIN' : 'password'} to carry on.</p>

        {mode === 'pin' ? (
          <input
            key="pin"
            className="form-input lock-screen-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="6-digit PIN"
            aria-label="PIN"
            value={value}
            onChange={e => setValue(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
        ) : (
          <input
            key="password"
            className="form-input lock-screen-input"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            value={value}
            onChange={e => setValue(e.target.value)}
            autoFocus
          />
        )}

        {error && <div className="lock-screen-error">{error}</div>}

        <button type="submit" className="btn btn-primary lock-screen-unlock" disabled={busy || !value}>
          {busy ? <span className="spinner" /> : 'Unlock'}
        </button>

        <div className="lock-screen-links">
          {canUsePin && (
            <button type="button" className="btn btn-ghost" onClick={switchMode}>
              {mode === 'pin' ? 'Use password instead' : 'Use PIN instead'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onSignOut}>
            <LogOut size={16} /> Not {user.name.split(' ')[0]}? Sign out
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
