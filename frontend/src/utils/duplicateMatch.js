/**
 * Client-side mirror of backend match_classification for Request History UX.
 * Uses field-flag classification rules:
 * - FIRST_NAME_MATCH_MIN = 0.60 Jaro-Winkler similarity
 * - Confirmed: exact equality on all identity fields
 * - Potential: matched field count >= 2 AND (same_last OR same_email)
 */

const FIRST_NAME_MATCH_MIN = 0.60;

function norm(val) {
  if (!val) return '';
  return String(val).trim().toLowerCase().replace(/\s+/g, ' ');
}

function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

  let matches = 0;
  const hash1 = Array(len1).fill(false);
  const hash2 = Array(len2).fill(false);

  for (let i = 0; i < len1; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(len2, i + matchDistance + 1);
    for (let j = start; j < end; j += 1) {
      if (!hash2[j] && s1[i] === s2[j]) {
        hash1[i] = true;
        hash2[j] = true;
        matches += 1;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let t = 0;
  let point = 0;
  for (let i = 0; i < len1; i += 1) {
    if (hash1[i]) {
      while (!hash2[point]) point += 1;
      if (s1[i] !== s2[point]) t += 1;
      point += 1;
    }
  }
  t /= 2;

  const m = matches;
  const jaro = (m / len1 + m / len2 + (m - t) / m) / 3.0;

  let prefix = 0;
  const maxPrefix = Math.min(4, len1, len2);
  for (let i = 0; i < maxPrefix; i += 1) {
    if (s1[i] === s2[i]) prefix += 1;
    else break;
  }

  return jaro + prefix * 0.1 * (1.0 - jaro);
}

/**
 * @param {object} left
 * @param {object} right
 * @param {object} [options] - e.g. { isGll: boolean }
 * @returns {'confirmed_duplicate' | 'potential_duplicate' | null}
 */
export function matchClassification(left, right, options = {}) {
  const isGll = Boolean(options?.isGll);

  const firstL = norm(left?.firstName);
  const lastL = norm(left?.lastName);
  const emailL = norm(left?.email);
  const locL = norm(left?.location);
  const firstR = norm(right?.firstName);
  const lastR = norm(right?.lastName);
  const emailR = norm(right?.email);
  const locR = norm(right?.location);

  const sameLast = Boolean(lastL && lastR && lastL === lastR);
  const sameFirst = Boolean(firstL && firstR && firstL === firstR);
  const jwFirst = jaroWinkler(firstL, firstR);
  const firstMatch = sameFirst || (Boolean(firstL && firstR) && jwFirst >= FIRST_NAME_MATCH_MIN);
  const sameEmail = Boolean(emailL && emailR && emailL === emailR);
  const sameLoc = Boolean(locL && locR && locL === locR);

  // Requirement: at least one anchor field (same_last OR same_email) must be true
  const anchorFieldMatched = sameLast || sameEmail;

  if (sameFirst && sameLast && sameEmail && (isGll || sameLoc)) {
    return 'confirmed_duplicate';
  }

  const matchedCount = [
    sameLast,
    firstMatch,
    sameEmail,
    isGll ? false : sameLoc,
  ].filter(Boolean).length;

  if (matchedCount >= 2 && anchorFieldMatched) {
    return 'potential_duplicate';
  }

  return null;
}

