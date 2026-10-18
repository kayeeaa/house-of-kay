/* Giving wall art to friends (for everyone, no feature flag).
   Needs 20261017130000_voxie_creations_for_everyone.sql, 20261016100000_voxie_push_reminders.sql and
   20261018090000_voxie_new_grown_up_alert.sql (pg_net, and the Vault secrets the notify trigger uses).

   - give_creation(creationId, friendId): wall art you made goes to a friend, free. The friend gets a copy on their
     playing buddy (price_paid 0, received_as_gift) and yours is hidden (thrown_away, given_away) and taken down, so it
     leaves your stuff while the XP it cost stays spent, as when throwing one away. Only things you made yourself can
     be given, not gifts. The friend can throw it away like anything they made (throw_away_creation).
   - creation_gifts: who a gift came from, readable by the child who got it only. Grown-ups never see friends, so the
     child's grown-ups can see the picture, and that it was a gift (creations.received_as_gift), but not who sent it.
   - The friend gets a child_notifications row ('gift-received': from_name is the giver's game name, task_title the
     picture's name) for the in-game pop-up, and a push notification on every device they've turned notifications on
     for (the same switch as school reminders), sent by the notify-child Edge Function.
   - Gifts have their own limit, separate from making: a buddy can hold its own 20 AND 20 gifts ("friend-full"), so
     getting gifts never stops a child making (and collecting) their own. */

alter table public.creations
  add column received_as_gift boolean not null default false,
  add column given_away boolean not null default false;

create table public.creation_gifts (
  creation_id uuid primary key references public.creations (id) on delete cascade,   -- the friend's copy
  child_id uuid not null references public.profiles (id) on delete cascade,          -- who got it
  from_child_id uuid references public.profiles (id) on delete set null,
  from_name text not null,                                                            -- the giver's game name when they gave it
  given_at timestamptz not null default now()
);
create index creation_gifts_child on public.creation_gifts (child_id);
alter table public.creation_gifts enable row level security;
create policy "children read gifts they got" on public.creation_gifts for select to authenticated using (child_id = (select auth.uid()));
grant select on public.creation_gifts to authenticated;
grant all on public.creation_gifts to service_role;

alter table public.child_notifications drop constraint child_notifications_kind_check;
alter table public.child_notifications add constraint child_notifications_kind_check check (kind in ('task-added', 'gift-received'));

/* ---------- Making: gifts you got don't count towards the 20 you can make ----------
   As in 20261017130000_voxie_creations_for_everyone.sql, with "and not received_as_gift" in the count. */
create or replace function public.make_creation(p_kind text, p_name text, p_pixels text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_child();   -- locks the profile, so two at once can't overspend
  buddy uuid := private.active_buddy(me);
  creation_price constant int := 20;
  max_creations constant int := 20;
  clean_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  made public.creations;
begin
  if buddy is null or p_kind is distinct from 'wall-art' then raise exception 'bad-request'; end if;
  if char_length(clean_name) not between 1 and 24 then raise exception 'bad-name'; end if;
  if p_pixels is null or not private.wall_art_pixels_ok(p_pixels) then raise exception 'bad-pixels'; end if;
  if (select count(*) from public.creations where buddy_id = buddy and not thrown_away and not received_as_gift) >= max_creations then raise exception 'too-many'; end if;
  if private.xp_to_spend(me) < creation_price then raise exception 'not-enough-xp'; end if;
  insert into public.creations (child_id, buddy_id, kind, name, pixels, price_paid, made_on)
  values (me, buddy, p_kind, clean_name, p_pixels, creation_price, private.today_uk())
  returning * into made;
  return jsonb_build_object('id', made.id, 'name', made.name, 'pixels', to_jsonb(made.pixels), 'pricePaid', made.price_paid);
end $$;

/* ---------- Giving ---------- */
-- Asks notify-child to send the push notification. Never stops the gift if it fails.
create or replace function private.push_gift_notice(p_creation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_project_url') || '/functions/v1/notify-child',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_mcas_sync_secret')),
    body := jsonb_build_object('kind', 'gift-received', 'creationId', p_creation_id),
    timeout_milliseconds := 10000);
exception when others then
  return;
end $$;

/* giveCreation(creationId, friendId). Errors: not-found, is-a-gift, not-friends, friend-full. */
create or replace function public.give_creation(p_creation_id uuid, p_friend_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_child();
  max_gifts constant int := 20;
  original public.creations;
  friend_buddy uuid;
  my_name text;
  copy_id uuid;
begin
  select * into original from public.creations where id = p_creation_id and child_id = me and not thrown_away for update;
  if not found then raise exception 'not-found'; end if;
  if original.received_as_gift then raise exception 'is-a-gift'; end if;
  if not exists (select 1 from public.friendships where child_id = me and friend_id = p_friend_id) then raise exception 'not-friends'; end if;
  friend_buddy := private.active_buddy(p_friend_id);
  if friend_buddy is null then raise exception 'not-found'; end if;
  if (select count(*) from public.creations where buddy_id = friend_buddy and received_as_gift and not thrown_away) >= max_gifts then raise exception 'friend-full'; end if;
  my_name := coalesce(nullif(trim((select display_name from private.app_profiles where id = me)), ''), 'A friend');

  update public.creations set thrown_away = true, given_away = true where id = original.id;
  update public.buddies set equipped_items = array_remove(equipped_items, 'made-' || original.id::text) where child_id = me;
  insert into public.creations (child_id, buddy_id, kind, name, pixels, price_paid, made_on, received_as_gift)
  values (p_friend_id, friend_buddy, original.kind, original.name, original.pixels, 0, original.made_on, true)
  returning id into copy_id;
  insert into public.creation_gifts (creation_id, child_id, from_child_id, from_name) values (copy_id, p_friend_id, me, my_name);
  insert into public.child_notifications (child_id, kind, from_name, task_title) values (p_friend_id, 'gift-received', my_name, original.name);
  perform private.push_gift_notice(copy_id);
end $$;

revoke execute on function private.push_gift_notice(uuid) from public, anon, authenticated;
revoke execute on function public.give_creation(uuid, uuid) from public, anon;
grant execute on function public.give_creation(uuid, uuid) to authenticated;
