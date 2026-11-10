import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { 
  User, 
  KeyRound, 
  ArrowRight, 
  ArrowLeft, 
  Delete, 
  RotateCcw, 
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Eye,
  EyeOff
} from 'lucide-react';
import { CameraScanButton } from '../../../components/Common/CameraScan';
import '../../../styles/layout.css';
import '../../../styles/components.css';

// A password box with the usual eye button inside it, to show or hide what was typed
function PasswordField({ id, value, onChange, placeholder, autoFocus, autoComplete = 'new-password' }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        className="form-input"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        required
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        style={{ height: 42, paddingRight: 46 }}
      />
      <button
        type="button"
        onClick={() => setShown(s => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        title={shown ? 'Hide password' : 'Show password'}
        style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 42, height: 38, border: 'none', background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', cursor: 'pointer' }}
      >
        {shown ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

// Employee IDs are assigned by the system as EMP-0001…; anything else typed is a username.
// Deciding by format (not by asking the server) means the page never tells which usernames exist.
const isEmployeeId = (value: string) => /^EMP-\d+$/i.test(value.trim());

export default function LoginPage() {
  const { login, badgeLogin, completePasswordReset, completePinReset } = useAuth();
  // One sign-in: scan a badge or type a username, then the PIN (badge) or the password (username)
  const [step, setStep] = useState<'ID' | 'PASSWORD' | 'PIN'>('ID');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [badgeCode, setBadgeCode] = useState('');
  const [pin, setPin] = useState('');

  // First-Time Credential Reset State
  const [resetMode, setResetMode] = useState<'NONE' | 'PASSWORD' | 'PIN'>('NONE');
  const [resetUser, setResetUser] = useState<{ name?: string; username?: string; badgeCode?: string | null } | null>(null);
  const [tempToken, setTempToken] = useState<string>('');

  // Password Reset Fields
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Terminal PIN Reset Fields
  const [resetPinStep, setResetPinStep] = useState<'ENTER_NEW' | 'CONFIRM_NEW'>('ENTER_NEW');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Why this device was signed out (by an administrator, the device limit, ...), shown once
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const reason = sessionStorage.getItem('wms_signed_out');
    if (reason) { setNotice(reason); sessionStorage.removeItem('wms_signed_out'); }
  }, []);

  // References for terminal barcode scanner workflow
  const badgeInputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const resetPinInputRef = useRef<HTMLInputElement>(null);

  // Focus management when switching modes or steps
  useEffect(() => {
    setError('');
    if (resetMode === 'NONE') {
      if (step === 'ID') setTimeout(() => badgeInputRef.current?.focus(), 120);
      else if (step === 'PIN') setTimeout(() => pinInputRef.current?.focus(), 120);
      else setTimeout(() => document.getElementById('password')?.focus(), 120);
    } else if (resetMode === 'PIN') {
      setTimeout(() => resetPinInputRef.current?.focus(), 120);
    }
  }, [step, resetMode, resetPinStep]);

  // Standard Office Login Submit
  const handleStandardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(username, password);
      if (res?.mustResetPassword) {
        setResetMode('PASSWORD');
        setResetUser(res.user);
        setTempToken(res.tempToken || '');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  // First-time Password Reset Submit
  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);
    try {
      await completePasswordReset(newPassword, tempToken);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 1: a badge goes on to the PIN, a username to the password
  const handleContinue = (e?: React.FormEvent, scanned = identifier) => {
    if (e) e.preventDefault();
    const value = scanned.trim();
    if (!value) {
      setError('Scan your badge or type your username');
      badgeInputRef.current?.focus();
      return;
    }
    setError('');
    setIdentifier(value);
    if (isEmployeeId(value)) {
      setBadgeCode(value.toUpperCase());
      setPin('');
      setStep('PIN');
    } else {
      setUsername(value.toLowerCase());
      setPassword('');
      setStep('PASSWORD');
    }
  };

  // Back to step 1 to enter a different badge or username
  const handleBackToScan = () => {
    setError('');
    setPin('');
    setPassword('');
    setStep('ID');
  };

  // Step 2: Final Verification & Login
  const handleFloorSubmit = async (currentPin?: string) => {
    const finalPin = currentPin || pin;
    if (finalPin.length !== 6) {
      setError('PIN must be exactly 6 digits');
      pinInputRef.current?.focus();
      return;
    }

    setError('');
    setLoading(true);
    try {
      const res = await badgeLogin(badgeCode, finalPin);
      if (res?.mustResetPin) {
        setResetMode('PIN');
        setResetUser(res.user);
        setTempToken(res.tempToken || '');
        setResetPinStep('ENTER_NEW');
        setNewPin('');
        setConfirmPin('');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Authentication failed. Please verify your badge and 6-digit PIN.');
      setPin('');
      pinInputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handlePinInput = (digit: string) => {
    if (pin.length < 6) {
      const nextPin = pin + digit;
      setPin(nextPin);
      if (nextPin.length === 6) {
        setTimeout(() => {
          handleFloorSubmit(nextPin);
        }, 150);
      }
    }
  };

  const handlePinBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handlePinClear = () => {
    setPin('');
    pinInputRef.current?.focus();
  };

  // First-time Terminal PIN Reset Handlers
  const handleResetPinInput = (digit: string) => {
    if (resetPinStep === 'ENTER_NEW') {
      if (newPin.length < 6) {
        const next = newPin + digit;
        setNewPin(next);
        if (next.length === 6) {
          setTimeout(() => {
            setResetPinStep('CONFIRM_NEW');
          }, 150);
        }
      }
    } else {
      if (confirmPin.length < 6) {
        const next = confirmPin + digit;
        setConfirmPin(next);
        if (next.length === 6) {
          setTimeout(() => {
            handleCompleteResetPin(newPin, next);
          }, 150);
        }
      }
    }
  };

  const handleResetPinBackspace = () => {
    if (resetPinStep === 'ENTER_NEW') {
      setNewPin(prev => prev.slice(0, -1));
    } else {
      setConfirmPin(prev => prev.slice(0, -1));
    }
  };

  const handleResetPinClear = () => {
    if (resetPinStep === 'ENTER_NEW') {
      setNewPin('');
    } else {
      setConfirmPin('');
    }
  };

  const handleCompleteResetPin = async (p1: string, p2: string) => {
    if (p1 !== p2) {
      setError('PINs do not match. Please re-enter your new 6-digit PIN.');
      setNewPin('');
      setConfirmPin('');
      setResetPinStep('ENTER_NEW');
      return;
    }

    setError('');
    setLoading(true);
    try {
      await completePinReset(p1, tempToken);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to update PIN. Please try again.');
      setNewPin('');
      setConfirmPin('');
      setResetPinStep('ENTER_NEW');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelReset = () => {
    setResetMode('NONE');
    setResetUser(null);
    setTempToken('');
    setNewPassword('');
    setConfirmPassword('');
    setNewPin('');
    setConfirmPin('');
    setError('');
    setPin('');
    setPassword('');
    setStep('ID');
  };

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 430, padding: 32 }}>
        {/* Logo and Header */}
        <div className="login-logo" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
          <img 
            src="/logo.png" 
            alt="Olino Uniforms" 
            style={{ maxHeight: '72px', objectFit: 'contain', marginBottom: '12px' }} 
          />
          <div className="login-logo-sub" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Warehouse Management System
          </div>
        </div>

        {notice && !error && (
          <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, fontSize: 13 }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="alert alert-danger" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, fontSize: 13 }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Sign in: one box, then the PIN or the password ── */}
        {resetMode === 'NONE' && (
          <div>
            {/* ─── STEP 1: Badge or username ─── */}
            {step === 'ID' && (
              <form onSubmit={handleContinue} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text-main)' }}>Sign in</h2>
                  <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                    Scan your Employee ID badge, or enter your username.
                  </p>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="identifier" className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>
                    Employee ID or username
                  </label>
                  {/* The camera sits inside the box, at its right edge */}
                  <div style={{ position: 'relative' }}>
                    <input
                      id="identifier"
                      ref={badgeInputRef}
                      type="text"
                      className="form-input"
                      placeholder="Scan or enter username"
                      value={identifier}
                      onChange={e => setIdentifier(e.target.value)}
                      required
                      autoFocus
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      style={{ height: 50, fontSize: 15, fontWeight: 600, paddingLeft: 14, paddingRight: 54, width: '100%' }}
                    />
                    <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}>
                      <CameraScanButton size={42} inset title="Scan your badge with the camera" onScan={code => handleContinue(undefined, code)} />
                    </div>
                  </div>
                </div>

                <button
                  id="login-continue"
                  type="submit"
                  className="btn btn-primary btn-lg login-btn"
                  disabled={!identifier.trim()}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, fontSize: 15, fontWeight: 600 }}
                >
                  Continue <ArrowRight size={18} />
                </button>
              </form>
            )}

            {/* ─── STEP 2a: Password (a username was entered) ─── */}
            {step === 'PASSWORD' && (
              <form className="login-form" onSubmit={handleStandardSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <User size={18} color="var(--color-brand)" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Username</div>
                      <div className="truncate" style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-main)' }}>{username}</div>
                    </div>
                  </div>
                  <button type="button" onClick={handleBackToScan}
                    style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ArrowLeft size={13} /> Change
                  </button>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="password" className="form-label" style={{ fontSize: 13 }}>
                    Password <span className="required">*</span>
                  </label>
                  <PasswordField id="password" placeholder="Enter password" value={password} onChange={setPassword} autoFocus autoComplete="current-password" />
                </div>

                <button
                  id="login-submit"
                  type="submit"
                  className="btn btn-primary btn-lg login-btn"
                  disabled={loading || !password}
                  style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, fontSize: 15, fontWeight: 600 }}
                >
                  {loading ? <><span className="spinner" /> Signing in…</> : <>Sign in <ArrowRight size={18} /></>}
                </button>
              </form>
            )}

            {/* ─── STEP 2b: 6-digit PIN (an Employee ID was entered) ─── */}
            {step === 'PIN' && (
              <form 
                onSubmit={(e) => { e.preventDefault(); handleFloorSubmit(); }} 
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                {/* Active Badge Banner with option to change badge */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'var(--color-bg-subtle)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 14px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 size={18} color="var(--color-success)" />
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                        Employee ID
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-main)', letterSpacing: '0.04em' }}>
                        {badgeCode}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleBackToScan}
                    style={{
                      background: '#fff',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '5px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-text-main)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                    title="Scan a different badge"
                  >
                    <ArrowLeft size={13} /> Change
                  </button>
                </div>

                {/* 6-Digit PIN Indicator */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label htmlFor="pinCode" className="form-label" style={{ fontSize: 13, marginBottom: 0 }}>
                      Enter 6-Digit PIN <span className="required">*</span>
                    </label>
                    <span style={{ fontSize: 11, color: pin.length === 6 ? 'var(--color-success)' : 'var(--color-text-muted)', fontWeight: 600 }}>
                      {pin.length} / 6 digits
                    </span>
                  </div>

                  {/* Visual PIN Digits Indicator */}
                  <div style={{
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'center',
                    margin: '2px 0 6px 0'
                  }}>
                    {[0, 1, 2, 3, 4, 5].map(idx => (
                      <div
                        key={idx}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 'var(--radius-sm)',
                          border: idx === pin.length 
                            ? '2px solid var(--color-brand)' 
                            : idx < pin.length 
                              ? '2px solid var(--color-success)' 
                              : '1px solid var(--color-border)',
                          background: idx < pin.length ? 'var(--color-bg-subtle)' : '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 20,
                          fontWeight: 700,
                          color: 'var(--color-text-main)',
                          transition: 'all 0.1s ease'
                        }}
                      >
                        {idx < pin.length ? '●' : ''}
                      </div>
                    ))}
                  </div>

                  {/* Hidden input to catch keyboard typing on desktop */}
                  <input
                    id="pinCode"
                    ref={pinInputRef}
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={pin}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setPin(val);
                      if (val.length === 6) {
                        setTimeout(() => handleFloorSubmit(val), 150);
                      }
                    }}
                    style={{ opacity: 0, height: 0, padding: 0, margin: 0, border: 'none', position: 'absolute' }}
                  />
                </div>

                {/* Interactive Touch Numpad Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                  marginTop: 2
                }}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handlePinInput(num)}
                      style={{
                        padding: '12px 0',
                        fontSize: 18,
                        fontWeight: 600,
                        background: '#fff',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--color-text-main)',
                        cursor: 'pointer',
                        transition: 'all 0.1s',
                        boxShadow: 'var(--shadow-xs)'
                      }}
                      onMouseDown={e => { e.currentTarget.style.background = 'var(--color-bg-subtle)'; }}
                      onMouseUp={e => { e.currentTarget.style.background = '#fff'; }}
                    >
                      {num}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={handlePinClear}
                    title="Clear PIN"
                    style={{
                      padding: '12px 0',
                      fontSize: 12,
                      fontWeight: 600,
                      background: 'var(--color-bg-subtle)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                  >
                    <RotateCcw size={16} />
                    Clear
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePinInput('0')}
                    style={{
                      padding: '12px 0',
                      fontSize: 18,
                      fontWeight: 600,
                      background: '#fff',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-main)',
                      cursor: 'pointer',
                      transition: 'all 0.1s',
                      boxShadow: 'var(--shadow-xs)'
                    }}
                    onMouseDown={e => { e.currentTarget.style.background = 'var(--color-bg-subtle)'; }}
                    onMouseUp={e => { e.currentTarget.style.background = '#fff'; }}
                  >
                    0
                  </button>

                  <button
                    type="button"
                    onClick={handlePinBackspace}
                    title="Backspace"
                    style={{
                      padding: '12px 0',
                      fontSize: 12,
                      fontWeight: 600,
                      background: 'var(--color-bg-subtle)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                  >
                    <Delete size={16} />
                    Del
                  </button>
                </div>

                <button
                  id="floor-login-submit"
                  type="submit"
                  className="btn btn-primary btn-lg login-btn"
                  disabled={loading || pin.length !== 6}
                  style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, fontSize: 15, fontWeight: 600 }}
                >
                  {loading ? (
                    <><span className="spinner" /> Signing in…</>
                  ) : (
                    <>Sign in <ArrowRight size={18} /></>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* ── Mode 3: First-Time Web Password Reset ── */}
        {resetMode === 'PASSWORD' && (
          <form className="login-form" onSubmit={handlePasswordResetSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--color-brand-faded)',
                color: 'var(--color-brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 10px'
              }}>
                <ShieldCheck size={24} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--color-text-main)' }}>
                Set Your New Password
              </h3>
              <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.45 }}>
                Welcome, <strong>{resetUser?.name}</strong>! For account security, you must replace your initial password before accessing the system.
              </p>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: 13, marginBottom: 4 }} htmlFor="new-password">
                New Password <span className="required">*</span>
              </label>
              <PasswordField id="new-password" placeholder="Minimum 8 characters" value={newPassword} onChange={setNewPassword} autoFocus />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: 13, marginBottom: 4 }} htmlFor="confirm-password">
                Confirm New Password <span className="required">*</span>
              </label>
              <PasswordField id="confirm-password" placeholder="Re-enter new password" value={confirmPassword} onChange={setConfirmPassword} />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg login-btn"
              disabled={loading || !newPassword || !confirmPassword}
              style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44 }}
            >
              {loading ? (
                <><span className="spinner" /> Updating Password…</>
              ) : (
                <><ShieldCheck size={18} /> Update Password & Continue</>
              )}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancelReset}
              style={{ height: 40, fontSize: 13, justifyContent: 'center' }}
            >
              Cancel & Back to Login
            </button>
          </form>
        )}

        {/* ── Mode 4: First-Time Terminal PIN Reset ── */}
        {resetMode === 'PIN' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ textAlign: 'center', padding: '4px 0 6px' }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--color-brand-faded)',
                color: 'var(--color-brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 10px'
              }}>
                <KeyRound size={24} />
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text-main)' }}>
                {resetPinStep === 'ENTER_NEW' ? 'Set Your New 6-Digit PIN' : 'Confirm Your 6-Digit PIN'}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.4 }}>
                {resetPinStep === 'ENTER_NEW'
                  ? `First-time sign-in for ${resetUser?.name || badgeCode}. Enter your private 6-digit PIN.`
                  : 'Re-enter your 6-digit PIN to confirm and activate terminal login.'}
              </p>
            </div>

            {/* Visual PIN Digits Indicator */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '4px 0 6px 0' }}>
              {[0, 1, 2, 3, 4, 5].map(idx => {
                const currentLen = resetPinStep === 'ENTER_NEW' ? newPin.length : confirmPin.length;
                return (
                  <div
                    key={idx}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 'var(--radius-sm)',
                      border: idx === currentLen
                        ? '2px solid var(--color-brand)'
                        : idx < currentLen
                          ? '2px solid var(--color-success)'
                          : '1px solid var(--color-border)',
                      background: idx < currentLen ? 'var(--color-bg-subtle)' : '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'var(--color-text-main)',
                      transition: 'all 0.1s ease'
                    }}
                  >
                    {idx < currentLen ? '●' : ''}
                  </div>
                );
              })}
            </div>

            {/* Hidden input to capture physical keyboard / scanner numeric keypad */}
            <input
              id="resetPinInput"
              ref={resetPinInputRef}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={resetPinStep === 'ENTER_NEW' ? newPin : confirmPin}
              onChange={e => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                if (resetPinStep === 'ENTER_NEW') {
                  setNewPin(val);
                  if (val.length === 6) {
                    setTimeout(() => setResetPinStep('CONFIRM_NEW'), 150);
                  }
                } else {
                  setConfirmPin(val);
                  if (val.length === 6) {
                    setTimeout(() => handleCompleteResetPin(newPin, val), 150);
                  }
                }
              }}
              style={{ opacity: 0, height: 0, padding: 0, margin: 0, border: 'none', position: 'absolute' }}
            />

            {/* Interactive Touch Numpad Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleResetPinInput(num)}
                  style={{
                    padding: '12px 0',
                    fontSize: 18,
                    fontWeight: 600,
                    background: '#fff',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-main)',
                    cursor: 'pointer',
                    transition: 'all 0.1s',
                    boxShadow: 'var(--shadow-xs)'
                  }}
                  onMouseDown={e => { e.currentTarget.style.background = 'var(--color-bg-subtle)'; }}
                  onMouseUp={e => { e.currentTarget.style.background = '#fff'; }}
                >
                  {num}
                </button>
              ))}

              <button
                type="button"
                onClick={handleResetPinClear}
                title="Clear PIN"
                style={{
                  padding: '12px 0',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--color-bg-subtle)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4
                }}
              >
                <RotateCcw size={16} />
                Clear
              </button>

              <button
                type="button"
                onClick={() => handleResetPinInput('0')}
                style={{
                  padding: '12px 0',
                  fontSize: 18,
                  fontWeight: 600,
                  background: '#fff',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-main)',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                  boxShadow: 'var(--shadow-xs)'
                }}
                onMouseDown={e => { e.currentTarget.style.background = 'var(--color-bg-subtle)'; }}
                onMouseUp={e => { e.currentTarget.style.background = '#fff'; }}
              >
                0
              </button>

              <button
                type="button"
                onClick={handleResetPinBackspace}
                title="Backspace"
                style={{
                  padding: '12px 0',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--color-bg-subtle)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4
                }}
              >
                <Delete size={16} />
                Del
              </button>
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancelReset}
              style={{ marginTop: 6, height: 40, fontSize: 13 }}
            >
              Cancel & Back
            </button>
          </div>
        )}

        <div className="login-footer" style={{ marginTop: 22 }}>
          Olino Uniforms · Enterprise WMS v1
        </div>
      </div>
    </div>
  );
}
