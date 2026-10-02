import { useCallback } from 'react';
import { MANAGER_REQUEST_TABS } from '../../utils/managerRequestHistory';

export const MANAGER_REQUEST_HISTORY_PANEL_ID = 'manager-request-history-panel';

function tabAriaLabel(tab, count, attentionCount) {
  const noun = count === 1 ? 'request' : 'requests';
  let label = `${tab.label}, ${count} ${noun}`;

  if (tab.value === 'new' && attentionCount > 0) {
    label += ', awaiting review';
  } else if (tab.value === 'handled' && attentionCount > 0) {
    const updateNoun = attentionCount === 1 ? 'update' : 'updates';
    label += `, ${attentionCount} unread ${updateNoun}`;
  }

  return label;
}

export default function ManagerRequestHistoryTabs({
  activeTab,
  onChange,
  counts,
  pendingUnseenCount = 0,
  unreadCount = 0,
}) {
  const tabIds = MANAGER_REQUEST_TABS.map((tab) => tab.value);

  const focusTab = useCallback((tabId) => {
    requestAnimationFrame(() => {
      document.getElementById(`manager-request-history-tab-${tabId}`)?.focus();
    });
  }, []);

  const handleKeyDown = (event, tabId) => {
    const index = tabIds.indexOf(tabId);
    if (index < 0) return;

    let nextId = null;
    if (event.key === 'ArrowRight') nextId = tabIds[(index + 1) % tabIds.length];
    else if (event.key === 'ArrowLeft') nextId = tabIds[(index - 1 + tabIds.length) % tabIds.length];
    else if (event.key === 'Home') nextId = tabIds[0];
    else if (event.key === 'End') nextId = tabIds[tabIds.length - 1];

    if (!nextId) return;
    event.preventDefault();
    onChange(nextId);
    focusTab(nextId);
  };

  return (
    <div
      role="tablist"
      aria-label="Filter request history"
      aria-orientation="horizontal"
      className="flex flex-wrap gap-2"
    >
      {MANAGER_REQUEST_TABS.map((tab) => {
        const selected = activeTab === tab.value;
        const count = counts[tab.value] ?? 0;
        const attentionCount =
          tab.value === 'new' ? pendingUnseenCount : tab.value === 'handled' ? unreadCount : 0;

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`manager-request-history-tab-${tab.value}`}
            aria-controls={MANAGER_REQUEST_HISTORY_PANEL_ID}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            aria-label={tabAriaLabel(tab, count, attentionCount)}
            title={tab.hint}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, tab.value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/30 focus-visible:ring-offset-1 ${
              selected
                ? 'bg-[var(--color-brand-primary)] text-white shadow-sm'
                : 'border border-[var(--color-manager-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-brand-primary)]/25 hover:bg-[var(--color-manager-panel)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <span>{tab.label}</span>
            <span
              aria-hidden="true"
              className={`inline-flex min-w-[1.125rem] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums leading-none ${
                selected ? 'bg-white/20 text-white' : 'bg-[var(--color-manager-panel)] text-[var(--color-text-muted)]'
              }`}
            >
              {count}
            </span>
            {tab.value === 'new' && attentionCount > 0 && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-amber-400/25"
              />
            )}
            {tab.value === 'handled' && attentionCount > 0 && (
              <span
                aria-hidden="true"
                className={`rounded-full px-1.5 py-px text-[9px] font-bold leading-none ${
                  selected
                    ? 'bg-white/20 text-white'
                    : 'bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]'
                }`}
              >
                {attentionCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
