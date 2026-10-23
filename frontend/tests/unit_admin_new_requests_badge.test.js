import test from 'node:test';
import assert from 'node:assert/strict';

/** Minimal sessionStorage so badge helpers can run under node:test. */
function installSessionStorage() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => store.clear(),
  };
  return store;
}

installSessionStorage();

/** CustomEvent + window listeners so notify*BadgeChanged can fire under node. */
function installWindowEvents() {
  const listeners = new Map();
  globalThis.CustomEvent = class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.window = {
    dispatchEvent: (event) => {
      const type = event?.type;
      for (const fn of listeners.get(type) || []) fn(event);
      return true;
    },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
  };
}

installWindowEvents();

const {
  syncPendingRequestIdsForBadge,
  removePendingRequestIdsFromBadge,
  addPendingRequestIdsToBadge,
  countUnopenedNewRequests,
  markRequestsViewed,
  removeRequestHighlight,
  countUnopenedDirectoryPeople,
  markDirectoryPersonHighlight,
  markDirectoryPersonViewed,
  pruneDirectoryHighlightsToActiveEmails,
  ADMIN_NEW_REQUESTS_BADGE_EVENT,
  ADMIN_DIRECTORY_BADGE_EVENT,
} = await import('../src/utils/adminUiHighlights.js');

const { suppressNewRequests } = await import('../src/utils/pilot2Api.js');

function badgeEvents(eventName = ADMIN_NEW_REQUESTS_BADGE_EVENT) {
  const seen = [];
  const handler = () => seen.push(eventName);
  window.addEventListener(eventName, handler);
  return {
    seen,
    stop: () => window.removeEventListener(eventName, handler),
  };
}

test('badge drops instantly when pending ids are removed (merge / Directory / delete)', () => {
  sessionStorage.clear();
  const events = badgeEvents();

  syncPendingRequestIdsForBadge(['req-A', 'req-B', 'req-C'], { fetchedAt: 1000 });
  assert.equal(countUnopenedNewRequests(), 3);

  removePendingRequestIdsFromBadge(['req-B']);
  assert.equal(countUnopenedNewRequests(), 2);
  assert.ok(events.seen.length >= 2);

  // Stale older list GET must not resurrect removed ids.
  syncPendingRequestIdsForBadge(['req-A', 'req-B', 'req-C'], { fetchedAt: 999 });
  assert.equal(countUnopenedNewRequests(), 2);

  events.stop();
});

test('suppressNewRequests removes ids from the badge in the same call', () => {
  sessionStorage.clear();
  syncPendingRequestIdsForBadge(['req-1', 'req-2', 'req-3'], { fetchedAt: Date.now() });
  assert.equal(countUnopenedNewRequests(), 3);

  suppressNewRequests({ requestIds: ['req-1', 'req-3'], hard: true });
  assert.equal(countUnopenedNewRequests(), 1);
});

test('opening a request drops the badge without waiting for a list refresh', () => {
  sessionStorage.clear();
  syncPendingRequestIdsForBadge(['req-open', 'req-other'], { fetchedAt: Date.now() });
  assert.equal(countUnopenedNewRequests(), 2);

  markRequestsViewed(['req-open']);
  assert.equal(countUnopenedNewRequests(), 1);

  removeRequestHighlight('req-other');
  assert.equal(countUnopenedNewRequests(), 0);
});

test('addPendingRequestIdsToBadge raises the count for new arrivals', () => {
  sessionStorage.clear();
  syncPendingRequestIdsForBadge(['req-old'], { fetchedAt: Date.now() });
  assert.equal(countUnopenedNewRequests(), 1);

  addPendingRequestIdsToBadge(['req-new']);
  assert.equal(countUnopenedNewRequests(), 2);
});

test('Directory badge counts only unopened active highlights, not viewed or pruned archive', () => {
  sessionStorage.clear();
  const events = badgeEvents(ADMIN_DIRECTORY_BADGE_EVENT);

  markDirectoryPersonHighlight('a@test.com');
  markDirectoryPersonHighlight('b@test.com');
  markDirectoryPersonHighlight('archived@test.com');
  assert.equal(countUnopenedDirectoryPeople(), 3);

  markDirectoryPersonViewed('a@test.com');
  assert.equal(countUnopenedDirectoryPeople(), 2);

  pruneDirectoryHighlightsToActiveEmails(['a@test.com', 'b@test.com']);
  assert.equal(countUnopenedDirectoryPeople(), 1);
  assert.ok(events.seen.length >= 1);
  events.stop();
});
