import { getPublicCustomForm } from './pilot2Api';
import { normalizeAllowedDomainSuffixes } from './managerAuth';

const CACHE_PREFIX = 'pm_partner_slug_branding:';
const inflight = new Map();

function readStorage(storage, slug) {
  if (!slug || !storage) return null;
  try {
    const raw = storage.getItem(`${CACHE_PREFIX}${slug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.partnerName) return null;
    return {
      partnerName: parsed.partnerName,
      logoDataUrl: parsed.logoDataUrl ?? null,
      allowedDomains: Array.isArray(parsed.allowedDomains)
        ? normalizeAllowedDomainSuffixes(parsed.allowedDomains)
        : [],
    };
  } catch {
    return null;
  }
}

function writeStorage(storage, slug, branding) {
  if (!slug || !branding?.partnerName || !storage) return;
  try {
    storage.setItem(
      `${CACHE_PREFIX}${slug}`,
      JSON.stringify({
        partnerName: branding.partnerName,
        logoDataUrl: branding.logoDataUrl ?? null,
        allowedDomains: branding.allowedDomains ?? [],
      }),
    );
  } catch {
    /* quota */
  }
}

export function parsePartnerSlugFromPath(pathname = '') {
  const match = String(pathname).match(/^\/([^/]+)\/submit\/signup\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function partnerSlugFromName(name) {
  return (name || 'partner').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function preloadLogo(logoDataUrl) {
  if (!logoDataUrl) return;
  const img = new Image();
  img.decoding = 'sync';
  img.src = logoDataUrl;
}

export const LARGE_PARTNER_LOGO_DATA_URL_LENGTH = 200_000;

const AVATAR_LOGO_SIZE = 256;
const PARTNER_FORM_CACHE_KEY = 'partner_custom_form_v2';
const PARTNER_LOGOS_MAP_KEY = 'pm_partner_logos_v1';

function readPartnerLogosMap() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PARTNER_LOGOS_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writePartnerLogoToMap(partnerId, logoDataUrl) {
  if (!partnerId || typeof window === 'undefined') return;
  try {
    const map = readPartnerLogosMap();
    if (logoDataUrl) map[String(partnerId)] = logoDataUrl;
    else delete map[String(partnerId)];
    localStorage.setItem(PARTNER_LOGOS_MAP_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function cachePartnerLogo(partnerId, logoDataUrl) {
  if (!partnerId) return;
  writePartnerLogoToMap(partnerId, logoDataUrl);
  preloadLogo(logoDataUrl ?? null);
}

export function buildPartnerLogosSync(partners = []) {
  const logos = { ...readPartnerLogosMap() };
  for (const partner of partners) {
    if (!partner?.id) continue;
    const instant = readInstantPartnerLogo(partner.id, partner.name);
    if (instant) {
      logos[partner.id] = instant;
      if (!readPartnerLogosMap()[String(partner.id)]) {
        writePartnerLogoToMap(partner.id, instant);
      }
    }
  }
  for (const logo of Object.values(logos)) {
    preloadLogo(logo);
  }
  return logos;
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load logo'));
    img.src = dataUrl;
  });
}

export function resolvePartnerLogoSrc(logoUrl, logoDataUrl) {
  return logoUrl ?? logoDataUrl ?? null;
}

/** Session cache key for partner custom form (includes logo_url / legacy logo_data_url). */
export function partnerCustomFormCacheKey(partnerId) {
  return `${PARTNER_FORM_CACHE_KEY}:${partnerId}`;
}

/**
 * Downscale a logo for storage without letterboxing (preserves aspect ratio).
 */
export async function downscalePartnerLogoDataUrl(dataUrl, maxSize = 768) {
  if (!dataUrl || typeof window === 'undefined') return dataUrl;

  try {
    const img = await loadImageElement(dataUrl);
    if (img.width <= maxSize && img.height <= maxSize) return dataUrl;

    const scale = Math.min(maxSize / img.width, maxSize / img.height);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}

/**
 * Pre-render a circular avatar PNG (cover crop, center-weighted).
 * Prefer raw logo + CSS object-cover in UI; use this only when a baked asset is required.
 */
export async function preparePartnerLogoForAvatar(
  dataUrl,
  { size = AVATAR_LOGO_SIZE } = {},
) {
  if (!dataUrl || typeof window === 'undefined') return dataUrl;

  try {
    const img = await loadImageElement(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;

    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const scale = Math.max(size / img.width, size / img.height);
    const width = img.width * scale;
    const height = img.height * scale;
    ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
    ctx.restore();

    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}

/** @deprecated Use preparePartnerLogoForAvatar */
export function resizePartnerLogoDataUrl(dataUrl, maxSize = AVATAR_LOGO_SIZE) {
  return preparePartnerLogoForAvatar(dataUrl, { size: maxSize });
}

/** Partner-id cache only — avoids slug cache showing the wrong partner's logo. */
export function readInstantPartnerLogoByPartnerId(partnerId) {
  if (!partnerId || typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`pm_cache_${partnerCustomFormCacheKey(partnerId)}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const logo = resolvePartnerLogoSrc(parsed?.logo_url, parsed?.logo_data_url);
    if (logo) preloadLogo(logo);
    return logo;
  } catch {
    return null;
  }
}

/** Instant logo — prefer partner id; optional slug fallback for public pages. */
export function readInstantPartnerLogo(partnerId, partnerName, { slugFallback = true } = {}) {
  const byPartnerId = readInstantPartnerLogoByPartnerId(partnerId);
  if (byPartnerId) return byPartnerId;

  const fromMap = partnerId ? readPartnerLogosMap()[String(partnerId)] : null;
  if (fromMap) {
    preloadLogo(fromMap);
    return fromMap;
  }

  if (!slugFallback) return null;

  const slug = partnerSlugFromName(partnerName);
  const cached = slug ? readCachedPartnerSlugBranding(slug) : null;
  if (cached?.logoDataUrl) {
    preloadLogo(cached.logoDataUrl);
    return cached.logoDataUrl;
  }

  return null;
}

export function readCachedPartnerSlugBranding(slug) {
  if (!slug || typeof window === 'undefined') return null;
  return (
    readStorage(localStorage, slug) ||
    readStorage(sessionStorage, slug)
  );
}

/**
 * Merge into the slug branding cache. Only fields explicitly provided are
 * updated; omitted fields (undefined) keep their existing cached value. Pass an
 * explicit null to clear a field (e.g. logoDataUrl on remove).
 */
export function cachePartnerSlugBranding(slug, branding) {
  if (!slug || !branding) return;
  const existing = readCachedPartnerSlugBranding(slug);
  const partnerName = branding.partnerName ?? existing?.partnerName;
  if (!partnerName) return;

  const merged = {
    partnerName,
    logoDataUrl:
      branding.logoDataUrl !== undefined
        ? branding.logoDataUrl
        : existing?.logoDataUrl ?? null,
    allowedDomains:
      branding.allowedDomains !== undefined
        ? branding.allowedDomains
        : existing?.allowedDomains ?? [],
  };

  writeStorage(localStorage, slug, merged);
  writeStorage(sessionStorage, slug, merged);
  preloadLogo(merged.logoDataUrl ?? null);
}

function brandingFromApiResponse(data) {
  if (!data?.partnerName) return null;
  const logo = resolvePartnerLogoSrc(data.logoUrl, data.logoDataUrl);
  return {
    partnerName: data.partnerName,
    logoDataUrl: logo,
    allowedDomains: normalizeAllowedDomainSuffixes(data.allowedDomains),
  };
}

export function prefetchPartnerSlugBranding(slugOrPath) {
  const slug =
    typeof slugOrPath === 'string' && slugOrPath.includes('/')
      ? parsePartnerSlugFromPath(slugOrPath)
      : slugOrPath;
  if (!slug) return null;

  const cached = readCachedPartnerSlugBranding(slug);
  if (cached) {
    preloadLogo(cached.logoDataUrl);
    return Promise.resolve(cached);
  }

  return fetchAndCachePartnerSlugBranding(slug);
}

// Always hits the network and refreshes the cache (deduped per slug).
function fetchAndCachePartnerSlugBranding(slug) {
  if (!slug) return Promise.resolve(null);
  if (inflight.has(slug)) return inflight.get(slug);

  const promise = getPublicCustomForm(slug)
    .then((data) => {
      const branding = brandingFromApiResponse(data);
      if (branding) cachePartnerSlugBranding(slug, branding);
      inflight.delete(slug);
      return branding;
    })
    .catch(() => {
      inflight.delete(slug);
      return null;
    });

  inflight.set(slug, promise);
  return promise;
}

export function prefetchPartnerSlugBrandingFromLocation() {
  if (typeof window === 'undefined') return null;
  return prefetchPartnerSlugBranding(window.location.pathname);
}

export function ensurePartnerSlugBranding(slug) {
  if (!slug) return Promise.resolve(null);
  const cached = readCachedPartnerSlugBranding(slug);
  // Complete cache entry: return it instantly, but revalidate in the background
  // so admin edits (e.g. a removed domain) self-heal on the next visit.
  if (cached?.partnerName && cached.allowedDomains?.length) {
    fetchAndCachePartnerSlugBranding(slug);
    return Promise.resolve(cached);
  }
  // Missing/empty domains (old or clobbered cache entries): always hit the
  // network and wait. Do NOT fall back to prefetch here — prefetch returns the
  // stale cached entry first, which would keep the empty domain list.
  return fetchAndCachePartnerSlugBranding(slug);
}
