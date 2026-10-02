import { CheckCircle2, Clock3 } from 'lucide-react';
import { fetchJson } from './api';
import { formatActivityTimestamp } from './dateTime';

export const MANAGER_REQUEST_TABS = [
  { value: 'all', label: 'All', hint: 'Every request you have submitted' },
  { value: 'new', label: 'Pending', hint: 'Requests waiting for admin action' },
  { value: 'handled', label: 'Handled', hint: 'Reviewed requests; open to clear highlights' },
];

export { MANAGER_UPDATE_HIGHLIGHT_CLASS } from './managerUiHighlights';

export function formatRequestTimestamp(value) {
  if (!value) return null;
  return formatActivityTimestamp(value) || null;
}

export function personName(person) {
  const first = (person?.firstName || '').trim();
  const last = (person?.lastName || '').trim();
  const name = [first, last].filter(Boolean).join(' ');
  return name || 'Unknown person';
}

export function requestStatusMeta(request) {
  if (request.status === 'handled') {
    return {
      label: 'Handled',
      className:
        'bg-[var(--color-tag-neutral-bg)] text-[var(--color-tag-neutral-text)] ring-1 ring-inset ring-[var(--color-tag-neutral-border)]',
      detail: request.handledAt
        ? `Handled ${formatRequestTimestamp(request.handledAt)}`
        : 'Handled',
      icon: CheckCircle2,
    };
  }

  return {
    label: 'Pending',
    className: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80',
    detail: request.receivedAt
      ? `Submitted ${formatRequestTimestamp(request.receivedAt)}`
      : 'Awaiting review',
    icon: Clock3,
  };
}

function buildQuery({ page = 1, limit = 20, status } = {}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (status && status !== 'all') {
    params.set('status', status);
  }
  return params.toString();
}

export async function fetchManagerRequestsPage(options = {}) {
  const query = buildQuery(options);
  return fetchJson(`/api/manager/requests?${query}`);
}

export async function fetchManagerRequestsSummary() {
  return fetchJson('/api/manager/requests/summary');
}

export function totalPages(total, limit) {
  if (!total || !limit) return 1;
  return Math.max(1, Math.ceil(total / limit));
}
