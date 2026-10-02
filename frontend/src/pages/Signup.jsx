import { useState, useEffect, useLayoutEffect, useId, useRef, useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  isManagerAccountExistsMessage,
  validateManagerSignupFields,
  validateManagerEmail,
  ensureManagerAllowedDomains,
  getCachedManagerAllowedDomains,
  MANAGER_ACCOUNT_EXISTS_MESSAGE,
  MANAGER_ACCOUNT_NOT_FOUND_MESSAGE,
  MANAGER_DOMAINS_UNAVAILABLE_MESSAGE,
  isManagerAccountNotFoundMessage,
  isPasswordStrongEnough,
  resolveManagerAuthAllowedDomains,
  managerEmailDomainError,
} from '../utils/managerAuth';
import { formatCooldown, getOtpCooldownRemaining, setOtpCooldown } from '../utils/otpCooldown';
import { requestManagerPasswordReset, resendManagerSignupConfirmation } from '../utils/managerAuthEmail';
import ManagerAuthShell, {
  ManagerAuthLoading,
  inputClass,
  labelClass,
  buttonClass,
  errorClass,
  formGridClass,
} from '../components/auth/ManagerAuthShell';
import PasswordRequirements, { PasswordMatchHint } from '../components/auth/PasswordRequirements';
import PasswordInput from '../components/auth/PasswordInput';
import ManagerAuthEmailNotice from '../components/auth/ManagerAuthEmailNotice';
import { getAuthLinkExpiryLabel } from '../utils/authRedirect';
import { queueManagerPortalIntro, prefetchManagerPortalBranding } from '../components/manager/ManagerPortalIntro';
import { usePartnerBrandingFromEmail } from '../hooks/usePartnerBrandingFromEmail';
import {
  ensurePartnerSlugBranding,
  partnerSlugFromName,
  readCachedPartnerSlugBranding,
} from '../utils/partnerSlugBrandingCache';
import {
  instantPartnerBrandingFromSlug,
  managerAuthCreateAccountLink,
  managerAuthHeading,
  managerAuthSignupPath,
  managerAuthSubmitLabel,
  resolveManagerAuthPartnerBranding,
  getPartnerTerminology,
} from '../utils/managerAuthBranding';
import { getManagerPartnerBranding, getPublicPartnerBranding } from '../utils/pilot2Api';
import {
  readCachedManagerPortalBranding,
} from '../components/manager/ManagerPortalIntro';
import ManagerPartnerLinkConflict from '../components/auth/ManagerPartnerLinkConflict';
import RolePortalConflict from '../components/auth/RolePortalConflict';
import {
  clearManagerIntendedPartnerSlug,
  setManagerIntendedPartnerSlug,
} from '../utils/managerPartnerLinkIntent';
import {
  getManagerPartnerLinkConflict,
  isLikelyManagerPartnerLinkConflict,
} from '../utils/managerPartnerLinkConflict';
import { isAdminOnManagerPortal, isLikelyManagerSession } from '../utils/rolePortalAccess';
import { signOutToManagerAuth } from '../utils/managerPartnerConflictSignOut';

export default function Signup() {
  const {
    registerManager,
    checkManagerAccountExists,
    signInManager,
    user,
    role,
    loading: authLoading,
    appConfig,
    logout,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const formId = useId();
  const signInEmailId = `${formId}-signin-email`;
  const signInPasswordId = `${formId}-signin-password`;
  const forgotEmailId = `${formId}-forgot-email`;
  const emailGateEmailId = `${formId}-email-gate`;

  const [mode, setMode] = useState('signin');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    club: '',
    password: '',
    confirmPassword: '',
  });
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState(() =>
    location.state?.passwordUpdated ? 'Your password was updated. Sign in with your new password.' : '',
  );
  const [verifySent, setVerifySent] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [cooldownMs, setCooldownMs] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendError, setResendError] = useState('');
  const [resendNotice, setResendNotice] = useState('');
  const signInInFlightRef = useRef(false);
  const forgotInFlightRef = useRef(false);
  const resendInFlightRef = useRef(false);
  const [allowedDomains, setAllowedDomains] = useState(() => getCachedManagerAllowedDomains());
  const [domainsReady, setDomainsReady] = useState(() => Boolean(getCachedManagerAllowedDomains()));
  const [emailGateEmail, setEmailGateEmail] = useState('');
  const [emailGateLoading, setEmailGateLoading] = useState(false);

  const { partner: partnerSlug } = useParams();
  const [slugBranding, setSlugBranding] = useState(() =>
    partnerSlug ? instantPartnerBrandingFromSlug(partnerSlug) : null,
  );
  const [partnerAllowedDomains, setPartnerAllowedDomains] = useState(() => {
    if (!partnerSlug) return null;
    return readCachedPartnerSlugBranding(partnerSlug)?.allowedDomains ?? null;
  });
  const [partnerAccessReady, setPartnerAccessReady] = useState(() => {
    if (!partnerSlug) return true;
    return Boolean(readCachedPartnerSlugBranding(partnerSlug)?.allowedDomains?.length);
  });
  const [sessionBranding, setSessionBranding] = useState(() => readCachedManagerPortalBranding());
  const [sessionBrandingReady, setSessionBrandingReady] = useState(() =>
    Boolean(readCachedManagerPortalBranding()?.partnerName),
  );
  const [signingOut, setSigningOut] = useState(false);

  const brandingEmail = verifySent
    ? registeredEmail
    : resetSent
      ? resetEmail
      : mode === 'signup'
        ? formData.email
        : mode === 'forgot'
          ? forgotEmail
          : signInEmail;
  const emailBranding = usePartnerBrandingFromEmail(brandingEmail);
  const partnerBranding = useMemo(
    () =>
      resolveManagerAuthPartnerBranding({
        emailBranding,
        slugBranding,
        partnerSlug,
      }),
    [emailBranding, slugBranding, partnerSlug],
  );
  const partnerLabel = partnerBranding?.partnerName || '';
  const terms = useMemo(
    () => getPartnerTerminology(partnerLabel, partnerSlug),
    [partnerLabel, partnerSlug],
  );
  const authAllowedDomains = useMemo(
    () =>
      resolveManagerAuthAllowedDomains({
        partnerSlug,
        partnerAllowedDomains,
        globalAllowedDomains: allowedDomains,
        partnerAccessReady,
      }),
    [partnerSlug, partnerAllowedDomains, allowedDomains, partnerAccessReady],
  );
  const activeAuthEmail =
    mode === 'signup'
      ? formData.email
      : mode === 'forgot'
        ? forgotEmail
        : signInEmail;
  const emailDomainError = useMemo(() => {
    if (!partnerSlug || !appConfig.enforceDomainCheck || !partnerAccessReady) return '';
    if (!authAllowedDomains) return '';
    return managerEmailDomainError(activeAuthEmail, authAllowedDomains);
  }, [
    partnerSlug,
    appConfig.enforceDomainCheck,
    partnerAccessReady,
    authAllowedDomains,
    activeAuthEmail,
  ]);

  useLayoutEffect(() => {
    if (partnerSlug) setManagerIntendedPartnerSlug(partnerSlug);
  }, [partnerSlug]);

  useLayoutEffect(() => {
    if (!partnerSlug) {
      setSlugBranding(null);
      setPartnerAllowedDomains(null);
      setPartnerAccessReady(true);
      return undefined;
    }

    let active = true;
    setPartnerAccessReady(false);

    ensurePartnerSlugBranding(partnerSlug).then((branding) => {
      if (!active) return;
      if (!branding) {
        setPartnerAllowedDomains([]);
        setPartnerAccessReady(true);
        return;
      }
      setSlugBranding((prev) => ({
        partnerName: branding.partnerName || prev?.partnerName,
        logoDataUrl: branding.logoDataUrl ?? prev?.logoDataUrl ?? null,
      }));
      setPartnerAllowedDomains(
        Array.isArray(branding.allowedDomains) ? branding.allowedDomains : [],
      );
      setPartnerAccessReady(true);
    }).catch(() => {
      if (active) {
        setPartnerAllowedDomains([]);
        setPartnerAccessReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, [partnerSlug]);

  useLayoutEffect(() => {
    if (!user || role !== 'manager') {
      setSessionBrandingReady(true);
      return undefined;
    }

    let active = true;
    const cached = readCachedManagerPortalBranding();
    if (cached?.partnerName) setSessionBranding(cached);

    getManagerPartnerBranding()
      .then((data) => {
        if (!active || !data?.partnerName) return;
        setSessionBranding(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setSessionBrandingReady(true);
      });

    return () => {
      active = false;
    };
  }, [user, role]);

  useEffect(() => {
    let active = true;
    ensureManagerAllowedDomains()
      .then((domains) => {
        if (!active) return;
        setAllowedDomains(domains);
        setDomainsReady(true);
      })
      .catch(() => {
        if (!active) return;
        setAllowedDomains(null);
        setDomainsReady(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (location.state?.mode === 'signin') {
      setMode('signin');
      navigate(location.pathname, { replace: true, state: {} });
    } else if (location.state?.mode === 'signup') {
      setMode('signup');
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (location.state?.passwordUpdated) {
      const email = typeof location.state.email === 'string' ? location.state.email : '';
      if (email) setSignInEmail(email);
      setMode('signin');
      setSuccessMsg('Your password was updated. Sign in with your new password.');
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    const email = typeof location.state?.prefilledEmail === 'string' ? location.state.prefilledEmail.trim() : '';
    if (!email) return;
    setSignInEmail(email);
    setFormData((prev) => ({ ...prev, email }));
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (cooldownMs <= 0) return undefined;
    const timer = window.setInterval(() => {
      const email = resetEmail || forgotEmail || registeredEmail || formData.email;
      const remaining = getOtpCooldownRemaining(email);
      setCooldownMs(remaining);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownMs, resetEmail, forgotEmail, registeredEmail, formData.email]);

  const assertNotRateLimited = (email) => {
    const remaining = getOtpCooldownRemaining(email);
    if (remaining > 0) {
      setCooldownMs(remaining);
      setErrorMsg(`Please wait ${formatCooldown(remaining)} before requesting another email.`);
      return false;
    }
    return true;
  };

  const cachedPartnerConflict = partnerSlug ? getManagerPartnerLinkConflict(partnerSlug) : null;
  const isSignedInManager = isLikelyManagerSession(user, role);

  const renderAdminOnManagerConflict = () => (
    <RolePortalConflict
      variant="admin-on-manager"
      partnerBranding={slugBranding || cachedPartnerConflict?.urlBranding}
      partnerSlug={partnerSlug || ''}
      signingOut={signingOut}
      onGoToDashboard={() => navigate('/')}
      onLogout={async () => {
        if (signingOut) return;
        setSigningOut(true);
        try {
          await signOutToManagerAuth(partnerSlug, { logout, navigate });
        } finally {
          setSigningOut(false);
        }
      }}
    />
  );

  const renderPartnerLinkConflict = (conflict = cachedPartnerConflict) => {
    if (!conflict || !partnerSlug) return null;
    return (
      <ManagerPartnerLinkConflict
        urlPartnerBranding={slugBranding || conflict.urlBranding}
        urlPartnerSlug={partnerSlug}
        sessionPartnerBranding={sessionBranding || conflict.sessionBranding}
        signingOut={signingOut}
        onGoToPortal={() => {
          clearManagerIntendedPartnerSlug();
          navigate('/submit');
        }}
        onLogout={async () => {
          if (signingOut) return;
          setSigningOut(true);
          try {
            await signOutToManagerAuth(partnerSlug, { logout, navigate });
          } finally {
            setSigningOut(false);
          }
        }}
      />
    );
  };

  if (user && isAdminOnManagerPortal(user, role)) {
    return renderAdminOnManagerConflict();
  }

  if (user && isSignedInManager && cachedPartnerConflict) {
    return renderPartnerLinkConflict();
  }

  if (authLoading) {
    return (
      <ManagerAuthLoading
        partnerBranding={slugBranding || cachedPartnerConflict?.urlBranding}
      />
    );
  }
  if (partnerSlug && !partnerAccessReady) {
    return (
      <ManagerAuthLoading partnerBranding={slugBranding || cachedPartnerConflict?.urlBranding} />
    );
  }

  const normalizedUrlSlug = partnerSlug?.toLowerCase() ?? '';
  const sessionPartnerSlug = sessionBranding?.partnerName
    ? partnerSlugFromName(sessionBranding.partnerName)
    : '';
  const partnerLinkMismatch = Boolean(
    user &&
      role === 'manager' &&
      normalizedUrlSlug &&
      (!sessionPartnerSlug || normalizedUrlSlug !== sessionPartnerSlug),
  );

  // Don't force-logout non-managers here — that raced with role hydration and
  // bounced managers back to this page. Route guards handle redirects.
  if (user && role === 'manager') {
    if (!sessionBrandingReady && !cachedPartnerConflict) {
      return (
        <ManagerAuthLoading partnerBranding={slugBranding || cachedPartnerConflict?.urlBranding} />
      );
    }

    if (partnerSlug && sessionPartnerSlug && normalizedUrlSlug === sessionPartnerSlug) {
      clearManagerIntendedPartnerSlug();
      return <Navigate to="/submit" replace />;
    }

    if (partnerLinkMismatch) {
      return renderPartnerLinkConflict(
        cachedPartnerConflict || {
          urlSlug: normalizedUrlSlug,
          urlBranding: slugBranding,
          sessionBranding,
          sessionSlug: sessionPartnerSlug,
        },
      );
    }

    clearManagerIntendedPartnerSlug();
    return <Navigate to="/submit" replace />;
  }
  if (user && !role) {
    if (isAdminOnManagerPortal(user, role)) {
      return renderAdminOnManagerConflict();
    }
    if (isLikelyManagerPartnerLinkConflict(partnerSlug, user.id, role)) {
      return renderPartnerLinkConflict();
    }
    return (
      <ManagerAuthLoading partnerBranding={slugBranding || cachedPartnerConflict?.urlBranding} />
    );
  }

  const handleChange = (field, val) => {
    setFormData((prev) => ({ ...prev, [field]: val }));
    if (errorMsg) setErrorMsg('');
  };

  const switchMode = (next) => {
    const trimmedSignInEmail = signInEmail.trim();
    const trimmedSignupEmail = formData.email.trim();

    if (next === 'signup' && trimmedSignInEmail) {
      setFormData((prev) => ({ ...prev, email: trimmedSignInEmail }));
    }
    if (next === 'signin' && trimmedSignupEmail) {
      setSignInEmail(trimmedSignupEmail);
    }

    const brandingSlug =
      partnerSlug ||
      (slugBranding?.partnerName ? partnerSlugFromName(slugBranding.partnerName) : '') ||
      (emailBranding?.partnerName ? partnerSlugFromName(emailBranding.partnerName) : '');
    const targetPath = managerAuthSignupPath(brandingSlug);
    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true, state: location.state });
    }

    setMode(next);
    setErrorMsg('');
    setSuccessMsg('');
    setVerifySent(false);
    setResetSent(false);
    setLoading(false);
    setResendError('');
    setResendNotice('');
    if (next === 'forgot' && trimmedSignInEmail) {
      setForgotEmail(trimmedSignInEmail);
    }
  };

  const goToSignIn = (email = formData.email) => {
    setSignInEmail(email.trim());
    switchMode('signin');
  };

  const submitEmailGate = async (intendedMode) => {
    setErrorMsg('');

    if (!emailGateEmail.trim()) {
      setErrorMsg('Please enter your email address.');
      return;
    }

    if (appConfig.enforceDomainCheck && !domainsReady) {
      setErrorMsg(MANAGER_DOMAINS_UNAVAILABLE_MESSAGE);
      return;
    }

    const emailResult = validateManagerEmail(emailGateEmail, {
      enforceDomain: appConfig.enforceDomainCheck,
      allowedDomains,
    });
    if (!emailResult.ok) {
      setErrorMsg(emailResult.error);
      return;
    }

    setEmailGateLoading(true);
    try {
      const branding = await getPublicPartnerBranding(emailResult.value);
      const slug = partnerSlugFromName(branding?.partnerName);
      if (!slug) {
        setErrorMsg('No partner portal is configured for this email domain.');
        return;
      }
      navigate(managerAuthSignupPath(slug), {
        replace: true,
        state: { prefilledEmail: emailResult.value, mode: intendedMode },
      });
    } catch (err) {
      setErrorMsg(err?.message || 'No partner portal is configured for this email domain.');
    } finally {
      setEmailGateLoading(false);
    }
  };

  const handleEmailGateSubmit = (e) => {
    e.preventDefault();
    submitEmailGate('signin');
  };

  const handleEmailGateCreate = () => submitEmailGate('signup');

  const showVerifyScreen = (email, { resent = false } = {}) => {
    setOtpCooldown(email);
    setCooldownMs(getOtpCooldownRemaining(email));
    setRegisteredEmail(email);
    setVerifySent(true);
    setResendError('');
    setResendNotice(resent ? 'We sent another confirmation link.' : '');
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (emailDomainError) {
      setErrorMsg(emailDomainError);
      return;
    }

    const validated = validateManagerSignupFields(formData, {
      enforceDomain: appConfig.enforceDomainCheck,
      allowedDomains: authAllowedDomains,
      isHealthFitness: terms.isHealthFitness,
      isGll: terms.isGll,
    });
    if (!validated.ok) {
      setErrorMsg(validated.error);
      return;
    }

    if (appConfig.enforceDomainCheck && !domainsReady) {
      setErrorMsg(MANAGER_DOMAINS_UNAVAILABLE_MESSAGE);
      return;
    }

    setLoading(true);

    try {
      const { exists } = await checkManagerAccountExists(validated.value.email, {
        enforceDomain: appConfig.enforceDomainCheck,
      });

      if (exists) {
        setErrorMsg(MANAGER_ACCOUNT_EXISTS_MESSAGE);
        return;
      }

      const result = await registerManager(formData, {
        enforceDomain: appConfig.enforceDomainCheck,
        isHealthFitness: terms.isHealthFitness,
        isGll: terms.isGll,
      });

      if (result.needsConfirmation) {
        showVerifyScreen(result.email);
      } else {
        queueManagerPortalIntro(partnerBranding);
        if (!partnerBranding?.partnerName) {
          await prefetchManagerPortalBranding(validated.value.email);
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendSignupEmail = async () => {
    if (!registeredEmail || resendInFlightRef.current) return;
    setResendError('');
    setResendNotice('');

    if (!assertNotRateLimited(registeredEmail)) {
      setResendError(`Please wait ${formatCooldown(getOtpCooldownRemaining(registeredEmail))} before requesting another email.`);
      return;
    }

    resendInFlightRef.current = true;
    setResendLoading(true);

    try {
      const result = await resendManagerSignupConfirmation(registeredEmail, {
        enforceDomain: appConfig.enforceDomainCheck,
      });
      setOtpCooldown(result.email);
      setCooldownMs(getOtpCooldownRemaining(result.email));
      setResendNotice('We sent another confirmation link.');
    } catch (err) {
      console.error(err);
      setResendError(err.message || 'Could not resend confirmation email.');
    } finally {
      resendInFlightRef.current = false;
      setResendLoading(false);
    }
  };

  const handleResendResetEmail = async () => {
    if (!resetEmail || resendInFlightRef.current) return;
    setResendError('');
    setResendNotice('');

    if (!assertNotRateLimited(resetEmail)) {
      setResendError(`Please wait ${formatCooldown(getOtpCooldownRemaining(resetEmail))} before requesting another email.`);
      return;
    }

    resendInFlightRef.current = true;
    setResendLoading(true);

    try {
      const result = await requestManagerPasswordReset(resetEmail, {
        enforceDomain: appConfig.enforceDomainCheck,
      });
      setOtpCooldown(result.email);
      setCooldownMs(getOtpCooldownRemaining(result.email));
      setResendNotice('We sent another reset link.');
    } catch (err) {
      console.error(err);
      setResendError(err.message || 'Could not resend reset email.');
    } finally {
      resendInFlightRef.current = false;
      setResendLoading(false);
    }
  };

  const handleSignInSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!signInEmail.trim()) {
      setErrorMsg('Please enter your email address.');
      return;
    }
    if (!signInPassword) {
      setErrorMsg('Please enter your password.');
      return;
    }

    const emailResult = validateManagerEmail(signInEmail, {
      enforceDomain: appConfig.enforceDomainCheck,
      allowedDomains: authAllowedDomains,
    });
    if (!emailResult.ok) {
      setErrorMsg(emailResult.error);
      return;
    }

    if (emailDomainError) {
      setErrorMsg(emailDomainError);
      return;
    }

    if (appConfig.enforceDomainCheck && !domainsReady) {
      setErrorMsg(MANAGER_DOMAINS_UNAVAILABLE_MESSAGE);
      return;
    }

    if (signInInFlightRef.current) return;
    signInInFlightRef.current = true;
    setLoading(true);

    try {
      await signInManager(signInEmail, signInPassword, {
        enforceDomain: appConfig.enforceDomainCheck,
      });
      queueManagerPortalIntro(partnerBranding);
      navigate('/submit', { replace: true });
    } catch (err) {
      console.error(err);
      const msg = err.message || '';
      if (isManagerAccountNotFoundMessage(msg)) {
        setErrorMsg(MANAGER_ACCOUNT_NOT_FOUND_MESSAGE);
      } else if (
        msg.includes('Invalid login credentials') ||
        msg.includes('invalid_credentials') ||
        msg.includes('Incorrect email or password')
      ) {
        setErrorMsg('Wrong password. Please enter it again.');
      } else {
        setErrorMsg(msg || 'Sign in failed.');
      }
    } finally {
      signInInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleForgotPasswordSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!forgotEmail.trim()) {
      setErrorMsg('Please enter your email address.');
      return;
    }

    const emailResult = validateManagerEmail(forgotEmail, {
      enforceDomain: appConfig.enforceDomainCheck,
      allowedDomains: authAllowedDomains,
    });
    if (!emailResult.ok) {
      setErrorMsg(emailResult.error);
      return;
    }

    if (emailDomainError) {
      setErrorMsg(emailDomainError);
      return;
    }

    if (appConfig.enforceDomainCheck && !domainsReady) {
      setErrorMsg(MANAGER_DOMAINS_UNAVAILABLE_MESSAGE);
      return;
    }

    if (!assertNotRateLimited(forgotEmail)) return;

    if (forgotInFlightRef.current) return;
    forgotInFlightRef.current = true;
    setLoading(true);

    try {
      const result = await requestManagerPasswordReset(forgotEmail, {
        enforceDomain: appConfig.enforceDomainCheck,
      });
      setOtpCooldown(forgotEmail);
      setCooldownMs(getOtpCooldownRemaining(forgotEmail));
      setResetEmail(result.email);
      setResendError('');
      setResendNotice('');
      setResetSent(true);
    } catch (err) {
      console.error(err);
      const msg = err.message || '';
      if (isManagerAccountNotFoundMessage(msg)) {
        setErrorMsg(MANAGER_ACCOUNT_NOT_FOUND_MESSAGE);
      } else {
        setErrorMsg(msg || 'Could not send reset email.');
      }
    } finally {
      forgotInFlightRef.current = false;
      setLoading(false);
    }
  };

  if (!partnerSlug) {
    return (
      <ManagerAuthShell partnerBranding={null}>
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          Enter your work email
        </h2>
        <p className="mt-1 mb-6 text-center text-sm text-[var(--color-text-secondary)]">
          Use the email domain your partner has approved for portal access.
        </p>

        {errorMsg && (
          <div role="alert" className={errorClass}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleEmailGateSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor={emailGateEmailId} className={labelClass}>
              Email
            </label>
            <input
              id={emailGateEmailId}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              placeholder="you@partner.com"
              value={emailGateEmail}
              onChange={(e) => {
                setEmailGateEmail(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              disabled={emailGateLoading}
              className={inputClass}
              required
            />
          </div>

          <button
            type="submit"
            disabled={emailGateLoading || (appConfig.enforceDomainCheck && !domainsReady)}
            aria-busy={emailGateLoading}
            className={buttonClass}
          >
            {emailGateLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Checking email…</span>
              </>
            ) : (
              'Continue'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
          New to the portal?{' '}
          <button
            type="button"
            onClick={handleEmailGateCreate}
            disabled={emailGateLoading || (appConfig.enforceDomainCheck && !domainsReady)}
            className="font-medium text-[var(--color-brand-accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create Account
          </button>
        </p>
      </ManagerAuthShell>
    );
  }

  if (verifySent) {
    return (
      <ManagerAuthEmailNotice
        title="Check your email"
        onBack={() => switchMode('signin')}
        onResend={handleResendSignupEmail}
        resendLabel="Send again"
        resendLoading={resendLoading}
        resendCooldownMs={cooldownMs}
        resendError={resendError}
        resendNotice={resendNotice}
      >
        We sent a confirmation link to{' '}
        <span className="font-medium text-[var(--color-text-primary)]">{registeredEmail}</span>.
        Click it once to finish setting up your account. The link expires in{' '}
        <span className="font-medium text-[var(--color-text-primary)]">{getAuthLinkExpiryLabel()}</span>.
        If it still doesn’t arrive, you can send again below.
      </ManagerAuthEmailNotice>
    );
  }

  if (mode === 'forgot') {
    const showCreateAccountHint = isManagerAccountNotFoundMessage(errorMsg);

    if (resetSent) {
      return (
        <ManagerAuthShell partnerBranding={partnerBranding}>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Check your email</h2>
          <p className="mt-1 mb-4 text-sm text-[var(--color-text-secondary)]">
            We sent a password reset link to{' '}
            <span className="font-medium text-[var(--color-text-primary)]">{resetEmail}</span>. Open it to
            choose a new password, then sign in. The link expires in{' '}
            <span className="font-medium text-[var(--color-text-primary)]">{getAuthLinkExpiryLabel()}</span>.
            If it still doesn’t arrive, you can send again below.
          </p>

          <div
            className="mb-6 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-950"
            role="note"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="leading-relaxed">
              Can&apos;t find the email in your inbox? Check your Spam folder (and All Mail) as well.
              Reset links often land there.
            </p>
          </div>

          {resendNotice && (
            <div
              className="mb-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900"
              role="status"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{resendNotice}</span>
            </div>
          )}

          {resendError && (
            <div role="alert" className={errorClass}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              <span>{resendError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleResendResetEmail}
            disabled={resendLoading || cooldownMs > 0}
            className={buttonClass}
          >
            {resendLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Sending link…</span>
              </>
            ) : cooldownMs > 0 ? (
              `Send again in ${formatCooldown(cooldownMs)}`
            ) : (
              'Send again'
            )}
          </button>

          <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
            Remember your password?{' '}
            <button
              type="button"
              onClick={() => {
                const email = resetEmail;
                setResetSent(false);
                setResetEmail('');
                setResendError('');
                setResendNotice('');
                setSignInEmail(email);
                switchMode('signin');
              }}
              className="font-medium text-[var(--color-brand-accent)] hover:underline"
            >
              Back to Sign In
            </button>
          </p>
        </ManagerAuthShell>
      );
    }

    return (
      <ManagerAuthShell partnerBranding={partnerBranding}>
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Reset password</h2>
        <p className="mt-1 mb-6 text-sm text-[var(--color-text-secondary)]">
          Enter your email and we will send you a link to choose a new password.
        </p>

        {(errorMsg || emailDomainError) && (
          <div role="alert" className={errorClass}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <span>
              {errorMsg || emailDomainError}
              {showCreateAccountHint && errorMsg && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    className="font-medium underline"
                  >
                    {managerAuthCreateAccountLink(partnerLabel, partnerSlug)}
                  </button>
                </>
              )}
            </span>
          </div>
        )}

        <form onSubmit={handleForgotPasswordSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor={forgotEmailId} className={labelClass}>
              {terms.managerEmailLabel}
            </label>
            <input
              id={forgotEmailId}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              placeholder="you@gmail.com"
              value={forgotEmail}
              onChange={(e) => {
                setForgotEmail(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              disabled={loading}
              className={inputClass}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || cooldownMs > 0 || Boolean(emailDomainError)}
            className={buttonClass}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Sending link…</span>
              </>
            ) : cooldownMs > 0 ? (
              `Wait ${formatCooldown(cooldownMs)}`
            ) : (
              'Send reset link'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
          Remember your password?{' '}
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className="font-medium text-[var(--color-brand-accent)] hover:underline"
          >
            Back to Sign In
          </button>
        </p>
      </ManagerAuthShell>
    );
  }

  if (mode === 'signin') {
    const showCreateAccountHint = isManagerAccountNotFoundMessage(errorMsg);

    return (
      <ManagerAuthShell partnerBranding={partnerBranding}>
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {managerAuthHeading(partnerLabel, 'signin', partnerSlug)}
        </h2>
        <p className="mt-1 mb-6 text-center text-sm text-[var(--color-text-secondary)]">
          Use the email and password you chose when you signed up.
        </p>

        {successMsg && (
          <div
            role="status"
            className="mb-5 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        {(errorMsg || emailDomainError) && (
          <div role="alert" className={errorClass}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <span>
              {errorMsg || emailDomainError}
              {showCreateAccountHint && errorMsg && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    className="font-medium underline"
                  >
                    {managerAuthCreateAccountLink(partnerLabel, partnerSlug)}
                  </button>
                </>
              )}
            </span>
          </div>
        )}

        <form onSubmit={handleSignInSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor={signInEmailId} className={labelClass}>
              {terms.managerEmailLabel}
            </label>
            <input
              id={signInEmailId}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              placeholder="you@gmail.com"
              value={signInEmail}
              onChange={(e) => {
                setSignInEmail(e.target.value);
                if (errorMsg) setErrorMsg('');
                if (successMsg) setSuccessMsg('');
              }}
              disabled={loading}
              className={inputClass}
              required
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor={signInPasswordId} className={labelClass}>
                Password
              </label>
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-xs font-medium text-[var(--color-brand-accent)] hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <PasswordInput
              id={signInPasswordId}
              name="password"
              autoComplete="current-password"
              value={signInPassword}
              onChange={(e) => {
                setSignInPassword(e.target.value);
                if (errorMsg) setErrorMsg('');
                if (successMsg) setSuccessMsg('');
              }}
              disabled={loading}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || Boolean(emailDomainError)}
            aria-busy={loading}
            className={buttonClass}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>{managerAuthSubmitLabel(partnerLabel, 'signin', { loading: true, partnerSlug })}</span>
              </>
            ) : (
              managerAuthSubmitLabel(partnerLabel, 'signin', { partnerSlug })
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
          New here?{' '}
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className="font-medium text-[var(--color-brand-accent)] hover:underline"
          >
            {managerAuthCreateAccountLink(partnerLabel, partnerSlug)}
          </button>
        </p>
      </ManagerAuthShell>
    );
  }

  return (
    <ManagerAuthShell wide partnerBranding={partnerBranding}>
      <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
        {managerAuthHeading(partnerLabel, 'signup', partnerSlug)}
      </h2>
      <p className="mt-1 mb-6 text-center text-sm text-[var(--color-text-secondary)]">
        Fill in your details and choose a password. You may need to confirm your email once.
      </p>

      {errorMsg && (
        <div role="alert" className={errorClass}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <div className="space-y-2">
            <p>{errorMsg}</p>
            {isManagerAccountExistsMessage(errorMsg) && (
              <button
                type="button"
                onClick={() => goToSignIn()}
                className="text-sm font-medium text-[var(--color-brand-accent)] hover:underline"
              >
                Sign in instead
              </button>
            )}
          </div>
        </div>
      )}

      {emailDomainError && !errorMsg && (
        <div role="alert" className={errorClass}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <span>{emailDomainError}</span>
        </div>
      )}

      <form onSubmit={handleSignupSubmit} className="space-y-4" noValidate>
        <div className={formGridClass}>
          <div>
            <label htmlFor="signup-first" className={labelClass}>
              First Name
            </label>
            <input
              id="signup-first"
              type="text"
              autoComplete="given-name"
              maxLength={100}
              value={formData.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              disabled={loading}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label htmlFor="signup-last" className={labelClass}>
              Last Name
            </label>
            <input
              id="signup-last"
              type="text"
              autoComplete="family-name"
              maxLength={100}
              value={formData.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
              disabled={loading}
              className={inputClass}
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="signup-email" className={labelClass}>
            {terms.managerEmailLabel}
          </label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            maxLength={254}
            placeholder="you@gmail.com"
            value={formData.email}
            onChange={(e) => handleChange('email', e.target.value)}
            disabled={loading}
            className={inputClass}
            required
          />
        </div>

        {terms.isGll ? (
          <div>
            <label htmlFor="signup-club" className={labelClass}>
              Gym Location <span className="font-normal text-[var(--color-text-muted)]">(Optional)</span>
            </label>
            <input
              id="signup-club"
              type="text"
              autoComplete="organization"
              maxLength={200}
              placeholder="e.g. London, Manchester"
              value={formData.club}
              onChange={(e) => handleChange('club', e.target.value)}
              disabled={loading}
              className={inputClass}
            />
          </div>
        ) : !terms.isHealthFitness ? (
          <div>
            <label htmlFor="signup-club" className={labelClass}>
              {terms.clubOrClientLabel}
            </label>
            <input
              id="signup-club"
              type="text"
              autoComplete="organization"
              maxLength={200}
              placeholder={terms.clubOrClientPlaceholder}
              value={formData.club}
              onChange={(e) => handleChange('club', e.target.value)}
              disabled={loading}
              className={inputClass}
              required
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="signup-password" className={labelClass}>
            Password
          </label>
          <PasswordInput
            id="signup-password"
            autoComplete="new-password"
            value={formData.password}
            onChange={(e) => handleChange('password', e.target.value)}
            disabled={loading}
            required
            minLength={8}
          />
          <PasswordRequirements password={formData.password} email={formData.email} />
        </div>

        <div>
          <label htmlFor="signup-confirm" className={labelClass}>
            Confirm Password
          </label>
          <PasswordInput
            id="signup-confirm"
            autoComplete="new-password"
            value={formData.confirmPassword}
            onChange={(e) => handleChange('confirmPassword', e.target.value)}
            disabled={loading}
            required
            minLength={8}
          />
          <PasswordMatchHint password={formData.password} confirmPassword={formData.confirmPassword} />
        </div>

        <button
          type="submit"
          disabled={
            loading ||
            Boolean(emailDomainError) ||
            !formData.firstName.trim() ||
            !formData.lastName.trim() ||
            !formData.email.trim() ||
            (!terms.isHealthFitness && !terms.isGll && !formData.club.trim()) ||
            !formData.password ||
            !formData.confirmPassword ||
            !isPasswordStrongEnough(formData.password, { email: formData.email }) ||
            formData.password !== formData.confirmPassword
          }
          className={buttonClass}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{managerAuthSubmitLabel(partnerLabel, 'signup', { loading: true, partnerSlug })}</span>
            </>
          ) : (
            managerAuthSubmitLabel(partnerLabel, 'signup', { partnerSlug })
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
        Already have an account?{' '}
        <button
          type="button"
          onClick={() => switchMode('signin')}
          className="font-medium text-[var(--color-brand-accent)] hover:underline"
        >
          Sign In
        </button>
      </p>
    </ManagerAuthShell>
  );
}
