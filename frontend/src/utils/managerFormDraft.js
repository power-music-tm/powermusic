const DRAFT_PREFIX = 'powerMusicOps.managerFormDraft';

function draftKey(userId) {
  return `${DRAFT_PREFIX}:${userId}`;
}

export function readManagerFormDraft(userId) {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeManagerFormDraft(userId, draft) {
  if (!userId || typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(draftKey(userId), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // ignore quota / private mode
  }
}

export function clearManagerFormDraft(userId) {
  if (!userId || typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(draftKey(userId));
  } catch {
    // ignore
  }
}

export const EMPTY_MANAGER_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  club: '',
};

export const EMPTY_PERSON_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  location: '',
  role: '',
  notes: '',
};

export const MAX_MANAGER_PERSON_ROWS = 10;

export function isPersonFormComplete(personForm, options = {}) {
  const requiresLocation = options.requiresLocation ?? true;
  return (
    (personForm.firstName || '').trim() !== '' &&
    (personForm.lastName || '').trim() !== '' &&
    (personForm.email || '').trim() !== '' &&
    (!requiresLocation || (personForm.location || '').trim() !== '')
  );
}

export function normalizePersonFormsFromDraft(draft) {
  if (!draft) return [{ ...EMPTY_PERSON_FORM }];
  let forms;
  if (Array.isArray(draft.personForms) && draft.personForms.length > 0) {
    forms = draft.personForms
      .slice(0, MAX_MANAGER_PERSON_ROWS)
      .map((person) => ({ ...EMPTY_PERSON_FORM, ...person }));
  } else if (draft.personForm) {
    forms = [{ ...EMPTY_PERSON_FORM, ...draft.personForm }];
  } else {
    forms = [{ ...EMPTY_PERSON_FORM }];
  }

  if (typeof draft.notes === 'string' && draft.notes.trim() && !forms[0].notes?.trim()) {
    forms[0] = { ...forms[0], notes: draft.notes };
  }

  return forms;
}
