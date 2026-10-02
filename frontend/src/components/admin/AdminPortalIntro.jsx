import { useEffect, useState } from 'react';
import { FlowGradientBackground } from '../ui/flow-gradient-hero-section';

export const ADMIN_INTRO_DURATION_MS = 5600;
const FADE_MS = 700;

const brandMarkBoxClass =
  'flex h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-white shadow-lg sm:h-16 sm:w-16';

const DEFAULT_ADMIN_NAME = 'Andrea';

function displayAdminWelcomeName(firstName, fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  const candidate = (firstName || parts[0] || '').trim();

  // Treat generic account labels as non-personal so we greet the admin by name.
  if (candidate && !/^(power|admin)$/i.test(candidate)) {
    return candidate;
  }

  return DEFAULT_ADMIN_NAME;
}

/**
 * Full-page admin welcome splash on the liquid gradient, then hand off to the dashboard.
 */
export default function AdminPortalIntro({
  firstName = '',
  fullName = '',
  onComplete,
}) {
  const [exiting, setExiting] = useState(false);
  const welcomeName = displayAdminWelcomeName(firstName, fullName);

  useEffect(() => {
    const timer = window.setTimeout(() => setExiting(true), ADMIN_INTRO_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!exiting) return undefined;
    const timer = window.setTimeout(() => onComplete?.(), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [exiting, onComplete]);

  const finish = () => {
    if (!exiting) setExiting(true);
  };

  return (
    <div
      className={`fixed inset-0 z-[100] transition-opacity duration-[600ms] ease-out ${
        exiting ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Power Music Ops"
      onClick={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') finish();
      }}
    >
      <FlowGradientBackground className="pointer-events-none fixed inset-0" interactive />

      <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] text-center sm:px-10">
        <div className="flex w-full max-w-3xl flex-col items-center">
          <div
            className="mb-8 animate-[manager-intro-rise_0.8s_ease-out_both]"
            style={{ animationDelay: '0.05s' }}
          >
            <div className={brandMarkBoxClass}>
              <img
                src="/image.png"
                alt=""
                className="h-full w-full object-cover"
                width={64}
                height={64}
              />
            </div>
          </div>

          <h1
            className="text-[clamp(2.25rem,8vw,4.5rem)] font-bold leading-[1.05] tracking-tight text-white animate-[manager-intro-rise_0.8s_ease-out_both]"
            style={{ animationDelay: '0.15s' }}
          >
            Welcome, {welcomeName}
          </h1>

          <p
            className="mt-3 text-[clamp(1.75rem,5.5vw,3.25rem)] font-semibold leading-tight tracking-tight text-white/95 animate-[manager-intro-rise_0.8s_ease-out_both]"
            style={{ animationDelay: '0.28s' }}
          >
            to{' '}
            <span className="bg-gradient-to-r from-white via-white to-[var(--color-brand-accent)] bg-clip-text text-transparent">
              Power Music Ops
            </span>
            !
          </p>

          <p
            className="mt-8 max-w-xl text-base leading-relaxed text-white/55 sm:mt-10 sm:text-lg animate-[manager-intro-rise_0.8s_ease-out_both]"
            style={{ animationDelay: '0.42s' }}
          >
            Review requests, manage the directory, and keep your partners moving.
          </p>
        </div>

        <div className="absolute inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-3 px-6">
          <div
            className="h-0.5 w-48 max-w-[70vw] overflow-hidden rounded-full bg-white/15 sm:w-56"
            aria-hidden="true"
          >
            <div
              className="h-full origin-left bg-white/70"
              style={{
                animation: `manager-intro-progress ${ADMIN_INTRO_DURATION_MS}ms ease-out forwards`,
              }}
            />
          </div>
          <p className="text-xs text-white/40">Tap anywhere to continue</p>
        </div>
      </div>
    </div>
  );
}

export function adminIntroSessionKey(userId) {
  return `admin-portal-intro-seen:${userId}`;
}

const INTRO_PENDING_KEY = 'admin-portal-intro-pending';

/** Call before navigating to the admin dashboard after sign-in. */
export function queueAdminPortalIntro() {
  try {
    sessionStorage.setItem(INTRO_PENDING_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function shouldShowAdminPortalIntro(userId) {
  if (!userId) return false;
  try {
    if (sessionStorage.getItem(INTRO_PENDING_KEY)) {
      sessionStorage.removeItem(INTRO_PENDING_KEY);
      sessionStorage.removeItem(adminIntroSessionKey(userId));
      return true;
    }
    return !sessionStorage.getItem(adminIntroSessionKey(userId));
  } catch {
    return true;
  }
}

export function markAdminIntroSeen(userId) {
  if (!userId) return;
  try {
    sessionStorage.removeItem(INTRO_PENDING_KEY);
    sessionStorage.setItem(adminIntroSessionKey(userId), '1');
  } catch {
    /* ignore */
  }
}

export function clearAdminIntroSeen(userId) {
  if (!userId) return;
  try {
    sessionStorage.removeItem(adminIntroSessionKey(userId));
    sessionStorage.removeItem(INTRO_PENDING_KEY);
  } catch {
    /* ignore */
  }
}
