/* School tab (feature "school"): the child's timetable and homework from their grown-up's MyChildAtSchool (MCAS)
   account, and homework as tasks on Home.

   - school_sync, school_days, school_lessons and school_homework are written ONLY by the MCAS sync (service role,
     coming next). The app reads them; children and grown-ups can't change them. The sync upserts homework by
     (child_id, source, external_id) and never deletes a row a child has ticked, so their XP stays put.
   - school_settings: how many days before homework is due it shows up in Today's tasks (0–7, default 2).
   - homework_completions: homework ticked off on Home. Each one gives HOMEWORK_XP (3) XP to spend and
     HOMEWORK_LEVEL_POINTS (2) level points to the buddy playing at the time, once per piece of homework.
     Homework isn't one of the 10 tasks a day. Keep both numbers the same as in app.js.
   Needs 20261007090000_voxie_feature_flags.sql (the "school" feature) and 20261008090000_voxie_buddy_inventories.sql. */

/* ---------- Synced from MCAS ---------- */
create table public.school_sync (
  child_id uuid primary key references public.profiles (id) on delete cascade,
  school_name text not null default '',
  last_synced_at timestamptz
);

-- The days the school is open (MCAS lists them per week), so INSET days and holidays show as "no school".
create table public.school_days (
  child_id uuid not null references public.profiles (id) on delete cascade,
  school_day date not null,
  primary key (child_id, school_day)
);

-- One row per lesson. A lesson taught by two teachers is one row with both names.
create table public.school_lessons (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.profiles (id) on delete cascade,
  lesson_date date not null,
  start_time time not null,
  end_time time not null,
  subject text not null check (char_length(subject) <= 100),
  colour text not null default '' check (colour ~ '^([0-9a-fA-F]{6})?$'),   -- MCAS subject colour, hex without "#"
  teachers text[] not null default '{}',
  mcas_class_id bigint,                                                      -- MCAS CollectionID
  unique (child_id, lesson_date, start_time, mcas_class_id)
);
create index school_lessons_child_day on public.school_lessons (child_id, lesson_date);

create table public.school_homework (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.profiles (id) on delete cascade,
  source text not null check (source in ('mcas', 'teams')),
  external_id text not null,                                   -- MCAS HomeworkID or the Teams assignment id
  subject text not null default '' check (char_length(subject) <= 100),
  title text not null check (char_length(title) between 1 and 300),
  due_date date not null,
  due_time time not null default '23:59',
  instructions text not null default '',                       -- plain text: the sync strips the teacher's HTML
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),   -- [{ "label", "url" }]
  set_by text not null default '',
  submitted boolean not null default false,                    -- MCAS says it's handed in
  synced_at timestamptz not null default now(),
  unique (child_id, source, external_id)
);
create index school_homework_child_due on public.school_homework (child_id, due_date);

/* ---------- Voxie's own ---------- */
create table public.school_settings (
  child_id uuid primary key references public.profiles (id) on delete cascade,
  homework_task_days_before smallint not null default 2 check (homework_task_days_before between 0 and 7)
);

create table public.homework_completions (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.profiles (id) on delete cascade,
  buddy_id uuid references public.buddies (id) on delete cascade,   -- the buddy playing when it was ticked
  homework_id uuid not null references public.school_homework (id) on delete cascade,
  completed_on date not null,
  xp_awarded int not null check (xp_awarded >= 0),
  level_points int not null check (level_points >= 0),
  created_at timestamptz not null default now(),
  unique (child_id, homework_id)
);
create index homework_completions_buddy on public.homework_completions (buddy_id);

/* ---------- Who can read what ----------
   The child and their linked grown-ups read everything here; nobody writes except through the RPCs below
   (and the sync, with the service role). */
do $$
declare table_name text;
begin
  foreach table_name in array array['school_sync', 'school_days', 'school_lessons', 'school_homework', 'school_settings', 'homework_completions']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy "read own or linked child rows" on public.%I for select to authenticated using (private.can_see_child(child_id))', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;

/* ---------- Homework counts towards XP, level points and days played ---------- */
-- XP to spend: missions, games and homework, for the playing buddy.
create or replace function private.xp_earned(p_child_id uuid) returns int
language sql stable set search_path = '' as $$
  select (coalesce((select sum(xp_awarded) from public.mission_completions where child_id = p_child_id and buddy_id = private.active_buddy(p_child_id)), 0)
        + coalesce((select sum(xp_awarded) from public.game_results where child_id = p_child_id and buddy_id = private.active_buddy(p_child_id)), 0)
        + coalesce((select sum(xp_awarded) from public.homework_completions where child_id = p_child_id and buddy_id = private.active_buddy(p_child_id)), 0))::int
$$;

-- Level points per buddy: 1 per task ticked while that buddy was playing, plus each homework's level points.
create or replace function private.buddy_points(p_child_id uuid)
returns table (buddy_id uuid, points int)
language sql stable set search_path = '' as $$
  select b.id,
    ((select count(*) from public.chore_completions c where c.child_id = p_child_id and c.buddy_id = b.id)
   + (select count(*) from public.scheduled_task_completions s where s.child_id = p_child_id and s.buddy_id = b.id)
   + (select count(*) from public.own_tasks o where o.child_id = p_child_id and o.done and o.done_by_buddy_id = b.id)
   + (select coalesce(sum(h.level_points), 0) from public.homework_completions h where h.child_id = p_child_id and h.buddy_id = b.id))::int
  from public.buddies b where b.child_id = p_child_id
$$;

-- Days with any task, homework or mission done (a day counts as played).
create or replace function private.days_played_dates(p_child_id uuid) returns date[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(day order by day), '{}') from (
    select completed_on as day from public.chore_completions where child_id = p_child_id
    union select added_on from public.own_tasks where child_id = p_child_id and done
    union select completed_on from public.scheduled_task_completions where child_id = p_child_id
    union select completed_on from public.mission_completions where child_id = p_child_id
    union select completed_on from public.homework_completions where child_id = p_child_id
  ) days
$$;

/* ---------- RPCs (children with the "school" feature) ---------- */
create or replace function private.homework_task_days_before(p_child_id uuid) returns int
language sql stable set search_path = '' as $$
  select coalesce((select homework_task_days_before from public.school_settings where child_id = p_child_id), 2)
$$;

/* markHomeworkDone(homeworkId) → { xpAwarded, levelPoints }. Only homework that's on Home today: yours, and due within
   your "days before" setting (or late). Ticking it again does nothing ({ 0, 0 }). */
create or replace function public.mark_homework_done(p_homework_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_child();   -- locks the profile, so a double tap can't award twice
  homework_xp constant int := 3;
  homework_level_points constant int := 2;
  due date;
  added int;
begin
  if not private.has_feature(me, 'school') then raise exception 'not-available'; end if;
  select due_date into due from public.school_homework where id = p_homework_id and child_id = me;
  if due is null then raise exception 'not-found'; end if;
  if due - private.homework_task_days_before(me) > private.today_uk() then raise exception 'too-early'; end if;
  insert into public.homework_completions (child_id, buddy_id, homework_id, completed_on, xp_awarded, level_points)
  values (me, (select active_buddy_id from public.profiles where id = me), p_homework_id, private.today_uk(), homework_xp, homework_level_points)
  on conflict (child_id, homework_id) do nothing;
  get diagnostics added = row_count;
  perform private.record_highest_level(me);
  return jsonb_build_object('xpAwarded', case when added > 0 then homework_xp else 0 end,
                            'levelPoints', case when added > 0 then homework_level_points else 0 end);
end $$;

/* unmarkHomeworkDone(homeworkId): only on the day it was ticked, like other tasks, and only if its XP hasn't been
   spent yet (otherwise "xp-spent"), so un-ticking can't leave the child owing XP. */
create or replace function public.unmark_homework_done(p_homework_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(); ticked public.homework_completions;
begin
  if not private.has_feature(me, 'school') then raise exception 'not-available'; end if;
  select * into ticked from public.homework_completions where child_id = me and homework_id = p_homework_id;
  if ticked.id is null then return; end if;
  if ticked.completed_on <> private.today_uk() then raise exception 'not-today'; end if;
  -- XP belongs to the buddy that earned it, so after switching buddy the tick stays.
  if ticked.buddy_id is distinct from private.active_buddy(me)
     or private.xp_earned(me) - private.xp_spent_on_items(me) - private.xp_spent_in_shop(me) < ticked.xp_awarded then
    raise exception 'xp-spent';
  end if;
  delete from public.homework_completions where id = ticked.id;
end $$;

-- saveMySchoolSettings({ homeworkTaskDaysBefore }): 0–7. Not locked by the grown-up's settings lock.
create or replace function public.save_my_school_settings(p_homework_task_days_before int) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(false);
begin
  if not private.has_feature(me, 'school') then raise exception 'not-available'; end if;
  if p_homework_task_days_before is null or p_homework_task_days_before not between 0 and 7 then raise exception 'bad-days'; end if;
  insert into public.school_settings (child_id, homework_task_days_before) values (me, p_homework_task_days_before)
  on conflict (child_id) do update set homework_task_days_before = excluded.homework_task_days_before;
end $$;

revoke execute on function private.homework_task_days_before(uuid) from public, anon, authenticated;
revoke execute on function public.mark_homework_done(uuid), public.unmark_homework_done(uuid), public.save_my_school_settings(int) from public, anon;
grant execute on function public.mark_homework_done(uuid), public.unmark_homework_done(uuid), public.save_my_school_settings(int) to authenticated;
