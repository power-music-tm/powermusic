import { NavLink } from 'react-router-dom';

export const CUSTOMER_SERVICE_TABS = [
  { to: '/email-responses', label: 'Email Responses' },
  { to: '/templates', label: 'Templates' },
  { to: '/ignore-list', label: 'Ignore List' },
  { to: '/email-accounts', label: 'Settings' }
];

export const PARTNER_SERVICE_TABS = [
  { to: '/new-requests', label: 'New Requests' },
  { to: '/directory', label: 'Users' }
];

const navTabClass = ({ isActive }) =>
  `px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
    isActive
      ? 'bg-[var(--color-surface-highlight-strong)] text-[var(--color-brand-primary)] shadow-sm'
      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
  }`;

export default function SectionNavTabs({ tabs }) {
  return (
    <div className="flex items-center bg-[var(--color-surface-panel)] rounded-xl p-1 gap-1 ring-1 ring-[rgba(26,26,46,0.05)] w-fit">
      {tabs.map(({ to, label }) => (
        <NavLink key={to} to={to} className={navTabClass}>
          {label}
        </NavLink>
      ))}
    </div>
  );
}
