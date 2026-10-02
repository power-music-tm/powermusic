export function formatRequestDisplayId(displayId) {
  if (!displayId) return '-';
  return `R-${String(displayId).padStart(2, '0')}`;
}

export {
  formatAdminDateTime,
  formatAdminDate,
} from './dateTime';
