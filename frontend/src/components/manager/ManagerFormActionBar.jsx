import { UserMinus, UserPlus } from 'lucide-react';

const OPTIONS = [
  { value: 'Add', label: 'Request addition', icon: UserPlus },
  { value: 'Remove', label: 'Request removal', icon: UserMinus },
];

function accentClass(isAdd) {
  return isAdd ? 'text-emerald-400' : 'text-red-400';
}

function optionButtonClass(selected) {
  const base =
    'relative z-10 inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

  if (!selected) {
    return `${base} text-white/40 hover:text-white/65`;
  }

  return `${base} text-white`;
}

function optionIconClass(selected, isAdd) {
  if (!selected) {
    return `h-4 w-4 shrink-0 text-white/35 transition-colors duration-200 group-hover:text-white/55`;
  }

  return `h-4 w-4 shrink-0 ${accentClass(isAdd)}`;
}

/**
 * Inset glass segmented control — stays on dark chrome, no stark white pills.
 */
export default function ManagerFormActionBar({
  action = 'Add',
  onActionChange,
  actionGroupId,
  interactive = true,
}) {
  const selectedIndex = action === 'Remove' ? 1 : 0;

  return (
    <div
      role="radiogroup"
      aria-labelledby={actionGroupId}
      className="px-4 pt-4 sm:px-6 sm:pt-5"
    >
      <p id={actionGroupId} className="sr-only">
        Request type
      </p>

      <div className="relative flex rounded-xl bg-black/20 p-1 ring-1 ring-inset ring-white/[0.08]">
        {/* Sliding glass indicator */}
        <div
          className="pointer-events-none absolute bottom-1 top-1 rounded-[10px] bg-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.25)] backdrop-blur-sm transition-[left,width] duration-300 ease-out"
          style={{
            left: `calc(${selectedIndex * 50}% + 4px)`,
            width: 'calc(50% - 8px)',
          }}
          aria-hidden="true"
        />
        {/* Accent underline on indicator */}
        <div
          className={`pointer-events-none absolute bottom-1 h-0.5 rounded-full transition-[left,width,background-color] duration-300 ease-out ${
            action === 'Add' ? 'bg-emerald-400/90' : 'bg-red-400/90'
          }`}
          style={{
            left: `calc(${selectedIndex * 50}% + 12px)`,
            width: 'calc(50% - 24px)',
          }}
          aria-hidden="true"
        />

        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const selected = action === value;
          const isAdd = value === 'Add';
          const className = optionButtonClass(selected);
          const iconClassName = optionIconClass(selected, isAdd);

          if (!interactive) {
            return (
              <span key={value} className={`group ${className}`} aria-hidden="true">
                <Icon className={iconClassName} />
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{isAdd ? 'Add' : 'Remove'}</span>
              </span>
            );
          }

          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onActionChange?.(value)}
              className={`group ${className}`}
            >
              <Icon className={iconClassName} aria-hidden="true" />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{isAdd ? 'Add' : 'Remove'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
