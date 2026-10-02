export default function KpiCard({ value, label, signal, onClick }) {
  let valueColorClass = 'text-[var(--color-text-primary)]';

  if (signal === 'amber') {
    valueColorClass = 'text-[var(--color-signal-amber)]';
  } else if (signal === 'red') {
    valueColorClass = 'text-[var(--color-signal-red)]';
  }

  const isClickable = typeof onClick === 'function';

  return (
    <div
      onClick={onClick}
      className={`bg-[var(--color-surface-card)] border border-[var(--color-border-default)] rounded-lg shadow-[var(--shadow-card)] flex flex-col justify-center transition-all duration-200 ${
        isClickable
          ? 'cursor-pointer hover:shadow-md hover:border-gray-300'
          : ''
      }`}
      style={{ padding: '20px 24px' }}
    >
      {/* KPI Value */}
      <span
        className={`text-2xl font-bold tracking-tight leading-none ${valueColorClass}`}
        style={{ fontSize: 'var(--font-size-2xl)' }}
      >
        {value}
      </span>
      
      {/* KPI Label */}
      <span
        className="text-sm text-[var(--color-text-secondary)] font-medium mt-2"
        style={{ fontSize: 'var(--font-size-sm)' }}
      >
        {label}
      </span>
    </div>
  );
}
