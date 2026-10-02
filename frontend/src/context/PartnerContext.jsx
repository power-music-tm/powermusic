import { createContext, useContext, useEffect, useMemo, useState, useRef } from 'react';
import {
  clearCache,
  createPartner as createPartnerApi,
  getPartnerCustomForm,
  getPartners,
  loadWithCache,
  updatePartner as updatePartnerApi,
  writeCache,
} from '../utils/pilot2Api';
import {
  buildPartnerLogosSync,
  cachePartnerLogo,
  partnerCustomFormCacheKey,
  resolvePartnerLogoSrc,
} from '../utils/partnerSlugBrandingCache';
import { useAuth } from './AuthContext';

const PartnerContext = createContext(null);
const SELECTED_PARTNER_KEY = 'pm_selected_partner_id';
const ADMIN_SESSION_USER_KEY = 'pm_admin_session_user_id_v2';
const PARTNERS_LIST_CACHE_KEY = 'partners_list';

function readPartnersListCache() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(`pm_cache_${PARTNERS_LIST_CACHE_KEY}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readSelectedPartnerId() {
  try {
    const value = localStorage.getItem(SELECTED_PARTNER_KEY);
    return value && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}

function writeSelectedPartnerId(value) {
  try {
    if (value === null || value === '') localStorage.removeItem(SELECTED_PARTNER_KEY);
    else localStorage.setItem(SELECTED_PARTNER_KEY, value);
  } catch {
    /* ignore */
  }
}

function beginAdminSession(userId) {
  try {
    sessionStorage.setItem(ADMIN_SESSION_USER_KEY, String(userId));
  } catch {
    /* ignore */
  }
}

function endAdminSession() {
  try {
    sessionStorage.removeItem(ADMIN_SESSION_USER_KEY);
    localStorage.removeItem(SELECTED_PARTNER_KEY);
  } catch {
    /* ignore */
  }
}

function partnerIdsMatch(left, right) {
  return String(left ?? '') === String(right ?? '');
}

function resolveDefaultPartnerId(list) {
  return list[0]?.id ?? '';
}

function partnerExistsInList(list, partnerId) {
  if (!partnerId) return false;
  return list.some((partner) => partnerIdsMatch(partner.id, partnerId));
}

function readInitialSelectedPartnerId(partners) {
  if (!partners.length) return readSelectedPartnerId();

  const stored = readSelectedPartnerId();
  const sessionUser = sessionStorage.getItem(ADMIN_SESSION_USER_KEY);
  if (sessionUser && stored && partnerExistsInList(partners, stored)) {
    return stored;
  }
  return resolveDefaultPartnerId(partners);
}

export function PartnerProvider({ children }) {
  const { authReady, user, role } = useAuth();
  const cachedPartners = readPartnersListCache();
  const [partners, setPartners] = useState(cachedPartners);
  const [partnerLogos, setPartnerLogos] = useState(() => buildPartnerLogosSync(cachedPartners));
  const [selectedPartnerId, setSelectedPartnerIdState] = useState(() => readInitialSelectedPartnerId(cachedPartners));
  const preferFirstPartnerRef = useRef(false);
  const logosPrefetchRef = useRef(0);

  const currentSelectedRef = useRef(selectedPartnerId);
  useEffect(() => {
    currentSelectedRef.current = selectedPartnerId;
  }, [selectedPartnerId]);

  const setSelectedPartnerId = (partnerId) => {
    preferFirstPartnerRef.current = false;
    setSelectedPartnerIdState(partnerId);
    writeSelectedPartnerId(partnerId);
  };

  const syncPartnerLogos = (list) => {
    setPartnerLogos(buildPartnerLogosSync(list));
  };

  const prefetchMissingPartnerLogos = (list) => {
    const syncLogos = buildPartnerLogosSync(list);
    setPartnerLogos(syncLogos);

    const missing = list.filter((partner) => !syncLogos[partner.id]);
    if (missing.length === 0) return;

    const prefetchId = ++logosPrefetchRef.current;
    void Promise.all(
      missing.map(async (partner) => {
        try {
          const form = await getPartnerCustomForm(partner.id);
          const logo = resolvePartnerLogoSrc(form?.logo_url, form?.logo_data_url);
          if (logo) {
            cachePartnerLogo(partner.id, logo);
            writeCache(partnerCustomFormCacheKey(partner.id), form);
          }
          return logo ? { id: partner.id, logo } : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (prefetchId !== logosPrefetchRef.current) return;
      setPartnerLogos((prev) => {
        const next = { ...prev };
        for (const item of results) {
          if (item) next[item.id] = item.logo;
        }
        return next;
      });
    });
  };

  const syncSelectedPartner = (list) => {
    if (!Array.isArray(list) || list.length === 0) {
      if (currentSelectedRef.current) setSelectedPartnerId('');
      return;
    }

    const defaultPartnerId = resolveDefaultPartnerId(list);

    if (preferFirstPartnerRef.current) {
      preferFirstPartnerRef.current = false;
      setSelectedPartnerId(defaultPartnerId);
      return;
    }

    const latestSelected = currentSelectedRef.current;
    if (!latestSelected || !partnerExistsInList(list, latestSelected)) {
      setSelectedPartnerId(defaultPartnerId);
    }
  };

  const refreshPartners = async () => {
    const fresh = await loadWithCache(PARTNERS_LIST_CACHE_KEY, getPartners, (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      setPartners(list);
      syncSelectedPartner(list);
      syncPartnerLogos(list);
      prefetchMissingPartnerLogos(list);
    });
    const list = Array.isArray(fresh) ? fresh : [];
    setPartners(list);
    syncSelectedPartner(list);
    syncPartnerLogos(list);
    prefetchMissingPartnerLogos(list);
    return list;
  };

  useEffect(() => {
    if (!authReady) return;

    if (!user || role !== 'admin') {
      if (!user) endAdminSession();
      if (role && role !== 'admin') {
        setPartners([]);
        setPartnerLogos({});
      }
      return;
    }

    const userId = String(user.id);
    const sessionUserId = sessionStorage.getItem(ADMIN_SESSION_USER_KEY);

    if (sessionUserId !== userId) {
      beginAdminSession(userId);
      writeSelectedPartnerId(null);
      const list = readPartnersListCache();
      const firstPartnerId = resolveDefaultPartnerId(list);
      setSelectedPartnerIdState(firstPartnerId || null);
      currentSelectedRef.current = firstPartnerId || null;
      preferFirstPartnerRef.current = true;
      if (list.length > 0) {
        setPartners(list);
        syncPartnerLogos(list);
        prefetchMissingPartnerLogos(list);
      }
    } else {
      const list = readPartnersListCache();
      if (list.length > 0) {
        syncPartnerLogos(list);
        prefetchMissingPartnerLogos(list);
      }
      const stored = readSelectedPartnerId();
      if (stored && stored !== currentSelectedRef.current) {
        setSelectedPartnerIdState(stored);
        currentSelectedRef.current = stored;
      }
    }

    refreshPartners().catch(() => setPartners([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user, role]);

  useEffect(() => {
    if (role !== 'admin' || partners.length === 0) return;
    if (!selectedPartnerId || !partnerExistsInList(partners, selectedPartnerId)) {
      setSelectedPartnerId(resolveDefaultPartnerId(partners));
    }
  }, [partners, role, selectedPartnerId]);

  const selectedPartner = useMemo(
    () => partners.find((partner) => partnerIdsMatch(partner.id, selectedPartnerId)) || null,
    [partners, selectedPartnerId],
  );

  const partnerLabel = selectedPartner?.name || partners[0]?.name || 'Partner';
  const selectedPartnerLogo = selectedPartnerId ? partnerLogos[selectedPartnerId] ?? null : null;

  const createPartner = async (payload) => {
    const created = await createPartnerApi(payload);
    clearCache(PARTNERS_LIST_CACHE_KEY);
    await refreshPartners();
    setSelectedPartnerId(created.id);
    return created;
  };

  const updatePartner = async (partnerId, name) => {
    const updated = await updatePartnerApi(partnerId, name);
    clearCache(PARTNERS_LIST_CACHE_KEY);
    await refreshPartners();
    return updated;
  };

  const value = {
    partners,
    partnerLogos,
    selectedPartnerId,
    selectedPartner,
    selectedPartnerLogo,
    partnerLabel,
    setSelectedPartnerId,
    refreshPartners,
    createPartner,
    updatePartner,
  };

  return <PartnerContext.Provider value={value}>{children}</PartnerContext.Provider>;
}

export function usePartners() {
  const ctx = useContext(PartnerContext);
  if (!ctx) {
    throw new Error('usePartners must be used within PartnerProvider');
  }
  return ctx;
}
