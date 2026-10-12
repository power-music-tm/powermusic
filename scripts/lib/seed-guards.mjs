/** Shared guards for one-time admin bootstrap scripts. */

export function isProduction() {
  return (
    process.env.VERCEL_ENV === 'production'
    || process.env.ENVIRONMENT === 'production'
    || process.env.NODE_ENV === 'production'
  );
}

/**
 * Resolve admin seed credentials from env only — no baked-in passwords.
 * @returns {{ email: string, password: string | null, production: boolean }}
 */
export function resolveAdminCredentials() {
  const production = isProduction();
  const email = (process.env.ADMIN_EMAIL || '').trim();
  const password = process.env.ADMIN_PASSWORD || null;

  if (!email) {
    console.error(
      'ADMIN_EMAIL is required. Example:\n'
        + '  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=\'...\' node scripts/seed-admin.mjs',
    );
    process.exit(1);
  }

  if (production && !password) {
    console.error(
      'Production seed requires ADMIN_PASSWORD. '
        + 'Run this script manually with secrets — never on deploy.',
    );
    process.exit(1);
  }

  return { email, password, production };
}
