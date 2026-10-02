import { fetchJson } from './api';
import { normalizeDirectoryPerson } from './managerDirectory';

export async function searchManagerDirectory(query, limit = 25, partnerId = null) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  if (partnerId) params.set('partner_id', partnerId);
  const data = await fetchJson(`/api/manager/persons/search?${params}`);
  return Array.isArray(data) ? data.map(normalizeDirectoryPerson).filter(Boolean) : [];
}

export async function fetchFormMatchCandidates(person, limit = 15, partnerId = null) {
  const data = await fetchJson(`/api/manager/persons/match-candidates?limit=${limit}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: person.email?.trim() || undefined,
      firstName: person.firstName?.trim() || undefined,
      lastName: person.lastName?.trim() || undefined,
      location: person.location?.trim() || undefined,
      partnerId: partnerId || person.partnerId || undefined,
    }),
  });

  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      const personRow = normalizeDirectoryPerson(row);
      if (!personRow) return null;
      return {
        ...personRow,
        matchReasons: Array.isArray(row.matchReasons) ? row.matchReasons : ['Match'],
      };
    })
    .filter(Boolean);
}
