import { Tag, TruncateCell, EMPTY_CELL } from '../ui';
import { formatTimestampSplit } from '../../utils/dateTime';
import { formatPersonEmail, formatPersonLocation } from '../../utils/personDisplay';
import { personName, requestStatusMeta } from '../../utils/managerRequestHistory';
import { getPartnerTerminology } from '../../utils/managerAuthBranding';

function TimestampCell({ val, className = '' }) {
  if (!val) return <span className="text-sm text-[var(--color-text-muted)]">{EMPTY_CELL}</span>;
  const { date, time } = formatTimestampSplit(val);
  return (
    <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
      <span className="text-sm font-semibold leading-5 whitespace-nowrap text-[var(--color-text-primary)]">
        {date}
      </span>
      <span className="text-xs leading-4 whitespace-nowrap text-[var(--color-text-muted)]">{time}</span>
    </div>
  );
}

function statusTagVariant(request) {
  return request.status === 'handled' ? 'neutral' : 'draft';
}

export function buildManagerRequestHistoryColumns(dateColumnLabel, partnerTerms = getPartnerTerminology()) {
  return [
    {
      key: '_rowNumber',
      label: '#',
      width: '3.25rem',
      noShrink: true,
      headerClassName: 'text-center',
      cellClassName: 'text-center align-top whitespace-nowrap px-1',
      render: (val) => (
        <span className="inline-flex h-5 items-center justify-center text-sm font-semibold leading-5 text-[var(--color-text-primary)] whitespace-nowrap tabular-nums">
          {val}
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Type',
      width: '4.5rem',
      noShrink: true,
      headerClassName: 'text-center',
      cellClassName: 'align-middle whitespace-nowrap text-center',
      render: (val) => (
        <div className="flex justify-center">
          <Tag variant={val === 'Add' ? 'add-action' : 'remove-action'} label={val} />
        </div>
      ),
    },
    {
      key: '_dateValue',
      label: dateColumnLabel,
      width: '6.5rem',
      noShrink: true,
      headerClassName: 'text-center',
      cellClassName: 'align-top text-center',
      render: (val) => <TimestampCell val={val} className="items-center" />,
    },
    {
      key: 'personName',
      label: 'Name',
      width: '12%',
      headerClassName: 'text-center',
      cellClassName: 'align-top text-left max-w-0 overflow-hidden',
      render: (_, row) => {
        const name = personName(row.person);
        return (
          <TruncateCell className="text-sm font-semibold text-[var(--color-text-primary)]" title={name}>
            {name}
          </TruncateCell>
        );
      },
    },
    {
      key: 'personLocation',
      label: partnerTerms?.locationTerm || 'Location',
      width: '12%',
      headerClassName: 'text-center',
      cellClassName: 'align-top text-left max-w-0 overflow-hidden',
      render: (_, row) => {
        const location = formatPersonLocation(row.person, { empty: EMPTY_CELL });
        return (
          <TruncateCell className="text-sm font-normal leading-5 text-[var(--color-text-primary)]" title={location}>
            {location}
          </TruncateCell>
        );
      },
    },
    {
      key: 'personEmail',
      label: 'Email',
      width: '18%',
      headerClassName: 'text-center',
      cellClassName: 'align-top text-left max-w-0 overflow-hidden',
      render: (_, row) => {
        const email = formatPersonEmail(row.person, { empty: EMPTY_CELL });
        return (
          <TruncateCell className="text-sm font-semibold leading-5 text-[var(--color-text-primary)]" title={email}>
            {email}
          </TruncateCell>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: '6.5rem',
      noShrink: true,
      headerClassName: 'text-center',
      cellClassName: 'align-middle whitespace-nowrap text-center',
      render: (_, row) => {
        const meta = requestStatusMeta(row);
        return (
          <div className="flex items-center justify-center gap-1.5">
            {row._showAsNew && (
              <span className="inline-flex rounded-full bg-[var(--color-brand-primary)] px-1.5 py-px text-[10px] font-semibold leading-none text-white">
                New
              </span>
            )}
            <Tag variant={statusTagVariant(row)} label={meta.label} />
          </div>
        );
      },
    },
  ];
}
