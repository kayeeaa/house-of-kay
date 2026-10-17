/* Late homework can be ticked again: a teacher may give more time without changing the date in MCAS.
   It still comes off Home once it's late; the child ticks it in the School tab instead.
   Replaces mark_homework_done from 20261016110000_voxie_school_reminder_time_and_handed_in.sql (no "too-late"). */

/* markHomeworkDone(homeworkId) → { xpAwarded, levelPoints }. Yours, and due within your "days before" setting or
   already late ("too-early" otherwise). Ticking it again gives { 0, 0 }. */
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
  insert into public.homework_completions (child_id, buddy_id, homework_id, completed_on, xp_awarded, level_points, how)
  values (me, (select active_buddy_id from public.profiles where id = me), p_homework_id, private.today_uk(), homework_xp, homework_level_points, 'ticked')
  on conflict (child_id, homework_id) do nothing;
  get diagnostics added = row_count;
  perform private.record_highest_level(me);
  return jsonb_build_object('xpAwarded', case when added > 0 then homework_xp else 0 end,
                            'levelPoints', case when added > 0 then homework_level_points else 0 end);
end $$;
