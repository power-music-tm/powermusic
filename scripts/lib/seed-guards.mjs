/** Shared guards for one-time admin bootstrap scripts. */

export const DEV_DEFAULT_EMAIL = 'andrea@powermusic.com';
export const DEV_DEFAULT_PASSWORD = 'AndreaSuperSecurePass2026!';

export function isProduction() {
  return (
    process.env.VERCEL_ENV === 'production'
    || process.env.ENVIRONMENT === 'production'
    || process.env.NODE_ENV === 'production'
  );
}

/**
 * @param {{ allowDevDefaultPassword?: boolean }} options
 * - allowDevDefaultPassword: Python seed uses a fixed dev default when unset.
 *   Node seed generates a random password when unset.
 */
export function resolveAdminCredentials({ allowDevDefaultPassword = false } = {}) {
  const production = isProduction();
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (production) {
    if (!email || !password) {
      console.error(
        'Production seed requires ADMIN_EMAIL and ADMIN_PASSWORD env vars. '
          + 'Run this script manually with secrets — never on deploy.',
      );
      process.exit(1);
    }
    return { email, password, production: true };
  }

  const resolvedEmail = email || DEV_DEFAULT_EMAIL;
  if (!email) {
    console.warn(`DEV ONLY: defaulting ADMIN_EMAIL to ${DEV_DEFAULT_EMAIL}`);
  }

  if (password) {
    return { email: resolvedEmail, password, production: false };
  }

  if (allowDevDefaultPassword) {
    console.warn('DEV ONLY: using default admin password from seed-guards (local dev only).');
    return { email: resolvedEmail, password: DEV_DEFAULT_PASSWORD, production: false };
  }

  return { email: resolvedEmail, password: null, production: false };
}
