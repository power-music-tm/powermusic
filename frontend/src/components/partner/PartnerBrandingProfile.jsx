import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, Eye, Link2, Loader2, Pencil } from 'lucide-react';
import ManagerFormPreview, { PreviewFormActionToggle } from './ManagerFormPreview';

function partnerInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'P';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function ProfileAvatar({ name, logoDataUrl, sizeClass = 'h-20 w-20 sm:h-24 sm:w-24' }) {
  const [displayUrl, setDisplayUrl] = useState(null);

  useEffect(() => {
    if (!logoDataUrl) {
      setDisplayUrl(null);
      return undefined;
    }

    let active = true;
    const img = new Image();
    img.onload = () => {
      if (active) setDisplayUrl(logoDataUrl);
    };
    img.onerror = () => {
      if (active) setDisplayUrl(null);
    };
    img.src = logoDataUrl;
    if (img.complete) setDisplayUrl(logoDataUrl);

    return () => {
      active = false;
    };
  }, [logoDataUrl]);

  const showLogo = Boolean(displayUrl && logoDataUrl && displayUrl === logoDataUrl);

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ring-2 ring-white shadow-[0_4px_20px_rgba(26,26,46,0.12)] ${
        showLogo
          ? 'bg-[var(--color-surface-panel)]'
          : 'bg-gradient-to-br from-[var(--color-brand-primary)]/10 to-[var(--color-brand-accent)]/10'
      } ${sizeClass}`}
    >
      {!showLogo ? (
        <span className="flex h-full w-full items-center justify-center text-lg font-bold text-[var(--color-brand-primary)] sm:text-xl">
          {partnerInitials(name)}
        </span>
      ) : (
        <img
          src={displayUrl}
          alt=""
          loading="eager"
          decoding="sync"
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      )}
    </div>
  );
}

function ActionButton({ children, onClick, disabled, primary = false, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? 'bg-[var(--color-brand-primary)] text-white hover:bg-[var(--color-surface-sidebar-hover)]'
          : 'bg-[var(--color-surface-panel)] text-[var(--color-text-primary)] ring-1 ring-[var(--color-border-default)] hover:bg-[var(--color-surface-highlight)]'
      } ${className}`.trim()}
    >
      {children}
    </button>
  );
}

/**
 * Instagram-inspired partner profile: view mode with edit / copy / preview actions.
 */
export default function PartnerBrandingProfile({
  partnerName,
  logoDataUrl,
  formUrl,
  formUrlCopied,
  onCopyFormUrl,
  previewing,
  previewAction,
  onPreviewActionChange,
  onStartPreview,
  onCancelPreview,
  editing,
  onStartEdit,
  onCancelEdit,
  nameDraft,
  onNameDraftChange,
  onSaveProfile,
  profileSaving,
  profileDirty,
  onLogoUpload,
  onAdjustLogoCrop,
  onRemoveLogo,
  logoInputRef,
  disabled = false,
  fieldClass,
}) {
  const displayName = partnerName || 'Partner';
  const nameDirty = nameDraft.trim() !== (partnerName || '');
  const [nameEditing, setNameEditing] = useState(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (!editing) setNameEditing(false);
  }, [editing]);

  useEffect(() => {
    if (nameEditing) nameInputRef.current?.focus();
  }, [nameEditing]);

  if (previewing) {
    return (
      <div className="divide-y divide-[var(--color-border-default)]/70">
        <div className="px-5 py-5 sm:px-8">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[var(--color-border-default)]/70 pb-4">
            <div className="justify-self-start">
              <ActionButton onClick={onCancelPreview} className="flex-none px-4">
                Back
              </ActionButton>
            </div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Form preview</p>
            <div className="justify-self-end" aria-hidden="true" />
          </div>

          <div className="mb-5 mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-secondary)]">
                How managers see the {displayName} submission form
              </p>
            </div>
            <PreviewFormActionToggle action={previewAction} onChange={onPreviewActionChange} />
          </div>

          <ManagerFormPreview
            partnerName={displayName}
            logoDataUrl={logoDataUrl}
            action={previewAction}
          />
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="divide-y divide-[var(--color-border-default)]/70">
        <div className="px-5 py-5 sm:px-8">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[var(--color-border-default)]/70 pb-4">
            <div className="justify-self-start">
              <ActionButton onClick={onCancelEdit} disabled={profileSaving} className="flex-none px-4">
                Cancel
              </ActionButton>
            </div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Edit profile</p>
            <div className="justify-self-end">
              <ActionButton
                primary
                onClick={onSaveProfile}
                disabled={profileSaving || !profileDirty || disabled}
                className="flex-none px-4"
              >
                {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {profileSaving ? 'Saving…' : 'Save'}
              </ActionButton>
            </div>
          </div>

          <div className="mx-auto flex max-w-sm flex-col items-center pt-6 text-center">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={disabled}
              className="group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/30"
            >
              <ProfileAvatar
                name={nameDraft || displayName}
                logoDataUrl={logoDataUrl}
                sizeClass="h-28 w-28"
              />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Camera className="h-7 w-7 text-white" aria-hidden="true" />
              </span>
              <span className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-brand-primary)] text-white shadow-md ring-2 ring-white">
                <Camera className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="sr-only">Change profile photo</span>
            </button>

            <div className="mt-4 flex items-center justify-center gap-4 text-sm font-semibold">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={disabled}
                className="text-[var(--color-brand-primary)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Change
              </button>
              {logoDataUrl ? (
                <>
                  <span className="h-3.5 w-px bg-[var(--color-border-default)]" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={onAdjustLogoCrop}
                    disabled={disabled}
                    className="text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Adjust
                  </button>
                  <span className="h-3.5 w-px bg-[var(--color-border-default)]" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={onRemoveLogo}
                    disabled={disabled}
                    className="text-[var(--color-status-danger,#dc2626)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </div>

            <div className="mt-7 w-full">
              {nameEditing ? (
                <input
                  ref={nameInputRef}
                  id="partner-name"
                  type="text"
                  value={nameDraft}
                  onChange={(event) => onNameDraftChange(event.target.value)}
                  onBlur={() => {
                    if (!nameDirty) setNameEditing(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && profileDirty && !profileSaving) {
                      event.preventDefault();
                      onSaveProfile();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setNameEditing(false);
                    }
                  }}
                  placeholder="Partner name"
                  disabled={disabled || profileSaving}
                  className={`${fieldClass} text-center`}
                  aria-label="Partner name"
                />
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span className="truncate text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
                    {nameDraft.trim() || displayName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setNameEditing(true)}
                    disabled={disabled || profileSaving}
                    className="shrink-0 rounded-md p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-highlight)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Edit name"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={onLogoUpload} />
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--color-border-default)]/70">
      <div className="px-5 py-7 sm:px-8 sm:py-8">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
          <ProfileAvatar
            name={displayName}
            logoDataUrl={logoDataUrl}
            sizeClass="h-24 w-24 sm:h-28 sm:w-28"
          />

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h2 className="truncate text-xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-2xl">
              {displayName}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              Manager Portal · Power Music Partner Form
            </p>
          </div>

          <div className="flex w-full shrink-0 gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            <ActionButton primary onClick={onStartEdit} disabled={disabled} className="sm:flex-none sm:px-4">
              Edit profile
            </ActionButton>
            <ActionButton onClick={onStartPreview} disabled={disabled} className="sm:flex-none sm:px-4">
              <Eye className="h-4 w-4" aria-hidden="true" />
              Preview Form
            </ActionButton>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-panel)] text-[var(--color-text-muted)] ring-1 ring-[var(--color-border-default)]">
            <Link2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Partner sign-in link
            </p>
            <button
              type="button"
              onClick={onCopyFormUrl}
              disabled={!formUrl}
              className="group mt-1.5 flex w-full items-center gap-2 rounded-xl bg-[var(--color-surface-panel)]/80 px-3 py-2.5 text-left ring-1 ring-[var(--color-border-default)] transition-colors hover:bg-[var(--color-surface-highlight)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 break-all text-sm text-[var(--color-text-primary)]">
                {formUrl || 'Save a partner name to generate the link.'}
              </span>
              <span className="shrink-0 text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-brand-primary)]">
                {formUrlCopied ? (
                  <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              Share this link with managers so they can sign in and submit add/remove requests.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
