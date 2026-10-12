import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const guardsPath = path.join(root, 'scripts/lib/seed-guards.mjs');

function runResolve(env) {
  const script = `
    import { resolveAdminCredentials } from ${JSON.stringify(guardsPath)};
    const result = resolveAdminCredentials();
    console.log(JSON.stringify(result));
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, ...env, NODE_ENV: env.NODE_ENV || 'test' },
    encoding: 'utf8',
  });
}

test('seed guards refuse missing ADMIN_EMAIL', () => {
  const result = runResolve({
    ADMIN_EMAIL: '',
    ADMIN_PASSWORD: 'x',
    VERCEL_ENV: '',
    ENVIRONMENT: '',
    NODE_ENV: 'development',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /ADMIN_EMAIL is required/);
});

test('seed guards refuse production without ADMIN_PASSWORD', () => {
  const result = runResolve({
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: '',
    VERCEL_ENV: 'production',
    ENVIRONMENT: 'production',
    NODE_ENV: 'production',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /ADMIN_PASSWORD/);
});

test('seed guards accept explicit credentials in development', () => {
  const result = runResolve({
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'ExplicitStrongPass1!',
    VERCEL_ENV: '',
    ENVIRONMENT: 'development',
    NODE_ENV: 'development',
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(parsed.email, 'admin@example.com');
  assert.equal(parsed.password, 'ExplicitStrongPass1!');
  assert.equal(parsed.production, false);
});

test('seed-guards source must not contain baked-in passwords', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(guardsPath, 'utf8');
  assert.equal(src.includes('DEV_DEFAULT_PASSWORD'), false);
  assert.equal(src.includes('AndreaSuperSecurePass2026'), false);
  assert.equal(src.includes('Powermusic1_'), false);
  assert.equal(src.includes('andrea@powermusic.com'), false);
});

test('python seed_admin.py refuses missing credentials', () => {
  const py = path.join(root, 'backend/.venv-mac/bin/python');
  const result = spawnSync(
    py,
    ['-c', 'import seed_admin; seed_admin.resolve_admin_credentials()'],
    {
      cwd: path.join(root, 'backend'),
      env: {
        ...process.env,
        ADMIN_EMAIL: '',
        ADMIN_PASSWORD: '',
        VERCEL_ENV: '',
        ENVIRONMENT: '',
      },
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ADMIN_EMAIL and ADMIN_PASSWORD are required/);
});

test('python seed_admin.py source must not contain baked-in password', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(path.join(root, 'backend/seed_admin.py'), 'utf8');
  assert.equal(src.includes('DEV_DEFAULT_PASSWORD'), false);
  assert.equal(src.includes('Powermusic1_'), false);
});
