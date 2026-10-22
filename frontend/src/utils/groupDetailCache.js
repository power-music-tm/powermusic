import { writeCache } from './pilot2Api';
import { alignClassificationSummaryWithMembers } from './requestTags';

export function groupDetailCacheKey(groupId) {
  return `duplicate_group:${groupId}`;
}

export function readCachedGroup(groupId) {
  if (!groupId) return null;
  try {
    const raw = sessionStorage.getItem(`pm_cache_${groupDetailCacheKey(groupId)}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.id !== groupId) return null;
    if (parsed.status === 'resolved' || parsed.status === 'dismissed') return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeMemberStub(member, { forceRepresentativeId = null } = {}) {
  if (!member?.id) return null;
  return {
    id: member.id,
    displayId: member.displayId || 0,
    receivedAt: member.receivedAt || null,
    person: member.person || {},
    directorFirst: member.directorFirst || member.person?.directorFirst || null,
    directorLast: member.directorLast || member.person?.directorLast || null,
    action: member.action || 'Add',
    status: member.status || 'new',
    isRepresentative:
      forceRepresentativeId != null
        ? member.id === forceRepresentativeId
        : Boolean(member.isRepresentative),
    submittedBy: member.submittedBy || null,
    notes: member.notes || '',
    tags: member.tags || [],
    createdBy: member.createdBy || null,
  };
}

/** Prefer full list stubs so Request History is complete on first paint. */
export function applyListSeed(groupId, cached, seed) {
  if (!seed?.id && !(Array.isArray(seed?.groupMembers) && seed.groupMembers.length)) {
    return cached;
  }

  const preview = seed.groupPreview || null;
  const listSummary =
    seed.groupClassificationSummary
    || preview?.classificationSummary
    || null;
  const repId = seed.id || preview?.representativeRequestId || null;

  const fromList = Array.isArray(seed.groupMembers) && seed.groupMembers.length
    ? seed.groupMembers
    : (Array.isArray(preview?.members) && preview.members.length ? preview.members : null);

  let members;
  if (fromList) {
    members = fromList
      .map((m) => normalizeMemberStub(m, { forceRepresentativeId: repId }))
      .filter(Boolean);
  } else {
    members = Array.isArray(cached?.members) ? [...cached.members] : [];
    const seedMember = normalizeMemberStub(
      {
        id: seed.id,
        displayId: seed.displayId,
        receivedAt: seed.receivedAt,
        person: seed.person,
        directorFirst: seed.directorFirst,
        directorLast: seed.directorLast,
        action: seed.action,
        status: seed.status,
        submittedBy: seed.submittedBy,
        notes: seed.notes,
        tags: seed.tags,
        createdBy: seed.createdBy,
      },
      { forceRepresentativeId: repId },
    );
    if (seedMember) {
      const idx = members.findIndex((m) => m.id === seedMember.id);
      if (idx >= 0) members[idx] = { ...members[idx], ...seedMember };
      else members.push(seedMember);
    }
    for (const m of members) {
      m.isRepresentative = m.id === repId;
    }
  }

  if (!members.length && !cached) return null;

  const prev = cached?.classificationSummary || {};
  const next = listSummary || prev;
  const merged = {
    alreadyExists: Boolean(next.alreadyExists ?? prev.alreadyExists),
    alreadyRemoved: Boolean(next.alreadyRemoved ?? prev.alreadyRemoved),
    duplicateCount: next.duplicateCount || prev.duplicateCount || 0,
    potentialCount: Math.max(prev.potentialCount || 0, next.potentialCount || 0),
  };

  return {
    ...(cached || {}),
    id: groupId,
    status: preview?.status || cached?.status || 'active',
    classification: preview?.classification || cached?.classification || 'potential_duplicate',
    partnerId: preview?.partnerId || cached?.partnerId || null,
    directoryPersonId:
      seed.groupDirectoryPersonId
      || preview?.directoryPersonId
      || cached?.directoryPersonId
      || null,
    directoryPerson:
      seed.groupDirectoryPerson
      || preview?.directoryPerson
      || cached?.directoryPerson
      || null,
    directoryPersons:
      (Array.isArray(seed.groupDirectoryPersons) && seed.groupDirectoryPersons.length
        ? seed.groupDirectoryPersons
        : null)
      || (Array.isArray(preview?.directoryPersons) && preview.directoryPersons.length
        ? preview.directoryPersons
        : null)
      || (Array.isArray(cached?.directoryPersons) && cached.directoryPersons.length
        ? cached.directoryPersons
        : null)
      || null,
    representativeRequestId: repId || cached?.representativeRequestId || null,
    members,
    classificationSummary: alignClassificationSummaryWithMembers(merged, members.length),
  };
}

/** Warm group-detail session cache from list rows (manual + manager form). */
export function warmGroupCachesFromRequests(requests = []) {
  if (!Array.isArray(requests)) return;
  for (const row of requests) {
    const gid = row?.duplicateGroupId;
    if (!gid) continue;
    const preview = row.groupPreview;
    const members = row.groupMembers || preview?.members;
    if (!Array.isArray(members) || members.length === 0) continue;
    const seeded = applyListSeed(gid, readCachedGroup(gid), {
      id: row.id,
      displayId: row.displayId,
      receivedAt: row.receivedAt,
      person: row.person,
      action: row.action,
      status: row.status,
      submittedBy: row.submittedBy,
      notes: row.notes,
      tags: row.tags,
      createdBy: row.createdBy,
      directorFirst: row.directorFirst || row.person?.directorFirst,
      directorLast: row.directorLast || row.person?.directorLast,
      groupClassificationSummary: row.groupClassificationSummary || null,
      groupMembers: members,
      groupDirectoryPersonId: row.groupDirectoryPersonId || preview?.directoryPersonId || null,
      groupDirectoryPerson: row.groupDirectoryPerson || preview?.directoryPerson || null,
      groupPreview: preview || null,
    });
    if (seeded) writeCache(groupDetailCacheKey(gid), seeded);
  }
}
