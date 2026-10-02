import { UserMinus, UserPlus } from 'lucide-react';
import ManagerFormHeader from '../manager/ManagerFormHeader';

const formCardClass =
  'overflow-hidden rounded-2xl border border-[var(--color-border-default)]/70 bg-[var(--color-manager-panel)] shadow-[var(--shadow-manager-form)]';

const inputClass =
  'w-full h-10 rounded-lg border border-[var(--color-border-default)]/90 bg-white px-3.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-[border-color,box-shadow] focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20 disabled:cursor-not-allowed disabled:bg-[var(--color-surface-panel)]';

const managerReadonlyInputClass =
  'w-full h-10 cursor-not-allowed rounded-lg border border-[var(--color-border-default)]/40 bg-[var(--color-surface-highlight)]/80 px-3.5 text-sm text-[var(--color-text-secondary)] shadow-none focus:outline-none focus:ring-0 disabled:opacity-100';

const readonlyLabelClass = 'mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]';

const textareaClass = `${inputClass} h-auto resize-none py-2`;

const labelClass = 'mb-1.5 block text-xs font-medium text-[var(--color-text-primary)]';

const sectionTitleClass =
  'text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]';

const formGridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2';

const PREVIEW_COPY = {
  Add: {
    title: 'Add a user',
    subtitle: 'Ask Power Music to add someone to the system.',
    userSection: 'User to add',
    badge: 'Addition',
    badgeClass: 'bg-[var(--color-tag-added-bg)] text-[var(--color-tag-added-text)]',
  },
  Remove: {
    title: 'Remove a user',
    subtitle: 'Ask Power Music to remove someone from the system.',
    userSection: 'User to remove',
    badge: 'Removal',
    badgeClass: 'bg-[var(--color-tag-removed-bg)] text-[var(--color-tag-removed-text)]',
  },
};

function PreviewField({ id, label, required, children, labelMuted = false }) {
  return (
    <div>
      <label htmlFor={id} className={labelMuted ? readonlyLabelClass : labelClass}>
        {label}
        {required ? (
          <>
            <span className="text-[var(--color-brand-accent)]" aria-hidden="true">
              {' '}
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {children}
    </div>
  );
}

function PreviewSection({ title, children }) {
  return (
    <fieldset className="m-0 space-y-3 border-0 border-t border-[var(--color-border-default)]/60 p-0 pt-5 first:border-t-0 first:pt-0" disabled aria-hidden="true">
      <legend className={sectionTitleClass}>{title}</legend>
      {children}
    </fieldset>
  );
}

export function PreviewFormActionToggle({ action = 'Add', onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Preview form type"
      className="flex rounded-lg border border-[var(--color-border-default)] bg-white p-0.5"
    >
      {[
        { value: 'Add', label: 'Add', icon: UserPlus },
        { value: 'Remove', label: 'Remove', icon: UserMinus },
      ].map(({ value, label, icon: Icon }) => {
        const selected = action === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange?.(value)}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/30 sm:px-3 sm:text-xs ${
              selected
                ? value === 'Add'
                  ? 'bg-[var(--color-tag-added-bg)] text-[var(--color-tag-added-text)]'
                  : 'bg-[var(--color-tag-removed-bg)] text-[var(--color-tag-removed-text)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Read-only preview of the manager submission form with partner branding applied.
 */
export default function ManagerFormPreview({
  partnerName,
  logoDataUrl,
  action = 'Add',
}) {
  const copy = PREVIEW_COPY[action] ?? PREVIEW_COPY.Add;

  return (
    <div
      className="pointer-events-none select-none rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)]"
      aria-label={`Read-only preview of the partner ${action === 'Remove' ? 'remove' : 'add'} form`}
    >
      <ManagerFormHeader
        partnerName={partnerName}
        logoDataUrl={logoDataUrl}
        managerName="Alex Manager"
        userEmail="manager@activegym.com"
        clubLocation="Sample Club"
        preview
      />

      <div className="px-4 pt-4 pb-6 sm:px-5 sm:pt-5 sm:pb-8">
        <div className={formCardClass}>
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-lg">
                {copy.title}
              </h3>
              <span
                className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${copy.badgeClass}`}
              >
                {copy.badge}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {copy.subtitle}
            </p>

            <div className="mt-4 space-y-5 sm:space-y-6">
              <PreviewSection title="Manager Details">
                <p className="-mt-1 text-[11px] text-[var(--color-text-secondary)]">
                  Taken from the signed-in account and cannot be changed here.
                </p>
                <div className={formGridClass}>
                  <PreviewField id="preview-manager-first" label="Manager First Name" required labelMuted>
                    <input id="preview-manager-first" type="text" readOnly disabled tabIndex={-1} value="Alex" className={managerReadonlyInputClass} />
                  </PreviewField>
                  <PreviewField id="preview-manager-last" label="Manager Last Name" required labelMuted>
                    <input id="preview-manager-last" type="text" readOnly disabled tabIndex={-1} value="Manager" className={managerReadonlyInputClass} />
                  </PreviewField>
                </div>
                <div className={formGridClass}>
                  <PreviewField id="preview-manager-email" label="Manager Email" required labelMuted>
                    <input
                      id="preview-manager-email"
                      type="email"
                      readOnly
                      disabled
                      tabIndex={-1}
                      value="manager@activegym.com"
                      className={managerReadonlyInputClass}
                    />
                  </PreviewField>
                  <PreviewField id="preview-manager-club" label="Manager Club Location" required labelMuted>
                    <input id="preview-manager-club" type="text" readOnly disabled tabIndex={-1} value="Sample Club" className={managerReadonlyInputClass} />
                  </PreviewField>
                </div>
              </PreviewSection>

              <PreviewSection title={copy.userSection}>
                <div className={formGridClass}>
                  <PreviewField id="preview-user-first" label="User First Name" required>
                    <input id="preview-user-first" type="text" readOnly tabIndex={-1} placeholder="First name" className={inputClass} />
                  </PreviewField>
                  <PreviewField id="preview-user-last" label="User Last Name" required>
                    <input id="preview-user-last" type="text" readOnly tabIndex={-1} placeholder="Last name" className={inputClass} />
                  </PreviewField>
                </div>
                <div className={formGridClass}>
                  <PreviewField id="preview-user-email" label="User Email" required>
                    <input
                      id="preview-user-email"
                      type="email"
                      readOnly
                      tabIndex={-1}
                      placeholder="name@example.com"
                      className={inputClass}
                    />
                  </PreviewField>
                  <PreviewField id="preview-user-location" label="User Location" required>
                    <input id="preview-user-location" type="text" readOnly tabIndex={-1} placeholder="Location" className={inputClass} />
                  </PreviewField>
                </div>
                <PreviewField id="preview-user-notes" label="Additional notes for this request (optional)">
                  <textarea
                    id="preview-user-notes"
                    readOnly
                    tabIndex={-1}
                    rows={2}
                    placeholder="Any additional information for this request..."
                    className={textareaClass}
                  />
                </PreviewField>
              </PreviewSection>

              <button
                type="button"
                disabled
                tabIndex={-1}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-border-default)] px-3 text-xs font-semibold text-[var(--color-brand-primary)] opacity-60"
              >
                Add another user
              </button>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled
                  tabIndex={-1}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--color-brand-primary)] px-4 text-sm font-semibold text-white opacity-60"
                >
                  Submit request
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
