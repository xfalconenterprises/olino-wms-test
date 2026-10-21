import { useState, useEffect, useCallback } from 'react';
import type { UserModule } from '../utils/roles';

// 30 min duration if gate-only
const GATE_SESSION_DURATION_MS = 30 * 60 * 1000;
const SESSION_WARNING_MS = 5 * 60 * 1000; // warn 5 min before expiry

interface SessionState {
  msRemaining: number;
  showWarning: boolean;
  isExpired: boolean;
}

export function useSession(modules: UserModule[] | null, onExpire: () => void) {
  const [state, setState] = useState<SessionState>({
    msRemaining: Infinity,
    showWarning: false,
    isExpired: false,
  });

  const extendSession = useCallback(() => {
    localStorage.setItem('wms_login_at', String(Date.now()));
    setState({ msRemaining: Infinity, showWarning: false, isExpired: false });
  }, []);

  useEffect(() => {
    if (!modules || modules.length === 0) return;
    
    // Check if user is ONLY warehouse operations
    const isWarehouseOnly = modules.every(m => m === 'WAREHOUSE');
    if (!isWarehouseOnly) return; // No strict countdown for managers or purchase

    const duration = GATE_SESSION_DURATION_MS;

    const tick = () => {
      const loginAt = parseInt(localStorage.getItem('wms_login_at') || '0');
      const elapsed = Date.now() - loginAt;
      const remaining = duration - elapsed;

      if (remaining <= 0) {
        setState({ msRemaining: 0, showWarning: false, isExpired: true });
        onExpire();
        return;
      }

      setState({
        msRemaining: remaining,
        showWarning: remaining <= SESSION_WARNING_MS,
        isExpired: false,
      });
    };

    tick(); // run immediately
    const interval = setInterval(tick, 10_000); // check every 10s
    return () => clearInterval(interval);
  }, [modules, onExpire]);

  const minutesRemaining = Math.ceil(state.msRemaining / 60_000);

  return { ...state, minutesRemaining, extendSession };
}
