// The web client's service worker (docs/13-remote-access.md, "Push
// notifications"): shows the notifications a Mac pushes and opens the client
// on a tap. It is registered once per paired Mac, with the scope /m/<host
// key>/, because a push subscription belongs to one Mac's key. No fetch
// handler: the client loads from the network as it would without it.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("push", (e) => {
  let n = {};
  try {
    n = e.data ? e.data.json() : {};
  } catch {
    // not ours: still show something, a push must show a notification
  }
  e.waitUntil(
    self.registration.showNotification(n.title || "cmd", {
      body: n.body || "",
      // A newer notification about the same terminal replaces the one before.
      tag: n.paneId ? `pane:${n.paneId}` : n.id,
      icon: "/icon-192.png",
      data: { mac: n.host || null, paneId: n.paneId || null },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { mac, paneId } = e.notification.data || {};
  const url = new URL("/", self.location.origin);
  if (mac) url.searchParams.set("mac", mac);
  if (paneId) url.searchParams.set("pane", paneId);
  e.waitUntil(
    (async () => {
      // The client's pages are outside this worker's scope, so none is controlled by it.
      const [win] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (win) {
        win.postMessage({ type: "cmd.open", mac, paneId });
        try {
          return await win.focus();
        } catch {
          // not allowed to focus it: open a window instead
        }
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
