#!/usr/bin/env node
/**
 * Apply profile migrations to the linked Supabase Postgres database.
 * Uses DATABASE_URL from backend/.env
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

dotenv.config({ path: resolve(root, 'backend/.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL in backend/.env');
  process.exit(1);
}

const files = [
  'supabase/migrations/001_profiles_and_auth.sql',
  'supabase/migrations/003_manager_profile_metadata.sql',
  'supabase/migrations/004_ensure_manager_profile.sql',
  'supabase/migrations/005_manager_account_exists.sql',
  'supabase/migrations/006_manager_account_exists_auth_users.sql',
];

const backfillSql = `
INSERT INTO public.powermusic_users (id, email, full_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(
    NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(both FROM concat(
      NULLIF(trim(u.raw_user_meta_data->>'firstName'), ''),
      ' ',
      NULLIF(trim(u.raw_user_meta_data->>'lastName'), '')
    )), ''),
    split_part(u.email, '@', 1)
  ),
  'manager'
FROM auth.users u
LEFT JOIN public.powermusic_users p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
`;

async function main() {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    for (const file of files) {
      const sql = readFileSync(resolve(root, file), 'utf8');
      console.log(`Applying ${file}...`);
      await client.query(sql);
    }

    console.log('Backfilling missing profiles...');
    const backfill = await client.query(backfillSql);
    console.log(`Backfill inserted rows: ${backfill.rowCount ?? 0}`);

    const { rows } = await client.query('SELECT count(*)::int AS n FROM public.powermusic_users');
    console.log(`powermusic_users table row count: ${rows[0].n}`);
    console.log('Done.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
