import { useState, useEffect, useCallback } from 'react';
import type { UserModule } from '../utils/roles';

// Warehouse-only accounts (shared floor terminals) lock 45 minutes after sign-in or the last unlock.
// The screen locks over the page instead of signing out, so work in progress is kept.
const GATE_SESSION_DURATION_MS = 45 * 60 * 1000;
const SESSION_WARNING_MS = 5 * 60 * 1000; // warn 5 min before it locks

interface SessionState {
  minutesRemaining: number;
  showWarning: boolean;
  isLocked: boolean;
}

const NO_LIMIT: SessionState = { minutesRemaining: Infinity, showWarning: false, isLocked: false };

/** Restarts the 45 minutes (Stay signed in, or after unlocking). Shared by every tab of the app. */
export function restartSessionClock() {
  localStorage.setItem('wms_login_at', String(Date.now()));
}

export function useSession(modules: UserModule[] | null) {
  const [state, setState] = useState<SessionState>(NO_LIMIT);
  const [clock, setClock] = useState(0); // bumped to re-check at once after the clock restarts

  const extendSession = useCallback(() => {
    restartSessionClock();
    setClock(c => c + 1);
  }, []);

  useEffect(() => {
    if (!modules || modules.length === 0) return;

    // Check if user is ONLY warehouse operations
    const isWarehouseOnly = modules.every(m => m === 'WAREHOUSE');
    if (!isWarehouseOnly) return; // No strict countdown for managers or purchase

    const tick = () => {
      const loginAt = parseInt(localStorage.getItem('wms_login_at') || '0');
      const remaining = GATE_SESSION_DURATION_MS - (Date.now() - loginAt);
      const next: SessionState = remaining <= 0
        ? { minutesRemaining: 0, showWarning: false, isLocked: true }
        : { minutesRemaining: Math.ceil(remaining / 60_000), showWarning: remaining <= SESSION_WARNING_MS, isLocked: false };
      // Re-render only when something on screen would change
      setState(prev => (prev.minutesRemaining === next.minutesRemaining && prev.showWarning === next.showWarning && prev.isLocked === next.isLocked ? prev : next));
    };

    tick(); // run immediately
    const interval = setInterval(tick, 10_000); // check every 10s
    // Unlocking or extending in another tab unlocks this one straight away
    const onStorage = (e: StorageEvent) => { if (e.key === 'wms_login_at') tick(); };
    window.addEventListener('storage', onStorage);
    return () => { clearInterval(interval); window.removeEventListener('storage', onStorage); };
  }, [modules, clock]);

  return { ...state, extendSession };
}
