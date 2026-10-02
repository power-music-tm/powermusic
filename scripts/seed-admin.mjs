#!/usr/bin/env node
/**
 * One-time admin bootstrap — run manually with secrets, never on deploy.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *   node scripts/seed-admin.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { isProduction, resolveAdminCredentials } from './lib/seed-guards.mjs';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminFullName = process.env.ADMIN_FULL_NAME || 'Andrea';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

if (isProduction() && process.env.VERCEL === '1') {
  console.error(
    'Refusing to seed admin during a Vercel build/deploy. '
      + 'Run this script manually from a trusted machine with secrets.',
  );
  process.exit(1);
}

const { email: adminEmail, password: adminPassword } = resolveAdminCredentials({
  allowDevDefaultPassword: true,
});
let finalPassword = adminPassword;

if (!finalPassword) {
  finalPassword = generatePassword();
  console.log('No ADMIN_PASSWORD provided — generated a strong password (save it now):');
  console.log(`\n  ${finalPassword}\n`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function generatePassword() {
  const base = randomBytes(18).toString('base64url');
  return `Pm!${base}9`;
}

async function findExistingAdminProfile() {
  const { data, error } = await supabase
    .from('powermusic_users')
    .select('id, email, full_name')
    .eq('role', 'admin')
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function main() {
  const existingAdmin = await findExistingAdminProfile();

  if (existingAdmin) {
    console.log(`Admin account already exists: ${existingAdmin.email} (${existingAdmin.id})`);
    console.log('No changes made. Rotate password via Supabase Dashboard or auth.admin.updateUserById.');
    return;
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: finalPassword,
    email_confirm: true,
    user_metadata: {
      full_name: adminFullName,
    },
  });

  if (createError) throw createError;

  const userId = created.user.id;

  const { error: profileError } = await supabase
    .from('powermusic_users')
    .upsert({
      id: userId,
      email: adminEmail,
      full_name: adminFullName,
      role: 'admin',
    });

  if (profileError) throw profileError;

  console.log('Admin account created successfully.');
  console.log(`  Email: ${adminEmail}`);
  console.log(`  Name:  ${adminFullName}`);
  console.log(`  ID:    ${userId}`);
  if (process.env.ADMIN_PASSWORD) {
    console.log('  Password: (from ADMIN_PASSWORD env var — store in your password manager)');
  } else {
    console.log('  Password: (generated above — store securely before closing the terminal)');
  }
}

main().catch((error) => {
  console.error('Failed to seed admin account:', error.message || error);
  process.exit(1);
});
