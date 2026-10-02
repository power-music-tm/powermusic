import { useState, useEffect, useId } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useToast } from '../components/ui';
import AdminAuthShell from '../components/auth/AdminAuthShell';
import RolePortalConflict from '../components/auth/RolePortalConflict';
import { readCachedManagerPortalBranding } from '../components/manager/ManagerPortalIntro';
import { queueAdminPortalIntro } from '../components/admin/AdminPortalIntro';
import { AUTH_PAGE_CANVAS, useAuthPageCanvas } from '../components/auth/useAuthPageCanvas';
import { FlowGradientBackground } from '../components/ui/flow-gradient-hero-section';
import PasswordInput from '../components/auth/PasswordInput';
import { isManagerOnAdminPortal } from '../utils/rolePortalAccess';
import { signOutToAdminAuth } from '../utils/managerPartnerConflictSignOut';

const inputClass =
  'w-full h-11 px-3.5 bg-white text-sm rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:outline-none focus-visible:border-[var(--color-brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/20 disabled:opacity-60 disabled:cursor-not-allowed';

function consumeSignedOutFlash() {
  const raw = sessionStorage.getItem('adminSignedOut');
  if (!raw) return null;
  sessionStorage.removeItem('adminSignedOut');
  try {
    return JSON.parse(raw);
  } catch {
    return { name: null };
  }
}

export default function AdminLogin() {
  const { login, user, role, logout } = useAuth();
  useAuthPageCanvas();
  const { clearToasts } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';
  const [signedOutNotice] = useState(() => consumeSignedOutFlash());

  const formId = useId();
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    clearToasts();
  }, [clearToasts]);

  const redirectingAdmin = Boolean(user && role === 'admin');

  useEffect(() => {
    if (redirectingAdmin) {
      navigate(from, { replace: true });
    }
  }, [user, role, navigate, from, redirectingAdmin]);

  if (user && isManagerOnAdminPortal(user, role)) {
    return (
      <RolePortalConflict
        variant="manager-on-admin"
        sessionPartnerBranding={readCachedManagerPortalBranding()}
        signingOut={signingOut}
        onGoToPortal={() => navigate('/submit')}
        onLogout={async () => {
          if (signingOut) return;
          setSigningOut(true);
          try {
            await signOutToAdminAuth({ logout, navigate });
          } finally {
            setSigningOut(false);
          }
        }}
      />
    );
  }

  if (redirectingAdmin) {
    return (
      <div
        className="fixed inset-0 z-0 overflow-hidden"
        style={{ backgroundColor: AUTH_PAGE_CANVAS }}
      >
        <FlowGradientBackground className="pointer-events-none fixed inset-0" interactive />
        <div className="relative flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/90" aria-hidden="true" />
          <span className="sr-only">Opening dashboard…</span>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMsg('Please enter your email address.');
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      await login(email.trim(), password, 'admin');
      queueAdminPortalIntro();
      navigate(from, { replace: true });
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Could not sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminAuthShell>
      {signedOutNotice && (
        <div
          role="status"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <div>
            <p className="font-medium">Signed out successfully</p>
            <p className="mt-0.5 text-emerald-800/90">
              {signedOutNotice.name
                ? `See you next time, ${signedOutNotice.name}.`
                : 'You have been signed out.'}
            </p>
          </div>
        </div>
      )}

      <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Sign in</h2>
      <p className="mt-1 mb-6 text-sm text-[var(--color-text-secondary)]">
        Use your admin email and password to access the dashboard.
      </p>

      {errorMsg && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
            Email
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            placeholder="andrea@powermusic.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className={inputClass}
            required
          />
        </div>

        <div>
          <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
            Password
          </label>
          <PasswordInput
            id={passwordId}
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-surface-sidebar-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Signing in…</span>
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>
    </AdminAuthShell>
  );
}
