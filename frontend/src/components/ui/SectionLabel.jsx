export default function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-4 my-6 select-none w-full">
      <div className="flex-1 h-[1px] bg-[var(--color-border-default)]"></div>
      <span
        className="font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
        style={{ fontSize: 'var(--font-size-xs)', letterSpacing: '0.05em' }}
      >
        {children}
      </span>
      <div className="flex-1 h-[1px] bg-[var(--color-border-default)]"></div>
    </div>
  );
}
