import { readCachedManagerPortalBranding } from '../components/manager/ManagerPortalIntro';
import { instantPartnerBrandingFromSlug } from './managerAuthBranding';
import {
  partnerSlugFromName,
  readCachedPartnerSlugBranding,
} from './partnerSlugBrandingCache';

/** Sync mismatch check from cached branding — safe before auth/API resolves. */
export function getManagerPartnerLinkConflict(partnerSlug) {
  const urlSlug = String(partnerSlug || '').trim().toLowerCase();
  if (!urlSlug) return null;

  const sessionBranding = readCachedManagerPortalBranding();
  const sessionSlug = sessionBranding?.partnerName
    ? partnerSlugFromName(sessionBranding.partnerName)
    : '';
  if (!sessionSlug || urlSlug === sessionSlug) return null;

  const urlBranding =
    readCachedPartnerSlugBranding(urlSlug) || instantPartnerBrandingFromSlug(urlSlug);

  return {
    urlSlug,
    urlBranding,
    sessionBranding,
    sessionSlug,
  };
}

export function isLikelyManagerPartnerLinkConflict(partnerSlug, userId, role) {
  if (!partnerSlug || !userId) return false;
  if (role === 'manager') return Boolean(getManagerPartnerLinkConflict(partnerSlug));
  if (role) return false;
  try {
    const raw = localStorage.getItem('powerMusicOps.authProfile');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.userId !== userId || parsed?.role !== 'manager') return false;
    return Boolean(getManagerPartnerLinkConflict(partnerSlug));
  } catch {
    return false;
  }
}
