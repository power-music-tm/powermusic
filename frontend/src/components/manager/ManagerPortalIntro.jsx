import { useEffect, useState } from 'react';
import { getPublicPartnerBranding } from '../../utils/pilot2Api';
import { FlowGradientBackground } from '../ui/flow-gradient-hero-section';
import { partnerInitials } from '../partner/PartnerConnectionBranding';

export const INTRO_DURATION_MS = 5600;
const FADE_MS = 700;

const brandMarkBoxClass =
  'flex h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-white shadow-lg sm:h-[52px] sm:w-[52px]';

function displayFirstName(firstName, email) {
  const trimmed = firstName?.trim();
  if (trimmed) return trimmed;
  const local = String(email || '').split('@')[0];
  return local || 'there';
}

/**
 * Full-page welcome splash on the liquid gradient, then hand off to the manager portal.
 */
export default function ManagerPortalIntro({
  firstName = '',
  email = '',
  partnerName = null,
  logoDataUrl = null,
  onComplete,
}) {
  const [exiting, setExiting] = useState(false);
  const partner = partnerName?.trim() || null;
  const welcomeName = displayFirstName(firstName, email);

  const tagline = partner
    ? `Manage add and remove requests for ${partner}, all in one place.`
    : 'Submit add and remove requests for your team, all in one place.';

  useEffect(() => {
    preloadIntroLogos(logoDataUrl);
  }, [logoDataUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => setExiting(true), INTRO_DURATION_MS);
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
      className={`fixed inset-0 z-50 transition-opacity duration-[600ms] ease-out ${
        exiting ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Power Music"
      onClick={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') finish();
      }}
    >
      <FlowGradientBackground className="pointer-events-none fixed inset-0" interactive />

      <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] text-center sm:px-10">
        <div className="flex w-full max-w-3xl flex-col items-center">
          <div
            className="mb-8 flex items-center gap-3 animate-[manager-intro-rise_0.8s_ease-out_both]"
            style={{ animationDelay: '0.05s' }}
          >
            <div className={brandMarkBoxClass}>
              <img
                src="/image.png"
                alt=""
                className="h-full w-full object-cover"
                width={52}
                height={52}
              />
            </div>
            {partner ? (
              <>
                <span className="text-lg font-light text-white/40" aria-hidden="true">
                  ×
                </span>
                <div className={brandMarkBoxClass}>
                  {logoDataUrl ? (
                    <img src={logoDataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-[var(--color-surface-panel)] text-xs font-bold text-[var(--color-text-primary)]">
                      {partnerInitials(partner)}
                    </span>
                  )}
                </div>
              </>
            ) : null}
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
              Power Music
            </span>
            !
          </p>

          <p
            className="mt-8 max-w-xl text-base leading-relaxed text-white/55 sm:mt-10 sm:text-lg animate-[manager-intro-rise_0.8s_ease-out_both]"
            style={{ animationDelay: '0.42s' }}
          >
            {tagline}
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
                animation: `manager-intro-progress ${INTRO_DURATION_MS}ms ease-out forwards`,
              }}
            />
          </div>
          <p className="text-xs text-white/40">Tap anywhere to continue</p>
        </div>
      </div>
    </div>
  );
}

export function managerIntroSessionKey(userId) {
  return `manager-portal-intro-seen:${userId}`;
}

const INTRO_PENDING_KEY = 'manager-portal-intro-pending';
const BRANDING_CACHE_KEY = 'manager-portal-intro-branding';

function preloadIntroLogos(logoDataUrl) {
  const powerMusicLogo = new Image();
  powerMusicLogo.src = '/image.png';
  if (logoDataUrl) {
    const partnerLogo = new Image();
    partnerLogo.src = logoDataUrl;
  }
}

/** Cache partner branding for instant splash display after auth. */
export function cacheManagerPortalBranding(branding) {
  if (!branding?.partnerName) return;
  try {
    sessionStorage.setItem(
      BRANDING_CACHE_KEY,
      JSON.stringify({
        partnerId: branding.partnerId ?? null,
        partnerName: branding.partnerName,
        logoDataUrl: branding.logoDataUrl ?? null,
      }),
    );
    preloadIntroLogos(branding.logoDataUrl);
  } catch {
    /* ignore */
  }
}

export function readCachedManagerPortalBranding() {
  try {
    const raw = sessionStorage.getItem(BRANDING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.partnerName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCachedManagerPortalBranding() {
  try {
    sessionStorage.removeItem(BRANDING_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** Prefetch public partner branding before navigating to /submit. */
export async function prefetchManagerPortalBranding(email) {
  const cached = readCachedManagerPortalBranding();
  if (cached?.partnerName) return cached;

  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized.includes('@')) return null;

  try {
    const data = await getPublicPartnerBranding(normalized);
    if (data?.partnerName) cacheManagerPortalBranding(data);
    return data;
  } catch {
    return null;
  }
}

/** Call before navigating to /submit after sign-in or signup. */
export function queueManagerPortalIntro(branding = null) {
  try {
    sessionStorage.setItem(INTRO_PENDING_KEY, '1');
    if (branding?.partnerName) cacheManagerPortalBranding(branding);
  } catch {
    /* ignore */
  }
}

export function hasSeenManagerIntro(userId) {
  if (!userId) return false;
  try {
    if (sessionStorage.getItem(INTRO_PENDING_KEY)) return false;
    return Boolean(sessionStorage.getItem(managerIntroSessionKey(userId)));
  } catch {
    return false;
  }
}

export function shouldShowManagerPortalIntro(userId) {
  if (!userId) return null;
  try {
    if (sessionStorage.getItem(INTRO_PENDING_KEY)) {
      sessionStorage.removeItem(INTRO_PENDING_KEY);
      sessionStorage.removeItem(managerIntroSessionKey(userId));
      return true;
    }
    return !sessionStorage.getItem(managerIntroSessionKey(userId));
  } catch {
    return true;
  }
}

export function markManagerIntroSeen(userId) {
  if (!userId) return;
  try {
    sessionStorage.removeItem(INTRO_PENDING_KEY);
    sessionStorage.setItem(managerIntroSessionKey(userId), '1');
  } catch {
    /* ignore */
  }
}

export function clearManagerIntroSeen(userId) {
  if (!userId) return;
  try {
    sessionStorage.removeItem(managerIntroSessionKey(userId));
    sessionStorage.removeItem(INTRO_PENDING_KEY);
    clearCachedManagerPortalBranding();
  } catch {
    /* ignore */
  }
}
