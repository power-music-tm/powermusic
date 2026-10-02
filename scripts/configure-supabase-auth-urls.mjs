#!/usr/bin/env node
/**
 * Merge auth redirect URLs into the hosted Supabase project.
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/configure-supabase-auth-urls.mjs
 *
 * Token: https://supabase.com/dashboard/account/tokens
 * Project ref defaults to thnrekngjwtnjkksqomf (powermusic).
 */

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'thnrekngjwtnjkksqomf';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const REQUIRED_REDIRECT_URLS = [
  'http://localhost:5173/auth/callback',
  'http://localhost:3000/auth/callback',
  'http://127.0.0.1:3000/auth/callback',
  'http://127.0.0.1:5173/auth/callback',
  'https://power-music-mock.vercel.app/auth/callback',
  'http://localhost:5173/submit/signup',
  'http://localhost:3000/submit/signup',
  'http://127.0.0.1:3000/submit/signup',
  'https://power-music-mock.vercel.app/submit/signup',
  'http://localhost:5173/admin/login',
  'https://power-music-mock.vercel.app/admin/login',
];

const SITE_URL = process.env.SUPABASE_SITE_URL || 'https://power-music-mock.vercel.app';

function parseAllowList(config) {
  const raw = config?.uri_allow_list ?? config?.URI_ALLOW_LIST ?? '';
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

function mergeAllowList(existing, required) {
  const merged = new Set(existing);
  for (const url of required) merged.add(url);
  return [...merged];
}

async function main() {
  if (!ACCESS_TOKEN) {
    console.error('Missing SUPABASE_ACCESS_TOKEN.');
    console.error('Create one at https://supabase.com/dashboard/account/tokens');
    process.exit(1);
  }

  const base = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
  const headers = {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const getRes = await fetch(base, { headers });
  if (!getRes.ok) {
    const body = await getRes.text();
    console.error(`Failed to read auth config (${getRes.status}): ${body}`);
    process.exit(1);
  }

  const current = await getRes.json();
  const existing = parseAllowList(current);
  const merged = mergeAllowList(existing, REQUIRED_REDIRECT_URLS);

  const patchBody = {
    site_url: SITE_URL,
    uri_allow_list: merged.join(','),
  };

  const patchRes = await fetch(base, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patchBody),
  });

  if (!patchRes.ok) {
    const body = await patchRes.text();
    console.error(`Failed to update auth config (${patchRes.status}): ${body}`);
    process.exit(1);
  }

  const updated = await patchRes.json();
  const finalList = parseAllowList(updated);

  console.log(`Updated Supabase auth config for project ${PROJECT_REF}`);
  console.log(`  site_url: ${updated.site_url ?? SITE_URL}`);
  console.log('  redirect URLs:');
  for (const url of finalList) {
    console.log(`    - ${url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
