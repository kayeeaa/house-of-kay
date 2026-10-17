/* ======================================================================
   notify-admins — tells the people who run Voxie (public.site_admins) about things happening, as a push notification
   to their devices. Called by a database trigger (20261018090000_voxie_new_grown_up_alert.sql), never by the app.
   Body: { kind: "new-grown-up", userId }. Returns { ok, sent }.

   Secrets: MCAS_SYNC_SECRET (the schedule secret the trigger sends as x-sync-secret), VAPID_PUBLIC_KEY,
   VAPID_PRIVATE_KEY and VAPID_SUBJECT (the same push keys as send-reminders).
   Deploy with: npx supabase functions deploy notify-admins --no-verify-jwt
   ====================================================================== */
import webpush from "npm:web-push@3.6.7";
import { adminClient, json } from "../_shared/voxie.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "not-found" }, 405);
  const secret = Deno.env.get("MCAS_SYNC_SECRET");
  if (!secret || !sameText(request.headers.get("x-sync-secret") ?? "", secret)) return json({ error: "not-allowed" }, 401);
  let body: { kind?: string; userId?: string } = {};
  try { body = await request.json(); } catch { return json({ error: "bad-request" }, 400); }
  if (body.kind !== "new-grown-up" || typeof body.userId !== "string") return json({ error: "bad-request" }, 400);

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY"), privateKey = Deno.env.get("VAPID_PRIVATE_KEY"), subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return json({ error: "push-not-set-up" }, 500);
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const admin = adminClient();
  const [profile, grownUps, admins] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", body.userId).maybeSingle(),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "parent"),
    admin.from("site_admins").select("user_id"),
  ]);
  if (profile.error || grownUps.error || admins.error) { console.error(profile.error ?? grownUps.error ?? admins.error); return json({ error: "save-failed" }, 500); }
  const adminIds = (admins.data ?? []).map(row => row.user_id).filter(id => id !== body.userId);
  if (!adminIds.length) return json({ ok: true, sent: 0 });
  const devices = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", adminIds);
  if (devices.error) { console.error(devices.error); return json({ error: "save-failed" }, 500); }

  const name = (profile.data?.display_name || "Someone").trim(), count = grownUps.count ?? 0;
  const message = JSON.stringify({
    title: "🎉 New grown-up on Voxie",
    body: `${name} just signed up. That's ${count} grown-up${count === 1 ? "" : "s"} so far.`,
    tag: `new-grown-up-${body.userId}`, url: "/voxie",
  });
  let sent = 0;
  const gone: string[] = [];
  for (const device of devices.data ?? []) {
    try {
      await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, message, { TTL: 24 * 60 * 60 });
      sent++;
    } catch (pushError) {
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
