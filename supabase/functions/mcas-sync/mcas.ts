/* ======================================================================
   supabase/functions/mcas-sync/mcas.ts — talking to MyChildAtSchool (Bromcom MCAS) and tidying what comes back.
   MCAS has no official API for parents. This signs in the way the MCAS phone app does, with the grown-up's own
   login, and only ever READS (GET requests after signing in). No Supabase code here, so it can be tested on its own.
   ====================================================================== */

const API_BASE = "https://appsapi.bromcom.com/Nucleus/api";
const DISCOVERY_BASE = "https://cloudmis.bromcom.com/Nucleus/api";
// Public values built into the official MCAS app: they identify the app, not the grown-up.
const APP = { ApplicationId: "52C10C82-077F-4E5A-B8CF-4B91D9A71617", ApplicationSecret: "IFCCLB7AYyI)^0OMDLG#", ApiSource: "app" };
const USER_AGENT = "Voxie-MCAS-Sync/1.0";

/** An error whose message is a school_sync.last_error code. */
export type SyncErrorCode = "login-failed" | "mcas-unavailable" | "not-on-this-account" | "save-failed";
export class SyncError extends Error {
  code: SyncErrorCode;
  constructor(code: SyncErrorCode) { super(code); this.code = code; }
}

export type Lesson = { date: string; start: string; end: string; subject: string; colour: string; teachers: string[]; classId: number | null };
export type Homework = { source: "mcas" | "teams"; externalId: string; subject: string; title: string; dueDate: string; dueTime: string;
  instructions: string; links: { label: string; url: string }[]; setBy: string; submitted: boolean };
export type Week = { lessons: Lesson[]; schoolDays: string[] };

/* ---------- Signing in ---------- */

export type McasSession = { get: (path: string, params?: Record<string, string | number>) => Promise<unknown>; studentIds: number[] };

export async function signIn(email: string, password: string): Promise<McasSession> {
  const postJson = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT }, body: JSON.stringify(body) });
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new SyncError("login-failed");
    if (!response.ok) throw new SyncError("mcas-unavailable");
    const text = await response.text();
    try { return JSON.parse(text); } catch { return text.trim().replace(/^"|"$/g, ""); }
  };

  // 1. The school and parent contact this email belongs to (the first one, if there are several)
  const contact = [...walk(await postJson(`${DISCOVERY_BASE}/api/v1/mcas/user/schoolcontactinfoV2`, { ...APP, Email: email }))]
    .map(item => ({ schoolId: pick(item, "SchoolID"), contactId: pick(item, "ContactID") }))
    .find(item => item.schoolId && item.contactId);
  if (!contact) throw new SyncError("login-failed");

  // 2. MCAS hashes the password, then swaps it for a bearer token
  const hash = await postJson(`${DISCOVERY_BASE}/api/v1/mcas/user/hashpasswordV2`, { ...APP, Password: password });
  const tokenResponse = await fetch(`${API_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({
      schoolid: String(contact.schoolId), username: email, password: String(hash), grant_type: "password", apiSource: "app", userType: "mcas",
      application_id: APP.ApplicationId, application_secret: APP.ApplicationSecret, ipAddress: "127.0.0.1",
      mcasParentLoginFromMIS: "false", isPasswordHash: "True",
    }),
  });
  if (!tokenResponse.ok) throw new SyncError(tokenResponse.status < 500 ? "login-failed" : "mcas-unavailable");
  const token = (await tokenResponse.json()).access_token;
  if (!token) throw new SyncError("login-failed");

  const get = async (path: string, params?: Record<string, string | number>) => {
    const url = new URL(API_BASE + path);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, SchoolID: String(contact.schoolId), ContactID: String(contact.contactId), ProxyType: "mcas", "User-Agent": USER_AGENT } });
    if (!response.ok) throw new SyncError("mcas-unavailable");
    return response.json();
  };

  // 3. The pupils on this login. Only their ids are kept: names and photos are never read into Voxie.
  const users = await get("/api/v1/mcas/user/userList", { includeStudentPhotosData: "false" });
  const studentIds = [...new Set([...walk(users)].map(item => Number(pick(item, "StudentID", "StudentId"))).filter(Number.isInteger))];
  return { get, studentIds };
}

/* ---------- Fetching one pupil ---------- */

/** Monday-start weeks: this week and next, as "YYYY-MM-DD". */
export function weeksToSync(today: string): string[] {
  const weekDay = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, -((weekDay + 6) % 7));
  return [monday, addDays(monday, 7)];
}

export async function fetchWeek(session: McasSession, studentId: number, weekStart: string): Promise<unknown> {
  const [year, month, day] = weekStart.split("-").map(Number);
  return session.get("/api/v1/timetable/mcas/studentTimetableByWeekStart", { studentid: studentId, year, month, date: day });
}
export async function fetchHomework(session: McasSession, studentId: number, today: string): Promise<{ extended: unknown; assignments: unknown }> {
  const [year, month, day] = today.split("-").map(Number);
  const [extended, assignments] = await Promise.all([
    session.get(`/api/v1/mcas/homework/extendeddetails/${studentId}/${day}/${month}/${year}`),
    // Microsoft Teams assignments, which some schools pass through MCAS. Not every school has them.
    session.get(`/api/v1/mcas/assignments/${studentId}`).catch(() => null),
  ]);
  return { extended, assignments };
}

/* ---------- Tidying ---------- */

/** One week's timetable. MCAS sends a lesson once per teacher, so a team-taught lesson is merged into one. */
export function readWeek(reply: unknown): Week {
  const data = (reply ?? {}) as { Table?: Record<string, unknown>[]; Table2?: Record<string, unknown>[] };
  const lessons = new Map<string, Lesson>();
  for (const row of data.Table ?? []) {
    const start = String(row.StartDate ?? ""), end = String(row.EndDate ?? "");
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(start) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(end)) continue;
    const classId = Number.isInteger(row.CollectionID) ? row.CollectionID as number : null;
    const teacher = tidy(row.TeacherName);
    const key = `${classId}|${start}`;
    const existing = lessons.get(key);
    if (existing) { if (teacher && !existing.teachers.includes(teacher)) existing.teachers.push(teacher); continue; }
    const colour = String(row.SubjectColour ?? "");
    lessons.set(key, { date: start.slice(0, 10), start: start.slice(11, 16), end: end.slice(11, 16), subject: tidy(row.Subject).slice(0, 100) || "Lesson",
      colour: /^[0-9a-f]{6}$/i.test(colour) ? colour : "", teachers: teacher ? [teacher] : [], classId });
  }
  // Table2 is the week's school days, so a day with no lessons (INSET, holidays) is known rather than guessed.
  const schoolDays = [...new Set((data.Table2 ?? []).map(day => String(day.StartDate ?? "").slice(0, 10)).filter(day => /^\d{4}-\d\d-\d\d$/.test(day)))];
  return { lessons: [...lessons.values()], schoolDays };
}

/** Main MCAS homework plus Teams assignments, in one shape. subjectByClass comes from the timetable: teachers sometimes
    pick the wrong subject when setting homework (e.g. "German" on the French class), so the class wins. */
export function readHomework(replies: { extended: unknown; assignments: unknown }, subjectByClass: Map<number, string>): Homework[] {
  const extended = (replies.extended ?? {}) as { Table?: Record<string, unknown>[]; Table2?: Record<string, unknown>[] };
  const resources = new Map<string, string[]>();   // HomeworkID → urls attached as resources
  for (const resource of extended.Table2 ?? []) {
    if (resource.ResourceType !== "UrlType") continue;   // attached files need a download we don't do yet
    const id = String(resource.HomeworkID);
    resources.set(id, [...(resources.get(id) ?? []), String(resource.ResourceFileName ?? "")]);
  }
  const homework: Homework[] = [];
  for (const row of extended.Table ?? []) {
    const id = String(row.HomeworkID ?? ""), due = String(row.DueDate ?? ""), title = tidy(row.HomeworkTitle);
    if (!id || !title || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(due)) continue;
    const description = String(row.HomeworkDescription ?? "");
    const classSubject = Number.isInteger(row.CollectionID) ? subjectByClass.get(row.CollectionID as number) : undefined;
    homework.push({
      source: "mcas", externalId: id, subject: (classSubject || tidy(row.Subject)).slice(0, 100), title: title.slice(0, 300),
      dueDate: due.slice(0, 10), dueTime: due.slice(11, 16), instructions: htmlToText(description).slice(0, 5000),
      links: makeLinks([...(resources.get(id) ?? []), ...linksInHtml(description)]), setBy: tidy(row.AssignedBy).slice(0, 100),
      submitted: Number(row.IsHomeworkSubmitted) === 1 || row.IsHomeworkSubmitted === true,
    });
  }
  const assignments = (replies.assignments ?? {}) as { Assignments?: Record<string, unknown>[] };
  for (const row of assignments.Assignments ?? []) {
    const id = String(row.ID ?? ""), title = tidy(row.Name), due = ukDateTime(String(row.DueDateAsDate ?? ""));
    if (!id || !title || !due) continue;
    const instructions = String(row.Instructions ?? "");
    homework.push({
      source: "teams", externalId: id, subject: "", title: title.slice(0, 300), dueDate: due.date, dueTime: due.time,
      instructions: htmlToText(instructions).slice(0, 5000), links: makeLinks(linksInHtml(instructions)), setBy: "",
      // Only these statuses are known to mean handed in; "Created" / "Assigned" mean not yet.
      submitted: /submitted|turned ?in|returned|complete/i.test(String(row.Status ?? "")),
    });
  }
  return homework;
}

/* ---------- Helpers ---------- */

/** Teachers' instructions come as HTML (often pasted from Teams). Voxie shows plain text. */
export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .split("\n").map(line => line.replace(/[ \t\u00a0]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}
function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") { const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(point) ? String.fromCodePoint(point) : whole; }
    return named[code.toLowerCase()] ?? whole;
  });
}
function linksInHtml(html: string): string[] {
  return [...html.matchAll(/href\s*=\s*"([^"]+)"/gi)].map(match => decodeEntities(match[1]));
}

const SITE_NAMES: [RegExp, string][] = [
  [/languagenut\./, "Languagenut"], [/senecalearning\./, "Seneca"], [/tassomai\./, "Tassomai"], [/sparx/, "Sparx"],
  [/forms\.(office|cloud\.microsoft)|forms\.microsoft/, "the form"], [/teams\.microsoft/, "Teams"], [/(docs|drive)\.google/, "the Google file"],
  [/sharepoint\.com|onedrive/, "the file"], [/quizlet\./, "Quizlet"], [/educake\./, "Educake"], [/hegartymaths|mathswatch|drfrost/, "the maths site"],
];
/** https only (http is upgraded), no duplicates, and a friendly label. Fixes links that can't work as copied. */
export function makeLinks(urls: string[]): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  for (const raw of urls) {
    let url: URL;
    try { url = new URL(raw.trim()); } catch { continue; }
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") continue;
    // A Sparx login link copied halfway through signing in has a one-off code in it, so send them to Sparx itself.
    if (url.hostname === "auth.sparx-learning.com") url = new URL("https://app.sparx-learning.com");
    const href = url.toString();
    if (links.some(link => link.url === href)) continue;
    const host = url.hostname.replace(/^www\./, "");
    const name = SITE_NAMES.find(([pattern]) => pattern.test(host))?.[1] ?? host;
    const sameName = links.filter(link => link.label.startsWith(`Open ${name}`)).length;
    links.push({ label: sameName ? `Open ${name} (${sameName + 1})` : `Open ${name}`, url: href });
  }
  return links.slice(0, 10);
}

/** "2026-10-15T22:59:00Z" → { date: "2026-10-15", time: "23:59" } in UK time. */
function ukDateTime(iso: string): { date: string; time: string } | null {
  const moment = new Date(iso);
  if (!iso || Number.isNaN(moment.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(moment).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const tidy = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();
function* walk(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const child of value) yield* walk(child);
  else if (value && typeof value === "object") { yield value as Record<string, unknown>; for (const child of Object.values(value)) yield* walk(child); }
}
function pick(item: Record<string, unknown>, ...keys: string[]): unknown {
  for (const [key, value] of Object.entries(item)) if (keys.some(wanted => wanted.toLowerCase() === key.toLowerCase()) && value != null && value !== "") return value;
}
