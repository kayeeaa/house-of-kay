/* ======================================================================
   mcas-sync — copies each linked child's timetable (this week and next) and homework from MyChildAtSchool into
   the school_* tables. Run once a night by pg_cron (supabase/snippets/voxie_mcas_sync_schedule.sql), never by the app.

   Secrets (Edge Functions → Secrets): MCAS_EMAIL and MCAS_PASSWORD (the grown-up's MCAS login) and MCAS_SYNC_SECRET
   (any long random text; the schedule sends it in the x-sync-secret header, so nobody else can set off a sync).
   Deploy with: npx supabase functions deploy mcas-sync --no-verify-jwt   (the secret header does the checking)

   Which child gets which pupil's data: public.school_links (supabase/snippets/voxie_mcas_link_child.sql).
   Only ids, lessons and homework are kept: never the pupil's name, photo, contact details or school.
   Returns { ok, synced, failed } and nothing about the child. A failure is saved as school_sync.last_error.
   ====================================================================== */
import { adminClient, json, todayInUk } from "../_shared/voxie.ts";
import { addDays, fetchHomework, fetchWeek, type McasSession, readHomework, readWeek, signIn, SyncError, type SyncErrorCode, weeksToSync } from "./mcas.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "not-found" }, 405);
  const secret = Deno.env.get("MCAS_SYNC_SECRET");
  if (!secret || !sameText(request.headers.get("x-sync-secret") ?? "", secret)) return json({ error: "not-allowed" }, 401);

  const admin = adminClient();
  const { data: links, error } = await admin.from("school_links").select("child_id, mcas_student_id");
  if (error) { console.error(error); return json({ error: "save-failed" }, 500); }
  if (!links.length) return json({ ok: true, synced: 0, failed: 0 });

  const recordFailure = async (childId: string, code: SyncErrorCode) => {
    const { error } = await admin.from("school_sync").upsert({ child_id: childId, last_attempt_at: new Date().toISOString(), last_error: code });
    if (error) console.error(error);
  };

  // One sign-in for every child on the login. If it fails, stop: retrying a wrong password can lock the account.
  let session: McasSession;
  try {
    const email = Deno.env.get("MCAS_EMAIL"), password = Deno.env.get("MCAS_PASSWORD");
    if (!email || !password) throw new SyncError("login-failed");
    session = await signIn(email, password);
  } catch (error) {
    const code = errorCode(error);
    for (const link of links) await recordFailure(link.child_id, code);
    return json({ error: code }, 502);
  }

  let synced = 0, failed = 0;
  for (const link of links) {
    try {
      await syncChild(admin, session, link.child_id, Number(link.mcas_student_id));
      synced++;
    } catch (error) {
      failed++;
      await recordFailure(link.child_id, errorCode(error));
    }
  }
  return json({ ok: failed === 0, synced, failed });
});

async function syncChild(admin: ReturnType<typeof adminClient>, session: McasSession, childId: string, studentId: number) {
  if (!session.studentIds.includes(studentId)) throw new SyncError("not-on-this-account");
  const today = todayInUk(), weeks = weeksToSync(today);
  const weekData = (await Promise.all(weeks.map(weekStart => fetchWeek(session, studentId, weekStart)))).map(readWeek);
  const lessons = weekData.flatMap(week => week.lessons), schoolDays = weekData.flatMap(week => week.schoolDays);
  const subjectByClass = new Map(lessons.filter(lesson => lesson.classId !== null).map(lesson => [lesson.classId as number, lesson.subject]));
  const homework = readHomework(await fetchHomework(session, studentId, today), subjectByClass);

  // All in one transaction on the server (save_school_sync), so the School tab never sees half a sync.
  const { error } = await admin.rpc("save_school_sync", {
    p_child_id: childId, p_from: weeks[0], p_to: addDays(weeks[0], 13),
    p_school_days: schoolDays, p_lessons: lessons, p_homework: homework,
  });
  if (error) { console.error(error); throw new SyncError("save-failed"); }
}

function errorCode(error: unknown): SyncErrorCode {
  if (error instanceof SyncError) return error.code;
  console.error(error);
  return "mcas-unavailable";
}

/** Compares secrets without giving away how much matched through timing. */
function sameText(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index++) difference |= (a[index] ?? 0) ^ b[index];
  return difference === 0;
}
