import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getSupabase } from '../supabaseClient';
import { AlertCircle, Loader2 } from 'lucide-react';
import { validatePassword, isPasswordStrongEnough } from '../utils/managerAuth';
import ManagerAuthShell, { errorClass, labelClass, buttonClass } from '../components/auth/ManagerAuthShell';
import { queueManagerPortalIntro, prefetchManagerPortalBranding } from '../components/manager/ManagerPortalIntro';
import PasswordInput from '../components/auth/PasswordInput';
import PasswordRequirements, { PasswordMatchHint } from '../components/auth/PasswordRequirements';

const CALLBACK_TIMEOUT_MS = 45000;

function readHashParams() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ''));
}

function readQueryParams() {
  return new URLSearchParams(window.location.search);
}

function readCallbackContext() {
  const hashParams = readHashParams();
  const queryParams = readQueryParams();
  const urlError =
    hashParams.get('error_description') ||
    hashParams.get('error') ||
    queryParams.get('error_description') ||
    queryParams.get('error');

  return {
    urlError,
    code: queryParams.get('code'),
    hasAccessToken: hashParams.has('access_token'),
    isRecovery: hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery',
  };
}

function formatAuthCallbackError(raw) {
  if (!raw) {
    return 'This sign-in link is invalid or has expired. Please request a new one.';
  }

  const normalized = String(raw).replace(/\+/g, ' ');
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function clearAuthParamsFromUrl() {
  window.history.replaceState(null, '', window.location.pathname);
}

function isExpiredLinkMessage(message) {
  const msg = (message || '').toLowerCase();
  return (
    msg.includes('expired') ||
    msg.includes('invalid') ||
    msg.includes('already been used') ||
    msg.includes('otp_expired')
  );
}

function CallbackLoading({ title, detail }) {
  return (
    <ManagerAuthShell footnote="">
      <div className="text-center py-4">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--color-brand-primary)]" aria-hidden="true" />
        <h2 className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
        {detail && (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{detail}</p>
        )}
      </div>
    </ManagerAuthShell>
  );
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const { user, role, logout } = useAuth();
  const initialContext = useRef(readCallbackContext()).current;

  const [callbackStatus, setCallbackStatus] = useState(() => {
    if (initialContext.urlError) return 'error';
    if (initialContext.isRecovery && !initialContext.code) return 'recovery';
    return 'loading';
  });
  const [errorMsg, setErrorMsg] = useState(() =>
    initialContext.urlError ? formatAuthCallbackError(initialContext.urlError) : '',
  );
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const callbackFinishedRef = useRef(
    initialContext.urlError || (initialContext.isRecovery && !initialContext.code),
  );
  const callbackTimeoutRef = useRef(null);

  const finishWithError = async (message) => {
    if (callbackFinishedRef.current) return;
    callbackFinishedRef.current = true;
    if (callbackTimeoutRef.current) {
      window.clearTimeout(callbackTimeoutRef.current);
      callbackTimeoutRef.current = null;
    }
    await logout();
    setErrorMsg(message);
    setCallbackStatus('error');
    clearAuthParamsFromUrl();
  };

  const finishWithSuccess = () => {
    if (callbackFinishedRef.current) return;
    callbackFinishedRef.current = true;
    if (callbackTimeoutRef.current) {
      window.clearTimeout(callbackTimeoutRef.current);
      callbackTimeoutRef.current = null;
    }
    setCallbackStatus('success');
  };

  const enterRecoveryMode = () => {
    if (callbackFinishedRef.current && callbackStatus !== 'loading') return;
    callbackFinishedRef.current = true;
    if (callbackTimeoutRef.current) {
      window.clearTimeout(callbackTimeoutRef.current);
      callbackTimeoutRef.current = null;
    }
    setErrorMsg('');
    setCallbackStatus('recovery');
    clearAuthParamsFromUrl();
  };

  useEffect(() => {
    if (initialContext.urlError) {
      logout();
      return undefined;
    }

    const supabase = getSupabase();
    if (!supabase) {
      finishWithError('Authentication is not configured.');
      return undefined;
    }

    let active = true;

    async function completeCallback() {
      const context = readCallbackContext();

      if (context.code) {
        await logout();
        if (!active) return;

        const { error } = await supabase.auth.exchangeCodeForSession(context.code);
        if (!active) return;

        if (error) {
          const friendly = formatAuthCallbackError(error.message);
          await finishWithError(
            isExpiredLinkMessage(friendly)
              ? 'This sign-in link is invalid or has expired. Please request a new one.'
              : friendly,
          );
          return;
        }

        if (readCallbackContext().isRecovery) {
          enterRecoveryMode();
          return;
        }

        finishWithSuccess();
        return;
      }

      if (context.isRecovery) {
        if (!active) return;
        enterRecoveryMode();
        return;
      }

      if (context.hasAccessToken) {
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;

        if (error) {
          await finishWithError(formatAuthCallbackError(error.message));
          return;
        }

        if (data.session) {
          if (readCallbackContext().isRecovery) {
            enterRecoveryMode();
            return;
          }
          finishWithSuccess();
        }
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (!active) return;

      if (error) {
        await finishWithError(formatAuthCallbackError(error.message));
        return;
      }

      if (data.session) {
        finishWithSuccess();
        return;
      }

      await finishWithError('This sign-in link is invalid or has expired. Please request a new one.');
    }

    completeCallback();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || callbackFinishedRef.current) return;

      if (event === 'PASSWORD_RECOVERY') {
        enterRecoveryMode();
        return;
      }

      if (!session) return;

      const context = readCallbackContext();
      if (context.code) return;

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (context.isRecovery) {
          enterRecoveryMode();
          return;
        }
        finishWithSuccess();
      }
    });

    callbackTimeoutRef.current = window.setTimeout(() => {
      if (!active || callbackFinishedRef.current) return;
      finishWithError('This sign-in link is invalid or has expired. Please request a new one.');
    }, CALLBACK_TIMEOUT_MS);

    return () => {
      active = false;
      subscription.unsubscribe();
      if (callbackTimeoutRef.current) {
        window.clearTimeout(callbackTimeoutRef.current);
        callbackTimeoutRef.current = null;
      }
    };
  }, [logout]);

  useEffect(() => {
    if (callbackStatus !== 'success') return;

    if (!user || !role) return;

    clearAuthParamsFromUrl();
    if (role === 'manager') {
      queueManagerPortalIntro();
      void prefetchManagerPortalBranding(user.email).finally(() => {
        navigate('/submit', { replace: true });
      });
      return;
    }
    if (role === 'admin') {
      navigate('/', { replace: true });
    }
  }, [callbackStatus, user, role, navigate]);

  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    const validated = validatePassword(newPassword, { email: user?.email });
    if (!validated.ok) {
      setErrorMsg(validated.error);
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (!isPasswordStrongEnough(newPassword, { email: user?.email })) {
      setErrorMsg('Please meet all password requirements below.');
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setErrorMsg('Authentication is not configured.');
      return;
    }

    setSavingPassword(true);
    setErrorMsg('');

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      const email = user?.email || '';
      await logout();
      navigate('/submit/signup', {
        replace: true,
        state: { passwordUpdated: true, email },
      });
    } catch (err) {
      setErrorMsg(err.message || 'Could not save your new password.');
    } finally {
      setSavingPassword(false);
    }
  };

  if (callbackStatus === 'recovery') {
    return (
      <ManagerAuthShell footnote="">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Choose a new password</h2>
        <p className="mt-1 mb-6 text-sm text-[var(--color-text-secondary)]">
          Pick a password you will use to sign in next time.
        </p>

        {errorMsg && (
          <div role="alert" className={errorClass}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSetNewPassword} className="space-y-4" noValidate>
          <div>
            <label htmlFor="recovery-password" className={labelClass}>
              New password
            </label>
            <PasswordInput
              id="recovery-password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              disabled={savingPassword}
              required
              minLength={8}
            />
            <PasswordRequirements password={newPassword} email={user?.email} />
          </div>
          <div>
            <label htmlFor="recovery-confirm" className={labelClass}>
              Confirm password
            </label>
            <PasswordInput
              id="recovery-confirm"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              disabled={savingPassword}
              required
              minLength={8}
            />
            <PasswordMatchHint password={newPassword} confirmPassword={confirmPassword} />
          </div>
          <button
            type="submit"
            disabled={
              savingPassword ||
              !isPasswordStrongEnough(newPassword, { email: user?.email }) ||
              newPassword !== confirmPassword
            }
            className={buttonClass}
          >
            {savingPassword ? 'Saving…' : 'Save password and sign in'}
          </button>
        </form>
      </ManagerAuthShell>
    );
  }

  if (callbackStatus === 'loading' || callbackStatus === 'success') {
    return (
      <CallbackLoading
        title={callbackStatus === 'success' ? 'Opening your account…' : 'Signing you in…'}
        detail={
          callbackStatus === 'success'
            ? 'One moment while we finish signing you in.'
            : 'Confirming your email and opening the submission form.'
        }
      />
    );
  }

  return (
    <ManagerAuthShell footnote="">
      <div role="alert" className={errorClass}>
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
        <span>{errorMsg}</span>
      </div>
      <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
        <Link to="/submit/signup" className="font-medium text-[var(--color-brand-accent)] hover:underline">
          Back to sign in
        </Link>
      </p>
    </ManagerAuthShell>
  );
}
