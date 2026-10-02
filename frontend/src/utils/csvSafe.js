/** Block CSV/spreadsheet formula injection when exporting user data. */
export function csvCell(value) {
  const text = value == null ? '' : String(value);
  const escaped = text.replace(/"/g, '""');
  if (escaped && /^[=+\-@\t\r]/.test(escaped)) {
    return `"'${escaped}"`;
  }
  return `"${escaped}"`;
}
