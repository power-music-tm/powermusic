const COOLDOWN_MS = 60_000;
const STORAGE_PREFIX = 'managerOtpCooldown:';

export function getOtpCooldownRemaining(email) {
  const key = `${STORAGE_PREFIX}${(email || '').trim().toLowerCase()}`;
  const until = Number(sessionStorage.getItem(key) || 0);
  return Math.max(0, until - Date.now());
}

export function setOtpCooldown(email) {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return;
  sessionStorage.setItem(`${STORAGE_PREFIX}${normalized}`, String(Date.now() + COOLDOWN_MS));
}

export function formatCooldown(ms) {
  const seconds = Math.ceil(ms / 1000);
  return seconds <= 1 ? '1 second' : `${seconds} seconds`;
}
