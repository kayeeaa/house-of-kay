/* ======================================================================
   notify-child — tells a child about something a friend did, as a push notification to their devices. Called by the
   database (private.push_gift_notice in 20261019090000_voxie_wall_art_gifts.sql), never by the app.
   Body: { kind: "gift-received", creationId } (the friend's copy). Goes to every device the child has turned
   notifications on for. Returns { ok, sent }.

   Secrets: MCAS_SYNC_SECRET (the schedule secret the database sends as x-sync-secret), VAPID_PUBLIC_KEY,
   VAPID_PRIVATE_KEY and VAPID_SUBJECT (the same push keys as send-reminders).
   Deploy with: npx supabase functions deploy notify-child --no-verify-jwt
   ====================================================================== */
import webpush from "npm:web-push@3.6.7";
import { adminClient, json } from "../_shared/voxie.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "not-found" }, 405);
  const secret = Deno.env.get("MCAS_SYNC_SECRET");
  if (!secret || !sameText(request.headers.get("x-sync-secret") ?? "", secret)) return json({ error: "not-allowed" }, 401);
  let body: { kind?: string; creationId?: string } = {};
  try { body = await request.json(); } catch { return json({ error: "bad-request" }, 400); }
  if (body.kind !== "gift-received" || typeof body.creationId !== "string") return json({ error: "bad-request" }, 400);

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY"), privateKey = Deno.env.get("VAPID_PRIVATE_KEY"), subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return json({ error: "push-not-set-up" }, 500);
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const admin = adminClient();
  const gift = await admin.from("creation_gifts").select("child_id, from_name, creations(name)").eq("creation_id", body.creationId).maybeSingle();
  if (gift.error) { console.error(gift.error); return json({ error: "save-failed" }, 500); }
  if (!gift.data) return json({ error: "not-found" }, 404);
  const childId = gift.data.child_id;
  const devices = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", childId);
  if (devices.error) { console.error(devices.error); return json({ error: "save-failed" }, 500); }

  const pictureName = (gift.data.creations as unknown as { name: string } | null)?.name ?? "a picture";
  const message = JSON.stringify({
    title: `🎁 A gift from ${gift.data.from_name}`,
    body: `${gift.data.from_name} gave you "${pictureName}". Put it up in your house!`,
    tag: `gift-${body.creationId}`, url: "/voxie",
  });
  let sent = 0;
  const gone: string[] = [];
  for (const device of devices.data ?? []) {
    try {
      await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, message, { TTL: 24 * 60 * 60 });
      sent++;
    } catch (pushError) {
      // 404 / 410: the device turned notifications off or the browser dropped it. Forget it.
      const status = (pushError as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(device.endpoint);
      else console.error("push failed", status);
    }
  }
  if (gone.length) await admin.from("push_subscriptions").delete().in("endpoint", gone);
  return json({ ok: true, sent });
});

function sameText(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index++) difference |= (a[index] ?? 0) ^ b[index];
  return difference === 0;
}
