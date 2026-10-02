import { Tag } from '../ui';
import {
  MANAGER_UPDATE_HIGHLIGHT_CLASS,
  formatRequestTimestamp,
  personName,
  requestStatusMeta,
} from '../../utils/managerRequestHistory';
import { formatPersonEmail, formatPersonLocation } from '../../utils/personDisplay';

function highlightKind(request) {
  if (request.status === 'handled') return 'handled';
  if (request.status === 'new') return 'pending';
  return null;
}

function statusTagVariant(request) {
  return request.status === 'handled' ? 'neutral' : 'draft';
}

function rowTimestamp(request) {
  const value = request.status === 'handled' ? request.handledAt : request.receivedAt;
  const formatted = formatRequestTimestamp(value);
  if (!formatted) return request.status === 'handled' ? 'Handled' : 'Awaiting';
  return formatted;
}

function rowAriaLabel(request, meta, highlighted, kind, rowNumber) {
  const action = request.action === 'Add' ? 'addition' : 'removal';
  const parts = [
    `Row ${rowNumber}`,
    personName(request.person),
    `${action} request number ${request.displayId}`,
    meta.label,
    rowTimestamp(request),
  ];
  if (request.person?.email) parts.push(request.person.email);
  if (request.person?.location) parts.push(request.person.location);
  if (highlighted && kind === 'handled') parts.push('unread update, press to mark as seen');
  if (highlighted && kind === 'pending') parts.push('new submission');
  return parts.join(', ');
}

const rowInteractionClass =
  'w-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-primary)]/35';

/** Mobile-only row card for manager request history. */
export default function ManagerRequestHistoryRow({
  request,
  onOpen,
  showAsNew = false,
  rowNumber = 1,
}) {
  const meta = requestStatusMeta(request);
  const kind = highlightKind(request);
  const highlighted = showAsNew;
  const isAdd = request.action === 'Add';
  const name = personName(request.person);
  const email = formatPersonEmail(request.person, { empty: '' });
  const location = formatPersonLocation(request.person, { empty: '' });
  const contactLine = [email, location].filter(Boolean).join(' · ');
  const highlightClass = highlighted
    ? MANAGER_UPDATE_HIGHLIGHT_CLASS
    : 'hover:bg-[#f9fafb]';
  const ariaLabel = rowAriaLabel(request, meta, highlighted, kind, rowNumber);
  const handleOpen = () => onOpen?.(request);

  return (
    <li className="list-none">
      <button
        type="button"
        onClick={handleOpen}
        title={contactLine || undefined}
        aria-label={ariaLabel}
        className={`${rowInteractionClass} flex flex-col gap-2 px-4 py-3 text-left ${highlightClass}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{name}</p>
            {email && (
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">{email}</p>
            )}
            {location && (
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{location}</p>
            )}
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">
            {rowNumber}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tag variant={isAdd ? 'add-action' : 'remove-action'} label={isAdd ? 'Add' : 'Remove'} />
          <Tag variant={statusTagVariant(request)} label={meta.label} />
          {highlighted && (
            <span className="inline-flex rounded-full bg-[var(--color-brand-primary)] px-1.5 py-px text-[10px] font-semibold leading-none text-white">
              New
            </span>
          )}
          <span className="text-xs tabular-nums text-[var(--color-text-muted)]">{rowTimestamp(request)}</span>
        </div>
      </button>
    </li>
  );
}
