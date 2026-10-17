/* Lesson reminders (feature "school"), and grown-ups getting homework reminders too.
   Needs 20261016110000_voxie_school_reminder_time_and_handed_in.sql.

   - lesson_reminders: set by a linked grown-up on the child's tab, e.g. Core PE → "Get the PE kit and key ready".
     Each one goes the night before and/or the morning of a day the child has that lesson (from the MCAS timetable),
     to the child and/or their grown-ups. Children can read theirs but not change them.
   - school_settings.lesson_evening_hour / lesson_morning_hour: when they go (UK time), set by the grown-up.
     All of a child's lessons for that day come in one notification. lesson_reminders_sent stops repeats.
   - claim_homework_reminders now also returns the child's grown-ups' devices, so they get a copy. */

create table public.lesson_reminders (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 100),   -- exactly as the timetable has it, e.g. "Core PE"
  note text not null default '' check (char_length(note) <= 120),
  night_before boolean not null default true,
  morning_of boolean not null default true,
  to_child boolean not null default true,
  to_grown_ups boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (night_before or morning_of),
  check (to_child or to_grown_ups)
);
create index lesson_reminders_child on public.lesson_reminders (child_id);
alter table public.lesson_reminders enable row level security;
create policy "read own or linked child rows" on public.lesson_reminders for select to authenticated using (private.can_see_child(child_id));
grant select on public.lesson_reminders to authenticated;
grant all on public.lesson_reminders to service_role;

create table public.lesson_reminders_sent (
  child_id uuid not null references public.profiles (id) on delete cascade,
  for_date date not null,
  period text not null check (period in ('night-before', 'morning-of')),
  primary key (child_id, for_date, period)
);
alter table public.lesson_reminders_sent enable row level security;
revoke all on public.lesson_reminders_sent from anon, authenticated;
grant all on public.lesson_reminders_sent to service_role;

alter table public.school_settings
  add column lesson_evening_hour smallint not null default 20 check (lesson_evening_hour between 15 and 22),
  add column lesson_morning_hour smallint not null default 7 check (lesson_morning_hour between 5 and 10);

/* ---------- Grown-up RPCs ---------- */
-- addLessonReminder(childId, { subject, note, nightBefore, morningOf, toChild, toGrownUps }) → the reminder. At most 20 a child.
create or replace function public.add_lesson_reminder(p_child_id uuid, p_subject text, p_note text, p_night_before boolean, p_morning_of boolean,
  p_to_child boolean, p_to_grown_ups boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_my_child(p_child_id); added public.lesson_reminders;
begin
  if not private.has_feature(p_child_id, 'school') then raise exception 'not-available'; end if;
  if coalesce(trim(p_subject), '') = '' then raise exception 'needs-subject'; end if;
  if not (coalesce(p_night_before, false) or coalesce(p_morning_of, false)) then raise exception 'needs-when'; end if;
  if not (coalesce(p_to_child, false) or coalesce(p_to_grown_ups, false)) then raise exception 'needs-who'; end if;
  if (select count(*) from public.lesson_reminders where child_id = p_child_id) >= 20 then raise exception 'too-many'; end if;
  insert into public.lesson_reminders (child_id, subject, note, night_before, morning_of, to_child, to_grown_ups, created_by)
  values (p_child_id, trim(p_subject), left(trim(coalesce(p_note, '')), 120), p_night_before, p_morning_of, p_to_child, p_to_grown_ups, me)
  returning * into added;
  return jsonb_build_object('id', added.id, 'subject', added.subject, 'note', added.note, 'nightBefore', added.night_before,
    'morningOf', added.morning_of, 'toChild', added.to_child, 'toGrownUps', added.to_grown_ups);
end $$;

create or replace function public.remove_lesson_reminder(p_child_id uuid, p_reminder_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_my_child(p_child_id);
  delete from public.lesson_reminders where id = p_reminder_id and child_id = p_child_id;
end $$;

-- setLessonReminderTimes(childId, eveningHour, morningHour): 15–22 and 5–10, UK time.
create or replace function public.set_lesson_reminder_times(p_child_id uuid, p_evening_hour int, p_morning_hour int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_my_child(p_child_id);
  if not private.has_feature(p_child_id, 'school') then raise exception 'not-available'; end if;
  if p_evening_hour is null or p_evening_hour not between 15 and 22 or p_morning_hour is null or p_morning_hour not between 5 and 10 then raise exception 'bad-hour'; end if;
  insert into public.school_settings (child_id, lesson_evening_hour, lesson_morning_hour) values (p_child_id, p_evening_hour, p_morning_hour)
  on conflict (child_id) do update set lesson_evening_hour = excluded.lesson_evening_hour, lesson_morning_hour = excluded.lesson_morning_hour;
end $$;

/* ---------- For send-reminders (service role) ---------- */
create or replace function private.child_name(p_child_id uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(display_name, ''), username, 'Your child') from public.profiles where id = p_child_id
$$;
create or replace function private.devices_for(p_user_ids uuid[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::jsonb)
  from public.push_subscriptions where user_id = any (p_user_ids)
$$;
create or replace function private.grown_ups_of(p_child_id uuid) returns uuid[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(parent_id), '{}') from public.family_links where child_id = p_child_id
$$;

/* claimHomeworkReminders(anyHour) → [{ childId, childName, homework, devices, grownUpDevices }]. As before, and a child
   counts if they OR one of their grown-ups has reminders on; the grown-ups get a copy at the child's time. */
drop function public.claim_homework_reminders(boolean);
create or replace function public.claim_homework_reminders(p_any_hour boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  now_uk timestamp := now() at time zone 'Europe/London';
  today date := (now() at time zone 'Europe/London')::date;
  result jsonb;
begin
  with children as (
    select profile.id as child_id
    from public.profiles profile
    where profile.role = 'child'
      and private.has_feature(profile.id, 'school')
      and (p_any_hour or private.reminder_hour(profile.id) = extract(hour from now_uk))
      and exists (select 1 from public.push_subscriptions device
                  where device.user_id = profile.id or device.user_id = any (private.grown_ups_of(profile.id)))
  ), due as (
    select homework.child_id, homework.title, homework.subject, homework.due_date, homework.due_time
    from public.school_homework homework
    join children on children.child_id = homework.child_id
    where not homework.submitted
      and homework.due_date + homework.due_time > now_uk
      and not exists (select 1 from public.homework_completions tick where tick.homework_id = homework.id)
      and (homework.due_date <= today + 1 or homework.due_date - private.homework_task_days_before(homework.child_id) = today)
  ), claimed as (
    insert into public.push_reminders_sent (child_id, sent_on)
    select distinct child_id, today from due
    on conflict do nothing
    returning child_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'childId', claimed.child_id,
    'childName', private.child_name(claimed.child_id),
    'homework', (select jsonb_agg(jsonb_build_object('title', due.title, 'subject', due.subject, 'dueDate', due.due_date, 'dueTime', to_char(due.due_time, 'HH24:MI'))
                 order by due.due_date, due.due_time) from due where due.child_id = claimed.child_id),
    'devices', private.devices_for(array[claimed.child_id]),
    'grownUpDevices', private.devices_for(private.grown_ups_of(claimed.child_id)))), '[]'::jsonb)
  into result
  from claimed;
  return result;
end $$;

/* claimLessonReminders(anyHour) → [{ childId, childName, period: "night-before" | "morning-of", date,
     childLessons: [{ subject, note, start }], grownUpLessons: [...], devices, grownUpDevices }]
   The night before goes at the child's lesson_evening_hour about tomorrow; the morning one at lesson_morning_hour
   about today. Only lessons on the timetable that day (so nothing in holidays). p_any_hour sends both now. */
create or replace function public.claim_lesson_reminders(p_any_hour boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  now_uk timestamp := now() at time zone 'Europe/London';
  today date := (now() at time zone 'Europe/London')::date;
  hour_now int := extract(hour from now_uk)::int;
  result jsonb;
begin
  with slots as (
    select children.child_id, 'night-before'::text as period, today + 1 as for_date
    from (select distinct child_id from public.lesson_reminders where night_before) children
    where p_any_hour or coalesce((select lesson_evening_hour from public.school_settings where child_id = children.child_id), 20) = hour_now
    union all
    select children.child_id, 'morning-of', today
    from (select distinct child_id from public.lesson_reminders where morning_of) children
    where p_any_hour or coalesce((select lesson_morning_hour from public.school_settings where child_id = children.child_id), 7) = hour_now
  ), matches as (
    select slot.child_id, slot.period, slot.for_date, rule.subject, rule.note, rule.to_child, rule.to_grown_ups, min(lesson.start_time) as starts
    from slots slot
    join public.lesson_reminders rule on rule.child_id = slot.child_id
      and ((slot.period = 'night-before' and rule.night_before) or (slot.period = 'morning-of' and rule.morning_of))
    join public.school_lessons lesson on lesson.child_id = slot.child_id and lesson.lesson_date = slot.for_date
      and lower(lesson.subject) = lower(rule.subject)
    where private.has_feature(slot.child_id, 'school')
    group by slot.child_id, slot.period, slot.for_date, rule.id, rule.subject, rule.note, rule.to_child, rule.to_grown_ups
  ), claimed as (
    insert into public.lesson_reminders_sent (child_id, for_date, period)
    select distinct child_id, for_date, period from matches
    on conflict do nothing
    returning child_id, for_date, period
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'childId', claimed.child_id,
    'childName', private.child_name(claimed.child_id),
    'period', claimed.period,
    'date', claimed.for_date,
    'childLessons', coalesce((select jsonb_agg(jsonb_build_object('subject', m.subject, 'note', m.note, 'start', to_char(m.starts, 'HH24:MI')) order by m.starts)
                     from matches m where m.child_id = claimed.child_id and m.period = claimed.period and m.to_child), '[]'::jsonb),
    'grownUpLessons', coalesce((select jsonb_agg(jsonb_build_object('subject', m.subject, 'note', m.note, 'start', to_char(m.starts, 'HH24:MI')) order by m.starts)
                       from matches m where m.child_id = claimed.child_id and m.period = claimed.period and m.to_grown_ups), '[]'::jsonb),
    'devices', private.devices_for(array[claimed.child_id]),
    'grownUpDevices', private.devices_for(private.grown_ups_of(claimed.child_id)))), '[]'::jsonb)
  into result
  from claimed;
  return result;
end $$;

revoke execute on function private.child_name(uuid), private.devices_for(uuid[]), private.grown_ups_of(uuid) from public, anon, authenticated;
revoke execute on function public.add_lesson_reminder(uuid, text, text, boolean, boolean, boolean, boolean), public.remove_lesson_reminder(uuid, uuid),
  public.set_lesson_reminder_times(uuid, int, int) from public, anon;
grant execute on function public.add_lesson_reminder(uuid, text, text, boolean, boolean, boolean, boolean), public.remove_lesson_reminder(uuid, uuid),
  public.set_lesson_reminder_times(uuid, int, int) to authenticated;
revoke execute on function public.claim_homework_reminders(boolean), public.claim_lesson_reminders(boolean) from public, anon, authenticated;
grant execute on function public.claim_homework_reminders(boolean), public.claim_lesson_reminders(boolean) to service_role;
