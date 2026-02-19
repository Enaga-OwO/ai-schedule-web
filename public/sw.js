// public/sw.js - Service Worker 完全版（通知対応）
const CACHE_NAME = "ai-schedule-v2";
const STATIC_ASSETS = ["/", "/records", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        if (url.pathname === "/api/chat") {
          return new Response(
            JSON.stringify({ message: "現在オフラインです。オンライン復帰後にまた話しかけてね！", offline: true }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ error: "Offline" }), { status: 503 });
      })
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// メインスレッドから通知を受け取る（バックグラウンドでも動く）
self.addEventListener("message", (event) => {
  if (event.data?.type === "SHOW_NOTIFICATION") {
    const p = event.data.payload;
    event.waitUntil(
      self.registration.showNotification(p.title, {
        body: p.body,
        icon: p.icon || "/icon-192.png",
        tag: p.tag,
        vibrate: p.vibrate || [100, 50, 100],
        requireInteraction: p.requireInteraction || false,
        actions: p.actions || [],
        data: p.data || {},
        silent: false,
      })
    );
  }
  // タイマー通知をSWタイマーで予約
  if (event.data?.type === "SCHEDULE_TIMER_NOTIFICATION") {
    const { delayMs, title, body, tag } = event.data;
    setTimeout(() => {
      self.registration.showNotification(title, {
        body, icon: "/icon-192.png", tag,
        vibrate: [200, 100, 200],
        requireInteraction: true,
        actions: [
          { action: "open", title: "アプリを開く" },
          { action: "break", title: "休憩する" },
        ],
        data: { url: "/" },
      });
    }, delayMs);
  }
});

// 通知クリック
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "snooze") {
    setTimeout(() => {
      self.registration.showNotification("スヌーズ終了！", {
        body: event.notification.body,
        icon: "/icon-192.png",
        tag: event.notification.tag,
        requireInteraction: true,
      });
    }, 5 * 60 * 1000);
    return;
  }
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// Web Push受信
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: "通知", body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(payload.title || "習慣改善パートナー", {
      body: payload.body || "",
      icon: "/icon-192.png",
      tag: payload.tag || "push",
      vibrate: [100, 50, 100],
      requireInteraction: payload.requireInteraction || false,
      data: { url: payload.url || "/" },
    })
  );
});

// バックグラウンド同期
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-messages") event.waitUntil(syncOfflineMessages());
});

async function syncOfflineMessages() {
  const cache = await caches.open("offline-messages");
  const keys = await cache.keys();
  for (const key of keys) {
    const req = await cache.match(key);
    if (!req) continue;
    const body = await req.json();
    try {
      await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await cache.delete(key);
    } catch {}
  }
}
