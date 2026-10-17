# Voxie Supabase backend: notes

Files:

- `supabase/migrations/20261004120000_voxie_backend.sql`: paste into the SQL Editor and run it once.
- `supabase/migrations/20261007090000_voxie_feature_flags.sql`: per-user feature flags (see `FEATURES.md`).
- `supabase/migrations/20261007100000_voxie_games.sql`: the Games tab (Ping pong results and their XP). Run after the feature flags.
- `supabase/migrations/20261007110000_voxie_snap.sql`: Snap, and a 10 XP daily limit for each game. Run after the games migration.
- `supabase/migrations/20261007120000_voxie_games_for_everyone.sql`: Games no longer need a feature flag (the flag tables stay for future features).
- `supabase/migrations/20261008090000_voxie_buddy_inventories.sql`: every buddy has its own XP, items, house, place and gear, and its own shuffled unlock order and Shop (`buddy_unlocks`, `buddy_shop`, `option_catalogue`). Run it **before** deploying the app that reads those tables.
- `supabase/migrations/20261015090000_voxie_school.sql`: the School tab (feature `school`): timetable and homework tables filled by the MCAS sync, the homework "days before" setting, and homework ticks (3 XP + 2 level points each). Test data: `supabase/snippets/voxie_school_sample_data.sql`.
- `supabase/functions/_shared/voxie.ts` plus the `add-child`, `set-child-passcode` and `delete-child-account` folders.

## Calling conventions

- **RPCs:** `const { data, error } = await supabase.rpc("buy_item", { p_item_id: itemId }); if (error) throw new Error(error.message);`
  `error.message` is the exact dataLayer code (`"not-enough-xp"` etc.). Every argument starts with `p_`.
- **Edge Functions:** `const { data, error } = await supabase.functions.invoke("add-child", { body }); if (error) throw new Error((await error.context.json()).error);`
- **"Returns the profile"** means the RPC returns the same JSON object as a row of the `my_profile` view.
- `pet_look` comes back exactly as saved. Keep merging `DEFAULT_PET_LOOK` over it in the app, as the fake does.
- **Today:** table reads that need "today" use `getTodayInUk()` in the app. That is the same London date the server uses.

## 1. dataLayer function → backend

| dataLayer function | Reads table / calls | Arguments | Returns |
|---|---|---|---|
| getSignedInProfile | view `my_profile` (`.select("*").maybeSingle()`) | none | profile or null |
| signIn | if `@`: `auth.signInWithPassword`; else RPC `email_for_username` then `auth.signInWithPassword`; then `my_profile` | `p_username` | hidden email or null (null / auth error → throw `wrong-details`) |
| requestPasscodeReset | `auth.resetPasswordForEmail(email, { redirectTo: "<site>/voxie/new-passcode" })` | none | always succeeds |
| signOut | `auth.signOut()` | none | none |
| saveProfileSetup | `save_profile_setup` | `p_look` (the look object as is) | profile |
| updateMyProfile | `update_my_profile` | `p_look` | profile |
| loadMyBuddies | table `buddies` (order `adopted_on, created_at`) + `my_profile.active_buddy_id` | none | map to `{ id, petType, petName, petLook, themeColour, isActive }` |
| rebirthAsNewPet | `rebirth_as_new_pet` | `p_pet_type, p_pet_name` | profile |
| setActiveBuddy | `set_active_buddy` | `p_buddy_id` | profile |
| loadMyBuddyDeals | tables `buddy_unlocks`, `buddy_shop` (the playing buddy's rows) | none | `{ unlockLevels: { kind: { id: level } }, shopStock: { itemId: inStock } }` |
| searchPlayers | `search_players` | `p_search_text` | `[{ id, displayName, petType, petLook, relationship, requestId }]` |
| sendFriendRequest | `send_friend_request` | `p_to_child_id` | none |
| loadMyFriendRequests | `load_my_friend_requests` | none | `[{ id, fromChildId, displayName, petType, petLook }]` |
| loadMySentFriendRequests | `load_my_sent_friend_requests` | none | `[{ id, toChildId, displayName, petType, petLook }]` |
| answerFriendRequest | `answer_friend_request` | `p_request_id, p_accept` | none |
| cancelFriendRequest | `cancel_friend_request` | `p_request_id` | none |
| removeFriend | `remove_friend` | `p_friend_id` | none |
| loadMyFriends | `load_my_friends` | none | `[{ id, displayName, setupComplete, level, xpEarned, look:{ displayName, petType, petName, petLook, themeColour, location, level, equipped, itemColours, retiredBuddies } }]` |
| updateMySettings | `update_my_settings` | `p_settings` (`{ timedMissions, resetStreakOnMiss, chanceFeatures }`) | profile |
| updateEquippedItems | `update_equipped_items` | `p_item_ids` (text[]) | profile |
| loadMyChores | table `chores` (`active`, order `sort_order`) | none | map to `{ id, title }` |
| loadMyOwnTasksToday | table `own_tasks` (`added_on = today`) | none | map to `{ id, title, done }` |
| addMyOwnTask | `add_my_own_task` | `p_title` | `{ id, title, done }` |
| setMyOwnTaskDone | `set_my_own_task_done` | `p_own_task_id, p_done` | none |
| removeMyOwnTask | `remove_my_own_task` | `p_own_task_id` | none |
| loadMyScheduledTasks | table `scheduled_tasks` (`active`) | none | map to `{ id, title, daysOfWeek, timesPerDay, setBy }` |
| addMyScheduledTask | `add_my_scheduled_task` | `p_task` (`{ title, daysOfWeek, timesPerDay }`) | that task shape |
| removeMyScheduledTask | `remove_my_scheduled_task` | `p_scheduled_task_id` | none |
| loadScheduledTasksDoneToday | table `scheduled_task_completions` (`completed_on = today`) | none | map to `{ scheduledTaskId, occurrence }` |
| markScheduledTaskDone / unmarkScheduledTaskDone | `mark_scheduled_task_done` / `unmark_scheduled_task_done` | `p_scheduled_task_id, p_occurrence` | none |
| loadMyItemXp | table `item_xp` | none | `{ itemId: xp }` |
| addXpToItem | `add_xp_to_item` | `p_item_id, p_amount` | new total (int) |
| loadMyItemColours | tables `item_colours`, `purchases`, `chance_rolls` (build `gotAtLevels` as `fakeGotAtLevels` does) | none | `{ itemColours, gotAtLevels }` |
| setItemColour | `set_item_colour` | `p_item_id, p_colour_id` | none |
| loadMyPurchases | table `purchases` | none | item ids |
| buyItem | `buy_item` | `p_item_id` | `{ pricePaid }` |
| loadMyChanceHistory | table `chance_rolls` (same logic as the fake) | none | as the fake |
| openMysteryBox | `open_mystery_box` | none | `{ wonItemId, chance, duplicate, xpBack }` |
| keepNewItem | `keep_new_item` | `p_item_id` | none |
| claimWeeklyTreasure | `claim_weekly_treasure` | none | `{ wonItemId, chance, duplicate, xpBack }` |
| claimMilestoneBox | `claim_milestone_box` | `p_buddy_id, p_level` | `{ wonItemId, chance, duplicate, xpBack }` |
| takeAChance | `take_a_chance` | `p_item_id` | `{ outcome, wonItemId, chance, profile }` |
| loadChoresDoneToday | table `chore_completions` (`completed_on = today`) | none | chore ids |
| markChoreDone / unmarkChoreDone | `mark_chore_done` / `unmark_chore_done` | `p_chore_id` | none |
| saveMissionCompletion | `save_mission_completion` | `p_mission_id, p_choice_index, p_used_hint, p_used_think_again, p_did_it` | `{ xpAwarded, brainBoost }` (+ `alreadySaved`) |
| loadProgressSummary | `load_progress_summary` | none | exactly the fake's shape |
| saveGameResult | `save_game_result` | `p_game, p_my_points, p_bot_points, p_lose_points_on_loss` | `{ xpAwarded, won, hitDailyLimit }` |
| saveSnapResult | `save_snap_result` | `p_mode, p_score, p_lose_points_on_loss` | `{ xpAwarded, won, hitDailyLimit }` |
| loadMyGameXpToday | table `game_results` (today's rows) | none | XP from each game today, e.g. `{ "ping-pong": 4, snap: 3 }` |
| loadMySchool | tables `school_sync`, `school_days`, `school_lessons`, `school_homework` (from this Monday; homework due in the last 14 days or later) | none | `{ linked, updatedAt, schoolDays, lessons, homework }` |
| loadMySchoolSettings | table `school_settings` (`.maybeSingle()`, default 2) | none | `{ homeworkTaskDaysBefore }` |
| saveMySchoolSettings | `save_my_school_settings` | `p_homework_task_days_before` | none |
| loadMyHomeworkDone | table `homework_completions` | none | `[{ homeworkId, completedOn }]` |
| markHomeworkDone | `mark_homework_done` | `p_homework_id` | `{ xpAwarded, levelPoints }` |
| unmarkHomeworkDone | `unmark_homework_done` | `p_homework_id` | none |
| signUpParent | `auth.signUp({ email, password, options: { data: { display_name }, emailRedirectTo } })`; the trigger makes the profile | none | profile from `my_profile` |
| loadMyChildren | `load_my_children` | none | `[{ id, displayName, setupComplete, level, petName, look }]` |
| loadChildOverview | `load_child_overview` | `p_child_id` | the fake's shape; see the streak note below |
| setChildBirthMonth | `set_child_birth_month` | `p_child_id, p_birth_month, p_birth_year` | none |
| addChildTask | `add_child_task` | `p_child_id, p_task` | task shape |
| removeChildTask | `remove_child_task` | `p_child_id, p_task_id` | none |
| updateChildSettings | `update_child_settings` | `p_child_id, p_settings` (`{ …, childCanChangeSettings }`) | none |
| createGrownUpInvite | `create_grown_up_invite` | `p_child_id` | `{ code, expiresAt }` |
| linkChildWithCode | `link_child_with_code` | `p_code` | child (as loadMyChildren) |
| unlinkChild | `unlink_child` | `p_child_id` | none |
| **addChild** | Edge `add-child` | body `{ birthMonth, birthYear, username, passcode }` | child (as loadMyChildren) |
| **setChildPasscode** | Edge `set-child-passcode` | body `{ childId, passcode }` | `{ ok: true }` |
| **deleteChildAccount** | Edge `delete-child-account` | body `{ childId }` | `{ ok: true }` |

The service-role-only database functions are `create_child_profile` and `delete_child_data`. Only the Edge Functions call them; the browser can't.

## 2. Set by hand in the dashboard

1. **Authentication → Sign In / Providers → Email:** keep Email on, set **minimum password length = 6** (matches `MIN_PASSCODE_LENGTH`), and turn **Secure email change ON**. Secure email change needs a confirmation at the old address too. A child's old address is the hidden `.invalid` one, so a child can never swap in a real email with `auth.updateUser`.
2. **Confirm email:** decide this one, see point 3 below.
3. **Authentication → URL Configuration:** set Site URL to your live site. Add these Redirect URLs: `https://<your-site>/voxie/new-passcode`, plus your local one (e.g. `http://localhost:3000/voxie/new-passcode`).
4. **Authentication → Emails → SMTP (the page you have open):** set up custom SMTP. Supabase's built-in sender only mails your own team's addresses and is heavily rate-limited, so grown-ups wouldn't get reset or confirm emails without it.
5. **Edge Functions:** deploy all three with `supabase functions deploy add-child set-child-passcode delete-child-account`. Leave "Verify JWT" on (the default). There are **no secrets to add**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
6. **API settings → Exposed schemas:** leave it as `public` only. Never expose `private`.
7. **Your catalogue script:** run it with the service-role key from your machine or server, never from the browser. Upsert, don't truncate.

## 3. Assumptions and things to check

1. **Rebirth rule.** `rebirthsAvailable()` wasn't in the files I had. I used: one rebirth per 100 levels each buddy has reached, minus one for every buddy after the first. That matches Robin's test data (Nugget at 101, already reborn as Bubbles, so none left). If your function differs, change `rebirth_as_new_pet`.
2. **Streak.** `calculateStreak()` wasn't in the files either, so `load_child_overview` returns `stats.streakInputs = { daysPlayedDates, resetStreakOnMiss, streakShield }`. In dataLayer, set `stats.streak = calculateStreak(i.daysPlayedDates, today, i.resetStreakOnMiss, i.streakShield)`. Those are the same inputs the fake uses.
3. **Parent sign-up and Confirm email.** The fake signs the grown-up straight in. With Confirm email **on**, `signUp` returns no session, so the app needs a "check your email" step. If the email is already registered, Supabase returns no error, but `data.user.identities` is empty; map that to `email-taken`. I'd keep confirmation on so every grown-up account has a real, checked email. Turning it off matches the fake exactly.
4. **Delete account.** Your brief says only a child's only grown-up can delete the account. The file doesn't say that, so I added a new error, `not-only-grown-up`, which the app will need a message for.
5. **New error codes.** These only happen if the app sends bad data: `bad-name`, `bad-look`, `bad-task`, `not-found` (ticking a task that isn't yours or isn't on today), `not-owned` (equipping or adding XP to something not owned, or adding XP to a house item), `too-long` (passcode over 72), `bad-request`.
6. **Mission ages.** `MISSION_MIN_AGE` and `MISSION_MAX_AGE` weren't in the files, so I hardcoded 5 and 13 from the comment in `missionsForAge`.
7. **No pet or location catalogue.** The server only checks that pet types, colours and locations look like ids. It doesn't check they exist or are unlocked at the child's level. These are cosmetic only and don't affect XP or chance. A `pet_catalogue` table would close this if you want it.
8. **Usernames can be checked.** `email_for_username` returns null for unknown usernames, as briefed, so anyone can test whether a username exists. The alternative is to return a dummy address so the login simply fails.
9. **Strangers can find each other.** Search lets any set-up child find and friend-request any other child. With the ICO Children's Code in mind, consider letting grown-ups approve friend requests. That's your call. The data shown is already limited to safe fields.
10. **Chores.** dataLayer has no "add chore" function, so `chores` is only filled by hand. Grown-ups' tasks from the app go into `scheduled_tasks` with `set_by = 'parent'`.
11. **Audit trail.** Every chance roll also stores `random_number`, the dice value used, so any "that's not fair!" can be checked.

## 4. What was tested

I ran the migration in a local Postgres (PGlite) with a stubbed `auth` schema and put the RPCs through 85+ checks:

- **Levels:** level maths identical to the JS for 0–1,200 points.
- **Limits:** daily task, mission, box, hint and invite limits.
- **XP and chance:** XP and Bargain pricing, box odds over 20,000 rolls, Take a chance, milestones and rebirth.
- **Friends:** search and friends return safe fields only.
- **Access:** RLS isolation between children and between families, no direct writes, and no access to private helpers.
- **Grown-ups:** invites, link and unlink, and delete.

The Edge Functions type-check under Deno. They haven't been run against a live project.
