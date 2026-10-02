import { ArrowRight, UserMinus, UserPlus } from 'lucide-react';

const CARD_CLASS =
  'group relative flex flex-col overflow-hidden rounded-2xl border-2 border-[var(--color-brand-primary)] bg-white text-left shadow-[var(--shadow-manager-panel)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-[var(--color-brand-secondary)] hover:shadow-[0_12px_40px_rgba(44,95,143,0.12),0_2px_8px_rgba(26,26,46,0.04)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-secondary)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-manager-canvas)]';

const OPTIONS = [
  {
    value: 'Add',
    title: 'Add a user',
    description: 'Submit someone new to Power Music for your partner directory.',
    icon: UserPlus,
    iconClass: 'text-emerald-600',
    iconWrap: 'border-emerald-200/80 bg-emerald-50',
  },
  {
    value: 'Remove',
    title: 'Remove a user',
    description: 'Ask Power Music to remove someone who should no longer be listed.',
    icon: UserMinus,
    iconClass: 'text-red-600',
    iconWrap: 'border-red-200/80 bg-red-50',
  },
];

/**
 * Landing step — pick add vs remove before the form and directory search appear.
 */
export default function ManagerRequestChoice({ onSelect }) {
  return (
    <section
      aria-labelledby="manager-request-choice-heading"
      className="mx-auto flex w-full max-w-4xl flex-col items-center px-2 py-10 sm:py-12"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-brand-secondary)]">
        New request
      </p>
      <h2
        id="manager-request-choice-heading"
        className="mt-2.5 text-center text-[1.65rem] font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-[1.875rem]"
      >
        What would you like to do?
      </h2>
      <p className="mt-2.5 max-w-lg text-center text-sm leading-relaxed text-[var(--color-text-secondary)] sm:text-[15px]">
        Choose whether you&apos;re adding someone to the system or requesting a removal. You&apos;ll
        fill in the details on the next step.
      </p>

      <div className="mt-9 grid w-full grid-cols-1 gap-5 sm:mt-11 sm:grid-cols-2 sm:gap-6">
        {OPTIONS.map(({ value, title, description, icon: Icon, iconClass, iconWrap }) => (
          <button
            key={value}
            type="button"
            onClick={() => onSelect?.(value)}
            className={CARD_CLASS}
          >
            <div
              className="h-1 w-full bg-gradient-to-r from-[var(--color-brand-secondary)] via-[#3d7ab5] to-[var(--color-brand-secondary)]"
              aria-hidden="true"
            />

            <div className="px-6 pb-5 pt-6 sm:px-7 sm:pb-6 sm:pt-7">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl border-2 ${iconWrap}`}
              >
                <Icon className={`h-5 w-5 ${iconClass}`} aria-hidden="true" />
              </div>

              <h3 className="mt-4 text-lg font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-xl">
                {title}
              </h3>

              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                {description}
              </p>

              <span className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-[var(--color-brand-secondary)] bg-white text-sm font-semibold text-[var(--color-brand-secondary)] transition-[background-color,color,box-shadow] duration-300 group-hover:bg-[var(--color-brand-secondary)] group-hover:text-white group-hover:shadow-[0_4px_14px_rgba(44,95,143,0.28)]">
                Continue
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
