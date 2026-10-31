import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserModule } from '../utils/roles';

// 30 min duration if gate-only
const GATE_SESSION_DURATION_MS = 30 * 60 * 1000;
const SESSION_WARNING_MS = 5 * 60 * 1000; // warn 5 min before expiry

interface SessionState {
  minutesRemaining: number;
  showWarning: boolean;
  isExpired: boolean;
}

const NO_LIMIT: SessionState = { minutesRemaining: Infinity, showWarning: false, isExpired: false };

export function useSession(modules: UserModule[] | null, onExpire: () => void) {
  const [state, setState] = useState<SessionState>(NO_LIMIT);

  // The latest callback, kept out of the timer's dependencies: callers pass a new function on
  // every render, and restarting the timer on each render would loop forever.
  const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; });

  const extendSession = useCallback(() => {
    localStorage.setItem('wms_login_at', String(Date.now()));
    setState(NO_LIMIT);
  }, []);

  useEffect(() => {
    if (!modules || modules.length === 0) return;

    // Check if user is ONLY warehouse operations
    const isWarehouseOnly = modules.every(m => m === 'WAREHOUSE');
    if (!isWarehouseOnly) return; // No strict countdown for managers or purchase

    const tick = () => {
      const loginAt = parseInt(localStorage.getItem('wms_login_at') || '0');
      const remaining = GATE_SESSION_DURATION_MS - (Date.now() - loginAt);

      if (remaining <= 0) {
        setState({ minutesRemaining: 0, showWarning: false, isExpired: true });
        onExpireRef.current();
        return;
      }

      const next = { minutesRemaining: Math.ceil(remaining / 60_000), showWarning: remaining <= SESSION_WARNING_MS, isExpired: false };
      // Re-render only when something on screen would change
      setState(prev => (prev.minutesRemaining === next.minutesRemaining && prev.showWarning === next.showWarning ? prev : next));
    };

    tick(); // run immediately
    const interval = setInterval(tick, 10_000); // check every 10s
    return () => clearInterval(interval);
  }, [modules]);

  return { ...state, extendSession };
}
