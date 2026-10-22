/*
 * The smallest shell that makes the till installable (AGENT.md section 3).
 *
 * There is deliberately no offline cache: the screen must never show a stale
 * balance or award points it cannot confirm. The offline queue is build
 * step 8 and will be a designed feature, not an accident of caching.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Network only. Present so browsers treat the app as installable.
});
