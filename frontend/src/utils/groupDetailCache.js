import { writeCache } from './pilot2Api';
import { alignClassificationSummaryWithMembers } from './requestTags';

export function groupDetailCacheKey(groupId) {
  return `duplicate_group:${groupId}`;
}

/**
 * After Request History Merge: write survivor-only group detail so reload / paint
 * never flashes deleted peers from a stale session cache.
 */
export function writeMergedGroupCache(groupId, previousGroup, {
  survivor,
  deletedIds = [],
  members: membersOverride = null,
  classification = null,
  representativeId = null,
} = {}) {
  if (!groupId || !survivor?.id || !previousGroup) return null;
  const deleted = new Set((deletedIds || []).filter(Boolean));
  // Prefer explicit remaining members (survivor + late arrivals not in the merge snapshot).
  let members;
  if (Array.isArray(membersOverride) && membersOverride.length > 0) {
    members = membersOverride.filter((m) => m?.id && !deleted.has(m.id));
    if (!members.some((m) => m.id === survivor.id)) {
      members = [survivor, ...members];
    } else {
      members = members.map((m) => (m.id === survivor.id ? survivor : m));
    }
  } else {
    members = [survivor].filter((m) => m?.id && !deleted.has(m.id));
  }
  const hasDirectory = Boolean(
    previousGroup.directoryPersonId || previousGroup.directoryPerson,
  );
  const prevSummary = previousGroup.classificationSummary || {};
  const nextClassification = classification
    || (hasDirectory
      ? (
        previousGroup.classification?.startsWith('already_removed')
          ? previousGroup.classification
          : (previousGroup.classification?.startsWith('already_exists')
            ? previousGroup.classification
            : 'already_exists')
      )
      : previousGroup.classification);
  const summary = alignClassificationSummaryWithMembers(
    {
      alreadyExists: Boolean(
        prevSummary.alreadyExists ?? prevSummary.already_exists ?? hasDirectory,
      ),
      alreadyRemoved: Boolean(
        prevSummary.alreadyRemoved ?? prevSummary.already_removed,
      ),
      duplicateCount: 0,
      potentialCount: 0,
    },
    members.length,
  );
  const dropped = Array.from(
    new Set([
      ...(Array.isArray(previousGroup.droppedMemberIds) ? previousGroup.droppedMemberIds : []),
      ...(deletedIds || []),
    ].filter(Boolean)),
  );
  const next = {
    ...previousGroup,
    id: groupId,
    status: 'active',
    classification: nextClassification,
    representativeRequestId: representativeId || survivor.id,
    members,
    droppedMemberIds: dropped,
    peersMergedAt: Date.now(),
    classificationSummary: summary,
  };
  writeCache(groupDetailCacheKey(groupId), next);
  return next;
}

/** Keep New Requests list previews in sync so warm/seed cannot resurrect deleted peers. */
export function patchRequestsCacheAfterPeerMerge(requestsCacheKey, groupId, {
  survivorId,
  representativeId = null,
  deletedIds = [],
  members = [],
  classificationSummary = null,
} = {}) {
  if (!requestsCacheKey || !groupId || !survivorId) return;
  const deleted = new Set((deletedIds || []).filter(Boolean));
  try {
    const raw = sessionStorage.getItem(`pm_cache_${requestsCacheKey}`);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.requests)) return;
    const nextRequests = parsed.requests
      .filter((r) => r && !deleted.has(r.id))
      .map((r) => {
        if (r.duplicateGroupId !== groupId && r.id !== survivorId) return r;
        const preview = r.groupPreview && typeof r.groupPreview === 'object'
          ? { ...r.groupPreview }
          : {};
        preview.members = members;
        preview.representativeRequestId = representativeId || survivorId;
        if (classificationSummary) {
          preview.classificationSummary = classificationSummary;
        }
        return {
          ...r,
          duplicateGroupId: groupId,
          groupMembers: members,
          groupPreview: preview,
          groupClassificationSummary:
            classificationSummary || r.groupClassificationSummary || null,
        };
      });
    sessionStorage.setItem(
      `pm_cache_${requestsCacheKey}`,
      JSON.stringify({ ...parsed, requests: nextRequests }),
    );
  } catch { /* quota */ }
}

/**
 * After Attach-to-lookalike: drop the dissolved source group shell and upsert the
 * destination group so New Requests does not stay empty until a slow refetch.
 */
export function patchRequestsCacheAfterReattach(requestsCacheKey, {
  previousGroupId,
  newGroupId,
  detail = null,
  sourceRequestId = null,
  targetRequestId = null,
} = {}) {
  if (!requestsCacheKey || !newGroupId) return;
  try {
    const raw = sessionStorage.getItem(`pm_cache_${requestsCacheKey}`);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.requests)) return;

    const dropGroupIds = new Set([previousGroupId].filter(Boolean));
    const dropRequestIds = new Set(
      [sourceRequestId, targetRequestId].filter(Boolean),
    );
    // Source/target may still appear as solo or old-group rows — remove those
    // shells; the destination representative row replaces them.
    let nextRequests = parsed.requests.filter(
      (r) =>
        r
        && !dropGroupIds.has(r.duplicateGroupId)
        && !dropRequestIds.has(r.id),
    );

    const members = Array.isArray(detail?.members)
      ? detail.members.filter((m) => m?.id)
      : [];
    const repId =
      detail?.representativeRequestId
      || members.find((m) => m.isRepresentative)?.id
      || members[0]?.id
      || sourceRequestId
      || targetRequestId;
    const rep =
      members.find((m) => m.id === repId)
      || members[0]
      || null;

    if (rep?.id) {
      const preview = {
        members,
        representativeRequestId: repId,
        classification: detail.classification || null,
        status: detail.status || 'active',
        directoryPersonId: detail.directoryPersonId || null,
        directoryPerson: detail.directoryPerson || null,
        classificationSummary: detail.classificationSummary || null,
      };
      const row = {
        id: rep.id,
        displayId: rep.displayId || 0,
        receivedAt: rep.receivedAt || null,
        person: rep.person || {},
        action: rep.action || 'Add',
        status: rep.status || 'new',
        tags: rep.tags || [],
        submittedBy: rep.submittedBy || null,
        notes: rep.notes || '',
        createdBy: rep.createdBy || null,
        directorFirst: rep.directorFirst || rep.person?.directorFirst || null,
        directorLast: rep.directorLast || rep.person?.directorLast || null,
        duplicateGroupId: newGroupId,
        groupMembers: members,
        groupPreview: preview,
        groupClassificationSummary: detail.classificationSummary || null,
        groupDirectoryPersonId: detail.directoryPersonId || null,
        groupDirectoryPerson: detail.directoryPerson || null,
      };
      nextRequests = [row, ...nextRequests];
    }

    sessionStorage.setItem(
      `pm_cache_${requestsCacheKey}`,
      JSON.stringify({ ...parsed, requests: nextRequests }),
    );
  } catch { /* quota */ }
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

function personFromMemberStub(member) {
  const nested = member?.person && typeof member.person === 'object' ? member.person : null;
  const first = nested?.firstName || member?.firstName || '';
  const last = nested?.lastName || member?.lastName || '';
  const email = nested?.email || member?.email || '';
  const location = nested?.location || member?.location || '';
  const role = nested?.role ?? member?.role ?? null;
  if (nested && (first || last || email || location || role)) {
    return {
      ...nested,
      firstName: first,
      lastName: last,
      email,
      location,
      role,
    };
  }
  return {
    firstName: first,
    lastName: last,
    email,
    location,
    role,
  };
}

function personRichness(person) {
  if (!person || typeof person !== 'object') return 0;
  return ['firstName', 'lastName', 'email', 'location']
    .reduce((n, key) => n + (String(person[key] || '').trim() ? 1 : 0), 0);
}

function normalizeMemberStub(member, { forceRepresentativeId = null } = {}) {
  if (!member?.id) return null;
  const person = personFromMemberStub(member);
  return {
    id: member.id,
    displayId: member.displayId || 0,
    receivedAt: member.receivedAt || null,
    person,
    directorFirst: member.directorFirst || person?.directorFirst || null,
    directorLast: member.directorLast || person?.directorLast || null,
    action: member.action || 'Add',
    status: member.status || 'new',
    isRepresentative:
      forceRepresentativeId != null
        ? member.id === forceRepresentativeId
        : Boolean(member.isRepresentative),
    submittedBy: member.submittedBy || null,
    notes: member.notes || '',
    managerNotes: member.managerNotes || member.notes || '',
    tags: member.tags || [],
    createdBy: member.createdBy || null,
    // Keep Leave date available in Request History after cache/list seed.
    ...(member.automatedEmail ? { automatedEmail: member.automatedEmail } : {}),
  };
}

/**
 * Prefer full list stubs on first paint, but never resurrect Request History rows
 * that peers-merge already removed from the group-detail cache.
 */
export function applyListSeed(groupId, cached, seed) {
  if (!seed?.id && !(Array.isArray(seed?.groupMembers) && seed.groupMembers.length)) {
    return cached;
  }

  const preview = seed.groupPreview || null;
  const listSummary =
    seed.groupClassificationSummary
    || preview?.classificationSummary
    || null;
  const repId = seed.id || preview?.representativeRequestId || cached?.representativeRequestId || null;

  const fromList = Array.isArray(seed.groupMembers) && seed.groupMembers.length
    ? seed.groupMembers
    : (Array.isArray(preview?.members) && preview.members.length ? preview.members : null);

  const cachedMembers = Array.isArray(cached?.members) ? cached.members.filter((m) => m?.id) : [];
  const dropped = new Set(
    Array.isArray(cached?.droppedMemberIds) ? cached.droppedMemberIds.filter(Boolean) : [],
  );

  let members;
  if (fromList) {
    let listMembers = fromList
      .map((m) => normalizeMemberStub(m, { forceRepresentativeId: repId }))
      .filter(Boolean);
    if (dropped.size > 0) {
      listMembers = listMembers.filter((m) => !dropped.has(m.id));
    }
    // Stale New Requests previews often still include deleted peers after Merge.
    // If the detail cache is already a smaller active set, keep it.
    if (
      cachedMembers.length > 0
      && listMembers.length > cachedMembers.length
      && (cached?.status === 'active' || !cached?.status)
    ) {
      members = cachedMembers.map((m) => ({
        ...m,
        isRepresentative: m.id === (cached.representativeRequestId || repId),
      }));
    } else if (
      cachedMembers.length > 0
      && listMembers.length === cachedMembers.length
    ) {
      // Same IDs: keep whichever stub has richer person fields (detail cache
      // usually wins over a thin list seed after Transfer / reopen).
      const byId = new Map(cachedMembers.map((m) => [m.id, m]));
      members = listMembers.map((listMember) => {
        const cachedMember = byId.get(listMember.id);
        if (!cachedMember) return listMember;
        const preferCached = personRichness(cachedMember.person) > personRichness(listMember.person);
        const chosen = preferCached ? { ...cachedMember, ...listMember, person: cachedMember.person } : listMember;
        return {
          ...chosen,
          isRepresentative: listMember.id === (cached.representativeRequestId || repId),
        };
      });
    } else {
      members = listMembers;
    }
  } else {
    members = [...cachedMembers];
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
    if (seedMember && !dropped.has(seedMember.id)) {
      const idx = members.findIndex((m) => m.id === seedMember.id);
      if (idx >= 0) members[idx] = { ...members[idx], ...seedMember };
      else members.push(seedMember);
    }
    for (const m of members) {
      m.isRepresentative = m.id === repId;
    }
  }

  if (!members.length && !cached) return null;
  if (!members.length && cachedMembers.length) {
    members = cachedMembers;
  }

  const prev = cached?.classificationSummary || {};
  const next = listSummary || prev;
  // After peers-merge the detail cache owns zero peer counts — do not let a
  // stale list summary re-inflate Duplicate × N.
  const useCachedPeerCounts = Boolean(
    cachedMembers.length > 0
    && members.length <= cachedMembers.length
    && (cached?.droppedMemberIds?.length || members.length === 1),
  );
  const merged = {
    alreadyExists: Boolean(next.alreadyExists ?? prev.alreadyExists),
    alreadyRemoved: Boolean(next.alreadyRemoved ?? prev.alreadyRemoved),
    duplicateCount: useCachedPeerCounts
      ? (Number(prev.duplicateCount) || 0)
      : (next.duplicateCount || prev.duplicateCount || 0),
    potentialCount: useCachedPeerCounts
      ? (Number(prev.potentialCount) || 0)
      : Math.max(prev.potentialCount || 0, next.potentialCount || 0),
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
    directoryPersons: (() => {
      const fromSeed = Array.isArray(seed.groupDirectoryPersons) && seed.groupDirectoryPersons.length
        ? seed.groupDirectoryPersons
        : null;
      const fromPreview = Array.isArray(preview?.directoryPersons) && preview.directoryPersons.length
        ? preview.directoryPersons
        : null;
      const fromCached = Array.isArray(cached?.directoryPersons) && cached.directoryPersons.length
        ? cached.directoryPersons
        : null;
      // List / preview usually ship one Directory person. Prefer the richest
      // detail cache so reopen after Back does not flash 1 card then reload 2+.
      const candidates = [fromCached, fromSeed, fromPreview].filter(Boolean);
      if (candidates.length) {
        return candidates.reduce((best, cur) => (
          cur.length > best.length ? cur : best
        ));
      }
      // List rows only ship a single groupDirectoryPerson — promote it so the
      // group page can render Archived/Active Directory cards before detail loads.
      const single =
        seed.groupDirectoryPerson
        || preview?.directoryPerson
        || cached?.directoryPerson
        || null;
      return single ? [single] : null;
    })(),
    representativeRequestId: cached?.representativeRequestId || repId || null,
    members,
    droppedMemberIds: Array.isArray(cached?.droppedMemberIds) ? cached.droppedMemberIds : [],
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
    const existing = readCachedGroup(gid);
    const existingCount = Array.isArray(existing?.members) ? existing.members.length : 0;
    // Never let a stale list preview re-expand a post-merge group detail cache.
    if (existingCount > 0 && members.length > existingCount) {
      continue;
    }
    const existingDirCount = Array.isArray(existing?.directoryPersons)
      ? existing.directoryPersons.length
      : 0;
    const listDirCount = Array.isArray(preview?.directoryPersons)
      ? preview.directoryPersons.length
      : ((row.groupDirectoryPerson || preview?.directoryPerson) ? 1 : 0);
    // Keep a multi-match Directory detail cache; list only knows the primary.
    if (existingDirCount > 1 && listDirCount <= 1) {
      continue;
    }
    const seeded = applyListSeed(gid, existing, {
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
      groupDirectoryPersons: (
        Array.isArray(preview?.directoryPersons) && preview.directoryPersons.length
          ? preview.directoryPersons
          : null
      ) || (
        (row.groupDirectoryPerson || preview?.directoryPerson)
          ? [row.groupDirectoryPerson || preview.directoryPerson]
          : null
      ),
      groupPreview: preview || null,
    });
    if (seeded) writeCache(groupDetailCacheKey(gid), seeded);
  }
}
