import { clearCachedManagerPortalBranding } from '../components/manager/ManagerPortalIntro';
import { managerAuthSignupPath } from './managerAuthBranding';
import {
  readManagerIntendedPartnerSlug,
  setManagerIntendedPartnerSlug,
} from './managerPartnerLinkIntent';

function resolveTargetPartnerSlug(partnerSlug) {
  return String(partnerSlug || readManagerIntendedPartnerSlug() || '')
    .trim()
    .toLowerCase();
}

/** Sign out and land on the manager sign-in page for the partner link being opened. */
export async function signOutToManagerAuth(partnerSlug, { logout, navigate }) {
  const slug = resolveTargetPartnerSlug(partnerSlug);

  clearCachedManagerPortalBranding();
  if (slug) setManagerIntendedPartnerSlug(slug);

  await logout();

  navigate(managerAuthSignupPath(slug), { replace: true, state: { mode: 'signin' } });
}

/** @deprecated Use signOutToManagerAuth */
export const signOutForPartnerLinkConflict = signOutToManagerAuth;

/** Sign out and land on the admin sign-in page. */
export async function signOutToAdminAuth({ logout, navigate }) {
  clearCachedManagerPortalBranding();

  await logout();

  navigate('/admin/login', { replace: true });
}
