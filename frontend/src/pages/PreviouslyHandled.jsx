import { useState, useMemo } from 'react';
import { Search, Download, Info, SortAsc, SortDesc, ChevronDown, Filter } from 'lucide-react';
import { formatTimestampSplit, formatShortDateAndTime, formatTimeOnly } from '../utils/dateTime';
import { handledRequests } from '../data/mockData';
import { TAG_ALREADY_EXISTS, TAG_AUTO_MAIL, TAG_PARTNER_REQUEST, TAG_UNVERIFIED, TAG_VERIFIED, requestTagVariant, requestTagLabel, sortRequestTags } from '../utils/requestTags';
import { DataTable, Tag, Drawer, EMPTY_CELL, HoverTip } from '../components/ui';
import { usePartnerContext } from '../context/PartnerContext';
import { getPartnerTerminology } from '../utils/managerAuthBranding';

// ─── Shared Controls Bar (same pattern as NewRequests) ────────────────────────
function ControlsBar({
  searchQuery, setSearchQuery,
  filterOpen, setFilterOpen,
  sortOpen, setSortOpen,
  filterSlots,
  sortFields,
  sortField, setSortField,
  sortDir, setSortDir,
  activeFilterCount
}) {
  return (
    <div className="w-full bg-white rounded-xl border border-[var(--color-border-default)] overflow-hidden shadow-sm">
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-0 divide-y md:divide-y-0 md:divide-x divide-[var(--color-border-default)]">
        <div className="flex items-center gap-2 px-4 py-3 flex-1">
          <Search className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
          <input
            type="text"
            placeholder="Search name, email or club..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none"
          />
          {searchQuery && (
            <HoverTip label="Clear search">
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-xs leading-none cursor-pointer"
              >
                ✕
              </button>
            </HoverTip>
          )}
        </div>

        <button
          onClick={() => { setFilterOpen(o => !o); setSortOpen(false); }}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors cursor-pointer ${
            filterOpen || activeFilterCount > 0
              ? 'bg-[var(--color-surface-highlight)] text-[var(--color-surface-highlight-text)]'
              : 'bg-white text-[var(--color-text-primary)] hover:bg-gray-50'
          }`}
        >
          <Filter className="h-4 w-4" />
          <span>Filter</span>
          {activeFilterCount > 0 && (
            <span className="ml-0.5 bg-[var(--color-brand-primary)]/10 text-[var(--color-text-primary)] text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
        </button>

        <button
          onClick={() => { setSortOpen(o => !o); setFilterOpen(false); }}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors cursor-pointer ${
            sortOpen ? 'bg-[var(--color-surface-highlight)] text-[var(--color-surface-highlight-text)]' : 'bg-white text-[var(--color-text-primary)] hover:bg-gray-50'
          }`}
        >
          {sortDir === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
          <span>Sort</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {filterOpen && (
        <div className="border-t border-[var(--color-border-default)] bg-gray-50 px-4 py-3 flex flex-wrap items-center gap-4">
          {filterSlots.map((slot) => (
            <div key={slot.label} className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">{slot.label}</span>
              <div className="flex gap-1 flex-wrap">
                {slot.options.map(opt => (
                  <button key={opt.value} onClick={() => slot.onChange(opt.value)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                      slot.value === opt.value
                        ? 'bg-[var(--color-surface-highlight)] text-[var(--color-surface-highlight-text)] border border-[var(--color-border-default)]'
                        : 'bg-white border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-gray-50'
                    }`}
                  >{opt.label}</button>
                ))}
              </div>
            </div>
          ))}
          {activeFilterCount > 0 && (
            <button onClick={() => filterSlots.forEach(s => s.onChange(s.options[0].value))}
              className="ml-auto text-xs font-semibold text-[var(--color-text-secondary)] hover:text-red-500 transition-colors cursor-pointer">
              Clear filters
            </button>
          )}
        </div>
      )}

      {sortOpen && (
        <div className="border-t border-[var(--color-border-default)] bg-gray-50 px-4 py-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">Sort by</span>
            <div className="flex gap-1 flex-wrap">
              {sortFields.map(opt => (
                <button key={opt.value} onClick={() => setSortField(opt.value)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                    sortField === opt.value
                      ? 'bg-[var(--color-surface-highlight)] text-[var(--color-surface-highlight-text)] border border-[var(--color-border-default)]'
                      : 'bg-white border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-gray-50'
                  }`}
                >{opt.label}</button>
              ))}
            </div>
          </div>
          <div className="h-5 w-px bg-[var(--color-border-default)] hidden sm:block" />
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">Direction</span>
            <div className="flex gap-1">
              {[{ value: 'asc', label: 'Ascending', Icon: SortAsc }, { value: 'desc', label: 'Descending', Icon: SortDesc }].map(({ value, label, Icon }) => (
                <button key={value} onClick={() => setSortDir(value)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                    sortDir === value
                      ? 'bg-[var(--color-surface-highlight)] text-[var(--color-surface-highlight-text)] border border-[var(--color-border-default)]'
                      : 'bg-white border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-gray-50'
                  }`}
                ><Icon className="h-3 w-3" />{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PreviouslyHandled() {
  const { selectedPartner } = usePartnerContext();
  const terms = getPartnerTerminology(selectedPartner?.name, selectedPartner?.slug);
  const [requests] = useState(handledRequests);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAction, setFilterAction] = useState('All');
  const [filterTag, setFilterTag] = useState('All');
  const [selectedRequest, setSelectedRequest] = useState(null);

  // Sort states
  const [sortField, setSortField] = useState('displayId');
  const [sortDir, setSortDir] = useState('asc');

  // Panel open states
  const [filterOpen, setFilterOpen] = useState(true);
  const [sortOpen, setSortOpen] = useState(false);

  // ── Formatters ──
  const formatTimestamp = (iso) => {
    return formatTimestampSplit(iso);
  };
  const formatDateTime = (iso) => {
    return formatShortDateAndTime(iso);
  };

  // ── Filter + Sort ──
  const filteredRequests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const isManual = (req) => req.submittedBy.club === 'Manual entry';
    const filtered = requests.filter((req) => {
      const personName = `${req.person.firstName} ${req.person.lastName}`.toLowerCase();
      const managerName = isManual(req)
        ? 'andrea admin'
        : `${req.submittedBy.firstName} ${req.submittedBy.lastName || ''}`.toLowerCase();

      const matchesSearch =
        query === '' ||
        personName.includes(query) ||
        req.person.email.toLowerCase().includes(query) ||
        (req.person.location && req.person.location.toLowerCase().includes(query)) ||
        managerName.includes(query) ||
        (req.submittedBy.email && req.submittedBy.email.toLowerCase().includes(query)) ||
        req.submittedBy.club.toLowerCase().includes(query);

      const matchesAction = filterAction === 'All' || req.action === filterAction;
      const matchesTag = filterTag === 'All' || req.tags.includes(filterTag);
      return matchesSearch && matchesAction && matchesTag;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortField === 'managerName') {
        const nA = `${a.submittedBy.firstName} ${a.submittedBy.lastName || ''}`.toLowerCase();
        const nB = `${b.submittedBy.firstName} ${b.submittedBy.lastName || ''}`.toLowerCase();
        return nA.localeCompare(nB) * dir;
      }
      if (sortField === 'personName') {
        const nA = `${a.person.firstName} ${a.person.lastName}`.toLowerCase();
        const nB = `${b.person.firstName} ${b.person.lastName}`.toLowerCase();
        return nA.localeCompare(nB) * dir;
      }
      if (sortField === 'handledAt') return (new Date(a.handledAt) - new Date(b.handledAt)) * dir;
      // default: displayId
      return (a.displayId - b.displayId) * dir;
    });
  }, [requests, searchQuery, filterAction, filterTag, sortField, sortDir]);

  // ── CSV Export ──
  const handleExportCSV = () => {
    const headers = ['#', 'Timestamp', 'Handled At', 'Request Type', 'Person Name', 'Person Email', 'Person Location', 'Manager Name', 'Manager Email', 'Manager Club', 'Tags'];
    const csvRows = filteredRequests.map((req) => {
      const isManual = req.submittedBy.club === 'Manual entry';
      return [
        req.displayId,
        formatDateTime(req.receivedAt),
        formatDateTime(req.handledAt),
        req.action,
        `${req.person.firstName} ${req.person.lastName}`,
        req.person.email,
        req.person.location || '',
        isManual ? 'Power Music Admin' : `${req.submittedBy.firstName} ${req.submittedBy.lastName || ''}`.trim(),
        req.submittedBy.email || '',
        req.submittedBy.club,
        req.tags.join('; ')
      ].map((val) => `"${String(val).replace(/"/g, '""')}"`).join(',');
    });
    const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'previously-handled-export.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeFilterCount = [filterAction !== 'All', filterTag !== 'All'].filter(Boolean).length;

  // ── Column definitions ──
  const columns = [
    {
      key: 'displayId',
      label: '#',
      render: (val) => <span className="text-xs font-bold text-[var(--color-text-muted)]">{val}</span>
    },
    {
      key: 'receivedAt',
      label: 'Timestamp',
      render: (val) => {
        const { date, time } = formatTimestamp(val);
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{date}</span>
            <span className="text-xs text-[var(--color-text-muted)]">{time}</span>
          </div>
        );
      }
    },
    {
      key: 'action',
      label: 'Request Type',
      render: (val) => (
        <Tag variant={val === 'Add' ? 'add-action' : 'remove-action'} label={val} />
      )
    },
    {
      key: 'personName',
      label: 'Person Name',
      render: (_, row) => (
        <span className="font-semibold text-sm text-[var(--color-text-primary)]">
          {row.person.firstName} {row.person.lastName}
        </span>
      )
    },
    {
      key: 'personEmail',
      label: 'Person Email',
      render: (_, row) => (
        <span className="text-xs text-[var(--color-text-secondary)]">{row.person.email}</span>
      )
    },
    {
      key: 'personLocation',
      label: 'Location',
      hidden: terms.isGll,
      render: (_, row) => (
        <span className="text-xs text-[var(--color-text-secondary)]">{row.person.location || EMPTY_CELL}</span>
      )
    },
    {
      key: 'managerName',
      label: 'Manager Name',
      render: (_, row) => {
        const isManual = row.submittedBy.club === 'Manual entry';
        return (
          <span className="font-semibold text-sm text-[var(--color-text-primary)]">
            {isManual ? 'Power Music Admin' : `${row.submittedBy.firstName} ${row.submittedBy.lastName || ''}`.trim()}
          </span>
        );
      }
    },
    {
      key: 'managerEmail',
      label: 'Manager Email',
      render: (_, row) => (
        <span className="text-xs text-[var(--color-text-secondary)]">{row.submittedBy.email || EMPTY_CELL}</span>
      )
    },
    {
      key: 'managerClub',
      label: 'Manager Club',
      hidden: terms.isGll,
      render: (_, row) => (
        <span className="text-xs text-[var(--color-text-secondary)]">{row.submittedBy.club}</span>
      )
    },
    {
      key: 'tags',
      label: 'Status / Tags',
      render: (tagsList) => (
        <div className="flex flex-wrap gap-1.5">
          {sortRequestTags(tagsList).map((t) => (
            <Tag key={t} variant={requestTagVariant(t)} label={requestTagLabel(t)} />
          ))}
        </div>
      )
    }
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] pb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Previously Handled</h2>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">44 records</span>
        </div>
        <button
          onClick={handleExportCSV}
          className="inline-flex items-center gap-1.5 px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-semibold bg-white hover:bg-gray-50 transition-colors shadow-sm focus:outline-none cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Read-only banner */}
      <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-md px-4 py-2.5 flex items-center gap-2.5">
        <Info className="w-4 h-4 text-blue-500 shrink-0" />
        <span className="text-xs text-blue-800 font-semibold">This is a read-only log. Records cannot be edited.</span>
      </div>

      {/* Controls Bar */}
      <ControlsBar
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        filterOpen={filterOpen} setFilterOpen={setFilterOpen}
        sortOpen={sortOpen} setSortOpen={setSortOpen}
        activeFilterCount={activeFilterCount}
        filterSlots={[
          {
            label: 'Request Type', value: filterAction, onChange: setFilterAction,
            options: [{ value: 'All', label: 'All' }, { value: 'Add', label: 'Add' }, { value: 'Remove', label: 'Remove' }]
          },
          {
            label: 'Tag', value: filterTag, onChange: setFilterTag,
            options: [
              { value: 'All', label: 'All Tags' },
              { value: TAG_ALREADY_EXISTS, label: requestTagLabel(TAG_ALREADY_EXISTS) },
              { value: TAG_VERIFIED, label: TAG_VERIFIED },
              { value: TAG_UNVERIFIED, label: TAG_UNVERIFIED },
              { value: TAG_PARTNER_REQUEST, label: TAG_PARTNER_REQUEST },
              { value: TAG_AUTO_MAIL, label: TAG_AUTO_MAIL },
            ]
          }
        ]}
        sortFields={[
          { value: 'displayId', label: 'ID' },
          { value: 'handledAt', label: 'Timestamp' },
          { value: 'personName', label: 'Person Name' },
          { value: 'managerName', label: 'Manager Name' }
        ]}
        sortField={sortField} setSortField={setSortField}
        sortDir={sortDir} setSortDir={setSortDir}
      />

      {/* Table */}
      <div className="w-full">
        <DataTable
          columns={columns}
          rows={filteredRequests}
          onRowClick={(row) => setSelectedRequest(row)}
          emptyMessage="No handled requests matching your filters."
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-2 text-xs font-semibold text-[var(--color-text-secondary)]">
        <span>{filteredRequests.length} records shown</span>
      </div>

      {/* Read-Only Drawer */}
      <Drawer
        isOpen={selectedRequest !== null}
        onClose={() => setSelectedRequest(null)}
        title="Request record"
      >
        {selectedRequest && (
          <div className="space-y-6 text-left select-none">
            {/* Header tags and timestamp */}
            <div className="flex items-start justify-between border-b border-[var(--color-border-default)] pb-4">
              <div className="text-xs text-[var(--color-text-secondary)] font-medium space-y-0.5">
                <div>Submitted: {formatDateTime(selectedRequest.receivedAt)}</div>
                <div>Handled: {formatDateTime(selectedRequest.handledAt)}</div>
              </div>
              <div className="flex flex-wrap gap-1.5 shrink-0 max-w-[200px] justify-end">
                {sortRequestTags(selectedRequest.tags).map((t) => (
                  <Tag key={t} variant={requestTagVariant(t)} label={requestTagLabel(t)} />
                ))}
              </div>
            </div>

            {/* Manager Details */}
            <div className="bg-[#f9fafb] border border-[var(--color-border-default)] rounded-md p-4 space-y-2">
              <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">Manager Details</span>
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                {selectedRequest.submittedBy.club === 'Manual entry' ? 'Power Music Admin' : `${selectedRequest.submittedBy.firstName} ${selectedRequest.submittedBy.lastName || ''}`.trim()}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)] space-y-0.5 font-medium">
                {selectedRequest.submittedBy.email && <div>Email: {selectedRequest.submittedBy.email}</div>}
                <div>Club: {selectedRequest.submittedBy.club}</div>
              </div>
            </div>

            {/* Person Details */}
            <div className="bg-[#f9fafb] border border-[var(--color-border-default)] rounded-md p-4 space-y-2">
              <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                Person to {selectedRequest.action === 'Add' ? 'Add' : 'Remove'}
              </span>
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                {selectedRequest.person.firstName} {selectedRequest.person.lastName}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)] space-y-0.5 font-medium">
                <div>Email: {selectedRequest.person.email}</div>
                {selectedRequest.person.location && <div>Location: {selectedRequest.person.location}</div>}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-[#f9fafb] border border-[var(--color-border-default)] rounded-md p-4 space-y-2">
              <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">Notes</span>
              <p className="text-sm text-[var(--color-text-primary)] leading-normal whitespace-pre-wrap">
                {selectedRequest.notes?.trim() ? selectedRequest.notes : EMPTY_CELL}
              </p>
            </div>

            {/* Activity Log */}
            <div className="space-y-3 pt-3 border-t border-[var(--color-border-default)]">
              <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">Activity Log</span>
              <div className="divide-y divide-[var(--color-border-default)] font-medium text-xs">
                <div className="py-2 flex items-start gap-3">
                  <span className="text-[var(--color-text-secondary)] font-semibold shrink-0">
                    {formatTimeOnly(selectedRequest.receivedAt)}
                  </span>
                  <span className="text-[var(--color-text-primary)]">
                    Request submitted by{' '}
                    {selectedRequest.submittedBy.club === 'Manual entry'
                      ? 'Power Music Admin'
                      : `${selectedRequest.submittedBy.firstName} ${selectedRequest.submittedBy.lastName || ''}`.trim()}
                  </span>
                </div>
                <div className="py-2 flex items-start gap-3">
                  <span className="text-[var(--color-text-secondary)] font-semibold shrink-0">
                    {formatTimeOnly(selectedRequest.handledAt)}
                  </span>
                  <span className="text-[var(--color-text-primary)]">
                    Marked as {selectedRequest.action === 'Add' ? 'Added' : 'Removed'} by Power Music Admin
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
