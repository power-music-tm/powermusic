import test from 'node:test';
import assert from 'node:assert/strict';

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => store.clear(),
  };
}

globalThis.sessionStorage = memoryStorage();
globalThis.localStorage = memoryStorage();
globalThis.CustomEvent = class CustomEvent {
  constructor(type) {
    this.type = type;
  }
};
globalThis.window = {
  // Unref so a never-answered GET's 45s abort timer cannot keep a failing run alive.
  setTimeout: (...args) => {
    const timer = globalThis.setTimeout(...args);
    timer.unref?.();
    return timer;
  },
  clearTimeout: (...args) => globalThis.clearTimeout(...args),
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

/** Each /page GET waits until the test answers it — lets us force any interleaving. */
const pendingGets = [];
globalThis.fetch = (url) => new Promise((resolve) => {
  pendingGets.push({
    url: String(url),
    respond: (requestIds) => resolve({
      ok: true,
      status: 200,
      json: async () => ({ requests: requestIds.map((id) => ({ id })), persons: [] }),
    }),
  });
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { beginCacheMutation } = await import('../src/utils/pilot2Api.js');
const {
  fetchRequestsPage,
  requestsPageCacheKey,
  scheduleRequestsPageRefetch,
  subscribeRequestsPage,
} = await import('../src/utils/requestsPageStore.js');
const {
  syncPendingRequestIdsForBadge,
  removePendingRequestIdsFromBadge,
  countUnopenedNewRequests,
} = await import('../src/utils/adminUiHighlights.js');

function recordSnapshots(partnerId) {
  const snapshots = [];
  const stop = subscribeRequestsPage(({ partnerId: forPartner, data }) => {
    if (forPartner === partnerId) snapshots.push(data.requests.map((r) => r.id));
  });
  return { snapshots, stop };
}

async function answerNext(requestIds) {
  await flush();
  const get = pendingGets.shift();
  assert.ok(get, 'expected a pending /page GET');
  get.respond(requestIds);
  await flush();
  await flush();
}

test('a GET that resolves while a delete is in flight never repaints the deleted row', { timeout: 3000 }, async () => {
  pendingGets.length = 0;
  const { snapshots, stop } = recordSnapshots('gym-a');

  const inFlight = fetchRequestsPage('gym-a');
  const settle = beginCacheMutation(requestsPageCacheKey('gym-a'));
  await answerNext(['req-1', 'req-deleted']);
  await inFlight;
  assert.deepEqual(snapshots, []);

  settle();
  const after = fetchRequestsPage('gym-a');
  await answerNext(['req-1']);
  await after;
  assert.deepEqual(snapshots, [['req-1']]);
  stop();
});

test('a GET that started inside the mutation window is refetched after the server commits', { timeout: 3000 }, async () => {
  pendingGets.length = 0;
  const { snapshots, stop } = recordSnapshots('gym-b');

  const settle = beginCacheMutation(requestsPageCacheKey('gym-b'));
  const inFlight = fetchRequestsPage('gym-b');
  settle();
  await answerNext(['req-1', 'req-deleted']);
  await answerNext(['req-1']);
  await inFlight;
  assert.deepEqual(snapshots, [['req-1']]);
  stop();
});

test('a realtime nudge never reuses a GET that started before the new request was saved', { timeout: 3000 }, async () => {
  pendingGets.length = 0;
  const { snapshots, stop } = recordSnapshots('gym-c');

  const beforeArrival = fetchRequestsPage('gym-c');
  const afterNudge = fetchRequestsPage('gym-c', { invalidate: true });
  await flush();
  assert.equal(pendingGets.length, 2, 'nudge must start its own GET');

  const [oldGet, freshGet] = pendingGets.splice(0, 2);
  freshGet.respond(['req-1', 'req-new']);
  await flush();
  oldGet.respond(['req-1']);
  await flush();
  await answerNext(['req-1', 'req-new']);
  await Promise.all([beforeArrival, afterNudge]);

  assert.ok(snapshots.length > 0);
  for (const ids of snapshots) {
    assert.ok(ids.includes('req-new'), `snapshot regressed to ${JSON.stringify(ids)}`);
  }
  stop();
});

test('a burst of realtime + focus + poll triggers becomes one GET', { timeout: 3000 }, async () => {
  pendingGets.length = 0;
  scheduleRequestsPageRefetch('gym-d');
  scheduleRequestsPageRefetch('gym-d', { invalidate: true });
  scheduleRequestsPageRefetch('gym-d', { minAgeMs: 4000 });
  scheduleRequestsPageRefetch('gym-d');
  await wait(200);
  assert.equal(pendingGets.length, 1);
  await answerNext(['req-1']);
});

test('a poll right after a fresh GET is skipped', { timeout: 3000 }, async () => {
  pendingGets.length = 0;
  const done = fetchRequestsPage('gym-e');
  await answerNext(['req-1']);
  await done;

  scheduleRequestsPageRefetch('gym-e', { minAgeMs: 4000 });
  await wait(200);
  assert.equal(pendingGets.length, 0);
});

test('a local delete does not block a newer list GET from adding new arrivals to the badge', () => {
  sessionStorage.clear();
  syncPendingRequestIdsForBadge(['req-A', 'req-B'], { fetchedAt: 1000 });
  removePendingRequestIdsFromBadge(['req-B']);
  assert.equal(countUnopenedNewRequests(), 1);

  syncPendingRequestIdsForBadge(['req-A', 'req-C'], { fetchedAt: 2000 });
  assert.equal(countUnopenedNewRequests(), 2);
});
