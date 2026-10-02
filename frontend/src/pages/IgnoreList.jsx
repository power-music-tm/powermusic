import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Loader2, Plus, Trash2 } from 'lucide-react';
import { formatShortDate } from '../utils/dateTime';
import PageHeader from '../components/layout/PageHeader';
import { adminPageShellClassNarrow } from '../utils/responsiveLayout';
import DottedScroll from '../components/ui/DottedScroll';
import { Toast, useToast, CardListSkeleton, SelectDropdown, Modal, HoverTip } from '../components/ui';
import {
  clearCache,
  createIgnoreRule,
  deleteIgnoreRule,
  getIgnoreList,
  getInboxes,
  loadWithCache,
} from '../utils/pilot2Api';
import { resolveSelectedInbox, writeSelectedInbox } from '../utils/selectedInbox';

function formatPattern(rule) {
  if (rule.kind === 'domain') {
    return `@${rule.pattern}`;
  }
  return rule.pattern;
}

function formatAdded(iso) {
  if (!iso) return '';
  return formatShortDate(iso);
}

export default function IgnoreList() {
  const { showToast } = useToast();
  const [inboxes, setInboxes] = useState([]);
  const [rules, setRules] = useState([]);
  const [selectedInbox, setSelectedInbox] = useState('');
  const [pattern, setPattern] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(null);

  const inboxOptions = useMemo(
    () => inboxes.map((row) => ({ value: row.email, label: row.title || row.email })),
    [inboxes],
  );

  const ignoreCounts = useMemo(() => ({
    emails: rules.filter((row) => row.kind === 'email').length,
    domains: rules.filter((row) => row.kind === 'domain').length,
  }), [rules]);

  const headerDescription = useMemo(() => {
    if (loading) return 'Loading ignore list…';
    if (!selectedInbox) return 'Connect an inbox to manage ignore rules.';
    const { emails, domains } = ignoreCounts;
    return `${emails} email${emails === 1 ? '' : 's'} ignored · ${domains} domain${domains === 1 ? '' : 's'} ignored`;
  }, [loading, selectedInbox, ignoreCounts]);

  const loadRules = useCallback((inbox) => {
    if (!inbox) {
      setRules([]);
      setLoading(false);
      return Promise.resolve([]);
    }
    return loadWithCache(`ignore_list_${inbox}`, () => getIgnoreList(inbox), (rows) => {
      setRules(rows);
      setLoading(false);
    }).catch((err) => {
      setLoading(false);
      showToast(`Could not load ignore list: ${err.message}`, 'error');
    });
  }, [showToast]);

  useEffect(() => {
    loadWithCache('inboxes', getInboxes, (rows) => {
      setInboxes(rows);
      const inbox = resolveSelectedInbox(rows);
      setSelectedInbox(inbox);
      if (inbox) loadRules(inbox);
      else setLoading(false);
    }).catch((err) => {
      setLoading(false);
      showToast(`Could not load inboxes: ${err.message}`, 'error');
    });
  }, [loadRules, showToast]);

  const handleInboxChange = (inbox) => {
    setSelectedInbox(inbox);
    writeSelectedInbox(inbox);
    setLoading(true);
    loadRules(inbox);
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    const value = pattern.trim();
    if (!value) {
      showToast('Enter an email address or domain.', 'error');
      return;
    }
    if (!selectedInbox) {
      showToast('Connect an inbox first.', 'error');
      return;
    }

    setAdding(true);
    try {
      const created = await createIgnoreRule(selectedInbox, value);
      setRules((prev) => [created, ...prev.filter((row) => row.id !== created.id)]);
      setPattern('');
      clearCache('pilot2_workspace');
      clearCache(`ignore_list_${selectedInbox}`);
      showToast('Sender added to ignore list.', 'success');
    } catch (err) {
      showToast(err.message || 'Could not add to ignore list.', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (rule) => {
    setBusyId(rule.id);
    try {
      await deleteIgnoreRule(rule.id);
      setRules((prev) => prev.filter((row) => row.id !== rule.id));
      clearCache('pilot2_workspace');
      clearCache(`ignore_list_${selectedInbox}`);
      setPendingRemove(null);
      showToast('Removed from ignore list.', 'success');
    } catch (err) {
      showToast(`Remove failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={adminPageShellClassNarrow}>
      <Toast />
      <PageHeader
        section="Customer support"
        title="Ignore list"
        description={headerDescription}
      />

      <DottedScroll className="flex-1 min-h-0">
        <div className="space-y-6 pb-8">
          <section className="rounded-xl border border-[var(--color-border-default)] bg-white p-4 shadow-sm">
            {inboxOptions.length ? (
              <form onSubmit={handleAdd} className="space-y-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 sm:w-44 lg:w-52 shrink-0">
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      Inbox
                    </label>
                    <SelectDropdown
                      value={selectedInbox}
                      onChange={handleInboxChange}
                      options={inboxOptions}
                      className="w-full"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label htmlFor="ignore-pattern" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      Email or domain
                    </label>
                    <input
                      id="ignore-pattern"
                      type="text"
                      value={pattern}
                      onChange={(event) => setPattern(event.target.value)}
                      placeholder="noreply@company.com or @marketing.com"
                      className="w-full h-10 rounded-lg border border-[var(--color-border-default)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={adding || !pattern.trim() || !selectedInbox}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-50 sm:self-end"
                  >
                    {adding ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    )}
                    Add
                  </button>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Use a full address or a domain like <span className="font-medium">@company.com</span>.
                </p>
              </form>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Connect an inbox under Email accounts to manage ignore rules.
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
              Ignored senders
            </h2>
            {loading ? (
              <CardListSkeleton rows={4} />
            ) : !selectedInbox ? null : rules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/40 px-4 py-10 text-center">
                <Ban className="mx-auto mb-3 h-8 w-8 text-[var(--color-text-muted)]" aria-hidden="true" />
                <p className="text-sm font-medium text-[var(--color-text-primary)]">No ignored senders yet</p>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Matching messages will disappear from Email responses until you remove the rule.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border-default)] bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                        {formatPattern(rule)}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {rule.kind === 'domain' ? 'Whole domain' : 'Email address'}
                        {rule.createdAt ? ` · Added ${formatAdded(rule.createdAt)}` : ''}
                      </p>
                    </div>
                    <HoverTip label="Remove">
                      <button
                        type="button"
                        onClick={() => setPendingRemove(rule)}
                        disabled={busyId === rule.id}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        aria-label={`Remove ${formatPattern(rule)}`}
                      >
                        {busyId === rule.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </HoverTip>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </DottedScroll>

      <Modal
        isOpen={pendingRemove != null}
        onClose={() => !busyId && setPendingRemove(null)}
        confirm
        title="Remove from ignore list"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setPendingRemove(null)}
              disabled={busyId != null}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium text-[var(--color-text-primary)] hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => pendingRemove && handleRemove(pendingRemove)}
              disabled={busyId != null}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer disabled:opacity-50"
            >
              {busyId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Remove
            </button>
          </>
        )}
      >
        <p>
          Remove <strong>{pendingRemove ? formatPattern(pendingRemove) : ''}</strong> from the ignore list?
          Messages from this {pendingRemove?.kind === 'domain' ? 'domain' : 'sender'} will show up again in Email responses.
        </p>
      </Modal>
    </div>
  );
}
