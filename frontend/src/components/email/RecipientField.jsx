import { useMemo, useRef, useState } from 'react';
import { suggestFor } from '../../utils/emailAddressBook';

/**
 * Lightweight recipient input with a dropdown of suggestions drawn from the
 * loaded address book. Gmail-style behaviour: type freely, comma commits a
 * token, arrow keys / Enter pick from the suggestion list.
 */
export default function RecipientField({
  label,
  value,
  onChange,
  book,
  placeholder,
  autoFocus = false,
  required = false,
}) {
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const { tokenStart, matches } = useMemo(
    () => suggestFor(value, book),
    [value, book],
  );

  // Clamp during render rather than resetting via effect — Andrea's arrow-key
  // selection stays where she left it as long as it's still in range, and we
  // avoid the extra render an effect would trigger.
  const activeHighlight = matches.length === 0 ? 0 : Math.min(highlight, matches.length - 1);

  const accept = (entry) => {
    const before = value.slice(0, tokenStart).replace(/[\s,]+$/, '');
    const prefix = before.length > 0 ? `${before}, ` : '';
    const nextValue = `${prefix}${entry.email}, `;
    onChange(nextValue);
    // Keep focus so the user can chain-add recipients.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (e) => {
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((activeHighlight + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((activeHighlight - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      accept(matches[activeHighlight]);
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      <div className="relative mt-1">
        <input
          ref={inputRef}
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className="w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-brand-primary)]/40 focus:ring-2 focus:ring-[var(--color-brand-primary)]/10"
        />
        {focused && matches.length > 0 && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border-default)] bg-white shadow-lg"
          >
            {matches.map((entry, idx) => (
              <li
                key={entry.email}
                role="option"
                aria-selected={idx === activeHighlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(entry);
                }}
                onMouseEnter={() => setHighlight(idx)}
                className={`flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer ${
                  idx === activeHighlight
                    ? 'bg-[var(--color-surface-highlight)] text-[var(--color-brand-primary)]'
                    : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-panel)]'
                }`}
              >
                <span className="truncate font-medium">{entry.name}</span>
                <span className="truncate text-[11px] text-[var(--color-text-muted)]">
                  {entry.email}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  );
}
