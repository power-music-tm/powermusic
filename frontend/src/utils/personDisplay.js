/** Display helpers for person first/last/email/location (avoids "Rubab null"). */

function cleanPart(value) {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') {
    return '';
  }
  return text;
}

export function formatPersonName(person, { empty = 'No name' } = {}) {
  const first = cleanPart(person?.firstName);
  const last = cleanPart(person?.lastName);
  const name = [first, last].filter(Boolean).join(' ');
  return name || empty;
}

export function formatPersonEmail(person, { empty = 'No email' } = {}) {
  return cleanPart(person?.email) || empty;
}

export function formatPersonLocation(person, { empty = 'No location' } = {}) {
  return cleanPart(person?.location) || empty;
}

export function formatPersonFields(person) {
  return {
    name: formatPersonName(person),
    email: formatPersonEmail(person),
    location: formatPersonLocation(person),
  };
}
