/** Mailbox counts shared by Email responses and the overview dashboard. */

function isArchived(email, archivedIds) {
  return archivedIds ? archivedIds.has(email.id) : Boolean(email.archived);
}

export function emailMatchesMailbox(email, { accountEmail, mailbox, archivedIds } = {}) {
  if (accountEmail && email.inbox !== accountEmail) return false;

  if (mailbox === 'bin') return Boolean(email.deleted);
  if (email.deleted) return false;

  const archived = isArchived(email, archivedIds);
  if (mailbox === 'archive') return archived;
  if (archived) return false;

  switch (mailbox) {
    case 'inbox':
      return email.draftStatus !== 'Sent';
    case 'urgent':
      return Boolean(email.urgent);
    case 'flagged':
      return Boolean(email.flagged);
    case 'sent':
      return email.draftStatus === 'Sent';
    default:
      return true;
  }
}

export function countMailboxEmails(emails, options) {
  return (emails ?? []).filter((email) => emailMatchesMailbox(email, options)).length;
}

export function countInboxTabAcrossAccounts(emails, accountEmails) {
  const accounts = new Set(accountEmails ?? []);
  if (!accounts.size) return 0;
  return (emails ?? []).filter(
    (email) => accounts.has(email.inbox) && emailMatchesMailbox(email, { mailbox: 'inbox' }),
  ).length;
}

export function countInboxTabAcrossConnectedInboxes(emails, inboxes) {
  const connected = (inboxes ?? [])
    .filter((inbox) => inbox.status === 'Connected')
    .map((inbox) => inbox.email);
  return countInboxTabAcrossAccounts(emails, connected);
}

function connectedInboxes(inboxes) {
  return [...(inboxes ?? [])]
    .filter((inbox) => inbox.status === 'Connected')
    .sort((a, b) => (a.title || a.email).localeCompare(b.title || b.email, undefined, { sensitivity: 'base' }));
}

export function countFlaggedAcrossConnectedInboxes(emails, inboxes) {
  const accounts = new Set(connectedInboxes(inboxes).map((inbox) => inbox.email));
  if (!accounts.size) return 0;
  return (emails ?? []).filter(
    (email) => accounts.has(email.inbox) && emailMatchesMailbox(email, { mailbox: 'flagged' }),
  ).length;
}

export function buildFlaggedDashboardAlerts(emails, inboxes) {
  const alerts = connectedInboxes(inboxes).flatMap((inbox) => {
    const inboxTitle = inbox.title || inbox.email;
    const flagged = (emails ?? [])
      .filter((email) => email.inbox === inbox.email && emailMatchesMailbox(email, { mailbox: 'flagged' }))
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
      .slice(0, 2);

    return flagged.map((email) => ({
      id: email.id,
      title: email.subject || 'Flagged email requires review',
      subtitle: email.flagReason || 'Requires manual review',
      partitionLabel: inboxTitle,
      accountEmail: email.inbox,
      timestamp: email.receivedAt,
      type: 'critical',
    }));
  });

  return alerts;
}

function templateCreatedAt(template) {
  return template?.createdAt || template?.lastUpdated;
}

function templateInboxEmail(template) {
  return template?.inbox || template?.accountEmail || '';
}

function normalizeInboxEmail(email) {
  return (email || '').trim().toLowerCase();
}

function inboxTitleForEmail(inboxes, email) {
  const normalized = normalizeInboxEmail(email);
  const match = (inboxes ?? []).find((inbox) => normalizeInboxEmail(inbox.email) === normalized);
  return match?.title || email;
}

export function buildTemplateDashboardActivities(templates, inboxes) {
  const eligible = (templates ?? []).filter(
    (template) => template.status === 'Active',
  );
  if (!eligible.length) return [];

  const connected = connectedInboxes(inboxes);
  const scope = connected.length > 0
    ? connected
    : (inboxes ?? []).filter((inbox) =>
      eligible.some((template) => normalizeInboxEmail(templateInboxEmail(template)) === normalizeInboxEmail(inbox.email)),
    );

  const built = scope.flatMap((inbox) => {
    const inboxEmail = normalizeInboxEmail(inbox.email);
    const inboxTitle = inbox.title || inbox.email;
    const inboxTemplates = eligible
      .filter((template) => normalizeInboxEmail(templateInboxEmail(template)) === inboxEmail)
      .sort((a, b) => new Date(templateCreatedAt(b)) - new Date(templateCreatedAt(a)))
      .slice(0, 2);

    return inboxTemplates.map((template) => ({
      id: `act-${template.id}`,
      timestamp: templateCreatedAt(template),
      type: 'template_created',
      description: template.name,
      partitionLabel: inboxTitle,
      accountEmail: templateInboxEmail(template),
      link: `/templates?inbox=${encodeURIComponent(templateInboxEmail(template))}&id=${encodeURIComponent(template.id)}`,
    }));
  });

  if (built.length > 0) return built;

  // Fallback when inbox metadata is missing but templates exist.
  const byInbox = new Map();
  for (const template of eligible) {
    const email = templateInboxEmail(template);
    const key = normalizeInboxEmail(email);
    if (!key) continue;
    if (!byInbox.has(key)) byInbox.set(key, []);
    byInbox.get(key).push(template);
  }

  return [...byInbox.entries()].flatMap(([emailKey, rows]) => {
    const inboxTitle = inboxTitleForEmail(inboxes, rows[0] ? templateInboxEmail(rows[0]) : emailKey);
    return rows
      .sort((a, b) => new Date(templateCreatedAt(b)) - new Date(templateCreatedAt(a)))
      .slice(0, 2)
      .map((template) => ({
        id: `act-${template.id}`,
        timestamp: templateCreatedAt(template),
        type: 'template_created',
        description: template.name,
        partitionLabel: inboxTitle,
        accountEmail: templateInboxEmail(template),
        link: `/templates?inbox=${encodeURIComponent(templateInboxEmail(template))}&id=${encodeURIComponent(template.id)}`,
      }));
  });
}
