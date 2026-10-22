/**
 * Client-side mirror of backend match_classification for Request History UX.
 *
 * First-name Potential flag uses the nickname dataset (not Jaro-Winkler):
 * exact match OR nickname-graph related (shared token length >= 3).
 * Confirmed: exact equality on all identity fields.
 *
 * Potential (non-GLL): name is ONE entity (first_match AND same_last);
 * any two of {Name, Email, Location} → potential_duplicate.
 * Potential (GLL): first/last stay separate flags; matched >= 2 AND
 * (same_last OR same_email).
 */

import nicknameRelated from '../data/nicknameRelated.json' with { type: 'json' };

const MIN_SHARED_TOKEN_LEN = 3;

function norm(val) {
  if (!val) return '';
  return String(val).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Lowercase + strip all spaces — RUBAB / ru bab / rubab are the same. */
function normalizeFirstName(val) {
  if (!val) return '';
  return String(val).trim().toLowerCase().replace(/\s+/g, '');
}

function relatedFirstNames(name) {
  const n = normalizeFirstName(name);
  if (!n) return new Set();
  const related = new Set([n]);
  const extras = nicknameRelated[n];
  if (Array.isArray(extras)) {
    for (const x of extras) related.add(x);
  }
  return related;
}

/** Mirror of backend first_names_nickname_match */
export function firstNamesNicknameMatch(left, right) {
  const a = normalizeFirstName(left);
  const b = normalizeFirstName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const ra = relatedFirstNames(a);
  const rb = relatedFirstNames(b);
  if (ra.has(b) || rb.has(a)) return true;
  for (const token of ra) {
    if (rb.has(token) && token.length >= MIN_SHARED_TOKEN_LEN) return true;
  }
  return false;
}

/**
 * @param {object} left
 * @param {object} right
 * @param {object} [options] - e.g. { isGll: boolean }
 * @returns {'confirmed_duplicate' | 'potential_duplicate' | null}
 */
export function matchClassification(left, right, options = {}) {
  const isGll = Boolean(options?.isGll);

  const firstL = normalizeFirstName(left?.firstName);
  const lastL = norm(left?.lastName);
  const emailL = norm(left?.email);
  const locL = norm(left?.location);
  const firstR = normalizeFirstName(right?.firstName);
  const lastR = norm(right?.lastName);
  const emailR = norm(right?.email);
  const locR = norm(right?.location);

  const sameLast = Boolean(lastL && lastR && lastL === lastR);
  const sameFirst = Boolean(firstL && firstR && firstL === firstR);
  const firstMatch = Boolean(firstL && firstR && firstNamesNicknameMatch(firstL, firstR));
  const sameEmail = Boolean(emailL && emailR && emailL === emailR);
  const sameLoc = Boolean(locL && locR && locL === locR);

  if (sameFirst && sameLast && sameEmail && (isGll || sameLoc)) {
    return 'confirmed_duplicate';
  }

  if (isGll) {
    // GLL: first and last remain separate flags; any two + last/email anchor.
    const matchedCount = [sameLast, firstMatch, sameEmail].filter(Boolean).length;
    if (matchedCount >= 2 && (sameLast || sameEmail)) {
      return 'potential_duplicate';
    }
    return null;
  }

  // Non-GLL: name is one entity (first_match AND same_last).
  const nameMatch = firstMatch && sameLast;
  const entityMatched = [nameMatch, sameEmail, sameLoc].filter(Boolean).length;
  if (entityMatched >= 2) {
    return 'potential_duplicate';
  }

  return null;
}
