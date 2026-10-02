export const EMPTY_CELL = '-';

export function TruncateCell({ children, className = '', title }) {
  const text = children == null ? '' : String(children);
  if (!text) return null;
  return (
    <span className={`block truncate ${className}`} title={title ?? text}>
      {children}
    </span>
  );
}

export function StackedTextCell({
  primary,
  secondary,
  tertiary,
  lines,
  primaryClassName = '',
  truncate = true,
}) {
  const lineClass = truncate ? 'block truncate' : 'block break-words';
  const detailLines = Array.isArray(lines) && lines.length > 0
    ? lines.filter((line) => line != null && String(line).trim() !== '')
    : [secondary, tertiary].filter((line) => line != null && String(line).trim() !== '');
  return (
    <div className="min-w-0">
      <span className={`${lineClass} text-sm font-semibold leading-5 text-[var(--color-text-primary)] ${primaryClassName}`.trim()}>
        {primary}
      </span>
      {detailLines.map((line, index) => {
        const isSectionHeading = String(line).trim().toLowerCase() === 'manager details';
        const hasHeading = String(detailLines[0] || '').trim().toLowerCase() === 'manager details';
        const detailIndex = hasHeading ? index - 1 : index;
        return (
          <span
            key={`${index}-${line}`}
            className={`${lineClass} mt-0.5 ${
              isSectionHeading
                ? 'text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]'
                : `text-xs ${
                  detailIndex === 0
                    ? 'text-[var(--color-text-secondary)]'
                    : 'text-[var(--color-text-muted)]'
                }`
            }`}
          >
            {line}
          </span>
        );
      })}
    </div>
  );
}

function TableBodySkeleton({ columns, rows = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b border-[var(--color-border-default)] last:border-b-0">
          {columns.map((column) => (
            <td key={column.key} className="px-3 py-2.5">
              <div className="animate-pulse rounded-md bg-[var(--color-surface-highlight)] h-4 w-full max-w-[120px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DataTable({
  columns,
  rows,
  onRowClick,
  emptyMessage = 'No data available',
  compact = false,
  centerHeaders = false,
  loading = false,
  skeletonRows = 6,
  getRowClassName,
  /** Match request-detail blue border + header accents */
  accent = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}) {
  const isRowClickable = typeof onRowClick === 'function';
  const shellClass = accent
    ? 'border-[var(--color-brand-secondary)]'
    : 'border-[var(--color-border-default)]';
  const headRowClass = accent
    ? 'bg-[var(--color-brand-secondary-muted)] border-b border-[var(--color-brand-secondary-border)]'
    : 'bg-[#f9fafb] border-b border-[var(--color-border-default)]';
  const headCellClass = accent
    ? 'text-[var(--color-brand-secondary)]'
    : 'text-[var(--color-text-secondary)]';

  const selectable = !!selectedIds && typeof onToggleSelect === 'function';
  
  const handleHeaderCheckboxRef = (el) => {
    if (el) {
      const visibleIds = (rows || []).map((r) => String(r.id));
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
      const someVisibleSelected = visibleIds.length > 0 && visibleIds.some((id) => selectedIds.has(id));
      el.checked = allVisibleSelected;
      el.indeterminate = !allVisibleSelected && someVisibleSelected;
    }
  };

  const effectiveColumns = selectable
    ? [
        {
          key: '_select',
          label: (
            <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-[var(--color-border-default)] accent-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-secondary)] cursor-pointer"
                ref={handleHeaderCheckboxRef}
                onChange={(e) => {
                  if (onToggleSelectAll) {
                    const visibleIds = (rows || []).map((r) => String(r.id));
                    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
                    onToggleSelectAll(visibleIds, !allVisibleSelected);
                  }
                }}
              />
            </div>
          ),
          width: '2.25rem',
          noShrink: true,
          headerClassName: 'text-center pl-2 pr-0',
          cellClassName: 'text-center align-top pl-2 pr-0',
          render: (_, row) => (
            <div className="flex h-5 items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-[var(--color-border-default)] accent-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-secondary)] cursor-pointer"
                checked={selectedIds.has(String(row.id))}
                onChange={(e) => {
                  onToggleSelect(String(row.id), e.target.checked);
                }}
              />
            </div>
          )
        },
        ...columns
      ]
    : columns;

  return (
    <div
      className={`w-full border rounded-md bg-[var(--color-surface-card)] ${
        compact ? 'overflow-x-hidden' : 'overflow-x-auto'
      } ${shellClass}`}
    >
      <table className={`w-full border-collapse text-left ${compact ? 'table-fixed' : ''}`}>
        <thead>
          <tr className={headRowClass}>
            {effectiveColumns.map((column) => (
              <th
                key={column.key}
                className={`${compact ? 'px-2' : 'px-3'} py-2.5 text-xs font-semibold uppercase tracking-wider select-none ${headCellClass} ${
                  centerHeaders ? 'text-center' : ''
                } ${column.headerClassName || ''}`}
                style={{
                  fontSize: 'var(--font-size-xs)',
                  ...(column.width ? { width: column.width } : {}),
                  ...(column.minWidth && !compact ? { minWidth: column.minWidth } : {}),
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-default)]">
          {loading ? (
            <TableBodySkeleton columns={effectiveColumns} rows={skeletonRows} />
          ) : rows && rows.length > 0 ? (
            rows.map((row, rowIndex) => {
              const extraRowClass = getRowClassName ? getRowClassName(row) : '';
              return (
              <tr
                key={row.id || rowIndex}
                onClick={() => isRowClickable && onRowClick(row)}
                className={`transition-colors duration-150 border-b border-[var(--color-border-default)] last:border-b-0 ${
                  selectable && selectedIds.has(String(row.id)) ? 'bg-[var(--color-surface-highlight)]' : 'hover:bg-[#f9fafb]'
                } ${
                  isRowClickable ? 'cursor-pointer' : ''
                } ${extraRowClass}`}
              >
                {effectiveColumns.map((column) => {
                  const rawValue = row[column.key];
                  const renderedValue = column.render
                    ? column.render(rawValue, row)
                    : rawValue;

                  const cellStyle = {
                    ...(column.width ? { width: column.width } : {}),
                    ...(column.minWidth && !compact ? { minWidth: column.minWidth } : {}),
                  };
                  const defaultCellClass = compact
                    ? column.noShrink
                      ? 'align-top whitespace-nowrap'
                      : column.wrap
                        ? 'align-top whitespace-normal'
                        : 'align-top max-w-0 overflow-hidden'
                    : 'whitespace-nowrap align-middle';

                  return (
                    <td
                      key={column.key}
                      style={{ ...cellStyle }}
                      className={`${compact ? 'px-2' : 'px-3'} py-3 text-sm text-[var(--color-text-primary)] ${
                        column.cellClassName ?? defaultCellClass
                      }`}
                    >
                      {renderedValue !== undefined && renderedValue !== null
                        ? renderedValue
                        : ''}
                    </td>
                  );
                })}
              </tr>
            );
            })
          ) : (
            <tr>
              <td
                colSpan={effectiveColumns.length}
                className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)] bg-white"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
