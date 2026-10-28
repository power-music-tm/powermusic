/**
 * Client-side mirror of backend match_classification for Request History UX.
 *
 * First-name Potential flag uses the nickname dataset (not Jaro-Winkler):
 * exact match OR nickname-graph related (shared token length >= 3).
 * Confirmed: exact same non-empty email (complete match on its own).
 *
 * Potential (emails differ): first/last/email/location are separate fields.
 * Non-GLL allowed: first+email, last+email, email+location, first+last+location
 *   (and supersets). Never first+last, first+location, or last+location alone.
 * GLL allowed: first+last, first+email, first+location, last+email,
 *   email+location (and supersets). Never last+location alone.
 */

import nicknameRelated from '../data/nicknameRelated.json' with { type: 'json' };
import nicknameExtras from '../data/nicknameExtras.json' with { type: 'json' };

const MIN_SHARED_TOKEN_LEN = 3;

function norm(val) {
  if (!val) return '';
  return String(val).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Lowercase + strip all spaces — RUBAB / ru bab / rubab are the same. */
export function normalizeFirstName(val) {
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
  const local = nicknameExtras[n];
  if (Array.isArray(local)) {
    for (const x of local) related.add(x);
  }
  return related;
}

function nicknameGraphRelated(a, b) {
  const ra = relatedFirstNames(a);
  const rb = relatedFirstNames(b);
  if (ra.has(b) || rb.has(a)) return true;
  for (const token of ra) {
    if (rb.has(token) && token.length >= MIN_SHARED_TOKEN_LEN) return true;
  }
  return false;
}

/** Mirror of backend first_names_nickname_match */
export function firstNamesNicknameMatch(left, right, options = {}) {
  const a = normalizeFirstName(left);
  const b = normalizeFirstName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const rejected = options?.rejectedPairs;
  if (rejected instanceof Set) {
    const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
    if (rejected.has(key)) return false;
  }
  return nicknameGraphRelated(a, b);
}

/** Ordered ``a|b`` key for nickname pair answers (matches backend). */
export function orderedNicknamePairKey(left, right) {
  const a = normalizeFirstName(left);
  const b = normalizeFirstName(right);
  if (!a || !b || a === b) return null;
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * True when first names differ after normalize but are nickname-graph related.
 * Used to show the "learn these nicknames are different" confirmation on
 * Keep Existing and Add New.
 */
export function isNicknameOnlyFirstMatch(left, right, options = {}) {
  const a = normalizeFirstName(left);
  const b = normalizeFirstName(right);
  if (!a || !b || a === b) return false;
  const rejected = options?.rejectedPairs;
  if (rejected instanceof Set) {
    const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
    if (rejected.has(key)) return false;
  }
  return nicknameGraphRelated(a, b);
}

/** Display-safe first name (trimmed original casing when present). */
export function displayFirstName(value, fallback = '—') {
  const raw = String(value || '').trim();
  return raw || fallback;
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
  const firstMatch = Boolean(firstL && firstR && firstNamesNicknameMatch(firstL, firstR));
  const sameEmail = Boolean(emailL && emailR && emailL === emailR);
  const sameLoc = Boolean(locL && locR && locL === locR);

  // Exact same non-empty email is a complete / confirmed duplicate on its own.
  if (sameEmail) {
    return 'confirmed_duplicate';
  }

  if (isGll) {
    // Forbidden: last + location alone.
    if (sameLast && sameLoc && !firstMatch && !sameEmail) {
      return null;
    }
    const allowed =
      (firstMatch && sameLast)
      || (firstMatch && sameEmail)
      || (firstMatch && sameLoc)
      || (sameLast && sameEmail)
      || (sameEmail && sameLoc);
    if (allowed) {
      return 'potential_duplicate';
    }
    return null;
  }

  // Non-GLL: first/last separate. Forbidden weak pairs alone.
  if (firstMatch && sameLast && !sameEmail && !sameLoc) {
    return null;
  }
  if (firstMatch && sameLoc && !sameLast && !sameEmail) {
    return null;
  }
  if (sameLast && sameLoc && !firstMatch && !sameEmail) {
    return null;
  }
  const allowed =
    (firstMatch && sameEmail)
    || (sameLast && sameEmail)
    || (sameEmail && sameLoc)
    || (firstMatch && sameLast && sameLoc);
  if (allowed) {
    return 'potential_duplicate';
  }

  return null;
}

/**
 * True when `person` is a potential_duplicate of at least one other person in
 * `others` (Request History "Not the same person" eligibility). Confirmed-only
 * or non-matching peers do not count.
 *
 * @param {object} person
 * @param {object[]} others - person objects (not member wrappers)
 * @param {object} [options] - e.g. { isGll: boolean }
 */
export function hasPotentialDuplicatePeer(person, others, options = {}) {
  if (!person || !Array.isArray(others) || others.length === 0) return false;
  return others.some(
    (other) => other && matchClassification(person, other, options) === 'potential_duplicate',
  );
}
