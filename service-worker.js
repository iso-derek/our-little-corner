const CACHE_NAME = "pf-corner-v13";
const APP_SHELL = [
  "./",
  "./index.html",
  "./letters.html",
  "./memories.html",
  "./game.html",
  "./movies.html",
  "./messages.html",
  "./badges.html",
  "./gifts.html",
  "./quotes.html",
  "./love.html",
  "./offline.html",
  "./style.css?v=20260824-3",
  "./auth.js?v=20260823-6",
  "./script.js?v=20260824-3",
  "./app-enhancements.js?v=20260824-3",
  "./games-plus.js?v=20260824-3",
  "./couple-hub.js?v=20260824-3",
  "./supabase-config.js?v=20260823-2",
  "./site.webmanifest",
  "./images/favicon.svg",
  "./images/icon-192.png",
  "./images/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("./offline.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const update = fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || update;
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "Something new is waiting in your corner." };
  }
  event.waitUntil(self.registration.showNotification(payload.title || "Princess + Frog", {
    body: payload.body || "Something new is waiting in your corner.",
    icon: "./images/icon-192.png",
    badge: "./images/icon-192.png",
    data: { url: payload.url || "./index.html" },
    tag: payload.tag || "pf-corner-update",
    renotify: true
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./index.html", self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(new URL(target).origin));
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
