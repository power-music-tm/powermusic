import { normalizeManagerEmail } from './managerAuth';

const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const HTML_TAG = /<[^>]+>/;
const LETTERS_ONLY = /[^\p{L}\p{M}]/gu;
const LOCATION_CHARS = /[^\p{L}\p{M}\s]/gu;
const ROSTER_NAME_RE = /^[\p{L}\p{M}]{2,100}$/u;
const ROSTER_LOCATION_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;

export const PERSON_FIELD_LIMITS = {
  firstName: 100,
  lastName: 100,
  email: 254,
  // "location" for PureGym, "client" for Health Fitness — same physical field.
  location: 200,
  role: 200,
  notes: 5000,
};

export const MIN_ROSTER_NAME_LENGTH = 2;
export const MIN_ROSTER_LOCATION_LENGTH = 2;

const PERSON_FIELDS = ['firstName', 'lastName', 'email', 'location', 'role', 'notes'];

/** Strip invalid characters as the user types. */
export function sanitizePersonFieldInput(field, value) {
  const raw = String(value ?? '').replace(CONTROL_CHARS, '');
  if (field === 'email') {
    return raw.slice(0, PERSON_FIELD_LIMITS.email);
  }
  if (field === 'firstName' || field === 'lastName') {
    return raw.replace(LETTERS_ONLY, '').slice(0, PERSON_FIELD_LIMITS[field]);
  }
  if (field === 'location') {
    return raw.replace(LOCATION_CHARS, '').slice(0, PERSON_FIELD_LIMITS.location);
  }
  if (field === 'role') {
    return raw.slice(0, PERSON_FIELD_LIMITS.role);
  }
  const max = PERSON_FIELD_LIMITS[field] ?? 5000;
  return raw.slice(0, max);
}

function rejectHtml(value, fieldName) {
  if (HTML_TAG.test(value)) {
    return `${fieldName} must not contain HTML.`;
  }
  return null;
}

export function validateRosterPersonName(raw, fieldName, fieldKey) {
  const cleaned = sanitizePersonFieldInput(fieldKey, raw);
  if (!cleaned) {
    return { ok: false, error: `${fieldName} is required.` };
  }
  if (cleaned.length < MIN_ROSTER_NAME_LENGTH) {
    return { ok: false, error: `${fieldName} must be at least ${MIN_ROSTER_NAME_LENGTH} characters.` };
  }
  if (cleaned.length > PERSON_FIELD_LIMITS.firstName) {
    return { ok: false, error: `${fieldName} must be at most 100 characters.` };
  }
  const htmlError = rejectHtml(cleaned, fieldName);
  if (htmlError) return { ok: false, error: htmlError };
  if (!ROSTER_NAME_RE.test(cleaned)) {
    return { ok: false, error: `${fieldName} must contain letters only (no numbers, spaces, or symbols).` };
  }
  return { ok: true, value: cleaned };
}

/** Roster user email — format only (no manager-domain restriction). */
export function validatePersonEmail(raw) {
  const normalized = normalizeManagerEmail(raw);
  if (!normalized.ok) {
    if (normalized.error === 'Email address is required.') {
      return { ok: false, error: 'User Email is required.' };
    }
    return normalized;
  }
  return normalized;
}

export function validatePersonLocation(raw, fieldName = 'User Location') {
  const cleaned = sanitizePersonFieldInput('location', raw).trim();
  if (!cleaned) {
    return { ok: false, error: `${fieldName} is required.` };
  }
  if (cleaned.length < MIN_ROSTER_LOCATION_LENGTH) {
    return { ok: false, error: `${fieldName} must be at least ${MIN_ROSTER_LOCATION_LENGTH} characters.` };
  }
  if (cleaned.length > PERSON_FIELD_LIMITS.location) {
    return { ok: false, error: `${fieldName} must be at most 200 characters.` };
  }
  const htmlError = rejectHtml(cleaned, fieldName);
  if (htmlError) return { ok: false, error: htmlError };
  if (!ROSTER_LOCATION_RE.test(cleaned)) {
    return {
      ok: false,
      error: `${fieldName} must contain letters and spaces only (no numbers or symbols).`,
    };
  }
  return { ok: true, value: cleaned };
}

export function validatePersonRole(raw) {
  const cleaned = sanitizePersonFieldInput('role', raw).trim();
  if (!cleaned) {
    return { ok: true, value: '' };
  }
  if (cleaned.length > PERSON_FIELD_LIMITS.role) {
    return { ok: false, error: 'Role must be at most 200 characters.' };
  }
  const htmlError = rejectHtml(cleaned, 'Role');
  if (htmlError) return { ok: false, error: htmlError };
  return { ok: true, value: cleaned };
}

export function validatePersonNotes(raw) {
  const cleaned = sanitizePersonFieldInput('notes', raw).trim();
  if (!cleaned) {
    return { ok: true, value: '' };
  }
  if (cleaned.length > PERSON_FIELD_LIMITS.notes) {
    return { ok: false, error: 'Notes must be at most 5000 characters.' };
  }
  const htmlError = rejectHtml(cleaned, 'Notes');
  if (htmlError) return { ok: false, error: htmlError };
  return { ok: true, value: cleaned };
}

/**
 * Validate a single person form row.
 *
 * Both PureGym and Health Fitness use the same 4 required fields:
 *   firstName, lastName, email, location
 *
 * For Health Fitness, the "location" field stores what the partner calls
 * "client" — the label is applied by the UI based on partner context.
 * The options argument is accepted for backwards compatibility but no
 * longer changes which fields are required.
 */
export function validatePersonFormFields(person, { locationLabel = 'User Location', requiresLocation = true } = {}) {
  const errors = {};
  const values = {};

  const first = validateRosterPersonName(person.firstName, 'User First Name', 'firstName');
  if (!first.ok) errors.firstName = first.error;
  else values.firstName = first.value;

  const last = validateRosterPersonName(person.lastName, 'User Last Name', 'lastName');
  if (!last.ok) errors.lastName = last.error;
  else values.lastName = last.value;

  const email = validatePersonEmail(person.email);
  if (!email.ok) errors.email = email.error;
  else values.email = email.value;

  if (requiresLocation) {
    const location = validatePersonLocation(person.location, locationLabel);
    if (!location.ok) errors.location = location.error;
    else values.location = location.value;
  } else {
    // Location is optional — preserve what the user typed (trimmed), or store empty string
    const rawLoc = (person.location || '').trim();
    if (rawLoc) {
      // Validate format but not required
      const htmlError = rawLoc.match(/<[^>]+>/) ? `${locationLabel} must not contain HTML.` : null;
      if (htmlError) {
        errors.location = htmlError;
      } else if (rawLoc.length > PERSON_FIELD_LIMITS.location) {
        errors.location = `${locationLabel} must be at most 200 characters.`;
      } else {
        values.location = rawLoc;
      }
    } else {
      values.location = '';
    }
  }

  const role = validatePersonRole(person.role);
  if (!role.ok) errors.role = role.error;
  else values.role = role.value;

  const notes = validatePersonNotes(person.notes);
  if (!notes.ok) errors.notes = notes.error;
  else values.notes = notes.value;

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    values,
  };
}

function applyDuplicateEmailErrors(forms, rowResults) {
  const emailToIndexes = new Map();

  forms.forEach((person, index) => {
    const emailResult = validatePersonEmail(person.email);
    if (!emailResult.ok) return;
    const email = emailResult.value;
    if (!emailToIndexes.has(email)) {
      emailToIndexes.set(email, []);
    }
    emailToIndexes.get(email).push(index);
  });

  emailToIndexes.forEach((indexes) => {
    if (indexes.length <= 1) return;
    indexes.forEach((index) => {
      rowResults[index].ok = false;
      rowResults[index].errors.email = 'Each request must use a different email address.';
    });
  });
}

/** Validate every person row, including duplicate emails in a batch. */
export function validatePersonForms(forms, options = {}) {
  const rowResults = forms.map((person) => validatePersonFormFields(person, options));
  applyDuplicateEmailErrors(forms, rowResults);

  const errorsByRow = rowResults.map((result) => result.errors);
  const ok = rowResults.every((result) => result.ok);

  return {
    ok,
    errorsByRow,
    normalizedForms: rowResults.map((result, index) => ({
      firstName: result.values.firstName ?? forms[index].firstName,
      lastName: result.values.lastName ?? forms[index].lastName,
      email: result.values.email ?? forms[index].email,
      location: result.values.location ?? forms[index].location,
      role: result.values.role ?? forms[index].role ?? '',
      notes: result.values.notes ?? forms[index].notes ?? '',
    })),
  };
}

export function isPersonFormValid(person, options = {}) {
  return validatePersonFormFields(person, options).ok;
}

export function firstInvalidPersonField(errorsByRow) {
  for (let rowIndex = 0; rowIndex < errorsByRow.length; rowIndex += 1) {
    const rowErrors = errorsByRow[rowIndex] || {};
    for (const field of PERSON_FIELDS) {
      if (rowErrors[field]) {
        return { rowIndex, field, message: rowErrors[field] };
      }
    }
  }
  return null;
}
