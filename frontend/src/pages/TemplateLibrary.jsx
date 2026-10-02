import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, FileText, Trash2, Save, X, ChevronDown, Plus, Pencil,
  SlidersHorizontal, SortAsc, Mail, RotateCcw, Eye, Clock,
  ChevronLeft, ChevronRight, Link2, Unlink, Sparkles, Check, Loader2,
} from 'lucide-react';
import { parseISO } from 'date-fns';
import { formatShortDateAndTime, formatShortDate } from '../utils/dateTime';
import {
  getTemplates, createTemplate, updateTemplate, deleteTemplate,
  restoreTemplate, deleteTemplateForever, getInboxes, loadWithCache, refreshCache, writeCache,
  getTemplateSuggestions, approveTemplateSuggestion, rejectTemplateSuggestion,
} from '../utils/pilot2Api';
import { resolveSelectedInbox, writeSelectedInbox } from '../utils/selectedInbox';
import PageHeader from '../components/layout/PageHeader';
import { adminPageShellClass } from '../utils/responsiveLayout';
import { Toast, useToast, SelectDropdown, CardListSkeleton, Modal, EMPTY_CELL, HoverTip } from '../components/ui';

// ─── Language content swapper ──────────────────────────────────────────────────
const LANG_VARIANTS = {
  English: null, // use original
  German: {
    subjectPrefix: 'AW: ',
    salutation: 'Guten Tag {{first_name}},',
    closing: 'Mit freundlichen Grüßen,\nPower Music Team',
    bodyMiddle: '[Automatisch übersetzt. Inhalte werden in Kürze bereitgestellt.]'
  },
  Spanish: {
    subjectPrefix: 'RE: ',
    salutation: 'Estimado/a {{first_name}},',
    closing: 'Atentamente,\nEquipo de Power Music',
    bodyMiddle: '[Traducido automáticamente. El contenido se proporcionará en breve.]'
  },
  Japanese: {
    subjectPrefix: 'RE: ',
    salutation: '{{first_name}} 様、',
    closing: 'よろしくお願いいたします。\nPower Music チーム',
    bodyMiddle: '[自動翻訳. コンテンツは近日中に提供されます。]'
  }
};

function translateBody(originalBody, lang) {
  if (lang === 'English' || !LANG_VARIANTS[lang]) return originalBody;
  const v = LANG_VARIANTS[lang];
  const lines = originalBody.split('\n');
  const bodyLines = lines.slice(1, -2).join('\n'); // strip salutation + closing
  return `${v.salutation}\n\n${v.bodyMiddle}\n\n${bodyLines}\n\n${v.closing}`;
}
function translateSubject(originalSubject, lang) {
  if (lang === 'English' || !LANG_VARIANTS[lang]) return originalSubject;
  return LANG_VARIANTS[lang].subjectPrefix + originalSubject;
}

// ─── Shared format helpers ─────────────────────────────────────────────────────
const fmtUpdated = (iso) => {
  if (!iso) return EMPTY_CELL;
  return formatShortDateAndTime(iso);
};

const fmtListDate = (iso) => {
  if (!iso) return EMPTY_CELL;
  return formatShortDate(iso);
};

// ─── Template List Item ────────────────────────────────────────────────────────
const TEMPLATE_CATEGORIES = ['Membership', 'Payments', 'Events', 'General Enquiries', 'Other'];
const CATEGORY_ORDER = TEMPLATE_CATEGORIES.filter((c) => c !== 'All Categories');
const INTENT_TYPE_MAX_LENGTH = 100;
const TEMPLATE_NAME_MAX_LENGTH = 200;
const TEMPLATE_SUBJECT_MAX_LENGTH = 500;

function validateIntentType(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 'Intent type is required.';
  if (trimmed.length > INTENT_TYPE_MAX_LENGTH) {
    return `Intent type must be at most ${INTENT_TYPE_MAX_LENGTH} characters.`;
  }
  return null;
}

function validateTemplateName(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 'Template name is required.';
  if (trimmed.length > TEMPLATE_NAME_MAX_LENGTH) {
    return `Template name must be at most ${TEMPLATE_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

function validateTemplateSubject(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 'Template subject line is required.';
  if (trimmed.length > TEMPLATE_SUBJECT_MAX_LENGTH) {
    return `Template subject line must be at most ${TEMPLATE_SUBJECT_MAX_LENGTH} characters.`;
  }
  return null;
}

function normalizeIntentType(value) {
  return String(value ?? '').trim().slice(0, INTENT_TYPE_MAX_LENGTH);
}

const LIBRARY_TABS = [
  { id: 'templates', label: 'Templates', status: 'Active' },
  { id: 'drafts', label: 'Drafts', status: 'Draft' },
  { id: 'deleted', label: 'Deleted', status: 'Archived' },
];

const DEFAULT_NEW_BODY = 'Hi {{first_name}},\n\n\n';
const TEMPLATE_PAGE_SIZE = 12;

function templateCreatedAt(template) {
  return template?.createdAt || template?.lastUpdated;
}

function templateIdsMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function templateWasEdited(template) {
  const created = template?.createdAt;
  const updated = template?.lastUpdated;
  if (!created || !updated) return false;
  try {
    const createdMs = parseISO(created).getTime();
    const updatedMs = parseISO(updated).getTime();
    if (Number.isNaN(createdMs) || Number.isNaN(updatedMs)) return false;
    return updatedMs - createdMs > 2000;
  } catch {
    return false;
  }
}

function TemplateSuggestionPanel({
  suggestions,
  templates,
  busyId,
  onApprove,
  onReject,
}) {
  const revisionSuggestions = suggestions.filter((item) => item.kind === 'revision');
  if (!revisionSuggestions.length) return null;

  const templateName = (templateId) =>
    templates.find((row) => row.id === templateId)?.name || 'template';

  return (
    <div className="shrink-0 space-y-2 border-b border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/50 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand-primary)]" aria-hidden="true" />
        AI template edits
      </div>
      {revisionSuggestions.map((item) => {
        const title = `Edit ${templateName(item.templateId)}`;
        return (
          <div
            key={item.id}
            className="rounded-xl border border-[var(--color-brand-primary)]/20 bg-white px-3.5 py-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                  Based on how you edited drafts before sending. Suggested fix for next time.
                </p>
                {item.rationale && (
                  <p className="mt-1.5 text-xs text-[var(--color-text-muted)] line-clamp-2">{item.rationale}</p>
                )}
                <p className="mt-2 text-[11px] font-medium text-[var(--color-text-muted)] truncate">
                  Subject: {item.suggestedSubject}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onReject(item)}
                  disabled={busyId === item.id}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-border-default)] px-2.5 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-highlight)] disabled:opacity-50"
                >
                  {busyId === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => onApprove(item)}
                  disabled={busyId === item.id}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--color-brand-primary)] px-2.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-50"
                >
                  {busyId === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Apply edit
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategorySuggestionCard({
  suggestion,
  busyId,
  onApprove,
  onReject,
  isLast,
}) {
  return (
    <div
      className={`px-3.5 py-3 bg-[var(--color-brand-primary)]/[0.06] border-t border-[var(--color-brand-primary)]/15 ${
        isLast ? '' : 'border-b border-[var(--color-brand-primary)]/10'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-brand-primary)]/12"
          aria-hidden="true"
        >
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand-primary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            Add template: {suggestion.suggestedName}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            Andrea sent a reply without a matching template. Save it here so the AI can reuse her wording next time.
          </p>
          {suggestion.rationale && (
            <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-[var(--color-text-muted)] line-clamp-4">
              {suggestion.rationale}
            </p>
          )}
          <p className="mt-2 text-[11px] font-medium text-[var(--color-text-muted)] truncate">
            Subject: {suggestion.suggestedSubject}
          </p>
          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onReject(suggestion)}
              disabled={busyId === suggestion.id}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--color-border-default)] px-2 text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-white disabled:opacity-50"
            >
              {busyId === suggestion.id ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <X className="h-3 w-3" aria-hidden="true" />
              )}
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => onApprove(suggestion)}
              disabled={busyId === suggestion.id}
              className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--color-brand-primary)] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-50"
            >
              {busyId === suggestion.id ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-3 w-3" aria-hidden="true" />
              )}
              Add template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function templateMatchesDateRange(template, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return true;
  try {
    const created = parseISO(templateCreatedAt(template));
    if (dateFrom) {
      const from = parseISO(dateFrom);
      from.setHours(0, 0, 0, 0);
      if (created < from) return false;
    }
    if (dateTo) {
      const to = parseISO(dateTo);
      to.setHours(23, 59, 59, 999);
      if (created > to) return false;
    }
    return true;
  } catch {
    return true;
  }
}

function hasDraftableNewContent(form) {
  if (!form) return false;
  return !!(
    form.name?.trim()
    || form.subject?.trim()
    || (form.body && form.body !== DEFAULT_NEW_BODY)
  );
}

function intentToCategory(intent) {
  const map = {
    Membership: 'Membership',
    Payments: 'Payments',
    Events: 'Events',
    Enquiry: 'General Enquiries',
    Cancellation: 'Membership',
    Renewal: 'Membership',
    Partnership: 'Other',
    Finance: 'Payments',
  };
  return map[intent] || 'General Enquiries';
}

function groupTemplatesByCategory(templates, newSuggestions = []) {
  const byCategory = new Map();
  templates.forEach((template) => {
    const category = template.category || 'Other';
    if (!byCategory.has(category)) byCategory.set(category, { items: [], suggestions: [] });
    byCategory.get(category).items.push(template);
  });
  newSuggestions.forEach((suggestion) => {
    const category = intentToCategory(suggestion.intent);
    if (!byCategory.has(category)) byCategory.set(category, { items: [], suggestions: [] });
    byCategory.get(category).suggestions.push(suggestion);
  });
  const ordered = CATEGORY_ORDER.filter((cat) => byCategory.has(cat));
  const extras = [...byCategory.keys()].filter((cat) => !CATEGORY_ORDER.includes(cat));
  return [...ordered, ...extras].map((category) => ({
    category,
    items: byCategory.get(category).items,
    suggestions: byCategory.get(category).suggestions,
  }));
}

function templateTimestamp(template) {
  const ts = new Date(template?.lastUpdated).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

/** Prefer in-flight local edits; otherwise keep whichever copy is newer. */
function mergeTemplateLists(serverRows, localRows, pendingIds) {
  const localById = new Map((localRows || []).map((t) => [t.id, t]));
  const serverById = new Map((serverRows || []).map((t) => [t.id, t]));
  const allIds = new Set([...localById.keys(), ...serverById.keys()]);
  const merged = [];

  for (const id of allIds) {
    const local = localById.get(id);
    const server = serverById.get(id);

    if (pendingIds.has(id)) {
      if (local) merged.push(local);
      continue;
    }
    if (!server) {
      if (local) merged.push(local);
      continue;
    }
    if (!local) {
      merged.push(server);
      continue;
    }
    merged.push(templateTimestamp(local) >= templateTimestamp(server) ? local : server);
  }
  return merged;
}

function touchTemplate(template, patch) {
  const next = { ...template, ...patch, lastUpdated: new Date().toISOString() };
  if (!next.createdAt) next.createdAt = template?.createdAt || template?.lastUpdated || next.lastUpdated;
  return next;
}

function LibraryTabs({ activeTab, counts, onChange }) {
  const tabIds = LIBRARY_TABS.map((tab) => tab.id);

  const focusTab = (tabId) => {
    requestAnimationFrame(() => {
      document.getElementById(`library-tab-${tabId}`)?.focus();
    });
  };

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
      className="px-3 pt-2 pb-0 border-b border-[var(--color-border-default)]"
      role="tablist"
      aria-label="Template library views"
    >
      <div className="flex items-stretch -mb-px gap-0.5">
        {LIBRARY_TABS.map((tab) => {
          const active = activeTab === tab.id;
          const count = counts[tab.id] ?? 0;
          const itemLabel = count === 1 ? 'item' : 'items';

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`library-panel-${tab.id}`}
              id={`library-tab-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, tab.id)}
              aria-label={`${tab.label}, ${count} ${itemLabel}`}
              className={`group relative flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 px-2 py-2.5 rounded-t-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-primary)]/35 ${
                active
                  ? 'text-[var(--color-brand-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-highlight)]/60'
              }`}
            >
              <span
                aria-hidden="true"
                className={`text-xs font-semibold leading-tight truncate max-w-full ${
                  active ? 'text-[var(--color-brand-primary)]' : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'
                }`}
              >
                {tab.label}
              </span>
              <span
                aria-hidden="true"
                className={`text-[10px] font-medium tabular-nums leading-none ${
                  active ? 'text-[var(--color-brand-primary)]/75' : 'text-[var(--color-text-muted)]'
                }`}
              >
                {count}
              </span>
              {active && (
                <span
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--color-brand-primary)]"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TEMPLATE_FIELD_INPUT =
  'w-full px-3 py-2.5 bg-white border border-[var(--color-border-default)] rounded-lg text-sm text-[var(--color-text-primary)] transition-colors focus:outline-none focus:border-[var(--color-brand-primary)]/40 focus:ring-2 focus:ring-[var(--color-brand-primary)]/10';

const TEMPLATE_FIELD_READONLY =
  'w-full px-3 py-2.5 bg-[var(--color-surface-panel)] border border-[var(--color-border-default)] rounded-lg text-sm text-[var(--color-text-primary)]';

function TemplateReadonlyField({ label, children, className = '' }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
        {label}
      </label>
      <div className={`${TEMPLATE_FIELD_READONLY} ${className}`}>{children}</div>
    </div>
  );
}

function TemplateFieldLabel({ htmlFor, children, hint }) {
  return (
    <div className="space-y-0.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-semibold text-[var(--color-text-secondary)]"
      >
        {children}
      </label>
      {hint && <p className="text-[11px] text-[var(--color-text-muted)] leading-snug">{hint}</p>}
    </div>
  );
}

function TemplateModeBadge({ mode }) {
  const styles = {
    preview: 'bg-[var(--color-surface-highlight)] text-[var(--color-text-secondary)]',
    editing: 'bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]',
    creating: 'bg-amber-50 text-amber-700',
    deleted: 'bg-red-50 text-red-700',
  };
  const labels = {
    preview: 'Preview',
    editing: 'Editing',
    creating: 'New template',
    deleted: 'Deleted',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ${styles[mode]}`}>
      {mode === 'preview' && <Eye className="w-3 h-3" aria-hidden="true" />}
      {labels[mode]}
    </span>
  );
}

function TemplateStatusChip({ status, label }) {
  const displayLabel = label ?? (status === 'Archived' ? 'Deleted' : status);
  const styles = {
    Active: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    Draft: 'bg-amber-50 text-amber-700 ring-amber-100',
    Archived: 'bg-gray-100 text-gray-600 ring-gray-200',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ring-1 ring-inset ${styles[status] || styles.Archived}`}>
      {displayLabel}
    </span>
  );
}

function TemplateToolbarButton({
  variant,
  icon: Icon,
  label,
  onClick,
  ariaLabel,
  iconClassName = 'w-3.5 h-3.5',
  className = '',
}) {
  const styles = {
    edit: 'h-9 px-3 gap-1.5 text-xs font-semibold text-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/8 hover:bg-[var(--color-brand-primary)]/12 focus-visible:ring-[var(--color-brand-primary)]/30',
    editIcon: 'h-8 w-8 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)] focus-visible:ring-[var(--color-brand-primary)]/20',
    delete: 'h-9 px-3 gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:text-red-600 hover:border-red-200 hover:bg-red-50 focus-visible:ring-red-200',
    deleteDraft: 'h-9 px-3 gap-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 focus-visible:ring-red-200',
    deleteDraftIcon: 'h-8 w-8 text-red-600 bg-red-50 hover:bg-red-100 focus-visible:ring-red-200',
    deleteForever: 'h-9 px-3 gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:text-red-600 hover:border-red-200 hover:bg-red-50 focus-visible:ring-red-200',
    deleteIcon: 'h-9 w-9 text-[var(--color-text-secondary)] hover:text-red-600 hover:bg-red-50 focus-visible:ring-red-200',
    binIcon: 'h-8 w-8 text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50 focus-visible:ring-red-200',
    restore: 'h-9 px-3 gap-1.5 text-xs font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm focus-visible:ring-[var(--color-brand-primary)]/40 focus-visible:ring-offset-1',
    restoreIcon: 'h-8 w-8 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)] focus-visible:ring-[var(--color-brand-primary)]/20',
    cancelIcon: 'h-9 w-9 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)] focus-visible:ring-[var(--color-brand-primary)]/20',
    discardIcon: 'h-9 w-9 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)] focus-visible:ring-[var(--color-brand-primary)]/20',
    discard: 'h-9 px-3 gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)] focus-visible:ring-[var(--color-brand-primary)]/20',
    save: 'h-9 px-3 gap-1.5 text-xs font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm focus-visible:ring-[var(--color-brand-primary)]/40 focus-visible:ring-offset-1',
    saveDraft: 'h-9 px-3 gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 focus-visible:ring-amber-200',
    publish: 'h-9 px-3 gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)] focus-visible:ring-[var(--color-brand-primary)]/20',
  };
  const iconOnly = variant.endsWith('Icon') || variant === 'binIcon';
  const tip = ariaLabel || label;
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={tip}
      className={`inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 ${styles[variant]} ${className}`}
    >
      <Icon className={iconClassName} aria-hidden="true" />
      {!iconOnly && label && <span>{label}</span>}
    </button>
  );
  if (!iconOnly) return button;
  return <HoverTip label={tip}>{button}</HoverTip>;
}

function CategorySection({
  category,
  items,
  suggestions = [],
  revisionTemplateIds = new Set(),
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onRestore,
  suggestionBusyId,
  onApproveSuggestion,
  onRejectSuggestion,
}) {
  const totalCount = items.length + suggestions.length;
  if (totalCount === 0) return null;

  return (
    <section className="px-3">
      <div className="flex items-center gap-2 mb-1.5 px-1">
        <h3 className="text-[11px] font-medium text-[var(--color-text-secondary)] shrink-0">
          {category}
        </h3>
        <div className="flex-1 h-px bg-[var(--color-border-default)]/80" aria-hidden="true" />
        <span className="text-[10px] font-medium text-[var(--color-text-muted)] tabular-nums shrink-0">
          {items.length}
          {suggestions.length > 0 && (
            <span className="ml-1 text-[var(--color-brand-primary)]">+{suggestions.length}</span>
          )}
        </span>
      </div>
      <div className={`rounded-xl border overflow-hidden shadow-[0_1px_2px_rgba(26,26,46,0.04)] ${
        suggestions.length > 0
          ? 'border-[var(--color-brand-primary)]/30 bg-white'
          : 'border-[var(--color-border-default)] bg-white'
      }`}>
        {items.map((template, index) => (
          <TemplateListItem
            key={template.id}
            template={template}
            tab="templates"
            isSelected={templateIdsMatch(template.id, selectedId)}
            onClick={() => onSelect(template)}
            onEdit={onEdit}
            onDelete={onDelete}
            onRestore={onRestore}
            inCard
            isLast={index === items.length - 1 && suggestions.length === 0}
            hasPendingRevision={revisionTemplateIds.has(template.id)}
          />
        ))}
        {suggestions.map((suggestion, index) => (
          <CategorySuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            busyId={suggestionBusyId}
            onApprove={onApproveSuggestion}
            onReject={onRejectSuggestion}
            isLast={index === suggestions.length - 1}
          />
        ))}
      </div>
    </section>
  );
}

function TemplateListItem({
  template,
  isSelected,
  onClick,
  tab = 'templates',
  muted = false,
  inCard = false,
  isLast = false,
  hasPendingRevision = false,
  onEdit,
  onDelete,
  onRestore,
}) {
  const showDraftTag = tab === 'deleted' && template.archivedFrom === 'Draft';

  const listActions = (onEdit || onDelete || onRestore) ? (
    <div
      className="shrink-0 flex items-center gap-0"
      onClick={(e) => e.stopPropagation()}
    >
      {onRestore && (
        <TemplateToolbarButton
          variant="restoreIcon"
          icon={RotateCcw}
          label="Restore"
          className="!h-7 !w-7"
          onClick={(e) => { e.stopPropagation(); onRestore(template); }}
        />
      )}
      {onEdit && (
        <TemplateToolbarButton
          variant="editIcon"
          icon={Pencil}
          label="Edit"
          className="!h-7 !w-7"
          onClick={(e) => { e.stopPropagation(); onEdit(template); }}
        />
      )}
      {onDelete && (
        <TemplateToolbarButton
          variant="binIcon"
          icon={Trash2}
          label={tab === 'deleted' ? 'Delete forever' : tab === 'drafts' ? 'Move to deleted' : 'Move to deleted'}
          iconClassName="w-3.5 h-3.5"
          className="!h-7 !w-7"
          onClick={(e) => { e.stopPropagation(); onDelete(template); }}
        />
      )}
    </div>
  ) : null;

  return (
    <div
      data-template-selected={isSelected || undefined}
      className={`${
        inCard
          ? `${isLast ? '' : 'border-b border-[var(--color-border-default)]/70'}`
          : 'border-b border-[var(--color-border-default)]'
      } ${
        muted ? 'opacity-75' : ''
      } ${
        hasPendingRevision
          ? 'bg-[var(--color-brand-primary)]/[0.05]'
          : isSelected
            ? inCard
              ? 'bg-[var(--color-surface-highlight)]/80'
              : 'bg-[var(--color-surface-highlight)] border-l-[3px] border-l-[var(--color-brand-primary)]'
            : 'hover:bg-[var(--color-surface-highlight)]/50'
      }`}
    >
      <div
        className={`min-w-0 flex items-center gap-2 transition-colors cursor-pointer ${
          inCard ? 'px-3.5 py-2.5' : 'px-3 py-2.5 pl-[calc(0.75rem-3px)]'
        } ${isSelected && !inCard ? 'pl-[calc(0.75rem-3px)]' : ''}`}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        role="button"
        tabIndex={0}
      >
        <div
          className={`w-7 h-7 rounded-md shrink-0 flex items-center justify-center self-center pointer-events-none ${
            isSelected ? 'bg-[var(--color-brand-primary)]/10' : 'bg-[var(--color-surface-highlight)]'
          }`}
          aria-hidden="true"
        >
          <FileText className={`w-3.5 h-3.5 ${isSelected ? 'text-[var(--color-brand-primary)]' : 'text-[var(--color-text-muted)]'}`} />
        </div>
        <div className="min-w-0 flex-1 text-left self-center pointer-events-none">
          <span
            className={`block text-sm truncate leading-tight ${
              isSelected ? 'font-semibold text-[var(--color-brand-primary)]' : 'font-medium text-[var(--color-text-primary)]'
            }`}
          >
            {template.name}
          </span>
          {hasPendingRevision && (
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-primary)]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--color-brand-primary)]">
              <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
              AI edit suggested
            </span>
          )}
          <span className="block text-[11px] text-[var(--color-text-muted)] truncate leading-tight">
            {template.subject}
          </span>
          <span className="block text-[10px] text-[var(--color-text-muted)] tabular-nums leading-tight pt-0.5">
            Created {fmtListDate(templateCreatedAt(template))}
            {templateWasEdited(template) && (
              <>
                <span className="px-1 text-[var(--color-border-default)]" aria-hidden="true">·</span>
                Updated {fmtListDate(template.lastUpdated)}
              </>
            )}
          </span>
          {tab !== 'templates' && (
            <span className="flex items-center gap-1.5 pt-1 flex-wrap">
              {showDraftTag && (
                <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold leading-none bg-amber-50 text-amber-700">
                  Deleted draft
                </span>
              )}
              {!muted && !showDraftTag && (
                <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold leading-none ${
                  template.status === 'Active' ? 'bg-emerald-50 text-emerald-700' :
                  template.status === 'Draft' ? 'bg-amber-50 text-amber-700' :
                  'bg-gray-100 text-gray-500'
                }`}
                >
                  {template.status === 'Archived' ? 'Deleted' : template.status}
                </span>
              )}
              <span className="text-[10px] font-medium text-[var(--color-text-muted)]">{template.category}</span>
            </span>
          )}
        </div>
        {listActions}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function TemplateManagement() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateIdFromUrl = searchParams.get('id');
  const inboxFromUrl = searchParams.get('inbox');
  const consumedTemplateDeepLinkRef = useRef(null);
  const applyingTemplateDeepLinkRef = useRef(false);
  const skipPageResetRef = useRef(false);
  const skipSelectionResetRef = useRef(false);
  const scrollDeepLinkRef = useRef(false);

  // Template state (single source of truth: the backend database).
  // Cached copy renders instantly; fresh data replaces it, and window focus
  // revalidates so edits from other tabs/devices appear.
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [inboxes, setInboxes] = useState([]);
  const [inboxFilter, setInboxFilter] = useState('');
  const [libraryTab, setLibraryTab] = useState('templates');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionBusyId, setSuggestionBusyId] = useState(null);

  const templatesRef = useRef([]);
  const pendingTemplateOpsRef = useRef(new Set());
  const templateOpEpochRef = useRef(new Map());

  const beginTemplateOp = useCallback((id) => {
    const epoch = (templateOpEpochRef.current.get(id) || 0) + 1;
    templateOpEpochRef.current.set(id, epoch);
    pendingTemplateOpsRef.current.add(id);
    return epoch;
  }, []);

  const isCurrentTemplateOp = useCallback(
    (id, epoch) => templateOpEpochRef.current.get(id) === epoch,
    [],
  );

  const endTemplateOp = useCallback((id, epoch) => {
    if (!isCurrentTemplateOp(id, epoch)) return false;
    pendingTemplateOpsRef.current.delete(id);
    return true;
  }, [isCurrentTemplateOp]);

  const commitTemplates = useCallback((updater) => {
    setTemplates((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      templatesRef.current = next;
      if (inboxFilter) {
        try { writeCache(`templates_${inboxFilter}`, next); } catch { /* quota */ }
      }
      return next;
    });
  }, [inboxFilter]);

  const reconcileTemplatesFromServer = useCallback((serverRows) => {
    setTemplates((prev) => {
      const next = mergeTemplateLists(serverRows, prev, pendingTemplateOpsRef.current);
      templatesRef.current = next;
      if (inboxFilter) {
        try { writeCache(`templates_${inboxFilter}`, next); } catch { /* quota */ }
      }
      return next;
    });
  }, [inboxFilter]);

  useEffect(() => {
    loadWithCache('inboxes', getInboxes, (rows) => {
      setInboxes(rows);
      // Drop the selection if that inbox was deleted meanwhile.
      setInboxFilter((prev) => {
        if (prev && rows.some((r) => r.email === prev)) return prev;
        if (inboxFromUrl && rows.some((r) => r.email === inboxFromUrl)) {
          writeSelectedInbox(inboxFromUrl);
          return inboxFromUrl;
        }
        return resolveSelectedInbox(rows);
      });
    }).catch((err) => {
      showToast(`Could not load inboxes: ${err.message}`, 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!inboxFilter) return undefined;
    let cancelled = false;
    pendingTemplateOpsRef.current = new Set();
    templateOpEpochRef.current = new Map();
    setTemplates([]);
    templatesRef.current = [];
    setTemplatesLoading(true);
    const cacheKey = `templates_${inboxFilter}`;
    loadWithCache(cacheKey, () => getTemplates(inboxFilter), (rows) => {
      if (cancelled) return;
      reconcileTemplatesFromServer(rows);
      setTemplatesLoading(false);
    }).catch((err) => {
      if (!cancelled) setTemplatesLoading(false);
      showToast(`Could not load templates: ${err.message}`, 'error');
    });
    const refresh = () => {
      if (document.hidden || cancelled) return;
      if (pendingTemplateOpsRef.current.size > 0) return;
      refreshCache(cacheKey, () => getTemplates(inboxFilter), (rows) => {
        if (cancelled) return;
        reconcileTemplatesFromServer(rows);
      }).catch(() => { /* ignore background refresh errors */ });
    };
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxFilter, reconcileTemplatesFromServer]);

  const refreshSuggestions = useCallback(() => {
    if (!inboxFilter) {
      setSuggestions([]);
      return Promise.resolve([]);
    }
    return getTemplateSuggestions(inboxFilter)
      .then((rows) => {
        setSuggestions(rows);
        return rows;
      })
      .catch((err) => {
        showToast(`Could not load AI suggestions: ${err.message}`, 'error');
        return [];
      });
  }, [inboxFilter, showToast]);

  useEffect(() => {
    refreshSuggestions();
    const onFocus = () => { refreshSuggestions(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshSuggestions]);

  // Left pane controls
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState('created-desc');
  const [categoryFilter, setCategoryFilter] = useState('All Categories');
  const [intentTypeTouched, setIntentTypeTouched] = useState(false);
  const [templateNameTouched, setTemplateNameTouched] = useState(false);
  const [templateSubjectTouched, setTemplateSubjectTouched] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);

  // Right pane: which template is selected + editor form state
  const [selectedId, setSelectedId] = useState(null);
  const [editForm, setEditForm] = useState(null);   // { name, subject, body, language }
  const [isDirty, setIsDirty] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Delete confirmation modal
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const discardNewRef = useRef(false);
  const draftAutoSaveIdRef = useRef(null);
  const editFormRef = useRef(editForm);
  const isCreatingNewRef = useRef(isCreatingNew);
  const isEditingRef = useRef(isEditing);
  const isDirtyRef = useRef(isDirty);
  const selectedIdRef = useRef(selectedId);
  const inboxFilterRef = useRef(inboxFilter);
  const autoSavePromiseRef = useRef(null);
  const persistDraftChainRef = useRef(Promise.resolve());

  editFormRef.current = editForm;
  isCreatingNewRef.current = isCreatingNew;
  isEditingRef.current = isEditing;
  isDirtyRef.current = isDirty;
  selectedIdRef.current = selectedId;
  inboxFilterRef.current = inboxFilter;

  const handleApproveSuggestion = async (item) => {
    setSuggestionBusyId(item.id);
    try {
      const saved = await approveTemplateSuggestion(item.id);
      setSuggestions((prev) => prev.filter((row) => row.id !== item.id));
      commitTemplates((prev) => {
        const without = prev.filter((t) => t.id !== saved.id);
        return [saved, ...without];
      });
      setLibraryTab(saved.status === 'Draft' ? 'drafts' : 'templates');
      setSelectedId(saved.id);
      showToast(item.kind === 'new' ? 'Template added.' : 'Template updated.', 'success');
    } catch (err) {
      showToast(`Could not apply suggestion: ${err.message}`, 'error');
    } finally {
      setSuggestionBusyId(null);
    }
  };

  const handleRejectSuggestion = async (item) => {
    setSuggestionBusyId(item.id);
    try {
      await rejectTemplateSuggestion(item.id);
      setSuggestions((prev) => prev.filter((row) => row.id !== item.id));
      showToast('Suggestion discarded.', 'info');
    } catch (err) {
      showToast(`Could not reject suggestion: ${err.message}`, 'error');
    } finally {
      setSuggestionBusyId(null);
    }
  };

  const isPendingDraftId = (id) => typeof id === 'string' && id.startsWith('draft-pending-');

  const resetNewTemplateSession = useCallback(() => {
    setIsCreatingNew(false);
    setIsEditing(false);
    setEditForm(null);
    setIsDirty(false);
    setIntentTypeTouched(false);
    setTemplateNameTouched(false);
    setTemplateSubjectTouched(false);
    discardNewRef.current = false;
    draftAutoSaveIdRef.current = null;
  }, []);

  const attachToSavedDraft = useCallback((saved) => {
    draftAutoSaveIdRef.current = saved.id;
    setSelectedId(saved.id);
    setIsCreatingNew(false);
    setIsEditing(true);
    setIsDirty(false);
  }, []);

  const persistNewDraftInner = useCallback(async (form, { silent = false } = {}) => {
    const inbox = inboxFilterRef.current;
    if (!form || !inbox) return null;
    const payload = {
      inbox,
      name: form.name?.trim() || 'Untitled draft',
      subject: form.subject?.trim() || '(No subject)',
      body: form.body || DEFAULT_NEW_BODY,
      category: normalizeIntentType(form.category) || 'General Enquiries',
      status: 'Draft',
    };
    const existingId = draftAutoSaveIdRef.current;
    const snapshot = templatesRef.current;

    if (existingId && !isPendingDraftId(existingId)) {
      const optimisticDraft = touchTemplate(
        templatesRef.current.find((t) => t.id === existingId) || {
          id: existingId,
          inbox,
          ...payload,
          intent: null,
        },
        {
          name: payload.name,
          subject: payload.subject,
          body: payload.body,
          category: payload.category,
        },
      );
      commitTemplates((prev) => prev.map((t) => (t.id === existingId ? optimisticDraft : t)));

      try {
        const saved = await updateTemplate(existingId, {
          name: payload.name,
          subject: payload.subject,
          body: payload.body,
          category: payload.category,
          intent: null,
          status: 'Draft',
        });
        draftAutoSaveIdRef.current = saved.id;
        commitTemplates((prev) => prev.map((t) => (t.id === existingId ? saved : t)));
        if (!silent) {
          showToast('Draft saved.', 'success');
          setLibraryTab('drafts');
          setSelectedId(saved.id);
          setIsCreatingNew(false);
          setIsEditing(false);
          setIsDirty(false);
        }
        return saved;
      } catch (err) {
        commitTemplates(() => snapshot);
        if (!silent) showToast(`Draft save failed: ${err.message}`, 'error');
        return null;
      }
    }

    const optimisticId = `draft-pending-${Date.now()}`;
    const optimisticDraft = touchTemplate(
      {
        id: optimisticId,
        inbox,
        name: payload.name,
        subject: payload.subject,
        body: payload.body,
        category: payload.category,
        status: 'Draft',
        intent: null,
      },
      {},
    );
    draftAutoSaveIdRef.current = optimisticId;
    commitTemplates((prev) => [...prev, optimisticDraft]);

    try {
      const saved = await createTemplate(payload);
      draftAutoSaveIdRef.current = saved.id;
      commitTemplates((prev) => {
        const withoutPending = prev.filter((t) => t.id !== optimisticId);
        return [...withoutPending, saved];
      });
      if (!silent) {
        showToast('Draft saved.', 'success');
        setLibraryTab('drafts');
        setSelectedId(saved.id);
        setIsCreatingNew(false);
        setIsEditing(false);
        setIsDirty(false);
      }
      return saved;
    } catch (err) {
      commitTemplates(() => snapshot);
      draftAutoSaveIdRef.current = null;
      if (!silent) showToast(`Draft save failed: ${err.message}`, 'error');
      return null;
    }
  }, [showToast, commitTemplates]);

  const persistNewDraft = useCallback((form, options = {}) => {
    const task = persistDraftChainRef.current
      .catch(() => {})
      .then(() => persistNewDraftInner(form, options));
    persistDraftChainRef.current = task.catch(() => {});
    return task;
  }, [persistNewDraftInner]);

  const autoSaveEditsIfNeeded = useCallback(async ({ leaveSession = true } = {}) => {
    if (autoSavePromiseRef.current) {
      await autoSavePromiseRef.current;
    }

    const run = async () => {
      if (discardNewRef.current) return false;

      if (
        isCreatingNewRef.current
        && hasDraftableNewContent(editFormRef.current)
      ) {
        const saved = await persistNewDraft(editFormRef.current, { silent: true });
        if (!saved) return false;
        if (leaveSession === true) {
          resetNewTemplateSession();
        } else if (leaveSession === false) {
          attachToSavedDraft(saved);
        }
        return true;
      }

      if (
        isEditingRef.current
        && isDirtyRef.current
        && !isCreatingNewRef.current
      ) {
        const id = selectedIdRef.current;
        const form = editFormRef.current;
        const tmpl = templatesRef.current.find((t) => t.id === id);
        if (!tmpl || !form || tmpl.status !== 'Draft') return false;

        const snapshot = templatesRef.current;
        const optimisticUpdated = touchTemplate(tmpl, {
          name: form.name,
          subject: form.subject,
          body: form.body,
        });
        commitTemplates((prev) => prev.map((t) => (t.id === id ? optimisticUpdated : t)));
        if (leaveSession !== 'background') setIsDirty(false);

        try {
          const updated = await updateTemplate(id, {
            name: form.name?.trim() || tmpl.name,
            subject: form.subject?.trim() || tmpl.subject,
            body: form.body ?? tmpl.body,
            category: tmpl.category,
            intent: tmpl.intent,
            status: 'Draft',
          });
          commitTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
        } catch (err) {
          commitTemplates(() => snapshot);
          if (leaveSession !== 'background') setIsDirty(true);
        }
        return true;
      }

      return false;
    };

    const promise = run();
    autoSavePromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (autoSavePromiseRef.current === promise) {
        autoSavePromiseRef.current = null;
      }
    }
  }, [persistNewDraft, resetNewTemplateSession, attachToSavedDraft, commitTemplates]);

  const focusOutSaveTimerRef = useRef(null);

  const handleEditorFocusOut = useCallback((e) => {
    const next = e.relatedTarget;
    if (next && e.currentTarget.contains(next)) return;
    if (next?.closest?.('[data-template-toolbar]')) return;
    if (focusOutSaveTimerRef.current) clearTimeout(focusOutSaveTimerRef.current);
    focusOutSaveTimerRef.current = setTimeout(() => {
      focusOutSaveTimerRef.current = null;
      void autoSaveEditsIfNeeded({ leaveSession: false });
    }, 200);
  }, [autoSaveEditsIfNeeded]);

  const cancelFocusOutSave = useCallback(() => {
    if (focusOutSaveTimerRef.current) {
      clearTimeout(focusOutSaveTimerRef.current);
      focusOutSaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelFocusOutSave(), [cancelFocusOutSave]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (
        isCreatingNewRef.current
        && !discardNewRef.current
        && hasDraftableNewContent(editFormRef.current)
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Auto-save draft when navigating away via sidebar / other routes
  useEffect(() => () => {
    if (
      !isCreatingNewRef.current
      || discardNewRef.current
      || !hasDraftableNewContent(editFormRef.current)
    ) return;
    const existingId = draftAutoSaveIdRef.current;
    if (existingId && !isPendingDraftId(existingId)) return;
    void persistNewDraft(editFormRef.current, { silent: true });
  }, [persistNewDraft]);

  useEffect(() => {
    consumedTemplateDeepLinkRef.current = null;
    applyingTemplateDeepLinkRef.current = Boolean(templateIdFromUrl);
  }, [templateIdFromUrl]);

  useEffect(() => {
    if (applyingTemplateDeepLinkRef.current) return;
    if (skipSelectionResetRef.current) {
      skipSelectionResetRef.current = false;
      return;
    }
    setSelectedId(null);
    setEditForm(null);
    setIsEditing(false);
    setIsCreatingNew(false);
    setIsDirty(false);
    setCategoryFilter('All Categories');
    setDateFrom('');
    setDateTo('');
    discardNewRef.current = false;
    draftAutoSaveIdRef.current = null;
  }, [inboxFilter]);

  const categories = ['All Categories', ...CATEGORY_ORDER];

  const sortOptions = useMemo(() => [
    { value: 'alpha-asc', label: 'A → Z' },
    { value: 'alpha-desc', label: 'Z → A' },
    { value: 'updated-desc', label: 'Newest updated' },
    { value: 'updated-asc', label: 'Oldest updated' },
    { value: 'created-desc', label: 'Newest created' },
    { value: 'created-asc', label: 'Oldest created' },
  ], []);

  const hasActiveFilters = categoryFilter !== 'All Categories' || dateFrom || dateTo;

  const accountOptions = useMemo(
    () => inboxes.map((inbox) => ({
      value: inbox.email,
      label: inbox.title,
    })),
    [inboxes]
  );

  const activeInboxTitle = useMemo(
    () => inboxes.find((inbox) => inbox.email === inboxFilter)?.title || inboxFilter,
    [inboxes, inboxFilter]
  );

  const selectedInboxRow = inboxes.find((inbox) => inbox.email === inboxFilter) ?? null;
  const inboxDisconnected = Boolean(selectedInboxRow && selectedInboxRow.status !== 'Connected');

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ value: category, label: category })),
    [categories]
  );

  const intentTypeError = useMemo(
    () => (intentTypeTouched ? validateIntentType(editForm?.category) : null),
    [intentTypeTouched, editForm?.category],
  );

  const templateNameError = useMemo(
    () => (templateNameTouched ? validateTemplateName(editForm?.name) : null),
    [templateNameTouched, editForm?.name],
  );

  const templateSubjectError = useMemo(
    () => (templateSubjectTouched ? validateTemplateSubject(editForm?.subject) : null),
    [templateSubjectTouched, editForm?.subject],
  );

  useEffect(() => {
    if (!sortOpen) return;
    const onClickOutside = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [sortOpen]);

  // Templates for the selected inbox.
  const inboxTemplates = templates;

  const tabCounts = useMemo(() => {
    const counts = { templates: 0, drafts: 0, deleted: 0 };
    inboxTemplates.forEach((t) => {
      if (t.status === 'Active') counts.templates += 1;
      else if (t.status === 'Draft') counts.drafts += 1;
      else if (t.status === 'Archived') counts.deleted += 1;
    });
    return counts;
  }, [inboxTemplates]);

  const activeTab = LIBRARY_TABS.find((t) => t.id === libraryTab) || LIBRARY_TABS[0];

  // ── Filtered + sorted list ──
  const displayedTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inboxTemplates.filter((t) => {
      if (t.status !== activeTab.status) return false;
      const matchSearch = q === '' || t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q);
      const matchCat = categoryFilter === 'All Categories' || t.category === categoryFilter;
      const matchDate = templateMatchesDateRange(t, dateFrom, dateTo);
      return matchSearch && matchCat && matchDate;
    });
    const createdTs = (t) => {
      const ts = new Date(templateCreatedAt(t)).getTime();
      return Number.isNaN(ts) ? 0 : ts;
    };
    const updatedTs = (t) => templateTimestamp(t);
    return [...filtered].sort((a, b) => {
      if (sortMode === 'alpha-asc') return a.name.localeCompare(b.name);
      if (sortMode === 'alpha-desc') return b.name.localeCompare(a.name);
      if (sortMode === 'updated-asc') return updatedTs(a) - updatedTs(b);
      if (sortMode === 'created-desc') return createdTs(b) - createdTs(a);
      if (sortMode === 'created-asc') return createdTs(a) - createdTs(b);
      if (sortMode === 'recent' || sortMode === 'updated-desc') return updatedTs(b) - updatedTs(a);
      return a.name.localeCompare(b.name);
    });
  }, [inboxTemplates, search, sortMode, categoryFilter, dateFrom, dateTo, activeTab.status]);

  const totalPages = Math.max(1, Math.ceil(displayedTemplates.length / TEMPLATE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const paginatedTemplates = useMemo(() => {
    const start = (currentPage - 1) * TEMPLATE_PAGE_SIZE;
    return displayedTemplates.slice(start, start + TEMPLATE_PAGE_SIZE);
  }, [displayedTemplates, currentPage]);

  const newSuggestions = useMemo(
    () => suggestions.filter((item) => item.kind === 'new'),
    [suggestions],
  );

  const revisionTemplateIds = useMemo(
    () => new Set(
      suggestions
        .filter((item) => item.kind === 'revision' && item.templateId)
        .map((item) => item.templateId),
    ),
    [suggestions],
  );

  const categoryGroups = useMemo(() => {
    if (libraryTab !== 'templates') return [];
    const q = search.trim().toLowerCase();
    const filteredSuggestions = newSuggestions.filter((item) => {
      const matchSearch = q === ''
        || item.suggestedName.toLowerCase().includes(q)
        || item.suggestedSubject.toLowerCase().includes(q);
      const matchCat = categoryFilter === 'All Categories'
        || intentToCategory(item.intent) === categoryFilter;
      return matchSearch && matchCat;
    });
    return groupTemplatesByCategory(displayedTemplates, filteredSuggestions);
  }, [displayedTemplates, libraryTab, newSuggestions, search, categoryFilter]);

  const pageStart = displayedTemplates.length === 0 ? 0 : (currentPage - 1) * TEMPLATE_PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * TEMPLATE_PAGE_SIZE, displayedTemplates.length);

  useLayoutEffect(() => {
    if (skipPageResetRef.current) {
      skipPageResetRef.current = false;
      return;
    }
    setPage(1);
  }, [libraryTab, inboxFilter, search, sortMode, categoryFilter, dateFrom, dateTo]);

  useLayoutEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [displayedTemplates.length, page, totalPages]);

  useLayoutEffect(() => {
    if (!templateIdFromUrl || templatesLoading) return;

    const targetInbox = inboxFromUrl || templates.find((row) => templateIdsMatch(row.id, templateIdFromUrl))?.inbox;
    applyingTemplateDeepLinkRef.current = true;

    if (targetInbox && targetInbox !== inboxFilter) {
      writeSelectedInbox(targetInbox);
      setInboxFilter(targetInbox);
      return;
    }

    if (!templates.length) {
      applyingTemplateDeepLinkRef.current = false;
      return;
    }

    const template = templates.find((row) => templateIdsMatch(row.id, templateIdFromUrl));
    if (!template) {
      applyingTemplateDeepLinkRef.current = false;
      return;
    }

    const targetTab = template.status === 'Draft'
      ? 'drafts'
      : template.status === 'Archived'
        ? 'deleted'
        : 'templates';

    if (consumedTemplateDeepLinkRef.current === templateIdFromUrl) {
      if (!templateIdsMatch(selectedIdRef.current, template.id)) {
        skipPageResetRef.current = true;
        skipSelectionResetRef.current = true;
        scrollDeepLinkRef.current = true;
        if (libraryTab !== targetTab) setLibraryTab(targetTab);
        setSelectedId(template.id);
        setEditForm({
          name: template.name,
          subject: template.subject,
          body: template.body,
          language: 'English',
        });
        setIsEditing(false);
        setIsCreatingNew(false);
      }
      applyingTemplateDeepLinkRef.current = false;
      return;
    }

    consumedTemplateDeepLinkRef.current = templateIdFromUrl;
    applyingTemplateDeepLinkRef.current = false;
    skipPageResetRef.current = true;
    skipSelectionResetRef.current = true;
    scrollDeepLinkRef.current = true;
    setLibraryTab(targetTab);
    setSelectedId(template.id);
    setEditForm({
      name: template.name,
      subject: template.subject,
      body: template.body,
      language: 'English',
    });
    setIsEditing(false);
    setIsCreatingNew(false);
  }, [templateIdFromUrl, inboxFromUrl, templates, templatesLoading, inboxFilter, libraryTab]);

  useLayoutEffect(() => {
    if (!templateIdFromUrl || templatesLoading || !templates.length) return;

    const target = templates.find((row) => templateIdsMatch(row.id, templateIdFromUrl));
    if (!target) return;

    const targetTab = target.status === 'Draft'
      ? 'drafts'
      : target.status === 'Archived'
        ? 'deleted'
        : 'templates';

    if (applyingTemplateDeepLinkRef.current) {
      if (libraryTab === targetTab) {
        skipSelectionResetRef.current = true;
        scrollDeepLinkRef.current = true;
        setSelectedId(target.id);
        setEditForm({
          name: target.name,
          subject: target.subject,
          body: target.body,
          language: 'English',
        });
        setIsEditing(false);
        setIsCreatingNew(false);
        applyingTemplateDeepLinkRef.current = false;
      }
      return;
    }

    if (libraryTab === targetTab && templateIdsMatch(selectedIdRef.current, templateIdFromUrl)) {
      return;
    }
  }, [libraryTab, inboxFilter, templateIdFromUrl, templates, templatesLoading]);

  useLayoutEffect(() => {
    if (!scrollDeepLinkRef.current || !templateIdFromUrl) return;
    const idx = displayedTemplates.findIndex((row) => templateIdsMatch(row.id, templateIdFromUrl));
    if (idx < 0) return;
    const targetPage = Math.floor(idx / TEMPLATE_PAGE_SIZE) + 1;
    if (targetPage !== page) setPage(targetPage);
  }, [templateIdFromUrl, displayedTemplates, page]);

  useEffect(() => {
    if (!scrollDeepLinkRef.current || !templateIdFromUrl || !selectedId) return;
    const row = document.querySelector('[data-template-selected="true"]');
    if (!row) return;
    scrollDeepLinkRef.current = false;
    row.scrollIntoView({ block: 'nearest' });
  }, [templateIdFromUrl, selectedId, libraryTab, inboxFilter, categoryGroups, paginatedTemplates]);

  const handleLibraryTabChange = (tab) => {
    if (tab === libraryTab) return;
    cancelFocusOutSave();
    void autoSaveEditsIfNeeded({ leaveSession: 'background' });
    setSelectedId(null);
    setEditForm(null);
    setIsEditing(false);
    setIsCreatingNew(false);
    setIsDirty(false);
    discardNewRef.current = false;
    draftAutoSaveIdRef.current = null;
    setLibraryTab(tab);
  };

  const handleInboxChange = (email) => {
    if (email === inboxFilter) return;
    writeSelectedInbox(email);
    void autoSaveEditsIfNeeded({ leaveSession: 'background' });
    setInboxFilter(email);
  };

  // ── Select a template ──
  const selectedTemplate = templates.find((t) => templateIdsMatch(t.id, selectedId)) || null;

  const handleSelectTemplate = (tmpl) => {
    cancelFocusOutSave();
    void autoSaveEditsIfNeeded({ leaveSession: 'background' });
    discardNewRef.current = false;
    draftAutoSaveIdRef.current = null;
    setIsCreatingNew(false);
    setIsDirty(false);
    setIsEditing(false);
    setSelectedId(tmpl.id);
    setEditForm({ name: tmpl.name, subject: tmpl.subject, body: tmpl.body, language: 'English' });
  };

  const handleStartEditing = (template = selectedTemplate) => {
    if (!template) return;
    setSelectedId(template.id);
    setIsEditing(true);
    setIsDirty(false);
    setIsCreatingNew(false);
    setEditForm({
      name: template.name,
      subject: template.subject,
      body: template.body,
      language: editForm?.language || 'English',
    });
  };

  const handleListEdit = (template) => {
    cancelFocusOutSave();
    void autoSaveEditsIfNeeded({ leaveSession: 'background' });
    handleStartEditing(template);
  };

  // ── Start creating a new template ──
  const handleNewTemplate = () => {
    if (!inboxFilter) {
      showToast('Select an inbox first.', 'error');
      return;
    }
    cancelFocusOutSave();
    void autoSaveEditsIfNeeded({ leaveSession: 'background' });
    discardNewRef.current = false;
    draftAutoSaveIdRef.current = null;
    setIsCreatingNew(true);
    setIsEditing(true);
    setSelectedId(null);
    setIsDirty(false);
    if (libraryTab === 'deleted') setLibraryTab('drafts');
    setEditForm({
      name: '',
      subject: '',
      body: DEFAULT_NEW_BODY,
      language: 'English',
      category: '',
      status: libraryTab === 'templates' ? 'Active' : 'Draft',
    });
    setIntentTypeTouched(false);
    setTemplateNameTouched(false);
    setTemplateSubjectTouched(false);
  };

  // ── Language switch ──
  const handleLanguageChange = (lang) => {
    if (!selectedTemplate) return;
    setEditForm((prev) => ({
      ...prev,
      language: lang,
      subject: translateSubject(selectedTemplate.subject, lang),
      body: translateBody(selectedTemplate.body, lang),
    }));
    setIsDirty(true);
  };

  const handlePreviewLanguageChange = (lang) => {
    if (!selectedTemplate) return;
    setEditForm((prev) => ({
      ...prev,
      language: lang,
      subject: translateSubject(selectedTemplate.subject, lang),
      body: translateBody(selectedTemplate.body, lang),
    }));
  };

  // ── Field change ──
  const handleFieldChange = (field, value) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  // ── Save (handles both create and update) ──
  const handleSave = async () => {
    if (!editForm) return;

    if (isCreatingNew) {
      const categoryError = validateIntentType(editForm.category);
      const nameError = validateTemplateName(editForm.name);
      const subjectError = validateTemplateSubject(editForm.subject);
      if (categoryError || nameError || subjectError) {
        setIntentTypeTouched(true);
        setTemplateNameTouched(true);
        setTemplateSubjectTouched(true);
        showToast(categoryError || nameError || subjectError, 'error');
        return;
      }
      const category = normalizeIntentType(editForm.category);
      try {
        const targetStatus = editForm.status || 'Active';
        let created;
        if (draftAutoSaveIdRef.current) {
          created = await updateTemplate(draftAutoSaveIdRef.current, {
            name: editForm.name.trim(),
            subject: editForm.subject.trim(),
            body: editForm.body,
            category,
            intent: null,
            status: targetStatus,
          });
          commitTemplates((prev) => prev.map((t) => (t.id === created.id ? created : t)));
        } else {
          created = await createTemplate({
            inbox: inboxFilter,
            name: editForm.name.trim(),
            subject: editForm.subject.trim(),
            body: editForm.body,
            category,
            status: targetStatus,
          });
          commitTemplates((prev) => [...prev, created]);
        }
        discardNewRef.current = true;
        draftAutoSaveIdRef.current = null;
        setSelectedId(created.id);
        setIsCreatingNew(false);
        setIsEditing(false);
        setIsDirty(false);
        setLibraryTab(created.status === 'Active' ? 'templates' : 'drafts');
        showToast(
          created.status === 'Active' ? 'Template created successfully.' : 'Draft saved.',
          'success',
        );
      } catch (err) {
        showToast(`Create failed: ${err.message}`, 'error');
      }
      return;
    }

    // Update existing — optimistic UI for instant feedback
    if (!selectedId || !selectedTemplate) return;
    const snapshot = templatesRef.current;
    const epoch = beginTemplateOp(selectedId);
    const optimisticUpdated = touchTemplate(selectedTemplate, {
      name: editForm.name,
      subject: editForm.subject,
      body: editForm.body,
    });

    commitTemplates((prev) => prev.map((t) => (t.id === selectedId ? optimisticUpdated : t)));
    setIsDirty(false);
    setIsEditing(false);
    if (optimisticUpdated.status === 'Active') setLibraryTab('templates');
    else if (optimisticUpdated.status === 'Draft') setLibraryTab('drafts');
    showToast('Template saved successfully.', 'success');

    try {
      const updated = await updateTemplate(selectedId, {
        name: editForm.name,
        subject: editForm.subject,
        body: editForm.body,
        category: selectedTemplate.category,
        intent: selectedTemplate.intent,
        status: selectedTemplate.status,
      });
      if (endTemplateOp(selectedId, epoch)) {
        commitTemplates((prev) => prev.map((t) => (t.id === selectedId ? updated : t)));
      }
    } catch (err) {
      if (endTemplateOp(selectedId, epoch)) {
        commitTemplates(() => snapshot);
        setEditForm({
          name: selectedTemplate.name,
          subject: selectedTemplate.subject,
          body: selectedTemplate.body,
          language: editForm.language || 'English',
        });
        setIsEditing(true);
        setIsDirty(true);
        showToast(`Save failed: ${err.message}`, 'error');
      }
    }
  };

  const handleSaveDraft = async () => {
    if (!editForm || !isCreatingNew) return;
    if (!hasDraftableNewContent(editForm)) {
      showToast('Add a name, subject, or edit the body before saving a draft.', 'error');
      return;
    }
    const categoryError = validateIntentType(editForm.category);
    const nameError = validateTemplateName(editForm.name);
    const subjectError = validateTemplateSubject(editForm.subject);
    if (categoryError || nameError || subjectError) {
      setIntentTypeTouched(true);
      setTemplateNameTouched(true);
      setTemplateSubjectTouched(true);
      showToast(categoryError || nameError || subjectError, 'error');
      return;
    }
    await persistNewDraft({
      ...editForm,
      name: editForm.name.trim(),
      subject: editForm.subject.trim(),
      category: normalizeIntentType(editForm.category),
    });
  };

  const handleDiscardNew = () => {
    discardNewRef.current = true;
    draftAutoSaveIdRef.current = null;
    resetNewTemplateSession();
  };

  // ── Cancel editing (existing templates only) ──
  const handleCancel = () => {
    if (isCreatingNew) {
      handleDiscardNew();
      return;
    }
    if (!selectedTemplate) return;
    setEditForm({
      name: selectedTemplate.name,
      subject: selectedTemplate.subject,
      body: selectedTemplate.body,
      language: 'English'
    });
    setIsDirty(false);
    setIsEditing(false);
  };

  const handleMobileBackToList = () => {
    if (isCreatingNew) {
      handleDiscardNew();
      return;
    }
    if (isEditing) {
      handleCancel();
    }
    setSelectedId(null);
  };

  const showMobileDetail = Boolean(selectedId || isCreatingNew);

  const clearSelectionIfNeeded = (targetId) => {
    if (selectedId === targetId) {
      setSelectedId(null);
      setEditForm(null);
      setIsDirty(false);
      setIsEditing(false);
    }
  };

  const openDeleteConfirm = (id, variant = 'active') => {
    const targetId = id || selectedId;
    if (!targetId) return;
    const template = templates.find((t) => t.id === targetId);
    setPendingDelete({
      id: targetId,
      variant,
      name: template?.name || 'this template',
    });
  };

  const confirmPendingDelete = () => {
    if (!pendingDelete) return;
    const { id, variant } = pendingDelete;
    setPendingDelete(null);
    if (variant === 'forever') void handleDeleteForever(id);
    else if (variant === 'draft') void handleDeleteDraft(id);
    else void handleDelete(id);
  };

  // ── Delete (soft) ──
  const handleDelete = async (id = selectedId) => {
    const targetId = id || selectedId;
    if (!targetId) return;
    const snapshot = templatesRef.current;
    const epoch = beginTemplateOp(targetId);
    commitTemplates((prev) =>
      prev.map((t) =>
        t.id === targetId
          ? touchTemplate(t, {
              status: 'Archived',
              archivedFrom: t.status === 'Draft' ? 'Draft' : 'Active',
            })
          : t,
      ),
    );
    clearSelectionIfNeeded(targetId);
    showToast('Template moved to Deleted.', 'success');
    try {
      const archived = await deleteTemplate(targetId);
      if (endTemplateOp(targetId, epoch)) {
        commitTemplates((prev) => prev.map((t) => (t.id === targetId ? archived : t)));
      }
    } catch (err) {
      if (endTemplateOp(targetId, epoch)) {
        commitTemplates(() => snapshot);
        showToast(`Delete failed: ${err.message}`, 'error');
      }
    }
  };

  const handleRestore = async (id = selectedId) => {
    const targetId = id || selectedId;
    if (!targetId) return;

    const target = templatesRef.current.find((t) => t.id === targetId);
    if (!target) return;

    const snapshot = templatesRef.current;
    const restoredStatus = target.archivedFrom === 'Draft' ? 'Draft' : 'Active';
    const epoch = beginTemplateOp(targetId);
    commitTemplates((prev) =>
      prev.map((t) =>
        t.id === targetId
          ? touchTemplate(t, { status: restoredStatus, archivedFrom: null })
          : t,
      ),
    );

    clearSelectionIfNeeded(targetId);
    showToast('Template restored.', 'success');

    try {
      const restored = await restoreTemplate(targetId);
      if (endTemplateOp(targetId, epoch)) {
        commitTemplates((prev) => prev.map((t) => (t.id === targetId ? restored : t)));
      }
    } catch (err) {
      if (endTemplateOp(targetId, epoch)) {
        commitTemplates(() => snapshot);
        showToast(`Restore failed: ${err.message}`, 'error');
      }
    }
  };

  const handleDeleteDraft = async (id = selectedId) => {
    const targetId = id || selectedId;
    if (!targetId) return;
    const snapshot = templatesRef.current;
    const epoch = beginTemplateOp(targetId);
    commitTemplates((prev) =>
      prev.map((t) =>
        t.id === targetId
          ? touchTemplate(t, { status: 'Archived', archivedFrom: 'Draft' })
          : t,
      ),
    );
    clearSelectionIfNeeded(targetId);
    showToast('Draft moved to Deleted.', 'success');
    try {
      const archived = await deleteTemplate(targetId);
      if (endTemplateOp(targetId, epoch)) {
        commitTemplates((prev) => prev.map((t) => (t.id === targetId ? archived : t)));
      }
    } catch (err) {
      if (endTemplateOp(targetId, epoch)) {
        commitTemplates(() => snapshot);
        showToast(`Delete failed: ${err.message}`, 'error');
      }
    }
  };

  const handleListDelete = (template) => {
    if (template.status === 'Draft') {
      openDeleteConfirm(template.id, 'draft');
      return;
    }
    if (template.status === 'Archived') {
      openDeleteConfirm(template.id, 'forever');
      return;
    }
    openDeleteConfirm(template.id, 'active');
  };

  const handleDeleteForever = async (id = selectedId) => {
    const targetId = id || selectedId;
    if (!targetId) return;
    const snapshot = templatesRef.current;
    const epoch = beginTemplateOp(targetId);
    commitTemplates((prev) => prev.filter((t) => t.id !== targetId));
    clearSelectionIfNeeded(targetId);
    showToast('Template permanently deleted.', 'success');
    try {
      await deleteTemplateForever(targetId);
      endTemplateOp(targetId, epoch);
    } catch (err) {
      if (endTemplateOp(targetId, epoch)) {
        commitTemplates(() => snapshot);
        showToast(`Delete failed: ${err.message}`, 'error');
      }
    }
  };

  const handlePublishDraft = async () => {
    if (!selectedId || !selectedTemplate || !editForm) return;
    const snapshot = templatesRef.current;
    const epoch = beginTemplateOp(selectedId);
    const optimisticPublished = touchTemplate(selectedTemplate, {
      name: editForm.name,
      subject: editForm.subject,
      body: editForm.body,
      status: 'Active',
    });

    commitTemplates((prev) => prev.map((t) => (t.id === selectedId ? optimisticPublished : t)));
    setIsDirty(false);
    setIsEditing(false);
    setLibraryTab('templates');
    showToast('Draft published as active template.', 'success');

    try {
      const updated = await updateTemplate(selectedId, {
        name: editForm.name,
        subject: editForm.subject,
        body: editForm.body,
        category: selectedTemplate.category,
        intent: selectedTemplate.intent,
        status: 'Active',
      });
      if (endTemplateOp(selectedId, epoch)) {
        commitTemplates((prev) => prev.map((t) => (t.id === selectedId ? updated : t)));
      }
    } catch (err) {
      if (endTemplateOp(selectedId, epoch)) {
        commitTemplates(() => snapshot);
        setLibraryTab('drafts');
        setIsEditing(true);
        setIsDirty(true);
        showToast(`Publish failed: ${err.message}`, 'error');
      }
    }
  };

  const renderTemplateList = () => {
    if (templatesLoading) {
      return (
        <div className="p-4">
          <CardListSkeleton rows={6} />
        </div>
      );
    }
    if (displayedTemplates.length === 0 && newSuggestions.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-white border border-[var(--color-border-default)] flex items-center justify-center mb-3 shadow-sm">
            <FileText className="w-6 h-6 text-[var(--color-text-muted)] opacity-50" />
          </div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">No {activeTab.label.toLowerCase()}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-[200px] leading-relaxed">
            {libraryTab === 'templates'
              ? 'Create a template with New Template above.'
              : 'Nothing here yet. Try another tab.'}
          </p>
        </div>
      );
    }
    if (libraryTab === 'templates') {
      return (
        <div className="py-3 space-y-4">
          {categoryGroups.map(({ category, items, suggestions: categorySuggestions }) => (
            <CategorySection
              key={category}
              category={category}
              items={items}
              suggestions={categorySuggestions}
              revisionTemplateIds={revisionTemplateIds}
              selectedId={selectedId}
              onSelect={handleSelectTemplate}
              onEdit={handleListEdit}
              onDelete={handleListDelete}
              suggestionBusyId={suggestionBusyId}
              onApproveSuggestion={handleApproveSuggestion}
              onRejectSuggestion={handleRejectSuggestion}
            />
          ))}
        </div>
      );
    }
    return (
      <div className="p-3">
        <div className="rounded-xl border border-[var(--color-border-default)] bg-white shadow-[0_1px_2px_rgba(26,26,46,0.04)] overflow-hidden">
          {paginatedTemplates.map((tmpl, index) => (
            <TemplateListItem
              key={tmpl.id}
              template={tmpl}
              tab={libraryTab}
              muted={libraryTab === 'deleted'}
              isSelected={templateIdsMatch(tmpl.id, selectedId)}
              onClick={() => handleSelectTemplate(tmpl)}
              onEdit={libraryTab === 'deleted' ? undefined : handleListEdit}
              onDelete={handleListDelete}
              onRestore={libraryTab === 'deleted' ? (t) => handleRestore(t.id) : undefined}
              inCard
              isLast={index === paginatedTemplates.length - 1}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`${adminPageShellClass} select-none`}>
      <Toast />

      <PageHeader
        section="Customer Support"
        title="Email templates"
        description="Create, edit, and preview AI templates."
        workspace
        actions={
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <div
              className="flex items-center gap-1.5 h-9 rounded-lg border border-[var(--color-brand-primary)]/25 bg-gradient-to-r from-[#f4f7fd] via-[#e9eff9] to-[#eef3fb] pl-2.5 pr-1 shadow-[0_1px_2px_rgba(26,26,46,0.04)]"
              title={inboxFilter}
            >
              <Mail className="w-3.5 h-3.5 text-[var(--color-brand-primary)] shrink-0" aria-hidden="true" />
              <SelectDropdown
                value={inboxFilter}
                onChange={handleInboxChange}
                options={accountOptions}
                size="xs"
                variant="soft"
                className="w-32 sm:w-36"
              />
            </div>
            <button
              type="button"
              onClick={handleNewTemplate}
              disabled={!inboxFilter || libraryTab === 'deleted' || inboxDisconnected}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer shrink-0 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              New Template
            </button>
          </div>
        }
      />

      <div className="flex flex-1 min-h-0 flex-col rounded-xl border border-[var(--color-border-default)] overflow-hidden shadow-sm bg-white">
        {!inboxDisconnected && (
          <TemplateSuggestionPanel
            suggestions={suggestions}
            templates={templates}
            busyId={suggestionBusyId}
            onApprove={handleApproveSuggestion}
            onReject={handleRejectSuggestion}
          />
        )}
        {inboxDisconnected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-12">
            <span className="flex items-center justify-center h-14 w-14 rounded-full bg-[var(--color-surface-highlight)] mb-5" aria-hidden="true">
              <Unlink className="w-6 h-6 text-[var(--color-text-secondary)]" />
            </span>
            <h2 className="text-base font-bold text-[var(--color-text-primary)] mb-1.5">
              {selectedInboxRow?.title} is disconnected
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-sm leading-relaxed mb-6">
              Templates for <span className="font-semibold text-[var(--color-text-primary)]">{selectedInboxRow?.email}</span> are
              hidden while the inbox is disconnected. Connect it again to manage its templates.
            </p>
            <button
              type="button"
              onClick={() => navigate('/email-accounts')}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer"
            >
              <Link2 className="w-4 h-4" aria-hidden="true" />
              Connect inbox
            </button>
          </div>
        ) : (
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">

        {/* ── LEFT PANE ─────────────────────────────────────────── */}
        <div className={`${showMobileDetail ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] shrink-0 flex-col border-b md:border-b-0 md:border-r border-[var(--color-border-default)] min-h-0 bg-[var(--color-surface-panel)]/35`}>

          <div className="shrink-0 bg-white border-b border-[var(--color-border-default)]">
            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[var(--color-text-primary)]">Library</h2>
                <p className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">
                  {activeInboxTitle || 'Select an inbox'}
                </p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <HoverTip label="Search templates">
                  <button
                    type="button"
                    onClick={() => { setSearchOpen((o) => !o); setFilterOpen(false); setSortOpen(false); }}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                      searchOpen || search.trim()
                        ? 'bg-[var(--color-surface-highlight-strong)] text-[var(--color-brand-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-highlight)]'
                    }`}
                    aria-label="Search templates"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </HoverTip>
                <HoverTip label="Filter templates">
                  <button
                    type="button"
                    onClick={() => { setFilterOpen((o) => !o); setSearchOpen(false); setSortOpen(false); }}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                      filterOpen || hasActiveFilters
                        ? 'bg-[var(--color-surface-highlight-strong)] text-[var(--color-brand-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-highlight)]'
                    }`}
                    aria-label="Filter templates"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </button>
                </HoverTip>
                <div className="relative" ref={sortRef}>
                  <HoverTip label="Sort templates">
                    <button
                      type="button"
                      onClick={() => { setSortOpen((o) => !o); setFilterOpen(false); setSearchOpen(false); }}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        sortOpen || sortMode !== 'created-desc'
                          ? 'bg-[var(--color-surface-highlight-strong)] text-[var(--color-brand-primary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-highlight)]'
                      }`}
                      aria-label="Sort templates"
                    >
                      <SortAsc className="w-4 h-4" />
                    </button>
                  </HoverTip>
                  {sortOpen && (
                    <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-48 py-1 bg-white rounded-xl border border-[var(--color-border-default)] shadow-[var(--shadow-modal)]">
                      {sortOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => { setSortMode(option.value); setSortOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-sm font-medium cursor-pointer ${
                            sortMode === option.value
                              ? 'bg-[var(--color-surface-highlight-strong)] text-[var(--color-brand-primary)]'
                              : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)]'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <LibraryTabs
              activeTab={libraryTab}
              counts={tabCounts}
              onChange={handleLibraryTabChange}
            />
          </div>

          {searchOpen && (
            <div className="shrink-0 px-4 py-3 border-b border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  placeholder="Search templates..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                  className="w-full pl-9 pr-8 py-2 bg-white border border-[var(--color-border-default)] rounded-lg text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-focus)]"
                />
                {search && (
                  <HoverTip label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2">
                    <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </HoverTip>
                )}
              </div>
            </div>
          )}

          {filterOpen && (
            <div className="shrink-0 px-4 py-3 border-b border-[var(--color-border-default)] space-y-2 bg-[var(--color-surface-panel)]/50">
              <SelectDropdown
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={categoryOptions}
                size="xs"
                className="w-full"
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
                    Created from
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-2.5 py-2 bg-white border border-[var(--color-border-default)] rounded-lg text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-focus)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
                    Created to
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-2.5 py-2 bg-white border border-[var(--color-border-default)] rounded-lg text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-focus)]"
                  />
                </div>
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setCategoryFilter('All Categories');
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="text-xs font-semibold text-[var(--color-brand-primary)] hover:underline cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* Scrollable template list */}
          <div
            id={`library-panel-${libraryTab}`}
            role="tabpanel"
            aria-labelledby={`library-tab-${libraryTab}`}
            className="flex-1 overflow-y-auto min-h-0"
          >
            {renderTemplateList()}
          </div>

          <div className="shrink-0 border-t border-[var(--color-border-default)] px-4 py-2 flex items-center justify-between gap-2 bg-white/90 backdrop-blur-sm">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">
              {activeTab.label}
            </span>
            {displayedTemplates.length > TEMPLATE_PAGE_SIZE ? (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-medium text-[var(--color-text-secondary)] tabular-nums whitespace-nowrap">
                  {pageStart}–{pageEnd} of {displayedTemplates.length}
                </span>
                <HoverTip label="Previous page">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="p-1 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-highlight)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </HoverTip>
                <HoverTip label="Next page">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="p-1 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-highlight)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </HoverTip>
              </div>
            ) : (
              <span className="text-[11px] font-medium text-[var(--color-text-secondary)] tabular-nums">
                {displayedTemplates.length} shown
              </span>
            )}
          </div>
        </div>

        {/* ── RIGHT PANE ────────────────────────────────────────── */}
        <div className={`${showMobileDetail ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-h-0 min-w-0 bg-white overflow-hidden md:border-l md:border-[var(--color-border-default)]`}>
          {!selectedTemplate && !isCreatingNew ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--color-text-muted)] p-8 text-center min-h-0">
              <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-highlight)] flex items-center justify-center">
                <FileText className="w-7 h-7 text-[var(--color-brand-primary)]/40" />
              </div>
              <div className="space-y-2 max-w-sm">
                <p className="text-sm font-bold text-[var(--color-text-primary)]">No template selected</p>
                <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  Click any template in the list on the left to preview its details here.
                  To start fresh, use <strong className="text-[var(--color-text-primary)]">New Template</strong> in the top right.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Detail header */}
              <div className="shrink-0 border-b border-[var(--color-border-default)] bg-white">
                <div className="px-4 py-3 sm:px-5 sm:py-3.5">
                  <button
                    type="button"
                    onClick={handleMobileBackToList}
                    className="mb-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-brand-primary)] transition-colors hover:bg-[var(--color-surface-highlight)] md:hidden"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Back to library
                  </button>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {isCreatingNew ? (
                        <TemplateModeBadge mode="creating" />
                      ) : isEditing ? (
                        <TemplateModeBadge mode="editing" />
                      ) : null}
                      {!isCreatingNew && selectedTemplate && (
                        <>
                          {libraryTab === 'deleted' && selectedTemplate.archivedFrom === 'Draft' ? (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold leading-none bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100">
                              Deleted draft
                            </span>
                          ) : libraryTab === 'deleted' ? (
                            <TemplateStatusChip status={selectedTemplate.status} label="Deleted template" />
                          ) : selectedTemplate.status !== 'Active' ? (
                            <TemplateStatusChip status={selectedTemplate.status} />
                          ) : null}
                        </>
                      )}
                      {isDirty && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                          Unsaved
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0" data-template-toolbar>
                      {libraryTab === 'deleted' && selectedTemplate && (
                        <>
                          <TemplateToolbarButton variant="restore" icon={RotateCcw} label="Restore" onClick={() => handleRestore()} />
                          <TemplateToolbarButton variant="deleteForever" icon={Trash2} label="Delete forever" onClick={() => openDeleteConfirm(selectedId, 'forever')} />
                        </>
                      )}
                      {libraryTab !== 'deleted' && !isCreatingNew && !isEditing && (
                        <>
                          <TemplateToolbarButton
                            variant="delete"
                            icon={Trash2}
                            label="Delete"
                            onClick={() => openDeleteConfirm(selectedId, libraryTab === 'drafts' ? 'draft' : 'active')}
                          />
                          <TemplateToolbarButton variant="save" icon={Pencil} label="Edit" onClick={() => handleStartEditing()} />
                        </>
                      )}
                      {isCreatingNew && (
                        <>
                          <TemplateToolbarButton variant="saveDraft" icon={Save} label="Save draft" onClick={handleSaveDraft} />
                          {editForm?.status === 'Active' && (
                            <TemplateToolbarButton variant="save" icon={Save} label="Create template" onClick={handleSave} className="min-w-36" />
                          )}
                          <TemplateToolbarButton variant="discardIcon" icon={X} label="Discard" onClick={handleDiscardNew} />
                        </>
                      )}
                      {isEditing && !isCreatingNew && libraryTab !== 'deleted' && (
                        <>
                          <TemplateToolbarButton
                            variant="delete"
                            icon={Trash2}
                            label="Delete"
                            onClick={() => openDeleteConfirm(selectedId, libraryTab === 'drafts' ? 'draft' : 'active')}
                          />
                          {libraryTab === 'drafts' && (
                            <TemplateToolbarButton variant="publish" icon={Save} label="Publish" onClick={handlePublishDraft} />
                          )}
                          <TemplateToolbarButton
                            variant="save"
                            icon={Save}
                            label={libraryTab === 'drafts' ? 'Save draft' : 'Save'}
                            onClick={handleSave}
                          />
                          <TemplateToolbarButton variant="cancelIcon" icon={X} label="Cancel" onClick={handleCancel} />
                        </>
                      )}
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-[var(--color-text-primary)] leading-snug">
                    {isCreatingNew
                      ? (editForm?.name?.trim() || 'Untitled template')
                      : (editForm?.name || selectedTemplate.name)}
                  </h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--color-text-muted)] font-medium">
                    <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    {isCreatingNew ? (
                      'Not saved yet'
                    ) : (
                      <>
                        <span>Created {fmtUpdated(templateCreatedAt(selectedTemplate))}</span>
                        {templateWasEdited(selectedTemplate) && (
                          <>
                            <span className="text-[var(--color-border-default)]" aria-hidden="true">·</span>
                            <span>Updated {fmtUpdated(selectedTemplate.lastUpdated)}</span>
                          </>
                        )}
                      </>
                    )}
                    {!isCreatingNew && selectedTemplate?.category && (
                      <>
                        <span className="text-[var(--color-border-default)]" aria-hidden="true">·</span>
                        <span>{selectedTemplate.category}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Detail body */}
              <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full border-t border-[var(--color-border-default)]/60">
                {!(isEditing || isCreatingNew) ? (
                  <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
                    <div className="space-y-5">
                      {libraryTab === 'deleted' && (
                        <div
                          role="status"
                          className="rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-xs text-amber-900 leading-relaxed"
                        >
                          This template is in Deleted. Restore it to use again, or delete forever to remove it permanently.
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label htmlFor="preview-language" className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                          Translation / Language
                        </label>
                        <div className="relative max-w-xs">
                          <select
                            id="preview-language"
                            value={editForm?.language || 'English'}
                            onChange={(e) => handlePreviewLanguageChange(e.target.value)}
                            className={`${TEMPLATE_FIELD_INPUT} appearance-none pr-8 cursor-pointer font-medium`}
                          >
                            {['English', 'German', 'Spanish', 'Japanese'].map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)] pointer-events-none" aria-hidden="true" />
                        </div>
                      </div>

                      <TemplateReadonlyField label="Template Name">
                        {editForm?.name || ''}
                      </TemplateReadonlyField>

                      <TemplateReadonlyField label="Email Subject">
                        {editForm?.subject || ''}
                      </TemplateReadonlyField>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                          Email Body
                        </label>
                        <pre className={`${TEMPLATE_FIELD_READONLY} min-h-[12rem] px-4 py-3 font-sans leading-relaxed whitespace-pre-wrap break-words overflow-y-auto`}>
                          {editForm?.body || ''}
                        </pre>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className="flex-1 min-h-0 overflow-y-auto px-5 py-5"
                    data-template-editor
                    onBlur={handleEditorFocusOut}
                  >
                    <div className="space-y-5">
                      {isCreatingNew && (
                        <p className="text-xs text-[var(--color-text-muted)] leading-relaxed rounded-lg border border-[var(--color-border-default)]/80 bg-white px-3 py-2.5">
                          Drafts save automatically when you click elsewhere, switch tabs, or select another template after filling in name, subject, or body.
                          Click{' '}
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded border border-[var(--color-border-default)] align-[-2px] text-[var(--color-text-secondary)]"
                            aria-label="Discard"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </span>
                          {' '}to leave without saving.
                        </p>
                      )}

                      <section
                        aria-labelledby="template-details-heading"
                        className="rounded-xl border border-[var(--color-border-default)] bg-white p-4 shadow-[0_1px_2px_rgba(26,26,46,0.04)] space-y-4"
                      >
                        <h4 id="template-details-heading" className="text-xs font-bold text-[var(--color-text-secondary)]">
                          Details
                        </h4>

                        {isCreatingNew ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5 min-w-0">
                              <TemplateFieldLabel
                                htmlFor="template-intent-type"
                                hint="e.g. Membership, Payments, Events"
                              >
                                Intent type
                              </TemplateFieldLabel>
                              <input
                                id="template-intent-type"
                                type="text"
                                required
                                maxLength={INTENT_TYPE_MAX_LENGTH}
                                value={editForm?.category || ''}
                                onChange={(e) => handleFieldChange('category', e.target.value)}
                                onBlur={() => setIntentTypeTouched(true)}
                                aria-invalid={intentTypeError ? true : undefined}
                                className={`${TEMPLATE_FIELD_INPUT} w-full ${
                                  intentTypeError
                                    ? 'border-red-500 focus:border-red-500 focus:ring-red-100'
                                    : ''
                                }`}
                                placeholder="e.g. Membership"
                                autoComplete="off"
                              />
                              {intentTypeError && (
                                <p className="text-[11px] text-red-600">{intentTypeError}</p>
                              )}
                            </div>
                            <div className="space-y-1.5 min-w-0">
                              <TemplateFieldLabel
                                htmlFor="template-name"
                                hint="e.g. Enquiry reply, Renewal reminder"
                              >
                                Template name
                              </TemplateFieldLabel>
                              <input
                                id="template-name"
                                type="text"
                                required
                                maxLength={TEMPLATE_NAME_MAX_LENGTH}
                                value={editForm?.name || ''}
                                onChange={(e) => handleFieldChange('name', e.target.value)}
                                onBlur={() => setTemplateNameTouched(true)}
                                aria-invalid={templateNameError ? true : undefined}
                                className={`${TEMPLATE_FIELD_INPUT} w-full ${
                                  templateNameError
                                    ? 'border-red-500 focus:border-red-500 focus:ring-red-100'
                                    : ''
                                }`}
                                placeholder="e.g. Membership enquiry"
                                autoComplete="off"
                              />
                              {templateNameError && (
                                <p className="text-[11px] text-red-600">{templateNameError}</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <TemplateFieldLabel
                              htmlFor="template-name"
                              hint="e.g. Enquiry reply, Renewal reminder"
                            >
                              Template name
                            </TemplateFieldLabel>
                            <input
                              id="template-name"
                              type="text"
                              value={editForm?.name || ''}
                              onChange={(e) => handleFieldChange('name', e.target.value)}
                              className={TEMPLATE_FIELD_INPUT}
                              placeholder="e.g. Membership enquiry"
                            />
                          </div>
                        )}

                        {!isCreatingNew && (
                          <div className="space-y-1.5">
                            <TemplateFieldLabel
                              htmlFor="template-language"
                              hint="Switching language swaps subject and body with translated mock content."
                            >
                              Language
                            </TemplateFieldLabel>
                            <div className="relative max-w-xs">
                              <select
                                id="template-language"
                                value={editForm?.language || 'English'}
                                onChange={(e) => handleLanguageChange(e.target.value)}
                                className={`${TEMPLATE_FIELD_INPUT} appearance-none pr-8 cursor-pointer font-medium`}
                              >
                                {['English', 'German', 'Spanish', 'Japanese'].map((l) => (
                                  <option key={l} value={l}>{l}</option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)] pointer-events-none" aria-hidden="true" />
                            </div>
                          </div>
                        )}
                      </section>

                      <section
                        aria-labelledby="template-email-heading"
                        className="rounded-xl border border-[var(--color-border-default)] bg-white p-4 shadow-[0_1px_2px_rgba(26,26,46,0.04)] space-y-4"
                      >
                        <h4 id="template-email-heading" className="text-xs font-bold text-[var(--color-text-secondary)]">
                          Email content
                        </h4>

                        <div className="space-y-1.5">
                          <TemplateFieldLabel htmlFor="template-subject">Template subject line</TemplateFieldLabel>
                          <input
                            id="template-subject"
                            type="text"
                            required
                            maxLength={TEMPLATE_SUBJECT_MAX_LENGTH}
                            value={editForm?.subject || ''}
                            onChange={(e) => handleFieldChange('subject', e.target.value)}
                            onBlur={() => setTemplateSubjectTouched(true)}
                            aria-invalid={templateSubjectError ? true : undefined}
                            className={`${TEMPLATE_FIELD_INPUT} ${
                              templateSubjectError
                                ? 'border-red-500 focus:border-red-500 focus:ring-red-100'
                                : ''
                            }`}
                            placeholder="Re: Your enquiry"
                            autoComplete="off"
                          />
                          {templateSubjectError && (
                            <p className="text-[11px] text-red-600">{templateSubjectError}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <TemplateFieldLabel htmlFor="template-body">Body</TemplateFieldLabel>
                            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insert template variables">
                              {['{{first_name}}', '{{club_name}}', '{{membership_type}}'].map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => handleFieldChange('body', `${editForm?.body || ''}${v}`)}
                                  className="px-2 py-1 rounded-md text-[10px] font-bold font-mono bg-[var(--color-surface-highlight)] text-[var(--color-text-secondary)] hover:bg-[var(--color-brand-primary)]/10 hover:text-[var(--color-brand-primary)] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/25"
                                >
                                  {v}
                                </button>
                              ))}
                            </div>
                          </div>
                          <textarea
                            id="template-body"
                            value={editForm?.body || ''}
                            onChange={(e) => handleFieldChange('body', e.target.value)}
                            rows={14}
                            className={`${TEMPLATE_FIELD_INPUT} resize-y font-mono leading-relaxed bg-[var(--color-surface-panel)]/30`}
                            placeholder="Hi {{first_name}},&#10;&#10;&#10;&#10;Kind regards,&#10;Power Music Team"
                          />
                          <p className="text-[11px] text-[var(--color-text-muted)]">
                            Click a variable chip to append it to the body, or type placeholders manually.
                          </p>
                        </div>
                      </section>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        </div>
        )}
      </div>

      <Modal
        isOpen={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        confirm
        title={pendingDelete?.variant === 'forever' ? 'Delete template forever' : 'Delete template'}
        footer={(
          <>
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium text-[var(--color-text-primary)] hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmPendingDelete}
              className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer"
            >
              Delete template
            </button>
          </>
        )}
      >
        <p>
          {pendingDelete?.variant === 'forever' ? (
            <>
              Permanently delete <strong>{pendingDelete?.name}</strong>? This cannot be undone.
            </>
          ) : (
            <>
              Move <strong>{pendingDelete?.name}</strong> to Deleted?
            </>
          )}
        </p>
      </Modal>
    </div>
  );
}
