/** List URL for New Requests, optionally scoped to Add / Remove tab. */
export function newRequestsListPath(actionTab) {
  if (actionTab === 'Add' || actionTab === 'Remove') {
    return `/new-requests?action=${encodeURIComponent(actionTab)}`;
  }
  return '/new-requests';
}

/** Safe back target under /new-requests (list with query, or another request/group). */
export function safeNewRequestsBackPath(from) {
  if (typeof from !== 'string') return '/new-requests';
  if (!from.startsWith('/new-requests')) return '/new-requests';
  if (from.includes('://') || from.includes('//')) return '/new-requests';
  return from;
}

export function isNewRequestsListPath(path) {
  if (typeof path !== 'string') return false;
  const bare = path.split('?')[0];
  return bare === '/new-requests';
}

/** Read Add | Remove | All from ?action= on the list URL. */
export function actionTabFromSearchParams(searchParams) {
  const action = searchParams?.get?.('action');
  if (action === 'Add' || action === 'Remove') return action;
  return 'All';
}
