import { useMemo } from 'react';
import DOMPurify from 'dompurify';

// Email HTML is untrusted, so every render goes through DOMPurify. We drop
// scripts/handlers, force all links to open in a new tab with noopener, and
// strip anything that could phone home or execute. When there's no HTML body
// the caller falls back to the plain-text body.
const PURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
  ALLOW_DATA_ATTR: false,
};

if (typeof window !== 'undefined') {
  // Harden links: external targets open safely, and javascript: URLs are
  // already stripped by DOMPurify's URI policy.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    // Block remote images by default would go here; we allow them so the
    // message renders as sent, matching Gmail's "images shown" default.
  });
}

export default function SafeHtml({ html, className = '' }) {
  const clean = useMemo(() => {
    if (!html) return '';
    return DOMPurify.sanitize(html, PURIFY_CONFIG);
  }, [html]);

  if (!clean) return null;

  return (
    <div
      className={`email-html-body break-words ${className}`.trim()}
      // Sanitized above; this is the standard DOMPurify usage pattern.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
