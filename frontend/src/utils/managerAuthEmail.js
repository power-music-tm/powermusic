import { getSupabase } from '../supabaseClient';
import {
  validateManagerEmail,
  ensureManagerAllowedDomains,
  MANAGER_ACCOUNT_NOT_FOUND_MESSAGE,
} from './managerAuth';
import { getAuthCallbackUrl } from './authRedirect';
import { clearAuthCache } from './authCache';

const AUTH_EMAIL_TIMEOUT_MS = 20000;

function getAuthEmailRateLimitError(error, fallback) {
  if (!error) return fallback;
  const msg = error.message || '';
  if (
    msg.includes('For security purposes') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('429')
  ) {
    const secondsMatch = msg.match(/after (\d+) seconds?/i);
    if (secondsMatch) {
      return `Please wait ${secondsMatch[1]} seconds before requesting another email.`;
    }
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return 'Network error: Please check your internet connection and try again.';
  }
  return error.message || fallback;
}

async function withAuthEmailTimeout(promise, timeoutMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), AUTH_EMAIL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function managerAccountExists(supabase, email, { enforceDomain = true } = {}) {
  let allowedDomains;
  if (enforceDomain) {
    allowedDomains = await ensureManagerAllowedDomains();
  }
  const validated = validateManagerEmail(email, { enforceDomain, allowedDomains });
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const { data, error } = await supabase.rpc('manager_account_exists', {
    p_email: validated.value,
  });

  if (error) {
    throw new Error('Could not check your account. Please try again.');
  }

  return { email: validated.value, exists: Boolean(data) };
}

async function prepareAuthEmailClient() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error(
      'Authentication is not configured. Create frontend/.env.local with VITE_SUPABASE_ANON_KEY, then hard-refresh the page.'
    );
  }

  await supabase.auth.signOut();
  clearAuthCache();
  return supabase;
}

/** Send signup confirmation email (same Send Email hook as initial signUp). */
export async function resendManagerSignupConfirmation(email, { enforceDomain = true } = {}) {
  const supabase = await prepareAuthEmailClient();
  const { email: normalized, exists } = await managerAccountExists(supabase, email, { enforceDomain });

  if (!exists) {
    throw new Error(MANAGER_ACCOUNT_NOT_FOUND_MESSAGE);
  }

  const redirectTo = getAuthCallbackUrl();
  const { error } = await withAuthEmailTimeout(
    supabase.auth.resend({
      type: 'signup',
      email: normalized,
      options: { emailRedirectTo: redirectTo },
    }),
    'Sending the confirmation email is taking too long. Please try again in a moment.',
  );

  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('already confirmed') || msg.includes('already verified')) {
      throw new Error('This email is already confirmed. Please sign in instead.');
    }
    throw new Error(getAuthEmailRateLimitError(error, 'Could not send confirmation email.'));
  }

  return { email: normalized };
}

/** Send a manager password reset email (same Send Email hook as signup). */
export async function requestManagerPasswordReset(email, { enforceDomain = true } = {}) {
  const supabase = await prepareAuthEmailClient();
  const { email: normalized, exists } = await managerAccountExists(supabase, email, { enforceDomain });

  if (!exists) {
    throw new Error(MANAGER_ACCOUNT_NOT_FOUND_MESSAGE);
  }

  const redirectTo = getAuthCallbackUrl();
  const { error } = await withAuthEmailTimeout(
    supabase.auth.resetPasswordForEmail(normalized, { redirectTo }),
    'Sending the reset email is taking too long. Please try again in a moment.',
  );

  if (error) {
    throw new Error(getAuthEmailRateLimitError(error, 'Could not send password reset email.'));
  }

  return { email: normalized };
}

export const resendManagerPasswordReset = requestManagerPasswordReset;
