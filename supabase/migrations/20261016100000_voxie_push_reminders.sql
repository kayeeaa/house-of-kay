/* Homework reminders as push notifications (feature "school").
   - push_subscriptions: each device a user has turned reminders on for (the browser's push address and keys).
     Written only through save_my_push_subscription / remove_my_push_subscription.
   - claim_homework_reminders(): for the send-reminders Edge Function (service role). Once a day, each child with
     reminders on gets ONE notification listing their homework that isn't ticked or handed in and is due tonight or
     tomorrow, or has just come onto Home today (their "days before" setting). push_reminders_sent makes sure a child
     never gets two on the same day, even if the schedule fires twice.
   Needs 20261015090000_voxie_school.sql. */

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "users read their own devices" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
grant select on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

create table public.push_reminders_sent (
  child_id uuid not null references public.profiles (id) on delete cascade,
  sent_on date not null,
  primary key (child_id, sent_on)
);
alter table public.push_reminders_sent enable row level security;
revoke all on public.push_reminders_sent from anon, authenticated;
grant all on public.push_reminders_sent to service_role;

/* savePushSubscription({ endpoint, p256dh, auth }): this device, for the signed-in user. A device that was someone
   else's (a brother logging in on the same tablet) moves to whoever turned reminders on last. At most 10 devices. */
create or replace function public.save_my_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_user();
begin
  if (select count(*) from public.push_subscriptions where user_id = me and endpoint <> p_endpoint) >= 10 then raise exception 'too-many-devices'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (me, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
exception when check_violation then raise exception 'bad-subscription';
end $$;

create or replace function public.remove_my_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_user();
begin
  delete from public.push_subscriptions where user_id = me and endpoint = p_endpoint;
end $$;

/* claimHomeworkReminders() → [{ childId, homework: [{ title, subject, dueDate, dueTime }], devices: [{ endpoint, p256dh, auth }] }]
   Marks each returned child as sent today, so call it only when about to send. Service role only. */
create or replace function public.claim_homework_reminders() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date := private.today_uk();
  time_now time := (now() at time zone 'Europe/London')::time;
  result jsonb;
begin
  with children as (
    select distinct device.user_id as child_id
    from public.push_subscriptions device
    join public.profiles profile on profile.id = device.user_id and profile.role = 'child'
    where private.has_feature(device.user_id, 'school')
  ), due as (
    select homework.child_id, homework.title, homework.subject, homework.due_date, homework.due_time
    from public.school_homework homework
    join children on children.child_id = homework.child_id
    where not homework.submitted
      and not exists (select 1 from public.homework_completions tick where tick.homework_id = homework.id)
      and ((homework.due_date = today and homework.due_time > time_now)
        or homework.due_date = today + 1
        or homework.due_date - private.homework_task_days_before(homework.child_id) = today)
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

revoke execute on function public.save_my_push_subscription(text, text, text), public.remove_my_push_subscription(text) from public, anon;
grant execute on function public.save_my_push_subscription(text, text, text), public.remove_my_push_subscription(text) to authenticated;
revoke execute on function public.claim_homework_reminders() from public, anon, authenticated;
grant execute on function public.claim_homework_reminders() to service_role;
