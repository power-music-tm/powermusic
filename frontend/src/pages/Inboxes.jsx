import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { formatTimeOnly } from '../utils/dateTime';
import { inboxes } from '../data/mockData';
import { Tag } from '../components/ui';

export default function Inboxes() {
  const formatLastSync = (syncTime) => {
    if (!syncTime) return '';
    return `Today at ${formatTimeOnly(syncTime)}`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 select-none">
      {/* Header */}
      <div className="border-b border-[var(--color-border-default)] pb-4">
        <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
          Inboxes
        </h2>
      </div>

      {/* Persistent Info Banner */}
      <div className="flex items-start gap-3 bg-[#fef3c7] border border-[#fde68a] rounded-md p-3.5">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <span className="text-sm text-amber-900 font-semibold leading-normal">
          Drafts are created inside your email client, not here. This dashboard is where you manage templates and review flagged emails.
        </span>
      </div>

      {/* Inbox Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {inboxes.map((inbox) => (
          <div
            key={inbox.id}
            className="bg-white border border-[var(--color-border-default)] rounded-lg p-6 shadow-sm flex flex-col justify-between"
          >
            {/* Top Row */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-md font-semibold text-[var(--color-text-primary)]">
                  {inbox.address}
                </h3>
                <span className="text-xs text-[var(--color-text-secondary)] font-medium mt-0.5 block">
                  {inbox.displayName}
                </span>
              </div>
              <Tag
                variant={inbox.aiStatus === 'Active' ? 'active' : 'archived'}
                label={inbox.aiStatus}
              />
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 divide-x divide-[var(--color-border-default)] border-y border-[var(--color-border-default)] py-3.5 my-4">
              <div className="text-center">
                <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                  Emails Today
                </span>
                <span className="block text-lg font-bold text-[var(--color-text-primary)] mt-1">
                  {inbox.emailsToday}
                </span>
              </div>
              <div className="text-center px-1">
                <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                  Flagged
                </span>
                <span
                  className="block text-lg font-bold mt-1"
                  style={{
                    color: inbox.flaggedCount > 0 ? 'var(--color-signal-amber)' : 'var(--color-text-primary)'
                  }}
                >
                  {inbox.flaggedCount}
                </span>
              </div>
              <div className="text-center">
                <span className="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                  AI Status
                </span>
                <span className="block text-lg font-bold text-[var(--color-text-primary)] mt-1">
                  {inbox.aiStatus}
                </span>
              </div>
            </div>

            {/* Last Sync Row */}
            <div className="text-xs text-[var(--color-text-muted)] font-medium">
              Last synced: {formatLastSync(inbox.lastSync)}
            </div>

            {/* Action Buttons Row */}
            <div className="flex items-center gap-4 mt-5 pt-4 border-t border-[var(--color-border-default)]">
              <Link
                to="/email-queue"
                className="inline-flex items-center text-sm font-semibold text-[var(--color-brand-accent)] hover:text-[var(--color-brand-accent-hover)] transition-colors focus:outline-none"
              >
                View Emails &rarr;
              </Link>
              {inbox.flaggedCount > 0 && (
                <Link
                  to="/flagged-emails"
                  className="inline-flex items-center text-sm font-semibold text-amber-600 hover:text-amber-700 transition-colors focus:outline-none"
                >
                  View Flagged &rarr;
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Processing Stats Table */}
      <div className="space-y-3 pt-4">
        <span className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          Processing Summary: Today
        </span>
        <div className="bg-white rounded-lg border border-[var(--color-border-default)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-[var(--color-border-default)]">
                  <th className="px-6 py-3.5 text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                    Inbox
                  </th>
                  <th className="px-6 py-3.5 text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider text-right">
                    Emails Processed
                  </th>
                  <th className="px-6 py-3.5 text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider text-right">
                    Drafts Created
                  </th>
                  <th className="px-6 py-3.5 text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider text-right">
                    Flagged
                  </th>
                  <th className="px-6 py-3.5 text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider text-right">
                    AI Accuracy
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] font-medium">
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-semibold">
                    info@powermusic.com
                  </td>
                  <td className="px-6 py-4 text-right">4</td>
                  <td className="px-6 py-4 text-right">3</td>
                  <td className="px-6 py-4 text-right text-amber-600 font-bold">
                    1
                  </td>
                  <td className="px-6 py-4 text-right">75%</td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-semibold">
                    support@powermusic.com
                  </td>
                  <td className="px-6 py-4 text-right">2</td>
                  <td className="px-6 py-4 text-right">2</td>
                  <td className="px-6 py-4 text-right">0</td>
                  <td className="px-6 py-4 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
