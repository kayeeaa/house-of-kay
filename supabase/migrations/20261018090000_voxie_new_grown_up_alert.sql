/* Tell the people who run Voxie when a new grown-up signs up: a push notification to their devices, e.g.
   "🎉 New grown-up on Voxie: Dan just signed up. That's 5 grown-ups so far."
   - site_admins: who gets told. Add yourself in the SQL Editor (no policies: only the server reads it):
       insert into public.site_admins (user_id) select id from auth.users where email = 'you@example.com';
     Their devices are the ones with notifications turned on in Voxie (push_subscriptions).
   - The trigger calls the notify-admins Edge Function with the same schedule secret and project URL the other
     jobs use (Vault: voxie_project_url, voxie_mcas_sync_secret). It never stops a sign-up if the alert fails.
   Needs 20261016100000_voxie_push_reminders.sql and pg_net. */

create extension if not exists pg_net;

create table public.site_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.site_admins enable row level security;
revoke all on public.site_admins from anon, authenticated;
grant all on public.site_admins to service_role;

create or replace function private.tell_admins_about_new_grown_up() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'parent' and exists (select 1 from public.site_admins) then
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_project_url') || '/functions/v1/notify-admins',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_mcas_sync_secret')),
      body := jsonb_build_object('kind', 'new-grown-up', 'userId', new.id),
      timeout_milliseconds := 10000);
  end if;
  return new;
exception when others then
  return new;   -- an alert must never stop someone signing up
end $$;
revoke execute on function private.tell_admins_about_new_grown_up() from public, anon, authenticated;

drop trigger if exists tell_admins_about_new_grown_up on public.profiles;
create trigger tell_admins_about_new_grown_up after insert on public.profiles
  for each row execute function private.tell_admins_about_new_grown_up();
