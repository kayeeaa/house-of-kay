/* School tab, round 2. Needs 20261015090000_voxie_school.sql and 20261016100000_voxie_push_reminders.sql.
   1. The child picks when their homework reminder comes (school_settings.reminder_hour, 7–21, UK time; default 4pm).
   2. Late homework comes off Home: it can't be ticked once its due time has passed ("too-late"), and it's never in a
      reminder. The School tab still shows it as Late.
   3. Homework MCAS says is handed in, but that the child never ticked, can be collected for the same XP and level
      points (collect_handed_in_homework, from a pop-up in the app). Ticking it and MCAS saying it's handed in both
      make the same homework_completions row, which is unique per homework, so XP is only ever given once. */

/* ---------- 1. Reminder time ---------- */
alter table public.school_settings add column reminder_hour smallint not null default 16 check (reminder_hour between 7 and 21);

create or replace function private.reminder_hour(p_child_id uuid) returns int
language sql stable set search_path = '' as $$
  select coalesce((select reminder_hour from public.school_settings where child_id = p_child_id), 16)
$$;
revoke execute on function private.reminder_hour(uuid) from public, anon, authenticated;

-- saveMySchoolSettings({ homeworkTaskDaysBefore, reminderHour }). Leave either out (null) to keep it as it is.
drop function public.save_my_school_settings(int);
create or replace function public.save_my_school_settings(p_homework_task_days_before int default null, p_reminder_hour int default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(false);
begin
  if not private.has_feature(me, 'school') then raise exception 'not-available'; end if;
  if p_homework_task_days_before is not null and p_homework_task_days_before not between 0 and 7 then raise exception 'bad-days'; end if;
  if p_reminder_hour is not null and p_reminder_hour not between 7 and 21 then raise exception 'bad-hour'; end if;
  insert into public.school_settings (child_id, homework_task_days_before, reminder_hour)
  values (me, coalesce(p_homework_task_days_before, 2), coalesce(p_reminder_hour, 16))
  on conflict (child_id) do update set
    homework_task_days_before = coalesce(p_homework_task_days_before, school_settings.homework_task_days_before),
    reminder_hour = coalesce(p_reminder_hour, school_settings.reminder_hour);
end $$;
revoke execute on function public.save_my_school_settings(int, int) from public, anon;
grant execute on function public.save_my_school_settings(int, int) to authenticated;

/* claimHomeworkReminders(anyHour) → as before. Only children whose reminder_hour is the hour now (UK), unless
   p_any_hour (for testing). Only homework still to do: not late, not ticked, not handed in. */
drop function public.claim_homework_reminders();
create or replace function public.claim_homework_reminders(p_any_hour boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  now_uk timestamp := now() at time zone 'Europe/London';
  today date := (now() at time zone 'Europe/London')::date;
  result jsonb;
begin
  with children as (
    select distinct device.user_id as child_id
    from public.push_subscriptions device
    join public.profiles profile on profile.id = device.user_id and profile.role = 'child'
    where private.has_feature(device.user_id, 'school')
      and (p_any_hour or private.reminder_hour(device.user_id) = extract(hour from now_uk))
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
    'homework', (select jsonb_agg(jsonb_build_object('title', due.title, 'subject', due.subject, 'dueDate', due.due_date, 'dueTime', to_char(due.due_time, 'HH24:MI'))
                 order by due.due_date, due.due_time) from due where due.child_id = claimed.child_id),
    'devices', (select jsonb_agg(jsonb_build_object('endpoint', device.endpoint, 'p256dh', device.p256dh, 'auth', device.auth))
                from public.push_subscriptions device where device.user_id = claimed.child_id))), '[]'::jsonb)
  into result
  from claimed;
  return result;
end $$;
revoke execute on function public.claim_homework_reminders(boolean) from public, anon, authenticated;
grant execute on function public.claim_homework_reminders(boolean) to service_role;

/* ---------- 2 & 3. Ticking, and collecting what MCAS says is handed in ---------- */
-- How each homework got done: ticked on Home, or collected because MCAS said it was handed in.
alter table public.homework_completions add column how text not null default 'ticked' check (how in ('ticked', 'handed-in'));

/* markHomeworkDone(homeworkId) → { xpAwarded, levelPoints }. Homework that's on Home: yours, within your "days before"
   setting, and not late yet ("too-late" once its due time has passed). Ticking it again gives { 0, 0 }. */
create or replace function public.mark_homework_done(p_homework_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_child();   -- locks the profile, so a double tap can't award twice
  homework_xp constant int := 3;
  homework_level_points constant int := 2;
  homework public.school_homework;
  added int;
begin
  if not private.has_feature(me, 'school') then raise exception 'not-available'; end if;
  select * into homework from public.school_homework where id = p_homework_id and child_id = me;
  if homework.id is null then raise exception 'not-found'; end if;
  if homework.due_date - private.homework_task_days_before(me) > private.today_uk() then raise exception 'too-early'; end if;
  if homework.due_date + homework.due_time <= now() at time zone 'Europe/London' then raise exception 'too-late'; end if;
  insert into public.homework_completions (child_id, buddy_id, homework_id, completed_on, xp_awarded, level_points, how)
  values (me, (select active_buddy_id from public.profiles where id = me), p_homework_id, private.today_uk(), homework_xp, homework_level_points, 'ticked')
  on conflict (child_id, homework_id) do nothing;
  get diagnostics added = row_count;
  perform private.record_highest_level(me);
  return jsonb_build_object('xpAwarded', case when added > 0 then homework_xp else 0 end,
                            'levelPoints', case when added > 0 then homework_level_points else 0 end);
end $$;

/* unmarkHomeworkDone: as before ("not-today", "xp-spent"), and homework collected from MCAS can't be un-ticked ("handed-in"). */
create or replace function public.unmark_homework_done(p_homework_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(); ticked public.homework_completions;
begin
  if not private.has_feature(me, 'school') then raise exception 'not-available'; end if;
  select * into ticked from public.homework_completions where child_id = me and homework_id = p_homework_id;
  if ticked.id is null then return; end if;
  if ticked.how = 'handed-in' then raise exception 'handed-in'; end if;
  if ticked.completed_on <> private.today_uk() then raise exception 'not-today'; end if;
  if ticked.buddy_id is distinct from private.active_buddy(me)
     or private.xp_earned(me) - private.xp_spent_on_items(me) - private.xp_spent_in_shop(me) < ticked.xp_awarded then
    raise exception 'xp-spent';
  end if;
  delete from public.homework_completions where id = ticked.id;
end $$;

/* collectHandedInHomework() → { homework: [{ id, title, subject }], xpAwarded, levelPoints }
   Every homework MCAS says is handed in (school_homework.submitted, which only the sync can set), due in the last
   7 days or later, that the child hasn't already ticked or collected. Each gives the same as ticking it. */
create or replace function public.collect_handed_in_homework() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_child();   -- locks the profile, so collecting twice at once can't award twice
  homework_xp constant int := 3;
  homework_level_points constant int := 2;
  collected jsonb;
begin
  if not private.has_feature(me, 'school') then raise exception 'not-available'; end if;
  with added as (
    insert into public.homework_completions (child_id, buddy_id, homework_id, completed_on, xp_awarded, level_points, how)
    select me, (select active_buddy_id from public.profiles where id = me), homework.id, private.today_uk(), homework_xp, homework_level_points, 'handed-in'
    from public.school_homework homework
    where homework.child_id = me and homework.submitted and homework.due_date >= private.today_uk() - 7
    on conflict (child_id, homework_id) do nothing
    returning homework_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', homework.id, 'title', homework.title, 'subject', homework.subject) order by homework.due_date), '[]'::jsonb)
  into collected
  from added join public.school_homework homework on homework.id = added.homework_id;
  perform private.record_highest_level(me);
  return jsonb_build_object('homework', collected,
    'xpAwarded', jsonb_array_length(collected) * homework_xp, 'levelPoints', jsonb_array_length(collected) * homework_level_points);
end $$;
revoke execute on function public.collect_handed_in_homework() from public, anon;
grant execute on function public.collect_handed_in_homework() to authenticated;
