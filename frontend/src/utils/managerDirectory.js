const FIELD_RANK = { Name: 3, Email: 2, Location: 1 };

const MATCH_RULES = [
  {
    test: (form, person) => form.email && person.email === form.email,
    fields: ['Email'],
  },
  {
    test: (form, person) =>
      form.first && form.last && person.first === form.first && person.last === form.last,
    fields: ['Name'],
  },
  {
    test: (form, person) =>
      form.first && form.location && person.first === form.first && person.location === form.location,
    fields: ['Name', 'Location'],
  },
  {
    test: (form, person) =>
      form.last && form.location && person.last === form.last && person.location === form.location,
    fields: ['Name', 'Location'],
  },
  {
    test: (form, person) =>
      form.email && form.location && person.email === form.email && person.location === form.location,
    fields: ['Email', 'Location'],
  },
  {
    test: (form, person) =>
      form.first &&
      form.last &&
      form.location &&
      person.first === form.first &&
      person.last === form.last &&
      person.location === form.location,
    fields: ['Name', 'Location'],
  },
];

export function formHasMatchCriteria(personForm) {
  const email = personForm.email.trim();
  const first = personForm.firstName.trim();
  const last = personForm.lastName.trim();
  const location = personForm.location.trim();
  return Boolean(email || (first && last) || (location && (first || last)));
}

export function normalizeDirectoryPerson(person) {
  if (!person) return null;
  const id = person.id;
  if (!id) return null;

  return {
    ...person,
    id,
    firstName: person.firstName ?? person.first_name ?? '',
    lastName: person.lastName ?? person.last_name ?? '',
    email: person.email ?? '',
    location: person.location ?? '',
    role: person.role ?? person.person?.role ?? '',
    directorFirst: person.directorFirst ?? person.person?.directorFirst ?? '',
    directorLast: person.directorLast ?? person.person?.directorLast ?? '',
    status: person.status ?? '',
    dateAdded: person.dateAdded ?? person.date_added ?? null,
  };
}

const COMMON_TLDS = ['com', 'org', 'net', 'co', 'uk', 'io', 'app', 'edu', 'gov', 'de', 'fr'];

const BROAD_SEARCH_EXACT = new Set([
  '.com',
  '.co',
  '.uk',
  '.org',
  '.net',
  '.edu',
  '.gov',
  'com',
  'org',
  'net',
  '@',
]);

const KNOWN_EMAIL_DOMAIN_LABELS = new Set([
  'gmail',
  'googlemail',
  'yahoo',
  'hotmail',
  'outlook',
  'live',
  'icloud',
  'puregym',
  'powermusic',
  'example',
  'google',
  'microsoft',
  'protonmail',
  'proton',
  'anytime',
  'fitlife',
  'mail',
  'email',
]);

function queryAlphanumeric(query) {
  return query.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function emailLocalAndDomain(email) {
  const value = String(email || '').toLowerCase();
  const at = value.indexOf('@');
  if (at === -1) return { local: value, domain: '' };
  return {
    local: value.slice(0, at),
    domain: value.slice(at + 1),
  };
}

/** Search queries only compare against the part before @ in an email address. */
function getEmailSearchNeedle(query) {
  const q = query.trim().toLowerCase();
  if (!q) return '';
  return q.split('@')[0];
}

function isStaticDomainOnlyQuery(query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (BROAD_SEARCH_EXACT.has(q)) return true;
  if (q.startsWith('@')) return true;
  if (q.startsWith('.') && q.length <= 6) return true;

  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\.[a-z]{2,})?$/.test(q) && !q.includes('@')) {
    return true;
  }

  if (q.includes('@')) {
    const [local, domain = ''] = q.split('@');
    if (local.replace(/[^a-z0-9]/g, '').length < 2) return true;
    if (!domain.includes('.')) return true;
    return false;
  }

  const label = q.split('.')[0];
  if (KNOWN_EMAIL_DOMAIN_LABELS.has(label)) return true;

  const parts = q.split('.');
  if (parts.length === 2 && COMMON_TLDS.includes(parts[1]) && parts[0].length >= 2) {
    return true;
  }

  return false;
}

function personMatchesNonEmailFields(person, query) {
  const q = query.trim().toLowerCase();
  const first = String(person.firstName ?? person.first_name ?? '').toLowerCase();
  const last = String(person.lastName ?? person.last_name ?? '').toLowerCase();
  const fullName = `${first} ${last}`.trim();
  // "location" stores either the PureGym gym location or the Health Fitness client name.
  const location = String(person.location ?? '').toLowerCase();

  return (
    fullName.includes(q) ||
    first.includes(q) ||
    last.includes(q) ||
    location.includes(q)
  );
}

function emailMatchesSearch(email, query) {
  const needle = getEmailSearchNeedle(query);
  if (!needle) return false;

  const { local } = emailLocalAndDomain(email);
  if (!local) return false;

  return local.includes(needle);
}

/** Reject domain fragments and other terms that match almost every email. */
export function isUsableSearchQuery(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return false;
  if (isStaticDomainOnlyQuery(q)) return false;

  const alphanumeric = queryAlphanumeric(q);
  if (alphanumeric.length < 2) return false;

  const emailNeedle = getEmailSearchNeedle(q);
  if (!emailNeedle || emailNeedle.replace(/[^a-z0-9]/g, '').length < 2) return false;

  return true;
}

export function getSearchQueryHint(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return null;
  if (!isUsableSearchQuery(query)) {
    return 'Use at least 2 letters or numbers. Search by name, email, or location.';
  }
  return null;
}

export function personMatchesQuery(person, query) {
  const q = query.trim().toLowerCase();
  if (!isUsableSearchQuery(q)) return false;

  if (personMatchesNonEmailFields(person, q)) return true;

  const email = person.email ?? person.email_address;
  return emailMatchesSearch(email, q);
}

export function filterDirectorySearch(people, query, limit = 25) {
  if (!isUsableSearchQuery(query)) return [];

  return people
    .filter((person) => personMatchesQuery(person, query))
    .slice(0, limit);
}

function getMatchFields(form, person) {
  const fields = new Set();
  for (const rule of MATCH_RULES) {
    if (rule.test(form, person)) {
      rule.fields.forEach((field) => fields.add(field));
    }
  }
  return fields;
}

export function findFormMatchCandidates(people, personForm, limit = 15) {
  const form = {
    email: personForm.email.trim().toLowerCase(),
    first: personForm.firstName.trim().toLowerCase(),
    last: personForm.lastName.trim().toLowerCase(),
    location: personForm.location.trim().toLowerCase(),
  };

  if (!formHasMatchCriteria(personForm)) return [];

  const matches = [];

  for (const person of people) {
    const personFields = {
      email: (person.email || '').toLowerCase(),
      first: (person.firstName || '').toLowerCase(),
      last: (person.lastName || '').toLowerCase(),
      location: (person.location || '').toLowerCase(),
    };

    const matchFields = getMatchFields(form, personFields);
    if (matchFields.size === 0) continue;

    matches.push({
      ...person,
      matchReasons: [...matchFields].sort(
        (a, b) => (FIELD_RANK[b] || 0) - (FIELD_RANK[a] || 0),
      ),
    });
  }

  return matches
    .sort((a, b) => {
      const aScore = a.matchReasons?.length || 0;
      const bScore = b.matchReasons?.length || 0;
      if (bScore !== aScore) return bScore - aScore;
      const aBest = Math.max(...(a.matchReasons || []).map((field) => FIELD_RANK[field] || 0), 0);
      const bBest = Math.max(...(b.matchReasons || []).map((field) => FIELD_RANK[field] || 0), 0);
      return bBest - aBest;
    })
    .slice(0, limit);
}
