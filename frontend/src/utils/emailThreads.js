// Thread grouping for the email queue.
//
// The backend still returns one row per message (there is no separate thread
// table). This util groups those rows into thread summaries so the list and
// detail views can behave Gmail-style — one row per conversation, one detail
// pane per conversation with all its messages stacked chronologically.

import { stripQuotedReply } from './emailQuotes';

export const THREAD_STATUS = {
  READY: 'ready', // has at least one inbound message with an AI draft to send
  PENDING: 'pending', // has an inbound whose draft is still being generated
  SENT: 'sent', // the latest inbound has been replied to — nothing awaiting action
  IGNORED: 'ignored', // whole thread is auto-ignored / archived
};

export function threadKeyFor(email) {
  // Emails imported before we started capturing gmailThreadId still exist —
  // fall back to their own id so they render as a single-message "thread".
  return email.gmailThreadId || email.id;
}

function toTimestamp(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** True when this row is Andrea's own outbound message (compose or Gmail echo). */
function isOutbound(email) {
  return Boolean(email.gmailIsOutbound);
}

/**
 * Expand DB rows into a chronological transcript. A replied-to inbound row
 * stores the customer message in `body` and Andrea's send in `sentBody` — we
 * surface those as separate lines so the thread reads like Gmail.
 */
export function buildThreadTranscript(messages, { outboundLabel = 'You' } = {}) {
  const entries = [];
  let sawPriorMessage = false;

  for (const msg of messages) {
    if (isOutbound(msg)) {
      entries.push({
        key: `${msg.id}:out`,
        messageId: msg.id,
        source: msg,
        direction: 'outbound',
        labelPrefix: sawPriorMessage ? 'RE' : null,
        sender: outboundLabel,
        body: msg.sentBody || msg.body || '',
        htmlBody: null,
        receivedAt: msg.sentAt || msg.receivedAt,
        showAttachments: false,
      });
      sawPriorMessage = true;
      continue;
    }

    const inboundBody =
      stripQuotedReply(msg.body || msg.snippet || '') || msg.body || msg.snippet || '';

    const inboundPrefix = msg.isForward ? 'FWD' : sawPriorMessage ? 'RE' : null;

    entries.push({
      key: `${msg.id}:in`,
      messageId: msg.id,
      source: msg,
      direction: 'inbound',
      labelPrefix: inboundPrefix,
      sender: msg.from || msg.fromEmail || 'Unknown sender',
      body: inboundBody,
      htmlBody: null,
      receivedAt: msg.receivedAt,
      showAttachments: true,
    });
    sawPriorMessage = true;

    if (msg.sentBody && msg.draftStatus === 'Sent') {
      entries.push({
        key: `${msg.id}:reply`,
        messageId: msg.id,
        source: msg,
        direction: 'outbound',
        labelPrefix: 'RE',
        sender: outboundLabel,
        body: msg.sentBody,
        htmlBody: null,
        receivedAt: msg.sentAt || msg.receivedAt,
        showAttachments: false,
      });
      sawPriorMessage = true;
    }
  }
  return entries;
}

/** True when this inbound is still awaiting a reply Andrea can act on. */
function isAwaitingReply(email) {
  if (email.deleted) return false;
  if (isOutbound(email)) return false;
  if (email.draftStatus === 'Sent') return false;
  if (email.draftStatus === 'Ignored') return false;
  return true;
}

function pickLatestBy(messages, predicate) {
  let best = null;
  let bestTs = -Infinity;
  for (const m of messages) {
    if (predicate && !predicate(m)) continue;
    const ts = toTimestamp(m.receivedAt);
    if (ts > bestTs) {
      bestTs = ts;
      best = m;
    }
  }
  return best;
}

function uniqueParticipants(messages, accountEmail) {
  const seen = new Set();
  const names = [];
  const self = (accountEmail || '').toLowerCase();
  for (const m of messages) {
    const email = (m.fromEmail || '').toLowerCase();
    if (!email || email === self) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    names.push({ email, name: m.from || m.fromEmail || 'Unknown sender' });
  }
  return names;
}

/**
 * Group emails into threads and compute per-thread metadata.
 *
 * Input:  array of EmailOut rows (already filtered for mailbox/search/etc).
 * Output: array of thread summaries, sorted with the caller's sortOrder.
 *
 * Each thread summary carries the raw messages array (in received order,
 * oldest first) plus fast-access fields the list/detail rendering needs.
 */
export function groupIntoThreads(emails, { sortOrder = 'newest', accountEmail = '' } = {}) {
  if (!emails || emails.length === 0) return [];

  const byKey = new Map();
  for (const email of emails) {
    const key = threadKeyFor(email);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(email);
  }

  const threads = [];
  for (const [key, rawMessages] of byKey.entries()) {
    // Chronological (oldest → newest) inside each thread so the detail view
    // renders like Gmail's timeline. Fall back to id ordering when timestamps
    // are equal so rendering stays deterministic across renders.
    const messages = [...rawMessages].sort((a, b) => {
      const diff = toTimestamp(a.receivedAt) - toTimestamp(b.receivedAt);
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });

    const latestMessage = messages[messages.length - 1];
    const latestInbound = pickLatestBy(messages, (m) => !isOutbound(m));
    const latestOutbound = pickLatestBy(messages, (m) => isOutbound(m));

    const awaitingReply = messages.filter(isAwaitingReply);
    const activeReplyTarget = pickLatestBy(awaitingReply);
    const anyPending = messages.some(
      (m) => m.draftStatus === 'Imported' || m.draftStatus === 'Processing',
    );

    let status = THREAD_STATUS.SENT;
    if (anyPending) status = THREAD_STATUS.PENDING;
    else if (awaitingReply.length > 0) status = THREAD_STATUS.READY;
    else if (messages.every((m) => m.draftStatus === 'Ignored')) status = THREAD_STATUS.IGNORED;

    // Subject: they should all match on the same Gmail thread, but strip any
    // Re:/Fwd: prefixes when picking the canonical one so the list row is
    // clean. The first (oldest) message is usually cleanest.
    const canonicalSubject = messages[0]?.subject || latestMessage?.subject || '(no subject)';

    threads.push({
      key,
      gmailThreadId: latestMessage?.gmailThreadId || null,
      subject: canonicalSubject,
      messages,
      messageCount: messages.length,
      unreadCount: messages.filter((m) => !m.read && !isOutbound(m)).length,
      inbox: latestMessage?.inbox,
      intent: latestInbound?.intent || latestMessage?.intent,
      intentConfidence: latestInbound?.intentConfidence ?? latestMessage?.intentConfidence,
      urgent: messages.some((m) => m.urgent),
      flagged: messages.some((m) => m.flagged),
      // Primary participants for the row label: the customers Andrea is
      // conversing with, excluding her own outbound.
      participants: uniqueParticipants(messages, accountEmail),
      latestMessage,
      latestInbound,
      latestOutbound,
      // The message the composer defaults to when Andrea opens the thread.
      // Falls back to the newest inbound if all have already been replied to
      // (Sent thread view), else to the newest message.
      activeReplyTarget: activeReplyTarget || latestInbound || latestMessage,
      awaitingReplyIds: awaitingReply.map((m) => m.id),
      status,
      sortAt: toTimestamp(latestMessage?.receivedAt),
    });
  }

  threads.sort((a, b) => (sortOrder === 'oldest' ? a.sortAt - b.sortAt : b.sortAt - a.sortAt));
  return threads;
}

/** Group threads by date (for the same date-label headers the flat list uses). */
export function groupThreadsByDate(threads, { getDateLabel }) {
  const dateMap = new Map();
  for (const thread of threads) {
    const label = getDateLabel(thread.latestMessage?.receivedAt);
    if (!dateMap.has(label)) dateMap.set(label, []);
    dateMap.get(label).push(thread);
  }
  return Array.from(dateMap.entries()).map(([dateLabel, items]) => ({ dateLabel, items }));
}
