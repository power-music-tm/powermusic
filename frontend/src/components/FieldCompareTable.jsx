import { AlertTriangle } from 'lucide-react';

const norm = (value) => String(value ?? '').trim().toLowerCase();

const hasValue = (value) => String(value ?? '').trim() !== '';

/**
 * Same visual language as the main source comparison matrix:
 * Field rows × version/source columns, with conflict highlighting.
 */
export default function FieldCompareTable({
  fieldRows = [],
  sources = [],
  embedded = false,
  caption = 'Values by source. Highlighted cells differ from the first column.',
}) {
  if (!sources.length || !fieldRows.length) return null;

  const anchor = sources[0];
  const fieldColClass =
    'w-[5.5rem] bg-[var(--color-brand-secondary-muted)] px-2.5 text-center align-middle text-[var(--color-brand-secondary)] sm:w-24 sm:px-3';
  const titleBorder = 'border-[var(--color-brand-secondary)]';
  const manyCols = sources.length > 3;

  return (
    <div
      className={
        embedded
          ? 'min-w-0 overflow-x-auto bg-white'
          : 'min-w-0 overflow-x-auto rounded-xl border border-[var(--color-brand-secondary)] bg-white'
      }
    >
      <table
        className={`border-separate border-spacing-0 text-sm leading-normal ${
          manyCols ? 'w-max min-w-full' : 'w-full table-fixed'
        }`}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className={`${fieldColClass} sticky left-0 z-[1] border-b ${titleBorder} py-2.5 text-[11px] font-semibold uppercase tracking-wide`}
            >
              Field
            </th>
            {sources.map((source) => (
              <th
                key={source.key}
                scope="col"
                className={`border-b ${titleBorder} bg-[var(--color-brand-secondary-muted)] px-2.5 py-2.5 text-center align-middle sm:px-3 ${
                  manyCols ? 'min-w-[7.5rem]' : ''
                }`}
              >
                <span className="block text-[12px] font-semibold leading-snug text-[var(--color-brand-secondary)] sm:text-[13px]">
                  {source.title}
                </span>
                {source.caption ? (
                  <span className="mt-0.5 block text-[10px] font-normal normal-case leading-snug text-[var(--color-brand-secondary)]/80 sm:text-[11px]">
                    {source.caption}
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fieldRows.map(({ key, label, mono }, rowIndex) => {
            const presentValues = sources.map((s) => s.values[key]).filter(hasValue);
            const conflict =
              presentValues.length > 1
              && new Set(presentValues.map(norm)).size > 1;
            const isLastRow = rowIndex === fieldRows.length - 1;

            return (
              <tr key={key}>
                <th
                  scope="row"
                  className={`${fieldColClass} sticky left-0 z-[1] border-r ${titleBorder} py-3 text-sm font-semibold`}
                >
                  {label}
                  {conflict ? (
                    <span className="mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-[var(--color-brand-accent)]">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                      Conflict
                    </span>
                  ) : null}
                </th>
                {sources.map((source, i) => {
                  const value = source.values[key];
                  const differs =
                    conflict
                    && i !== 0
                    && hasValue(value)
                    && norm(value) !== norm(anchor.values[key]);

                  return (
                    <td
                      key={`${source.key}-${key}`}
                      className={`px-2.5 py-3 text-center align-middle sm:px-3 ${
                        isLastRow ? '' : 'border-b border-[var(--color-border-default)]'
                      } ${
                        differs ? 'bg-[var(--color-brand-accent)]/10' : 'bg-white'
                      }`}
                    >
                      <span
                        className={`block min-w-0 text-center ${
                          mono
                            ? 'truncate font-mono text-[12px] sm:text-[13px]'
                            : 'break-words [overflow-wrap:anywhere]'
                        } ${
                          differs
                            ? 'font-semibold text-[var(--color-brand-accent)]'
                            : 'font-medium text-[var(--color-text-primary)]'
                        }`}
                        title={typeof value === 'string' ? value : undefined}
                      >
                        {hasValue(value) ? value : (
                          <span className="text-[var(--color-text-muted)]">-</span>
                        )}
                        {differs ? (
                          <span className="sr-only"> (differs from {anchor.title})</span>
                        ) : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
