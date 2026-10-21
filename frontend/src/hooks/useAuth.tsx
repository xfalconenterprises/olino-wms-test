import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import type { WmsUser } from '../utils/roles';
import { getDefaultRoute } from '../utils/roles';

interface AuthContextValue {
  user: WmsUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ mustResetPassword: boolean; user: WmsUser; tempToken?: string }>;
  badgeLogin: (badgeCode: string, pin: string) => Promise<{ mustResetPin: boolean; user: WmsUser; tempToken?: string }>;
  completePasswordReset: (newPassword: string, tempToken: string) => Promise<void>;
  completePinReset: (newPin: string, tempToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): WmsUser | null {
  try {
    const stored = localStorage.getItem('wms_user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// One shared login state for the whole app (must sit inside BrowserRouter)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WmsUser | null>(readStoredUser);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Validate the stored token once at startup
  useEffect(() => {
    const token = localStorage.getItem('wms_token');
    if (!token) { setLoading(false); return; }

    api.get('/api/auth/me')
      .then(({ data }) => {
        setUser(data.user);
        localStorage.setItem('wms_user', JSON.stringify(data.user));
      })
      .catch(() => {
        localStorage.removeItem('wms_token');
        localStorage.removeItem('wms_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const startSession = useCallback((token: string, sessionUser: WmsUser) => {
    localStorage.setItem('wms_token', token);
    localStorage.setItem('wms_user', JSON.stringify(sessionUser));
    localStorage.setItem('wms_login_at', String(Date.now()));
    setUser(sessionUser);
    navigate(getDefaultRoute(sessionUser));
  }, [navigate]);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post('/api/auth/login', { username, password });
    if (data.mustResetPassword) {
      return { mustResetPassword: true, user: data.user, tempToken: data.token };
    }
    startSession(data.token, data.user);
    return { mustResetPassword: false, user: data.user };
  }, [startSession]);

  const badgeLogin = useCallback(async (badgeCode: string, pin: string) => {
    const { data } = await api.post('/api/auth/badge-login', { badgeCode, pin });
    if (data.mustResetPin) {
      return { mustResetPin: true, user: data.user, tempToken: data.token };
    }
    startSession(data.token, data.user);
    return { mustResetPin: false, user: data.user };
  }, [startSession]);

  const completePasswordReset = useCallback(async (newPassword: string, tempToken: string) => {
    const { data } = await api.post(
      '/api/auth/reset-initial-password',
      { newPassword },
      { headers: { Authorization: `Bearer ${tempToken}` } }
    );
    startSession(data.token, data.user);
  }, [startSession]);

  const completePinReset = useCallback(async (newPin: string, tempToken: string) => {
    const { data } = await api.post(
      '/api/auth/reset-initial-pin',
      { newPin },
      { headers: { Authorization: `Bearer ${tempToken}` } }
    );
    startSession(data.token, data.user);
  }, [startSession]);

  const logout = useCallback(() => {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    localStorage.removeItem('wms_login_at');
    setUser(null);
    navigate('/login');
  }, [navigate]);

  const value = useMemo(
    () => ({ user, loading, login, badgeLogin, completePasswordReset, completePinReset, logout }),
    [user, loading, login, badgeLogin, completePasswordReset, completePinReset, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
