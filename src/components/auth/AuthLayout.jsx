import { Zap } from 'lucide-react';

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-[var(--color-surface-bg)] flex flex-col antialiased font-sans">
      <header className="h-14 bg-white border-b border-[var(--color-border-default)] flex items-center px-6 shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-[var(--color-brand-accent)] fill-[var(--color-brand-accent)]" />
          <span className="text-[15px] font-bold text-[var(--color-text-primary)] tracking-wide">
            Power Music
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-[var(--color-border-default)] rounded-lg shadow-[var(--shadow-card)] p-8">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{title}</h1>
            {subtitle && (
              <p className="text-sm text-[var(--color-text-secondary)] mt-1.5">{subtitle}</p>
            )}
          </div>

          {children}

          {footer && (
            <div className="mt-6 pt-6 border-t border-[var(--color-border-default)] text-center text-sm text-[var(--color-text-secondary)]">
              {footer}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export function AuthField({ id, label, type = 'text', value, onChange, autoComplete, required = true }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="w-full px-3 py-2 bg-white border border-[var(--color-border-default)] rounded-md text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-focus)] transition-colors"
      />
    </div>
  );
}

export function AuthError({ message }) {
  if (!message) return null;

  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}

export function AuthSubmitButton({ children, disabled, loading }) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className={`w-full h-11 flex items-center justify-center font-semibold text-white rounded-md transition-all shadow-[var(--shadow-card)] ${
        disabled || loading
          ? 'bg-gray-300 cursor-not-allowed'
          : 'bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] cursor-pointer'
      }`}
    >
      {loading ? 'Please wait…' : children}
    </button>
  );
}
