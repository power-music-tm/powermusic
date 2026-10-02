import { Check } from 'lucide-react';
import { getPasswordChecks } from '../../utils/managerAuth';

export default function PasswordRequirements({ password, email }) {
  const checks = getPasswordChecks(password, { email });

  if (!password) {
    return (
      <p className="mt-1.5 text-xs text-[var(--color-text-secondary)] leading-relaxed">
        Use 8 or more characters with uppercase, lowercase, a number, and a symbol.
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-1" aria-label="Password requirements">
      {checks.map((check) => (
        <li
          key={check.id}
          className={`flex items-center gap-1.5 text-xs ${
            check.met ? 'text-emerald-700' : 'text-[var(--color-text-secondary)]'
          }`}
        >
          {check.met ? (
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-current opacity-40"
              aria-hidden="true"
            />
          )}
          <span>{check.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function PasswordMatchHint({ password, confirmPassword }) {
  if (!confirmPassword) return null;

  const matches = password === confirmPassword;

  return (
    <p
      className={`mt-1.5 text-xs ${matches ? 'text-emerald-700' : 'text-red-600'}`}
      role="status"
    >
      {matches ? 'Passwords match' : 'Passwords do not match'}
    </p>
  );
}
