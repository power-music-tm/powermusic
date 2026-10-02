import { useEffect, useState } from 'react';
import { getPublicPartnerBranding } from '../utils/pilot2Api';

/**
 * Resolve partner logo/name from an email address (debounced, public API).
 */
export function usePartnerBrandingFromEmail(email) {
  const [partnerBranding, setPartnerBranding] = useState(null);

  useEffect(() => {
    const value = (email || '').trim().toLowerCase();
    if (!value.includes('@') || value.indexOf('@') === value.length - 1) {
      setPartnerBranding(null);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      getPublicPartnerBranding(value)
        .then((data) => {
          if (active) setPartnerBranding(data);
        })
        .catch(() => {
          if (active) setPartnerBranding(null);
        });
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [email]);

  return partnerBranding;
}
