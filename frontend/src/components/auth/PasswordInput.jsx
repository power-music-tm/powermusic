import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { inputClass } from './ManagerAuthShell';
import HoverTip from '../ui/HoverTip';

export default function PasswordInput({
  id,
  name,
  value,
  onChange,
  disabled = false,
  autoComplete,
  required,
  minLength,
  placeholder,
}) {
  const [visible, setVisible] = useState(false);
  const tip = visible ? 'Hide password' : 'Show password';

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        className={`${inputClass} pr-10`}
      />
      <span className="absolute right-3 top-1/2 z-[1] -translate-y-1/2">
        <HoverTip label={tip} placement="left">
          <button
            type="button"
            onClick={() => setVisible((show) => !show)}
            disabled={disabled}
            className="inline-flex items-center justify-center text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-50"
            aria-label={tip}
          >
            {visible ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </HoverTip>
      </span>
    </div>
  );
}
