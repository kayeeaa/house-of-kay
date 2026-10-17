/* ======================================================================
   data/dataLayer.js  —  the app's ONLY way to talk to the backend (Supabase).
   The rest of the app calls these functions by name; keep every name, argument and return shape.
   Backend: supabase/migrations/ (tables, RLS, RPCs) and supabase/functions/ (add-child, set-child-passcode,
   delete-child-account). docs/voxie/BACKEND.md maps each function below to its table / RPC / Edge Function.

   How it works:
   - Reads of the signed-in child's own rows go straight to tables (Row Level Security only shows their rows).
   - EVERY write goes through an RPC or Edge Function, which checks who's asking and works out XP, prices, powers,
     chance and limits on the server. RPC errors are the exact codes the app expects (error.message === "daily-limit").
   - Accounts are grown-up first: grown-ups sign up with email + password; they add each child (username, passcode,
     birth month and year). A child's REAL NAME, EMAIL, FULL DATE OF BIRTH AND GENDER ARE NEVER COLLECTED
     (UK GDPR data minimisation, ICO Children's code). Birth month/year are used only to pick missions for the
     child's age, only a grown-up can change them, and friends and search never see them.
   - Child log-ins: Supabase needs an email, so each child has a hidden "<id>@kids.voxie.invalid" address nobody can
     receive mail at. Log-in by username looks it up (RPC email_for_username). Never show hidden emails.
   - Grown-ups reset their password by email (link to /voxie/new-passcode). Children ask their grown-up, who sets a
     new passcode on the child's tab.
   - Payments (later): put the plan on the grown-up (profiles.plan). A child gets paid features if any linked
     grown-up pays.
   ====================================================================== */
function getTodayInUk() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()); }
function shiftDate(isoDate, days) { const date = new Date(isoDate + "T12:00:00Z"); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }

const LINK_CODE_HOURS = 24;
const MAX_CHILDREN_PER_GROWN_UP = 8;
const MAX_NAME_LENGTH = 16;        // a buddy's name
const MAX_GAME_NAME_LENGTH = 20;   // a child's game name: starts as their username (also up to 20), must be unique

/* The level the child was when they got an item: its unlock level, or when they bought / won it. */
function gotAtLevelFor(item, gotAtLevels) {
  const fromLevelUp = item.unlockLevel !== undefined ? item.unlockLevel : Infinity;
  return Math.min(fromLevelUp, gotAtLevels[item.id] ?? Infinity);
}

/* supabase-js is loaded from the CDN in index.html; the URL and anon key come from data/supabase-config.js. */
const supabaseClient = supabase.createClient(VOXIE_SUPABASE_URL, VOXIE_SUPABASE_ANON_KEY);

/* The signed-in user's id. Throws "not-signed-in" (the app sends them back to log in). */
async function requireUserId() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) throw new Error("not-signed-in");
  return data.session.user.id;
}
/* An RPC whose errors become the app's error codes. */
async function callRpc(name, args) {
  const { data, error } = await supabaseClient.rpc(name, args);
  if (error) throw new Error(error.message || "save-failed");
  return data;
}
/* A table read limited to the signed-in child's rows. build(query) adds filters and ordering. */
async function readMyRows(table, columns, build = query => query) {
  const childId = await requireUserId();
  const { data, error } = await build(supabaseClient.from(table).select(columns).eq("child_id", childId));
  if (error) throw new Error(error.message || "load-failed");
  return data;
}
/* Rows that belong to the PLAYING buddy: each buddy has its own items, item XP, colours and Shop buys.
   Returns { rows, buddyId } (no rows before setup, when there's no buddy yet). */
async function readMyBuddyRows(table, columns, build = query => query) {
  const profile = await loadMyProfile();
  const buddyId = profile && profile.active_buddy_id;
  if (!buddyId) return { rows: [], buddyId: null };
  // Row Level Security already limits every table to your own buddies, so the buddy is the only filter needed.
  const { data, error } = await build(supabaseClient.from(table).select(columns).eq("buddy_id", buddyId));
  if (error) throw new Error(error.message || "load-failed");
  return { rows: data, buddyId };
}
/* An Edge Function; its errors come back as { error: "<code>" }. */
async function callEdgeFunction(name, body) {
  const { data, error } = await supabaseClient.functions.invoke(name, { body });
  if (error) {
    let code = "save-failed";
    try { code = (await error.context.json()).error || code; } catch (parseError) {}
    throw new Error(code);
  }
  return data;
}
async function loadMyProfile() {
  const { data, error } = await supabaseClient.from("my_profile").select("*").maybeSingle();
  if (error) throw new Error(error.message || "load-failed");
  return data;
}

const dataLayer = {
  /** The signed-in user's profile (child or grown-up), or null. */
  async getSignedInProfile() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session ? loadMyProfile() : null;
  },
  /** loginName = a grown-up's email or a child's username. Throws Error("wrong-details") if it doesn't match. Returns the profile. */
  async signIn(loginName, passcode) {
    const name = loginName.trim().toLowerCase();
    const email = name.includes("@") ? name : await callRpc("email_for_username", { p_username: name });
    if (!email) throw new Error("wrong-details");
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: passcode });
    if (error) throw new Error(error.status === 400 ? "wrong-details" : "save-failed");
    const profile = await loadMyProfile();
    if (!profile) throw new Error("wrong-details");
    return profile;
  },
  /** Grown-ups only: emails a link to make a new password. Always "succeeds", so it never reveals which emails have accounts. */
  async requestPasscodeReset(email) {
    await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/voxie/new-passcode` });
  },
  async signOut() { await supabaseClient.auth.signOut(); },
  /** First-time setup. look = { displayName, petType, petName, themeColour, location, petLook }. Returns the profile. */
  async saveProfileSetup(look) { return callRpc("save_profile_setup", { p_look: look }); },
  /** Changes from the Buddies and Settings screens (same look shape). Throws Error("name-taken") if the game name is
      another child's game name or username. Changing the game name notifies the child's grown-ups. Returns the profile. */
  async updateMyProfile(look) { return callRpc("update_my_profile", { p_look: look }); },
  /** The child's unseen notifications, oldest first: [{ id, kind: "task-added", fromName, taskTitle }].
      One row per task a grown-up added; the app shows them together in one pop-up. */
  async loadMyTaskNotifications() {
    const rows = await readMyRows("child_notifications", "id, kind, from_name, task_title, created_at", query => query.is("seen_at", null).order("created_at"));
    return rows.map(row => ({ id: row.id, kind: row.kind, fromName: row.from_name, taskTitle: row.task_title }));
  },
  async markMyTaskNotificationsSeen(notificationIds) { return callRpc("mark_my_notifications_seen", { p_ids: notificationIds }); },
  /** Is this game name free (not another child's game name or username)? Game names are unique so friends can't mix children up. */
  async isGameNameAvailable(name) { return callRpc("is_game_name_available", { p_name: name }); },
  /** [{ id, petType, petName, petLook, themeColour, isActive }] oldest first. */
  async loadMyBuddies() {
    const [rows, profile] = await Promise.all([
      readMyRows("buddies", "id, pet_type, pet_name, pet_look, theme_colour", query => query.order("adopted_on").order("created_at")),
      loadMyProfile()]);
    return rows.map(row => ({ id: row.id, petType: row.pet_type, petName: row.pet_name, petLook: { ...DEFAULT_PET_LOOK, ...row.pet_look },
      themeColour: row.theme_colour, isActive: !!profile && row.id === profile.active_buddy_id }));
  },
  /** Rebirth: a new pet type at level 1. Throws Error("no-rebirth") or Error("already-collected"). Returns the profile. */
  async rebirthAsNewPet(petType, petName) { return callRpc("rebirth_as_new_pet", { p_pet_type: petType, p_pet_name: petName }); },
  async setActiveBuddy(buddyId) { return callRpc("set_active_buddy", { p_buddy_id: buddyId }); },
  /** The playing buddy's own unlock order and Shop, dealt out when the buddy was made:
      { unlockLevels: { item | location | body-colour | face | arms | width | height: { id: level } }, shopThisWeek: [itemId, ...] (the playing buddy's 12 Shop items this week), shopRestocksOn: "YYYY-MM-DD" (next Monday) }.
      Anything not listed (added to the game later) unlocks at its usual level. */
  async loadMyBuddyDeals() {
    const [{ rows: unlocks }, shop] = await Promise.all([
      readMyBuddyRows("buddy_unlocks", "kind, option_id, unlock_level"),
      callRpc("load_my_shop_this_week")]);
    const unlockLevels = {};
    unlocks.forEach(row => { (unlockLevels[row.kind] = unlockLevels[row.kind] || {})[row.option_id] = row.unlock_level; });
    return { unlockLevels, shopThisWeek: shop.itemIds, shopRestocksOn: shop.restocksOn };
  },
  /** Things the playing buddy made: [{ id, kind: "wall-art", name, pixels: 16 rows of 16 chars }]. */
  async loadMyCreations() {
    const { rows } = await readMyBuddyRows("creations", "id, kind, name, pixels, created_at", query => query.eq("thrown_away", false).order("created_at"));
    return rows.map(row => ({ id: row.id, kind: row.kind, name: row.name, pixels: row.pixels }));
  },
  /** → { id, name, pixels, pricePaid }. Throws Error("not-enough-xp"), Error("too-many"), Error("bad-name") or Error("bad-pixels"). */
  async makeCreation(kind, name, pixels) { return callRpc("make_creation", { p_kind: kind, p_name: name, p_pixels: pixels }); },
  /** Takes it down and out of My stuff. The XP isn't given back. */
  async throwAwayCreation(creationId) { await callRpc("throw_away_creation", { p_creation_id: creationId }); },
  /** [{ id, displayName, petType, petLook, relationship, requestId }] */
  async searchPlayers(searchText) { return callRpc("search_players", { p_search_text: searchText }); },
  async sendFriendRequest(toChildId) { return callRpc("send_friend_request", { p_to_child_id: toChildId }); },
  async loadMyFriendRequests() { return callRpc("load_my_friend_requests"); },
  async removeFriend(friendId) { return callRpc("remove_friend", { p_friend_id: friendId }); },
  async loadMySentFriendRequests() { return callRpc("load_my_sent_friend_requests"); },
  async cancelFriendRequest(requestId) { return callRpc("cancel_friend_request", { p_request_id: requestId }); },
  async answerFriendRequest(requestId, accept) { return callRpc("answer_friend_request", { p_request_id: requestId, p_accept: accept }); },
  /** Friends with only what's safe to show. */
  async loadMyFriends() { return callRpc("load_my_friends"); },
  /** settings = { timedMissions, resetStreakOnMiss, chanceFeatures }. Throws Error("set-by-grown-up"). Returns the profile. */
  async updateMySettings(settings) { return callRpc("update_my_settings", { p_settings: settings }); },
  async updateEquippedItems(itemIds) { return callRpc("update_equipped_items", { p_item_ids: itemIds }); },
  async loadMyChores() {
    const rows = await readMyRows("chores", "id, title", query => query.eq("active", true).order("sort_order").order("created_at"));
    return rows.map(row => ({ id: row.id, title: row.title }));
  },
  async loadMyOwnTasksToday() {
    const rows = await readMyRows("own_tasks", "id, title, done", query => query.eq("added_on", getTodayInUk()).order("created_at"));
    return rows.map(row => ({ id: row.id, title: row.title, done: row.done }));
  },
  async addMyOwnTask(title) { return callRpc("add_my_own_task", { p_title: title }); },
  async setMyOwnTaskDone(ownTaskId, done) { return callRpc("set_my_own_task_done", { p_own_task_id: ownTaskId, p_done: done }); },
  async removeMyOwnTask(ownTaskId) { return callRpc("remove_my_own_task", { p_own_task_id: ownTaskId }); },
  async loadMyScheduledTasks() {
    const rows = await readMyRows("scheduled_tasks", "id, title, days_of_week, times_per_day, set_by", query => query.eq("active", true).order("created_at"));
    return rows.map(row => ({ id: row.id, title: row.title, daysOfWeek: row.days_of_week, timesPerDay: row.times_per_day, setBy: row.set_by }));
  },
  async addMyScheduledTask(task) { return callRpc("add_my_scheduled_task", { p_task: task }); },
  async removeMyScheduledTask(scheduledTaskId) { return callRpc("remove_my_scheduled_task", { p_scheduled_task_id: scheduledTaskId }); },
  async loadScheduledTasksDoneToday() {
    const rows = await readMyRows("scheduled_task_completions", "scheduled_task_id, occurrence", query => query.eq("completed_on", getTodayInUk()));
    return rows.map(row => ({ scheduledTaskId: row.scheduled_task_id, occurrence: row.occurrence }));
  },
  async markScheduledTaskDone(scheduledTaskId, occurrence) { return callRpc("mark_scheduled_task_done", { p_scheduled_task_id: scheduledTaskId, p_occurrence: occurrence }); },
  async unmarkScheduledTaskDone(scheduledTaskId, occurrence) { return callRpc("unmark_scheduled_task_done", { p_scheduled_task_id: scheduledTaskId, p_occurrence: occurrence }); },
  /** { itemId: xp } for the playing buddy. */
  async loadMyItemXp() {
    const { rows } = await readMyBuddyRows("item_xp", "item_id, xp");
    return Object.fromEntries(rows.map(row => [row.item_id, row.xp]));
  },
  /** Throws Error("not-enough-xp"). Returns the item's new XP total. */
  async addXpToItem(itemId, amount) { return callRpc("add_xp_to_item", { p_item_id: itemId, p_amount: amount }); },
  /** { itemColours: { itemId: colourId }, gotAtLevels: { itemId: level } } for the playing buddy's Shop and chance items. */
  async loadMyItemColours() {
    const [{ rows: colours }, { rows: purchases }, { rows: rolls }] = await Promise.all([
      readMyBuddyRows("item_colours", "item_id, colour_id"),
      readMyBuddyRows("purchases", "item_id, got_at_level"),
      readMyBuddyRows("chance_rolls", "won_item_id, won_at_level", query => query.not("won_item_id", "is", null))]);
    const gotAtLevels = {};
    const note = (itemId, level) => { if (itemId && level) gotAtLevels[itemId] = Math.min(gotAtLevels[itemId] ?? Infinity, level); };
    purchases.forEach(row => note(row.item_id, row.got_at_level));
    rolls.forEach(row => note(row.won_item_id, row.won_at_level));
    return { itemColours: Object.fromEntries(colours.map(row => [row.item_id, row.colour_id])), gotAtLevels };
  },
  async setItemColour(itemId, colourId) { return callRpc("set_item_colour", { p_item_id: itemId, p_colour_id: colourId }); },
  async loadMyPurchases() { return (await readMyBuddyRows("purchases", "item_id")).rows.map(row => row.item_id); },
  /** Throws Error("not-for-sale"), Error("already-owned") or Error("not-enough-xp"). Returns { pricePaid }. */
  async buyItem(itemId) { return callRpc("buy_item", { p_item_id: itemId }); },
  /** { wonItemIds, swappedAwayItemIds, triedItemIds, boxesOpenedToday, treasureClaimedThisWeek, claimedMilestones }
      What was won, swapped and tried is the playing buddy's own; the daily and weekly limits are the child's. */
  async loadMyChanceHistory() {
    const today = getTodayInUk();
    const [rolls, profile] = await Promise.all([
      readMyRows("chance_rolls", "kind, outcome, risked_item_id, won_item_id, rolled_on, milestone_buddy_id, milestone_level, buddy_id"),
      loadMyProfile()]);
    const buddyId = profile && profile.active_buddy_id, buddyRolls = rolls.filter(row => row.buddy_id === buddyId);
    const gambles = buddyRolls.filter(row => row.kind === "gamble");
    return {
      wonItemIds: [...new Set(buddyRolls.map(row => row.won_item_id).filter(Boolean))],
      swappedAwayItemIds: gambles.filter(row => row.outcome === "rarer" || row.outcome === "common").map(row => row.risked_item_id),
      triedItemIds: gambles.map(row => row.risked_item_id),
      boxesOpenedToday: rolls.filter(row => row.kind === "box" && row.rolled_on === today).length,
      treasureClaimedThisWeek: rolls.some(row => row.kind === "treasure" && weekStartOf(row.rolled_on) === weekStartOf(today)),
      claimedMilestones: rolls.filter(row => row.kind === "milestone").map(row => `${row.milestone_buddy_id}:${row.milestone_level}`)
    };
  },
  /** Returns { wonItemId, chance, duplicate, xpBack }. Throws Error("chance-off"), Error("daily-limit") or Error("not-enough-xp"). */
  async openMysteryBox() { return callRpc("open_mystery_box"); },
  async keepNewItem(itemId) { return callRpc("keep_new_item", { p_item_id: itemId }); },
  async claimWeeklyTreasure() { return callRpc("claim_weekly_treasure"); },
  async claimMilestoneBox(buddyId, level) { return callRpc("claim_milestone_box", { p_buddy_id: buddyId, p_level: level }); },
  /** Returns { outcome: "rarer"|"keep"|"common", wonItemId, chance, profile }. */
  async takeAChance(itemId) { return callRpc("take_a_chance", { p_item_id: itemId }); },
  async loadChoresDoneToday() {
    return (await readMyRows("chore_completions", "chore_id", query => query.eq("completed_on", getTodayInUk()))).map(row => row.chore_id);
  },
  async markChoreDone(choreId) { return callRpc("mark_chore_done", { p_chore_id: choreId }); },
  async unmarkChoreDone(choreId) { return callRpc("unmark_chore_done", { p_chore_id: choreId }); },
  /** choiceIndex is null if the timer ran out, and for a Feel good mission (didIt: true). The SERVER works out the XP.
      Returns { xpAwarded, brainBoost }. Throws Error("daily-limit"), Error("not-for-age") or Error("no-power"). */
  async saveMissionCompletion(missionId, choiceIndex, { usedHint = false, usedThinkAgain = false, didIt = false } = {}) {
    return callRpc("save_mission_completion", { p_mission_id: missionId, p_choice_index: choiceIndex,
      p_used_hint: usedHint, p_used_think_again: usedThinkAgain, p_did_it: didIt });
  },
  /** { levelPoints, buddyLevelPoints, highestLevelReached, xpEarned, xpSpentOnItems, xpSpentInShop, daysPlayedTotal,
        daysPlayedDates, missionsDoneToday, hintsUsedToday, thinkAgainsUsedToday, missionsLastDoneOn } */
  async loadProgressSummary() { return callRpc("load_progress_summary"); },

  /* ---------- Games tab ---------- */
  /** A finished match (one side on 3). The SERVER works out the XP: 1 per point, 0 if lost with losePointsOnLoss,
      and no more than the daily limit. Returns { xpAwarded, won, hitDailyLimit }. */
  async saveGameResult(game, myPoints, botPoints, losePointsOnLoss) {
    return callRpc("save_game_result", { p_game: game, p_my_points: myPoints, p_bot_points: botPoints, p_lose_points_on_loss: losePointsOnLoss });
  },
  /** A finished Snap game: score is the scored half's total (+5 a snap, -5 a miss). The SERVER works out the XP:
      3 for winning (above 0), 1 for trying, 0 if lost with losePointsOnLoss, within Snap's daily limit. Returns { xpAwarded, won, hitDailyLimit }. */
  async saveSnapResult(mode, score, losePointsOnLoss) {
    return callRpc("save_snap_result", { p_mode: mode, p_score: score, p_lose_points_on_loss: losePointsOnLoss });
  },
  /** XP from each game today, for "X of 10 XP today": { "ping-pong": 4, snap: 3 }. Each game has its own limit. */
  async loadMyGameXpToday() {
    const rows = await readMyRows("game_results", "game, xp_awarded", query => query.eq("played_on", getTodayInUk()));
    return rows.reduce((totals, row) => ({ ...totals, [row.game]: (totals[row.game] || 0) + row.xp_awarded }), {});
  },

  /* ---------- School (feature "school") ---------- */
  /** The signed-in child's timetable and homework, synced from their grown-up's MyChildAtSchool account (school_* tables):
      { linked, updatedAt, schoolDays: ["2026-10-15", ...], lessons: [{ date, start, end, subject, colour, teachers }],
        homework: [{ id, source: "mcas" | "teams", subject, title, dueDate, dueTime, instructions, links: [{ label, url }], setBy, submitted }] }
      Dates and times are UK school times. Lessons from this Monday on; homework due in the last 14 days or later. */
  async loadMySchool() {
    const today = getTodayInUk(), weekDay = new Date(`${today}T12:00:00Z`).getUTCDay(), monday = shiftDate(today, -((weekDay + 6) % 7));
    const [sync, days, lessons, homework] = await Promise.all([
      readMyRows("school_sync", "last_synced_at", query => query.maybeSingle()),
      readMyRows("school_days", "school_day", query => query.gte("school_day", monday).order("school_day")),
      readMyRows("school_lessons", "lesson_date, start_time, end_time, subject, colour, teachers", query => query.gte("lesson_date", monday).order("lesson_date").order("start_time")),
      readMyRows("school_homework", "id, source, subject, title, due_date, due_time, instructions, links, set_by, submitted", query => query.gte("due_date", shiftDate(today, -14)).order("due_date")),
    ]);
    return {
      // Linked once the first sync has worked (a failed first try leaves a row with no last_synced_at).
      linked: !!(sync && sync.last_synced_at), updatedAt: sync && sync.last_synced_at,
      schoolDays: days.map(row => row.school_day),
      lessons: lessons.map(row => ({ date: row.lesson_date, start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5), subject: row.subject, colour: row.colour, teachers: row.teachers })),
      homework: homework.map(row => ({ id: row.id, source: row.source, subject: row.subject, title: row.title, dueDate: row.due_date, dueTime: row.due_time.slice(0, 5),
        instructions: row.instructions, links: Array.isArray(row.links) ? row.links : [], setBy: row.set_by, submitted: row.submitted })),
    };
  },
  /** { homeworkTaskDaysBefore, reminderHour }: how many days before homework is due it shows up as a task on Home
      (0 = on the day), and the hour (7–21, UK time) the day's homework reminder comes. */
  async loadMySchoolSettings() {
    const row = await readMyRows("school_settings", "homework_task_days_before, reminder_hour", query => query.maybeSingle());
    return { homeworkTaskDaysBefore: row ? row.homework_task_days_before : 2, reminderHour: row ? row.reminder_hour : 16 };
  },
  /** Either can be left out to keep it. Throws Error("bad-days") outside 0–7, Error("bad-hour") outside 7–21. */
  async saveMySchoolSettings({ homeworkTaskDaysBefore, reminderHour }) {
    await callRpc("save_my_school_settings", { p_homework_task_days_before: homeworkTaskDaysBefore ?? null, p_reminder_hour: reminderHour ?? null });
  },
  /** Homework ticked off on Home: [{ homeworkId, completedOn }]. */
  async loadMyHomeworkDone() {
    return (await readMyRows("homework_completions", "homework_id, completed_on")).map(row => ({ homeworkId: row.homework_id, completedOn: row.completed_on }));
  },
  /** { xpAwarded, levelPoints } (3 and 2; 0 and 0 if it was already ticked). Late homework can be ticked.
      Throws Error("too-early") or Error("not-found"). */
  async markHomeworkDone(homeworkId) { return callRpc("mark_homework_done", { p_homework_id: homeworkId }); },
  /** Only on the day it was ticked: Error("not-today"); only if its XP isn't spent: Error("xp-spent"); never one collected
      from MCAS: Error("handed-in"). */
  async unmarkHomeworkDone(homeworkId) { await callRpc("unmark_homework_done", { p_homework_id: homeworkId }); },
  /** Homework MCAS says is handed in (due in the last 7 days or later) that wasn't ticked: collects the same XP and
      level points as ticking it. { homework: [{ id, title, subject }], xpAwarded, levelPoints }. */
  async collectHandedInHomework() { return callRpc("collect_handed_in_homework"); },
  /** This device's push subscription ({ endpoint, p256dh, auth } from PushSubscription.toJSON()), for homework reminders.
      Throws Error("too-many-devices") or Error("bad-subscription"). */
  async savePushSubscription({ endpoint, p256dh, auth }) {
    await callRpc("save_my_push_subscription", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
  },
  async removePushSubscription(endpoint) { await callRpc("remove_my_push_subscription", { p_endpoint: endpoint }); },
  /** Grown-ups: a child's lesson reminders. { reminders: [{ id, subject, note, nightBefore, morningOf, toChild, toGrownUps }],
      subjects: the lessons on their synced timetable, eveningHour, morningHour }. */
  async loadChildLessonReminders(childId) {
    const [reminders, settings, lessons] = await Promise.all([
      supabaseClient.from("lesson_reminders").select("id, subject, note, night_before, morning_of, to_child, to_grown_ups").eq("child_id", childId).order("created_at"),
      supabaseClient.from("school_settings").select("lesson_evening_hour, lesson_morning_hour").eq("child_id", childId).maybeSingle(),
      supabaseClient.from("school_lessons").select("subject").eq("child_id", childId),
    ]);
    const failed = reminders.error || settings.error || lessons.error;
    if (failed) throw new Error(failed.message || "load-failed");
    return {
      reminders: reminders.data.map(row => ({ id: row.id, subject: row.subject, note: row.note, nightBefore: row.night_before, morningOf: row.morning_of, toChild: row.to_child, toGrownUps: row.to_grown_ups })),
      subjects: [...new Set(lessons.data.map(row => row.subject))].sort((a, b) => a.localeCompare(b)),
      eveningHour: settings.data ? settings.data.lesson_evening_hour : 20, morningHour: settings.data ? settings.data.lesson_morning_hour : 7,
    };
  },
  /** Returns the reminder. Throws Error("too-many") (20 a child), Error("needs-when") or Error("needs-who"). */
  async addLessonReminder(childId, { subject, note, nightBefore, morningOf, toChild, toGrownUps }) {
    return callRpc("add_lesson_reminder", { p_child_id: childId, p_subject: subject, p_note: note, p_night_before: nightBefore,
      p_morning_of: morningOf, p_to_child: toChild, p_to_grown_ups: toGrownUps });
  },
  async removeLessonReminder(childId, reminderId) { await callRpc("remove_lesson_reminder", { p_child_id: childId, p_reminder_id: reminderId }); },
  /** eveningHour 15–22, morningHour 5–10 (UK time). */
  async setLessonReminderTimes(childId, eveningHour, morningHour) {
    await callRpc("set_lesson_reminder_times", { p_child_id: childId, p_evening_hour: eveningHour, p_morning_hour: morningHour });
  },

  /* ---------- Grown-up accounts ---------- */
  /** The sign-up email again. Throws Error("too-soon") inside Supabase's wait between emails. */
  async resendSignUpEmail(email) {
    const { error } = await supabaseClient.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${location.origin}/voxie` } });
    if (error) throw new Error(/rate|seconds|security purposes/i.test(error.message) ? "too-soon" : "save-failed");
  },
  /** A grown-up signs up: { displayName, email, password }. With "Confirm email" on there's no session until they
      click the link, so this returns { needsEmailConfirmation: true }; otherwise their profile.
      Throws Error("needs-name"), Error("bad-email"), Error("too-short") or Error("email-taken"). */
  async signUpParent({ displayName, email, password }) {
    const name = displayName.trim(), cleanEmail = email.trim().toLowerCase();
    if (!name || name.length > 30) throw new Error("needs-name");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new Error("bad-email");
    if (password.length < MIN_PASSCODE_LENGTH) throw new Error("too-short");
    const { data, error } = await supabaseClient.auth.signUp({ email: cleanEmail, password,
      options: { data: { display_name: name }, emailRedirectTo: `${location.origin}/voxie` } });
    if (error) throw new Error(/registered|exists/i.test(error.message) ? "email-taken" : /password/i.test(error.message) ? "too-short" : "save-failed");
    // An email that already has an account comes back with no identities (Supabase doesn't say so, to protect privacy).
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error("email-taken");
    if (!data.session) return { needsEmailConfirmation: true };
    return loadMyProfile();
  },
  /** [{ id, displayName, setupComplete, level, petName, look }] */
  async loadMyChildren() { return callRpc("load_my_children"); },
  /** The grown-up's unseen notifications, oldest first: [{ id, childId, kind: "game-name-changed", oldName, newName, createdAt }] */
  async loadMyNotifications() {
    const parentId = await requireUserId();
    const { data, error } = await supabaseClient.from("parent_notifications").select("id, child_id, kind, old_name, new_name, created_at")
      .eq("parent_id", parentId).is("seen_at", null).order("created_at");
    if (error) throw new Error(error.message || "load-failed");
    return data.map(row => ({ id: row.id, childId: row.child_id, kind: row.kind, oldName: row.old_name, newName: row.new_name, createdAt: row.created_at }));
  },
  async markNotificationsSeen(notificationIds) { return callRpc("mark_notifications_seen", { p_ids: notificationIds }); },
  /** { child, settings, tasks, stats, login:{ username }, grownUps, birth:{ month, year } }. Throws Error("not-your-child"). */
  async loadChildOverview(childId) {
    const overview = await callRpc("load_child_overview", { p_child_id: childId });
    const inputs = overview.stats.streakInputs;
    overview.stats.streak = calculateStreak(inputs.daysPlayedDates, getTodayInUk(), inputs.resetStreakOnMiss, inputs.streakShield);
    return overview;
  },
  async addChildTask(childId, task) { return callRpc("add_child_task", { p_child_id: childId, p_task: task }); },
  async removeChildTask(childId, taskId) { return callRpc("remove_child_task", { p_child_id: childId, p_task_id: taskId }); },
  async updateChildSettings(childId, settings) { return callRpc("update_child_settings", { p_child_id: childId, p_settings: settings }); },
  /** A grown-up changes their child's birth month and year (the child can't). Throws Error("bad-birth-month"). */
  async setChildBirthMonth(childId, { birthMonth, birthYear }) {
    return callRpc("set_child_birth_month", { p_child_id: childId, p_birth_month: birthMonth, p_birth_year: birthYear });
  },
  /** { birthMonth, birthYear, username, passcode }. Returns the child (as in loadMyChildren). Throws Error("bad-birth-month"),
      Error("bad-username"), Error("username-taken"), Error("too-short") or Error("limit"). */
  async addChild({ birthMonth, birthYear, username, passcode }) {
    return callEdgeFunction("add-child", { birthMonth, birthYear, username: username.trim().toLowerCase(), passcode });
  },
  async setChildPasscode(childId, passcode) { return callEdgeFunction("set-child-passcode", { childId, passcode }); },
  /** Returns { code, expiresAt }. */
  async createGrownUpInvite(childId) { return callRpc("create_grown_up_invite", { p_child_id: childId }); },
  /** Deletes the child's account and everything in it. Only their ONLY grown-up can (Error("not-only-grown-up") otherwise). */
  async deleteChildAccount(childId) { return callEdgeFunction("delete-child-account", { childId }); },
  /** Throws Error("bad-code"), Error("already-linked") or Error("confusing-letters"). Returns the child. */
  async linkChildWithCode(code) { return callRpc("link_child_with_code", { p_code: code }); },
  /** Only when another grown-up looks after them (Error("last-grown-up") otherwise). */
  async unlinkChild(childId) { return callRpc("unlink_child", { p_child_id: childId }); }
};

