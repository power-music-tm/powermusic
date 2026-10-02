import { useState, useMemo } from 'react';
import { Flag, Info, CheckCircle, ArrowLeft } from 'lucide-react';
import { formatTimeOnly, formatDetailReceived as formatDetailReceivedHelper } from '../utils/dateTime';
import { emailQueue, templates } from '../data/mockData';
import { DataTable, Tag, Drawer, Modal, Toast, useToast } from '../components/ui';

export default function FlaggedEmails() {
  // Filter mock data initially to only show flagged emails (usually just 1: James Davies)
  const [emails, setEmails] = useState(() =>
    emailQueue.filter((email) => email.flagged === true)
  );
  
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [showResolveModal, setShowResolveModal] = useState(null);
  const [resolutionType, setResolutionType] = useState('Replied Manually');
  const [resolutionNote, setResolutionNote] = useState('');
  
  const { showToast } = useToast();

  // Helper: truncate string
  const truncate = (str, len) => {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  };

  // Helper: format received time for table
  const formatReceivedTime = (receivedStr) => {
    if (!receivedStr) return '';
    return formatTimeOnly(receivedStr);
  };

  // Helper: format received datetime for drawer
  const formatDetailReceived = (dateStr) => {
    if (!dateStr) return '';
    return formatDetailReceivedHelper(dateStr);
  };

  // Helper: get intent pill CSS styles
  const getIntentClass = (intent) => {
    switch (intent) {
      case 'Enquiry':
        return 'bg-[#dbeafe] text-[#1e40af]';
      case 'Renewal':
        return 'bg-[#dcfce7] text-[#166534]';
      case 'Cancellation':
        return 'bg-[#fee2e2] text-[#991b1b]';
      case 'Partnership':
        return 'bg-[#f3e8ff] text-[#7c3aed]';
      case 'Finance':
        return 'bg-[#fef9c3] text-[#713f12]';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Helper: resolve template body placeholders
  const getDraftText = (email) => {
    if (!email.templateUsed) {
      return 'No draft available. Email has been flagged for manual review.';
    }
    const foundTemplate = templates.find((t) => t.name === email.templateUsed);
    if (foundTemplate) {
      const firstName = email.from ? email.from.split(' ')[0] : 'there';
      const inboxShort = email.inbox ? email.inbox.split('@')[0] + '@' : '';
      return foundTemplate.body
        .replace(/\{\{first_name\}\}/g, firstName)
        .replace(/\{\{inbox_name\}\}/g, inboxShort);
    }
    const firstName = email.from ? email.from.split(' ')[0] : 'there';
    return `Hi ${firstName},\n\nWe've received your ${email.intent.toLowerCase()} enquiry and will respond shortly.\n\nKind regards,\nPower Music Team`;
  };

  // Handle drawer review/send actions (clear flag and remove from local list)
  const handleDrawerAction = (id, action) => {
    let toastMsg = '';
    if (action === 'reviewed') {
      toastMsg = 'Email marked as reviewed.';
    } else if (action === 'sent') {
      toastMsg = 'Draft marked as sent.';
    }

    setEmails((prev) => prev.filter((email) => email.id !== id));
    setSelectedEmail(null);
    showToast(toastMsg, 'success');
  };

  // Handle Resolve Flag modal confirmation
  const handleConfirmResolve = () => {
    if (!showResolveModal) return;
    const resolvedSubject = showResolveModal.subject;
    const resolvedId = showResolveModal.id;

    // Filter out resolved email
    setEmails((prev) => prev.filter((email) => email.id !== resolvedId));
    setShowResolveModal(null);
    setResolutionType('Replied Manually');
    setResolutionNote('');

    showToast(`Flag resolved: ${resolvedSubject}.`, 'success');
  };

  // Columns definition
  const columns = [
    {
      key: 'from',
      label: 'From',
      render: (_, row) => (
        <div className="flex flex-col">
          <span className="font-semibold text-sm text-[var(--color-text-primary)]">
            {row.from}
          </span>
          <span className="text-xs text-[var(--color-text-secondary)] font-normal text-gray-500 mt-0.5">
            {row.fromEmail}
          </span>
        </div>
      )
    },
    {
      key: 'subject',
      label: 'Subject',
      render: (val) => (
        <span className="font-semibold text-sm text-[var(--color-text-primary)]">
          {truncate(val, 60)}
        </span>
      )
    },
    {
      key: 'inbox',
      label: 'Inbox',
      render: (val) => (
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          {val ? val.split('@')[0] + '@' : ''}
        </span>
      )
    },
    {
      key: 'intent',
      label: 'AI Intent',
      render: (val, row) => (
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getIntentClass(
              val
            )}`}
          >
            {val}
          </span>
          <span className="text-xs text-[var(--color-text-secondary)] font-semibold">
            ({row.intentConfidence}%)
          </span>
        </div>
      )
    },
    {
      key: 'flagReason',
      label: 'Flagged Reason',
      render: (val) => (
        <span className="text-xs font-semibold text-[var(--color-text-secondary)] leading-normal">
          {val || 'Unknown reason'}
        </span>
      )
    },
    {
      key: 'receivedAt',
      label: 'Received',
      render: (val) => (
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {formatReceivedTime(val)}
        </span>
      )
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowResolveModal(row);
          }}
          className="px-2.5 py-1 border border-red-200 rounded text-xs font-bold text-red-600 bg-white hover:bg-red-50 focus:outline-none transition-colors cursor-pointer"
        >
          Resolve Flag
        </button>
      )
    }
  ];

  return (
    <div className="flagged-emails-container max-w-7xl mx-auto space-y-6 select-none relative">
      {/* Inject custom CSS styles for overriding Drawer width inside this view */}
      <style>{`
        .flagged-emails-container .max-w-\\[420px\\] {
          max-width: 520px !important;
        }
      `}</style>

      {/* Header Row */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] pb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
            Flagged Emails
          </h2>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${emails.length > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-150 text-gray-700'}`}>
            {emails.length} flagged
          </span>
        </div>
      </div>

      {emails.length > 0 ? (
        <>
          {/* Info Banner */}
          <div className="flex items-start gap-3 bg-red-50/50 border border-red-100 rounded-md p-3.5">
            <Info className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span className="text-sm text-red-800 font-semibold leading-normal">
              These emails require manual review. AI confidence was too low or no matching template was found.
            </span>
          </div>

          {/* Table */}
          <div className="w-full">
            <DataTable
              columns={columns}
              rows={emails}
              onRowClick={(row) => setSelectedEmail(row)}
              emptyMessage="No flagged emails matching search."
            />
          </div>
        </>
      ) : (
        /* Empty State */
        <div className="bg-white border border-[var(--color-border-default)] rounded-md py-16 flex flex-col items-center justify-center text-center space-y-3">
          <CheckCircle className="w-12 h-12 text-green-500" />
          <h3 className="text-md font-bold text-[var(--color-text-primary)]">
            No flagged emails.
          </h3>
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">
            You're all caught up.
          </p>
        </div>
      )}

      {/* Email Detail Drawer */}
      <Drawer
        isOpen={selectedEmail !== null}
        onClose={() => setSelectedEmail(null)}
        title={selectedEmail ? truncate(selectedEmail.subject, 40) : ''}
      >
        {selectedEmail && (
          <div className="flex flex-col h-full space-y-6 text-left select-none pb-20">
            {/* Drawer Body Layout Split */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              {/* Column A — Original Email */}
              <div className="space-y-4 pr-1">
                <div>
                  <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                    Original Email
                  </span>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    From: {selectedEmail.from} &lt;{selectedEmail.fromEmail}&gt;
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)] font-medium mt-0.5">
                    Received: {formatDetailReceived(selectedEmail.receivedAt)}
                  </div>
                </div>

                <div className="border-t border-[var(--color-border-default)] pt-3">
                  <div className="bg-[#f9fafb] border border-[var(--color-border-default)] rounded-md p-3 text-sm text-[var(--color-text-primary)] font-medium leading-relaxed font-sans whitespace-pre-wrap max-h-[220px] overflow-y-auto">
                    {selectedEmail.body}
                  </div>
                </div>

                <div className="space-y-2 pt-3 border-t border-[var(--color-border-default)]">
                  <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                    AI Classification
                  </span>
                  <div className="flex flex-col gap-1.5">
                    <div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getIntentClass(
                          selectedEmail.intent
                        )}`}
                      >
                        {selectedEmail.intent}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-[100px] h-2 bg-gray-100 rounded-full overflow-hidden shrink-0">
                        <div
                          className="h-full bg-[var(--color-brand-accent)] rounded-full"
                          style={{ width: `${selectedEmail.intentConfidence}%` }}
                        />
                      </div>
                      <span className="text-xs text-[var(--color-text-secondary)] font-semibold">
                        {selectedEmail.intentConfidence}% confidence
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Column B — AI Draft */}
              <div className="space-y-4 border-t md:border-t-0 md:border-l border-[var(--color-border-default)] pt-4 md:pt-0 md:pl-5 flex flex-col justify-between">
                <div className="space-y-3 flex-1">
                  <div>
                    <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1">
                      AI Draft Preview
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                      Template:{' '}
                      {selectedEmail.templateUsed ? (
                        <span className="font-semibold text-[var(--color-text-primary)]">
                          {selectedEmail.templateUsed}
                        </span>
                      ) : (
                        <span className="italic text-[var(--color-text-muted)]">
                          No template matched
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="bg-white border border-[var(--color-border-default)] rounded-md p-3 text-sm text-[var(--color-text-primary)] font-medium leading-relaxed font-sans whitespace-pre-wrap min-h-[140px] max-h-[220px] overflow-y-auto bg-gray-50/20">
                    {getDraftText(selectedEmail)}
                  </div>
                </div>

                <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-md p-3 flex items-start gap-2 mt-3 shrink-0">
                  <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <span className="text-xs text-blue-800 font-semibold leading-normal">
                    Open your email client to review and send this draft.
                  </span>
                </div>
              </div>
            </div>

            {/* Simulated Activity Log */}
            <div className="space-y-2.5 pt-4 border-t border-[var(--color-border-default)]">
              <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                Activity Log
              </span>
              <div className="space-y-1.5">
                <div className="text-xs text-[var(--color-text-secondary)] font-medium">
                  {formatReceivedTime(selectedEmail.receivedAt)}: Email received, AI
                  classification complete
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] font-medium">
                  {formatReceivedTime(selectedEmail.receivedAt)}:{' '}
                  {selectedEmail.templateUsed ? (
                    <span>Draft created using {selectedEmail.templateUsed}</span>
                  ) : (
                    <span className="text-amber-600 font-semibold">
                      Draft creation skipped. Flagged for manual review
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons Row */}
            <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-[var(--color-border-default)] py-4 flex items-center gap-2">
              <button
                onClick={() => handleDrawerAction(selectedEmail.id, 'reviewed')}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-colors cursor-pointer"
              >
                Mark as Reviewed
              </button>
              <button
                onClick={() => handleDrawerAction(selectedEmail.id, 'sent')}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-semibold text-white bg-[var(--color-brand-accent)] hover:bg-[var(--color-brand-accent-hover)] focus:outline-none transition-colors cursor-pointer"
              >
                Mark as Sent
              </button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Resolve Modal */}
      <Modal
        isOpen={showResolveModal !== null}
        onClose={() => setShowResolveModal(null)}
        title={showResolveModal ? `Resolve Flag: ${truncate(showResolveModal.subject, 20)}` : ''}
        footer={
          <>
            <button
              onClick={() => setShowResolveModal(null)}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmResolve}
              className="px-4 py-2 border border-transparent rounded-md text-sm font-semibold text-white bg-[var(--color-brand-accent)] hover:bg-[var(--color-brand-accent-hover)] focus:outline-none transition-colors cursor-pointer"
            >
              Resolve Flag
            </button>
          </>
        }
      >
        {showResolveModal && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2.5">
                Resolution type:
              </label>
              <div className="space-y-2">
                {['Replied Manually', 'Escalated', 'Template Created', 'Ignored'].map((option) => (
                  <label
                    key={option}
                    className="flex items-center gap-2 text-sm font-medium cursor-pointer text-[var(--color-text-primary)]"
                  >
                    <input
                      type="radio"
                      name="resolutionType"
                      value={option}
                      checked={resolutionType === option}
                      onChange={(e) => setResolutionType(e.target.value)}
                      className="text-[var(--color-brand-accent)] focus:ring-[var(--color-brand-accent)] w-4 h-4 cursor-pointer"
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="pt-2">
              <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                Resolution note (optional):
              </label>
              <textarea
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Add any notes for your records..."
                rows={3}
                className="w-full border border-[var(--color-border-default)] rounded-md p-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-focus)] transition-colors placeholder-[var(--color-text-muted)] bg-white resize-none"
              />
            </div>
          </div>
        )}
      </Modal>

      <Toast />
    </div>
  );
}
