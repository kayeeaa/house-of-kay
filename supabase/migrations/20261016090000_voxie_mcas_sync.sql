/* MCAS sync: which Voxie child each MCAS pupil's timetable and homework goes to, and how the last sync went.
   The MCAS login itself is NOT in the database: it's the Edge Function secrets MCAS_EMAIL and MCAS_PASSWORD, which
   only Edge Functions can read. The mcas-sync function (supabase/functions/mcas-sync) runs on a schedule; see
   supabase/snippets/voxie_mcas_sync_schedule.sql. Needs 20261015090000_voxie_school.sql. */

-- Set up in the SQL Editor (supabase/snippets/voxie_mcas_link_child.sql). No policies: only the service role reads it.
create table public.school_links (
  child_id uuid primary key references public.profiles (id) on delete cascade,
  mcas_student_id bigint not null unique,
  created_at timestamptz not null default now()
);
alter table public.school_links enable row level security;
revoke all on public.school_links from anon, authenticated;
grant all on public.school_links to service_role;

-- How the last sync went, for the grown-up's dashboard later. last_error is a short code, never MCAS's own text.
alter table public.school_sync
  add column last_attempt_at timestamptz,
  add column last_error text check (last_error in ('login-failed', 'mcas-unavailable', 'not-on-this-account', 'save-failed'));

-- Voxie only keeps what it needs: not which school the child goes to.
alter table public.school_sync drop column school_name;

/* saveSchoolSync: the mcas-sync function's one write per child, in a single transaction.
   - School days and lessons from p_from to p_to (this week and next) are replaced with what MCAS sent.
   - Homework is added or updated by (source, external_id) and never deleted, so a child's tick (and its XP) stays
     even after MCAS drops the homework from its list.
   Service role only. */
create or replace function public.save_school_sync(p_child_id uuid, p_from date, p_to date, p_school_days date[], p_lessons jsonb, p_homework jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.school_links where child_id = p_child_id) then raise exception 'not-linked'; end if;

  delete from public.school_days where child_id = p_child_id and school_day between p_from and p_to;
  insert into public.school_days (child_id, school_day)
  select distinct p_child_id, day from unnest(p_school_days) as day where day between p_from and p_to;

  delete from public.school_lessons where child_id = p_child_id and lesson_date between p_from and p_to;
  insert into public.school_lessons (child_id, lesson_date, start_time, end_time, subject, colour, teachers, mcas_class_id)
  select p_child_id, (lesson->>'date')::date, (lesson->>'start')::time, (lesson->>'end')::time, lesson->>'subject',
    coalesce(lesson->>'colour', ''), array(select jsonb_array_elements_text(coalesce(lesson->'teachers', '[]'::jsonb))), (lesson->>'classId')::bigint
  from jsonb_array_elements(p_lessons) as lesson
  where (lesson->>'date')::date between p_from and p_to
  on conflict (child_id, lesson_date, start_time, mcas_class_id) do nothing;

  insert into public.school_homework (child_id, source, external_id, subject, title, due_date, due_time, instructions, links, set_by, submitted, synced_at)
  select p_child_id, item->>'source', item->>'externalId', coalesce(item->>'subject', ''), item->>'title', (item->>'dueDate')::date,
    (item->>'dueTime')::time, coalesce(item->>'instructions', ''), coalesce(item->'links', '[]'::jsonb), coalesce(item->>'setBy', ''),
    coalesce((item->>'submitted')::boolean, false), now()
  from jsonb_array_elements(p_homework) as item
  on conflict (child_id, source, external_id) do update set
    subject = excluded.subject, title = excluded.title, due_date = excluded.due_date, due_time = excluded.due_time,
    instructions = excluded.instructions, links = excluded.links, set_by = excluded.set_by, submitted = excluded.submitted, synced_at = now();

  insert into public.school_sync (child_id, last_synced_at, last_attempt_at, last_error) values (p_child_id, now(), now(), null)
  on conflict (child_id) do update set last_synced_at = now(), last_attempt_at = now(), last_error = null;
end $$;

revoke execute on function public.save_school_sync(uuid, date, date, date[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_school_sync(uuid, date, date, date[], jsonb, jsonb) to service_role;
