export default function Tag({
  variant,
  label,
  compact: _compact = false,
  prefix: prefixOverride,
  wide = false,
  fit = false,
  wrap = false,
}) {
  let bgClass = '';
  let textClass = '';
  let extraClass = '';
  let prefix = prefixOverride ?? '';

  switch (variant) {
    case 'added':
    case 'active':
      bgClass = 'bg-[var(--color-tag-added-bg)]';
      textClass = 'text-[var(--color-tag-added-text)]';
      break;
    case 'removed':
      bgClass = 'bg-[var(--color-tag-removed-bg)]';
      textClass = 'text-[var(--color-tag-removed-text)]';
      break;
    case 'already-exists':
    case 'already-removed':
    case 'review-exists':
      bgClass = 'bg-[var(--color-tag-review-exists-bg)]';
      textClass = 'text-[var(--color-tag-review-exists-text)]';
      extraClass = 'ring-1 ring-inset ring-[var(--color-tag-review-exists-border)]';
      if (prefixOverride == null) prefix = '⚠ ';
      break;
    case 'duplicate-confirmed':
      bgClass = 'bg-[var(--color-tag-duplicate-confirmed-bg)]';
      textClass = 'text-[var(--color-tag-duplicate-confirmed-text)]';
      extraClass = 'ring-1 ring-inset ring-[var(--color-tag-duplicate-confirmed-border)]';
      break;
    case 'duplicate-potential':
      bgClass = 'bg-[var(--color-tag-duplicate-potential-bg)]';
      textClass = 'text-[var(--color-tag-duplicate-potential-text)]';
      extraClass = 'ring-1 ring-inset ring-[var(--color-tag-duplicate-potential-border)]';
      break;
    case 'new-person':
      bgClass = 'bg-[var(--color-tag-auto-mail-bg)]';
      textClass = 'text-[var(--color-tag-auto-mail-text)]';
      extraClass = 'ring-1 ring-inset ring-[var(--color-tag-auto-mail-border)]';
      break;
    case 'add-action':
      bgClass = 'bg-[var(--color-tag-add-action-bg)]';
      textClass = 'text-[var(--color-tag-add-action-text)]';
      break;
    case 'remove-action':
      bgClass = 'bg-[var(--color-tag-remove-action-bg)]';
      textClass = 'text-[var(--color-tag-remove-action-text)]';
      break;
    case 'auto-mail':
      bgClass = 'bg-[var(--color-tag-auto-mail-bg)]';
      textClass = 'text-[var(--color-tag-auto-mail-text)]';
      extraClass = 'ring-1 ring-inset ring-[var(--color-tag-auto-mail-border)]';
      break;
    case 'review-mismatch':
    case 'data-mismatch':
      bgClass = 'bg-[var(--color-tag-review-mismatch-bg)]';
      textClass = 'text-[var(--color-tag-review-mismatch-text)]';
      extraClass = 'ring-1 ring-inset ring-[var(--color-tag-review-mismatch-border)]';
      if (prefixOverride == null) prefix = '! ';
      break;
    case 'review-removed':
      bgClass = 'bg-[var(--color-tag-review-removed-bg)]';
      textClass = 'text-[var(--color-tag-review-removed-text)]';
      extraClass = 'ring-1 ring-inset ring-[var(--color-tag-review-removed-border)]';
      if (prefixOverride == null) prefix = '− ';
      break;
    case 'review':
      bgClass = 'bg-[var(--color-tag-review-exists-bg)]';
      textClass = 'text-[var(--color-tag-review-exists-text)]';
      extraClass = 'ring-1 ring-inset ring-[var(--color-tag-review-exists-border)]';
      break;
    case 'draft':
      bgClass = 'bg-yellow-100';
      textClass = 'text-yellow-800';
      break;
    case 'flagged':
      bgClass = 'bg-red-100';
      textClass = 'text-red-800';
      break;
    case 'archived':
      bgClass = 'bg-gray-100';
      textClass = 'text-gray-400';
      break;
    case 'neutral':
    default:
      bgClass = 'bg-[var(--color-tag-neutral-bg)]';
      textClass = 'text-[var(--color-tag-neutral-text)]';
      extraClass = 'ring-1 ring-inset ring-[var(--color-tag-neutral-border)]';
      break;
  }

  const equalSentViaWidth =
    wide || label === 'Manager Form' || label === 'Automated email' || label === 'Admin form'
      ? 'min-w-0 max-w-full justify-center px-2'
      : '';

  const sizeClass = wrap
    ? 'min-h-5 h-auto w-[8.75rem] max-w-full justify-center rounded-lg px-2.5 py-1.5 text-[11px] leading-snug whitespace-normal text-center'
    : fit
      ? 'h-5 max-w-full min-w-0 rounded-full px-1.5 text-[11px] leading-none whitespace-nowrap'
      : `h-5 shrink-0 rounded-full px-2 py-0 text-xs leading-none ${equalSentViaWidth}`;

  return (
    <span
      title={`${prefix || ''}${String(label).replace(/\n/g, ' ')}`}
      className={`inline-flex items-center font-semibold select-none ${sizeClass} ${bgClass} ${textClass} ${extraClass}`}
      style={fit || wrap ? undefined : { fontSize: 'var(--font-size-xs)' }}
    >
      <span
        className={
          wrap
            ? 'whitespace-pre-line text-center'
            : fit
              ? 'truncate'
              : undefined
        }
      >
        {prefix}
        {label}
      </span>
    </span>
  );
}
