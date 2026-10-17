/* ======================================================================
   send-reminders — homework and lesson reminders as push notifications. Run every hour by pg_cron
   (supabase/snippets/voxie_push_reminders_schedule.sql), so the times stay right through the clock changes.
   - Homework: at the child's reminder_hour, to the child and a copy to their grown-ups (public.claim_homework_reminders).
   - Lessons: the night before (lesson_evening_hour) and the morning of (lesson_morning_hour) a lesson with a reminder,
     to the child and/or their grown-ups, as the grown-up chose (public.claim_lesson_reminders).
   Each is sent at most once (the claim functions record it).

   Secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (from `npx web-push generate-vapid-keys`;
   the public one also goes in public/voxie/data/supabase-config.js), VAPID_SUBJECT (mailto:you@example.com, so push
   services can contact you), and MCAS_SYNC_SECRET (the same schedule secret mcas-sync uses).
   Deploy with: npx supabase functions deploy send-reminders --no-verify-jwt
   Body { "now": true } sends everything due straight away, whatever the time (for testing).
   ====================================================================== */
import webpush from "npm:web-push@3.6.7";
import { adminClient, json, todayInUk } from "../_shared/voxie.ts";

type Due = { title: string; subject: string; dueDate: string; dueTime: string };
type Lesson = { subject: string; note: string; start: string };
type Device = { endpoint: string; p256dh: string; auth: string };
type Message = { title: string; body: string; tag: string };

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "not-found" }, 405);
  const secret = Deno.env.get("MCAS_SYNC_SECRET");
  if (!secret || !sameText(request.headers.get("x-sync-secret") ?? "", secret)) return json({ error: "not-allowed" }, 401);
  let body: { now?: boolean } = {};
  try { body = await request.json(); } catch { /* no body is fine */ }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY"), privateKey = Deno.env.get("VAPID_PRIVATE_KEY"), subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return json({ error: "push-not-set-up" }, 500);
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const admin = adminClient();
  const anyHour = body.now === true;
  const [homeworkClaim, lessonClaim] = await Promise.all([
    admin.rpc("claim_homework_reminders", { p_any_hour: anyHour }),
    admin.rpc("claim_lesson_reminders", { p_any_hour: anyHour }),
  ]);
  if (homeworkClaim.error || lessonClaim.error) { console.error(homeworkClaim.error ?? lessonClaim.error); return json({ error: "save-failed" }, 500); }

  // Who gets what. A grown-up with two children gets one notification for each.
  const outgoing: { devices: Device[]; message: Message }[] = [];
  for (const child of (homeworkClaim.data ?? []) as { childId: string; childName: string; homework: Due[]; devices: Device[]; grownUpDevices: Device[] }[]) {
    const text = homeworkText(child.homework);
    outgoing.push({ devices: child.devices, message: { ...text, tag: "homework" } });
    outgoing.push({ devices: child.grownUpDevices, message: { title: `${child.childName}: ${lowerFirst(text.title)}`, body: text.body, tag: `homework-${child.childId}` } });
  }
  for (const child of (lessonClaim.data ?? []) as { childId: string; childName: string; period: string; childLessons: Lesson[]; grownUpLessons: Lesson[]; devices: Device[]; grownUpDevices: Device[] }[]) {
    const day = child.period === "night-before" ? "tomorrow" : "today";
    if (child.childLessons.length) outgoing.push({ devices: child.devices, message: { ...lessonText(child.childLessons, day), tag: `lessons-${child.period}` } });
    if (child.grownUpLessons.length) {
      const text = lessonText(child.grownUpLessons, day);
      outgoing.push({ devices: child.grownUpDevices, message: { title: `${child.childName} ${lowerFirst(text.title)}`, body: text.body, tag: `lessons-${child.period}-${child.childId}` } });
    }
  }

  let sent = 0, failed = 0;
  const gone = new Set<string>();
  for (const { devices, message } of outgoing) {
    for (const device of devices ?? []) {
      if (gone.has(device.endpoint)) continue;
      try {
        await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          JSON.stringify({ ...message, url: "/voxie" }), { TTL: 6 * 60 * 60, urgency: "normal" });
        sent++;
      } catch (pushError) {
        // 404 / 410: the device turned notifications off or the browser dropped it. Forget it.
        const status = (pushError as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.add(device.endpoint);
        else { failed++; console.error("push failed", status); }
      }
    }
  }
  if (gone.size) await admin.from("push_subscriptions").delete().in("endpoint", [...gone]);
  return json({ ok: true, sent, failed, removedDevices: gone.size });
});

/* "Homework reminder" + "French: Languagenut (due tonight)", or "3 homework reminders" with one per line. */
function homeworkText(homework: Due[]): { title: string; body: string } {
  const today = todayInUk();
  const when = (item: Due) => {
    if (item.dueDate === today) return item.dueTime >= "18:00" ? "tonight" : `today at ${clock(item.dueTime)}`;
    if (item.dueDate === addDays(today, 1)) return item.dueTime >= "18:00" ? "tomorrow" : `tomorrow at ${clock(item.dueTime)}`;
    return new Date(`${item.dueDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  };
  const line = (item: Due) => `${item.subject ? `${item.subject}: ` : ""}${item.title} (due ${when(item)})`;
  if (homework.length === 1) return { title: "Homework reminder", body: line(homework[0]) };
  const shown = homework.slice(0, 3).map(line);
  if (homework.length > 3) shown.push(`and ${homework.length - 3} more`);
  return { title: `${homework.length} homework reminders`, body: shown.join("\n") };
}

/* "Tomorrow: Core PE and Science" + "Core PE at 1:20pm: Get the PE kit and key ready" for each. */
function lessonText(lessons: Lesson[], day: "today" | "tomorrow"): { title: string; body: string } {
  const subjects = lessons.map(lesson => lesson.subject);
  const list = subjects.length === 1 ? subjects[0] : `${subjects.slice(0, -1).join(", ")} and ${subjects.at(-1)}`;
  return {
    title: `${day === "today" ? "Today" : "Tomorrow"}: ${list}`,
    body: lessons.map(lesson => `${lesson.subject} at ${clock(lesson.start)}${lesson.note ? `: ${lesson.note}` : ""}`).join("\n"),
  };
}

/* "13:20" → "1:20pm" */
function clock(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${hours < 12 ? "am" : "pm"}`;
}
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function sameText(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index++) difference |= (a[index] ?? 0) ^ b[index];
  return difference === 0;
}
