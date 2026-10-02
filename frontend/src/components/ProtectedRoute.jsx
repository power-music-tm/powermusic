import { useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ManagerAuthLoading } from '../components/auth/ManagerAuthShell';
import RolePortalConflict from '../components/auth/RolePortalConflict';
import { readCachedManagerPortalBranding } from '../components/manager/ManagerPortalIntro';
import { readManagerIntendedPartnerSlug } from '../utils/managerPartnerLinkIntent';
import { signOutToAdminAuth, signOutToManagerAuth } from '../utils/managerPartnerConflictSignOut';
import {
  readCachedPartnerSlugBranding,
} from '../utils/partnerSlugBrandingCache';
import { instantPartnerBrandingFromSlug } from '../utils/managerAuthBranding';
import {
  isAdminOnManagerPortal,
  isManagerOnAdminPortal,
} from '../utils/rolePortalAccess';

function useConflictSignOut() {
  const { logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const runSignOut = async (signOutFn) => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutFn();
    } finally {
      setSigningOut(false);
    }
  };

  return { logout, signingOut, runSignOut };
}

export function AdminRoute() {
  const { user, role, authReady } = useAuth();
  const navigate = useNavigate();
  const { logout, signingOut, runSignOut } = useConflictSignOut();

  if (!user) {
    return authReady ? <Navigate to="/admin/login" replace /> : <ManagerAuthLoading />;
  }

  if (isManagerOnAdminPortal(user, role)) {
    return (
      <RolePortalConflict
        variant="manager-on-admin"
        sessionPartnerBranding={readCachedManagerPortalBranding()}
        signingOut={signingOut}
        onGoToPortal={() => navigate('/submit')}
        onLogout={() =>
          runSignOut(() => signOutToAdminAuth({ logout, navigate }))
        }
      />
    );
  }

  if (!role) {
    return <ManagerAuthLoading />;
  }

  if (role === 'admin') {
    return <Outlet />;
  }

  return <Navigate to="/admin/login" replace />;
}

/** Manager-only pages — admins and guests cannot access the submit form. */
export function ManagerRoute() {
  const { user, role, session, authReady } = useAuth();
  const navigate = useNavigate();
  const { logout, signingOut, runSignOut } = useConflictSignOut();
  const intendedPartnerSlug = readManagerIntendedPartnerSlug();
  const intendedPartnerBranding =
    readCachedPartnerSlugBranding(intendedPartnerSlug) ||
    instantPartnerBrandingFromSlug(intendedPartnerSlug);

  if (user && isAdminOnManagerPortal(user, role)) {
    return (
      <RolePortalConflict
        variant="admin-on-manager"
        partnerSlug={intendedPartnerSlug}
        partnerBranding={intendedPartnerBranding}
        signingOut={signingOut}
        onGoToDashboard={() => navigate('/')}
        onLogout={() =>
          runSignOut(() => signOutToManagerAuth(intendedPartnerSlug, { logout, navigate }))
        }
      />
    );
  }

  if (user && session?.access_token && role === 'manager') {
    return <Outlet />;
  }

  if (!authReady || (user && !role)) {
    return <ManagerAuthLoading />;
  }

  if (user && role === 'manager') {
    return <ManagerAuthLoading />;
  }

  if (!user || !session?.access_token) {
    return <Navigate to="/submit/signup" replace state={{ from: '/submit' }} />;
  }

  return <Outlet />;
}

/** Login / signup — Signup handles signed-in admin, manager, and guest states. */
export function ManagerGuestRoute() {
  return <Outlet />;
}

export function ProtectedRoute({ allowedRoles }) {
  const { user, role } = useAuth();

  if (!user) {
    return <Navigate to="/submit/signup" replace />;
  }

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to={role === 'admin' ? '/' : '/submit/signup'} replace />;
  }

  return <Outlet />;
}
