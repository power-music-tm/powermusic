import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePartners } from '../../context/PartnerContext';
import Sidebar from './Sidebar';
import { HoverTip } from '../ui';
import AdminPortalIntro, {
  markAdminIntroSeen,
  shouldShowAdminPortalIntro,
} from '../admin/AdminPortalIntro';
import { resolveAdminDisplayName, resolveAdminFirstName } from '../../utils/adminDisplayName';

const SIDEBAR_EXPANDED_KEY = 'adminSidebarExpanded';

/** Nested admin detail routes → section home when the gym/partner changes. */
function sectionHomeForPath(pathname) {
  if (pathname.startsWith('/new-requests/')) return '/new-requests';
  return null;
}

function readSidebarExpanded() {
  try {
    const stored = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
    if (stored === null) return true;
    return stored !== 'false';
  } catch {
    return true;
  }
}

export default function AppLayout({ children }) {
  const { user, profile } = useAuth();
  const { selectedPartnerId } = usePartners();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(readSidebarExpanded);
  const [portalIntro, setPortalIntro] = useState(null);
  const introCheckedRef = useRef(false);
  const prevPartnerIdRef = useRef(undefined);

  // Switching gym while on a request/group detail → that gym's New Requests list.
  useEffect(() => {
    const prev = prevPartnerIdRef.current;
    prevPartnerIdRef.current = selectedPartnerId;
    if (prev === undefined) return;
    if (String(prev ?? '') === String(selectedPartnerId ?? '')) return;
    const home = sectionHomeForPath(location.pathname);
    if (home && location.pathname !== home) {
      navigate(home, { replace: true });
    }
  }, [selectedPartnerId, location.pathname, navigate]);

  const adminDetails = useMemo(
    () => ({
      firstName: resolveAdminFirstName(profile, user),
      fullName: resolveAdminDisplayName(profile, user),
    }),
    [profile, user],
  );

  useEffect(() => {
    if (!user?.id) {
      setPortalIntro(false);
      return;
    }
    if (introCheckedRef.current) return;
    introCheckedRef.current = true;
    setPortalIntro(shouldShowAdminPortalIntro(user.id));
  }, [user?.id]);

  const handlePortalIntroComplete = () => {
    if (user?.id) markAdminIntroSeen(user.id);
    setPortalIntro(false);
  };

  useEffect(() => {
    if (!mobileNavOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setMobileNavOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleExpandedChange = (next) => {
    setSidebarExpanded(next);
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
    } catch {
      // ignore storage failures
    }
  };

  return (
    <>
      {portalIntro ? (
        <AdminPortalIntro
          firstName={adminDetails.firstName}
          fullName={adminDetails.fullName}
          onComplete={handlePortalIntroComplete}
        />
      ) : null}

      <div
        className={`h-[100dvh] overflow-hidden bg-[var(--color-surface-bg)] text-[var(--color-text-primary)] antialiased font-sans transition-opacity duration-[600ms] ${
          portalIntro !== false ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        expanded={sidebarExpanded}
        onExpandedChange={handleExpandedChange}
      />

      <div
        className={`flex h-[100dvh] min-w-0 flex-col overflow-hidden transition-[margin] duration-300 ease-out ${
          sidebarExpanded ? 'md:ml-[256px]' : 'md:ml-[72px]'
        }`}
      >
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border-default)] bg-white px-4 md:hidden">
          <HoverTip label="Open menu">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-highlight)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/30"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </HoverTip>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">Power Music Ops</p>
            <p className="truncate text-[11px] text-[var(--color-text-secondary)]">Admin dashboard</p>
          </div>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
    </>
  );
}
