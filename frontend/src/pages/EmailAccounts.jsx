import { useEffect, useState, useCallback, useMemo } from 'react';
import { Mail, Link2, Unlink, Trash2, Pencil, Plus } from 'lucide-react';
import { formatShortDate, getUserTimeZoneLabel } from '../utils/dateTime';
import PageHeader from '../components/layout/PageHeader';
import { adminPageShellClassNarrow } from '../utils/responsiveLayout';
import DottedScroll from '../components/ui/DottedScroll';
import { Toast, useToast, CardListSkeleton, Modal, HoverTip } from '../components/ui';
import {
  getInboxes,
  connectInbox,
  disconnectInbox,
  updateInbox,
  deleteInbox,
  loadWithCache,
  writeCache,
  clearCache,
} from '../utils/pilot2Api';

const MAX_CONNECTED_INBOXES = 7;

function connectedDate(iso) {
  if (!iso) return null;
  return formatShortDate(iso);
}

export default function GmailAccounts() {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const connectedAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'Connected'),
    [accounts],
  );
  const atAccountLimit = connectedAccounts.length >= MAX_CONNECTED_INBOXES;

  const refresh = useCallback(() => {
    loadWithCache('inboxes', getInboxes, (rows) => {
      setAccounts(rows);
      setLoading(false);
    }).catch((err) => {
      setLoading(false);
      showToast(`Could not load inboxes: ${err.message}`, 'error');
    });
  }, [showToast]);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const handleAddAccount = async () => {
    const title = addTitle.trim();
    if (!title) {
      showToast('Enter a display name for this inbox.', 'error');
      return;
    }
    if (atAccountLimit) {
      showToast(`Maximum of ${MAX_CONNECTED_INBOXES} connected inboxes reached.`, 'error');
      return;
    }
    setAddBusy(true);
    try {
      const result = await connectInbox(title);
      clearCache('pilot2_workspace');
      if (result.authUrl) {
        window.location.assign(result.authUrl);
        return;
      }
      showToast('Inbox connected.', 'success');
      setAddOpen(false);
      setAddTitle('');
      refresh();
    } catch (err) {
      showToast(`Connect failed: ${err.message}`, 'error');
    } finally {
      setAddBusy(false);
    }
  };

  const openAddAccount = () => {
    if (atAccountLimit) {
      showToast(`Maximum of ${MAX_CONNECTED_INBOXES} connected inboxes reached.`, 'error');
      return;
    }
    setAddTitle('');
    setAddOpen(true);
  };

  const handleConnect = async (account) => {
    setBusyId(account.id);
    try {
      const result = await connectInbox(account.title, account.email);
      clearCache('pilot2_workspace');
      if (result.authUrl) {
        window.location.assign(result.authUrl);
        return;
      }
      showToast(`${account.email} connected.`, 'success');
      refresh();
    } catch (err) {
      showToast(`Connect failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnect = async (account) => {
    setBusyId(account.id);
    try {
      await disconnectInbox(account.id);
      clearCache('pilot2_workspace');
      showToast(`${account.email} disconnected.`, 'success');
      refresh();
    } catch (err) {
      showToast(`Disconnect failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openRename = (account) => {
    setRenameTarget(account);
    setRenameValue(account.title);
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title) {
      showToast('Name cannot be empty.', 'error');
      return;
    }
    setBusyId(renameTarget.id);
    try {
      const updated = await updateInbox(renameTarget.id, title);
      setAccounts((prev) => {
        const next = prev.map((a) => (a.id === updated.id ? updated : a));
        writeCache('inboxes', next);
        return next;
      });
      showToast('Inbox renamed.', 'success');
      setRenameTarget(null);
    } catch (err) {
      showToast(`Rename failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await deleteInbox(deleteTarget.id);
      const next = accounts.filter((a) => a.id !== deleteTarget.id);
      setAccounts(next);
      writeCache('inboxes', next);
      clearCache('pilot2_workspace');
      showToast(`${deleteTarget.email} removed.`, 'success');
      setDeleteTarget(null);
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={adminPageShellClassNarrow}>
      <Toast />
      <PageHeader
        section="Customer support"
        title="Email accounts"
        description={
          loading
            ? 'Loading connected inboxes…'
            : `${connectedAccounts.length} of ${MAX_CONNECTED_INBOXES} inboxes connected · Times in ${getUserTimeZoneLabel()}`
        }
        className="mb-4 shrink-0"
        actions={(
          <button
            type="button"
            onClick={openAddAccount}
            disabled={addBusy || atAccountLimit}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer shrink-0 disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            Add account
          </button>
        )}
      />

      <DottedScroll>
        {loading ? (
          <CardListSkeleton rows={4} />
        ) : connectedAccounts.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-12 h-12 rounded-2xl bg-white border border-[var(--color-border-default)] flex items-center justify-center mx-auto mb-3 shadow-sm">
              <Mail className="w-6 h-6 text-[var(--color-text-muted)] opacity-60" />
            </div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">No email accounts connected</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-[260px] mx-auto leading-relaxed">
              Add an inbox, then sign in with Google to connect it.
            </p>
            <button
              type="button"
              onClick={openAddAccount}
              disabled={atAccountLimit}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              Add account
            </button>
          </div>
        ) : connectedAccounts.map((account) => {
          const isConnected = account.status === 'Connected';
          const isBusy = busyId === account.id;
          return (
            <div
              key={account.id}
              className="group bg-white border border-[var(--color-border-default)] rounded-xl shadow-sm p-5 flex flex-col hover:border-[var(--color-surface-highlight-strong)] hover:bg-[var(--color-surface-panel)] transition-colors shrink-0"
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 bg-[var(--color-surface-highlight)] group-hover:bg-[var(--color-surface-highlight-strong)] rounded-xl flex items-center justify-center shrink-0 transition-colors">
                    <Mail className="w-5 h-5 text-[var(--color-brand-primary)]" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-[var(--color-text-primary)] leading-tight group-hover:text-[var(--color-brand-primary)] transition-colors">
                      {account.title}
                    </h2>
                    <button
                      type="button"
                      onClick={() => openRename(account)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md text-[11px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-brand-primary)] hover:bg-[var(--color-surface-highlight)] transition-colors cursor-pointer disabled:opacity-50"
                      aria-label={`Rename ${account.title}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Rename
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${
                    isConnected
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {account.status}
                  </span>
                  <HoverTip label="Delete inbox">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(account)}
                      disabled={isBusy}
                      className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200 disabled:opacity-50"
                      aria-label={`Delete ${account.title}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </HoverTip>
                </div>
              </div>

              <div className="h-px bg-[var(--color-border-default)] w-full mb-4" />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[var(--color-text-primary)] break-all">{account.email}</div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {isConnected && account.connectedAt
                      ? `Connected ${connectedDate(account.connectedAt)}`
                      : 'Not connected yet'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => handleConnect(account)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] bg-white border border-[var(--color-border-default)] rounded-lg hover:bg-gray-50 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <Link2 className="w-4 h-4 text-[var(--color-text-secondary)]" />
                    {isBusy ? 'Redirecting…' : isConnected ? 'Reconnect' : 'Connect'}
                  </button>
                  {isConnected && (
                    <button
                      type="button"
                      onClick={() => handleDisconnect(account)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 bg-white border border-[var(--color-border-default)] rounded-lg hover:bg-red-50 hover:border-red-200 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <Unlink className="w-4 h-4 text-red-500" />
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </DottedScroll>

      <Modal
        isOpen={addOpen}
        onClose={() => !addBusy && setAddOpen(false)}
        title="Add email account"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              disabled={addBusy}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium text-[var(--color-text-primary)] hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddAccount}
              disabled={addBusy || !addTitle.trim()}
              className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer disabled:opacity-40"
            >
              {addBusy ? 'Redirecting…' : 'Continue to Google'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
              Display name
            </label>
            <input
              type="text"
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="e.g. Customer Care"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddAccount(); }}
              className="w-full px-3 py-2 text-sm border border-[var(--color-border-default)] rounded-lg focus:outline-none focus:border-[var(--color-brand-primary)]"
              autoFocus
            />
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            You will be redirected to Google to sign in with the inbox account and approve access.
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={renameTarget != null}
        onClose={() => setRenameTarget(null)}
        title="Rename inbox"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setRenameTarget(null)}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium text-[var(--color-text-primary)] hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRename}
              disabled={!renameValue.trim() || busyId === renameTarget?.id}
              className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer disabled:opacity-40"
            >
              Save
            </button>
          </>
        )}
      >
        <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
          Display name
        </label>
        <input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
          className="w-full px-3 py-2 text-sm border border-[var(--color-border-default)] rounded-lg focus:outline-none focus:border-[var(--color-brand-primary)]"
          autoFocus
        />
      </Modal>

      <Modal
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        confirm
        title="Delete inbox"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium text-[var(--color-text-primary)] hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busyId === deleteTarget?.id}
              className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer disabled:opacity-40"
            >
              Delete inbox
            </button>
          </>
        )}
      >
        <div className="space-y-2">
          <p>
            Remove <strong>{deleteTarget?.title}</strong> ({deleteTarget?.email}) from the dashboard?
          </p>
          <p className="text-[var(--color-text-secondary)]">
            This disconnects the account and removes the inbox from this list. Existing emails in the queue are not deleted.
          </p>
        </div>
      </Modal>
    </div>
  );
}
