/* ======================================================================
   sw.js — Voxie's service worker. Only shows push notifications (homework reminders from the send-reminders
   Edge Function) and opens Voxie when one is tapped. It doesn't cache anything, so a new version of the site is
   always what loads.
   ====================================================================== */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

// The push body is { title, body, tag, url } (see supabase/functions/send-reminders).
self.addEventListener("push", event => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch (error) { message = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(message.title || "Voxie", {
    body: message.body || "",
    icon: "/voxie/apple-touch-icon.png",
    tag: message.tag || "voxie",         // a newer reminder replaces an older one instead of stacking up
    data: { url: message.url || "/voxie" },
  }));
});

// Tapping it brings back an open Voxie, or opens one.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  // Only ever Voxie's own pages, whatever the message says.
  const wanted = new URL((event.notification.data && event.notification.data.url) || "/voxie", self.location.origin);
  const url = wanted.origin === self.location.origin && wanted.pathname.startsWith("/voxie") ? wanted.href : new URL("/voxie", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find(client => new URL(client.url).pathname.startsWith("/voxie"));
    if (open) { await open.focus(); return; }
    await self.clients.openWindow(url);
  })());
});
