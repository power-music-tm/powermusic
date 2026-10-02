import { useEffect, useLayoutEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ensurePartnerSlugBranding,
  partnerSlugFromName,
  prefetchPartnerSlugBranding,
  readCachedPartnerSlugBranding,
} from '../utils/partnerSlugBrandingCache';
import { instantPartnerBrandingFromSlug } from '../utils/managerAuthBranding';
import { getManagerPartnerBranding } from '../utils/pilot2Api';
import { readCachedManagerPortalBranding } from '../components/manager/ManagerPortalIntro';
import ManagerPartnerLinkConflict from '../components/auth/ManagerPartnerLinkConflict';
import RolePortalConflict from '../components/auth/RolePortalConflict';
import { ManagerAuthLoading } from '../components/auth/ManagerAuthShell';
import {
  clearManagerIntendedPartnerSlug,
  setManagerIntendedPartnerSlug,
} from '../utils/managerPartnerLinkIntent';
import { getManagerPartnerLinkConflict } from '../utils/managerPartnerLinkConflict';
import { isAdminOnManagerPortal } from '../utils/rolePortalAccess';
import { signOutToManagerAuth } from '../utils/managerPartnerConflictSignOut';

/**
 * Partner-branded entry: /:partner/submit → signup (guest) or live form (signed-in manager).
 */
export default function PartnerSubmitEntry() {
  const navigate = useNavigate();
  const { partner } = useParams();
  const { user, role, loading, logout } = useAuth();
  const slug = partner || '';
  const cachedConflict = slug ? getManagerPartnerLinkConflict(slug) : null;
  const [managerBranding, setManagerBranding] = useState(() =>
    readCachedManagerPortalBranding() || cachedConflict?.sessionBranding || null,
  );
  const [urlBranding, setUrlBranding] = useState(() =>
    slug ? readCachedPartnerSlugBranding(slug) || instantPartnerBrandingFromSlug(slug) : null,
  );
  const [brandingReady, setBrandingReady] = useState(() =>
    Boolean(cachedConflict) || !readCachedManagerPortalBranding()?.partnerName,
  );
  const [signingOut, setSigningOut] = useState(false);

  useLayoutEffect(() => {
    if (slug) setManagerIntendedPartnerSlug(slug);
  }, [slug]);

  useLayoutEffect(() => {
    if (!slug) return undefined;
    prefetchPartnerSlugBranding(slug);
    let active = true;
    ensurePartnerSlugBranding(slug).then((branding) => {
      if (!active || !branding) return;
      setUrlBranding((prev) => ({
        partnerName: branding.partnerName || prev?.partnerName,
        logoDataUrl: branding.logoDataUrl ?? prev?.logoDataUrl ?? null,
      }));
    });
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!user || role !== 'manager') {
      setBrandingReady(true);
      return undefined;
    }

    let active = true;
    const cached = readCachedManagerPortalBranding();
    if (cached?.partnerName) setManagerBranding(cached);

    getManagerPartnerBranding()
      .then((data) => {
        if (!active || !data?.partnerName) return;
        setManagerBranding(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setBrandingReady(true);
      });

    return () => {
      active = false;
    };
  }, [user, role]);

  if (user && isAdminOnManagerPortal(user, role)) {
    return (
      <RolePortalConflict
        variant="admin-on-manager"
        partnerBranding={urlBranding}
        partnerSlug={slug}
        signingOut={signingOut}
        onGoToDashboard={() => navigate('/')}
        onLogout={async () => {
          if (signingOut) return;
          setSigningOut(true);
          try {
            await signOutToManagerAuth(slug, { logout, navigate });
          } finally {
            setSigningOut(false);
          }
        }}
      />
    );
  }

  if (user && cachedConflict) {
    return (
      <ManagerPartnerLinkConflict
        urlPartnerBranding={urlBranding || cachedConflict.urlBranding}
        urlPartnerSlug={slug}
        sessionPartnerBranding={managerBranding || cachedConflict.sessionBranding}
        signingOut={signingOut}
        onGoToPortal={() => {
          clearManagerIntendedPartnerSlug();
          navigate('/submit');
        }}
        onLogout={async () => {
          if (signingOut) return;
          setSigningOut(true);
          try {
            await signOutToManagerAuth(slug, { logout, navigate });
          } finally {
            setSigningOut(false);
          }
        }}
      />
    );
  }

  if (loading || (user && role === 'manager' && !brandingReady)) {
    return <ManagerAuthLoading partnerBranding={urlBranding || cachedConflict?.urlBranding} />;
  }

  if (user && role === 'manager') {
    const sessionSlug = managerBranding?.partnerName
      ? partnerSlugFromName(managerBranding.partnerName)
      : '';
    if (sessionSlug && slug.toLowerCase() === sessionSlug) {
      clearManagerIntendedPartnerSlug();
      return <Navigate to="/submit" replace />;
    }
    if (slug) {
      return (
        <ManagerPartnerLinkConflict
          urlPartnerBranding={urlBranding}
          urlPartnerSlug={slug}
          sessionPartnerBranding={managerBranding}
          signingOut={signingOut}
          onGoToPortal={() => {
            clearManagerIntendedPartnerSlug();
            navigate('/submit');
          }}
          onLogout={async () => {
            if (signingOut) return;
            setSigningOut(true);
            try {
              await signOutToManagerAuth(slug, { logout, navigate });
            } finally {
              setSigningOut(false);
            }
          }}
        />
      );
    }
    return <Navigate to="/submit" replace />;
  }

  return <Navigate to={`/${slug}/submit/signup`} replace />;
}
