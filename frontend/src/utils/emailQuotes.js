/**
 * Strip quoted reply chains so previews show only what the sender newly wrote.
 * Covers Gmail ("On … wrote:"), Outlook separators, and `>` quote lines.
 */
export function stripQuotedReply(text) {
  if (!text) return '';

  let content = text.replace(/\r\n/g, '\n').trim();
  if (!content) return '';

  // Same-line Gmail: "Please cancel. On Thu, 9 Jul … wrote:"
  const inlineWrote = content.match(/\s+On .{5,400} wrote:/i);
  if (inlineWrote && inlineWrote.index > 0) {
    const trimmed = content.slice(0, inlineWrote.index).trim();
    if (trimmed) return trimmed;
  }

  const lines = content.split('\n');
  const kept = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^On .{5,400} wrote:\s*$/i.test(trimmed)) break;

    const inlineOnWrote = trimmed.match(/^(.+?)\s+On .{5,400} wrote:\s*$/i);
    if (inlineOnWrote) {
      kept.push(inlineOnWrote[1].trim());
      break;
    }
    if (/^On .{5,400} wrote:/i.test(trimmed)) {
      const before = trimmed.replace(/\s+On .{5,400} wrote:[\s\S]*$/i, '').trim();
      if (before) kept.push(before);
      break;
    }

    if (/^-{5,}\s*(Original Message|Forwarded message)\s*-{5,}$/i.test(trimmed)) break;
    if (/^>{1,}/.test(trimmed)) break;
    if (i > 0 && /^From:\s/i.test(trimmed)) break;

    kept.push(line);
  }

  return kept.join('\n').trim();
}

export function messagePreviewText(body, { maxLength = 80 } = {}) {
  const stripped = stripQuotedReply(body);
  const line = stripped.replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > maxLength ? `${line.slice(0, maxLength)}...` : line;
}
