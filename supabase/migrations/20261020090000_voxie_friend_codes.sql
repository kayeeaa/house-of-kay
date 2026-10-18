/* Friend codes instead of friend search, and a grown-up's "Friends" setting. Needs 20261004120000_voxie_backend.sql.

   Why: with Voxie open to the public, children mustn't be findable by strangers (ICO Children's Code). Search by game
   name is gone; a child adds a friend by typing that friend's own code, which only travels by being passed on.

   - profiles.friends_allowed: the grown-ups' "Friends" setting. Existing children keep friends ON; new children start
     OFF (the column's default). Only grown-ups change it (update_child_settings), whatever child_can_change_settings
     says. Off: no code, no requests either way (waiting ones are cancelled), and a code for that child just doesn't
     work. Existing friends stay: the child still sees them, can remove them, and gifts between them carry on.
   - friend_codes: one code per child, e.g. FROG-48213 (a kid-safe word + 5 digits from 2 to 9, so no 0/O or 1/I mix-ups).
     Server only: the app never reads the table, so codes can't be listed. A new code replaces the old one at once.
   - friend_code_tries: wrong codes per child per UK day. 10 a day, then "too-many-tries" until tomorrow, so codes
     can't be guessed. A code that isn't even shaped like one, or the child's own code, doesn't count.
   - Requests are sent by CODE, never by child id, so knowing a child's id isn't enough to reach them.

   RPCs (children):
     loadMyFriendCode() → { allowed, code }   (code null when friends are off; made the first time it's asked for)
     newFriendCode() → { code }                Errors: friends-off
     lookUpFriendCode(code) → { displayName, petType, petLook, relationship: none | friend | request-sent | request-received }
                                               or { error: code-format | own-code | bad-code | too-many-tries }.  Errors: friends-off
     sendFriendRequest(code) → {} or { error: code-format | own-code | bad-code | too-many-tries }.  Errors: friends-off, already-friends, already-asked
     answerFriendRequest, loadMyFriendRequests, loadMySentFriendRequests: as before, but only while friends are on.
   RPCs (grown-ups): updateChildSettings and loadChildOverview gain friendsAllowed.
   Removed: search_players. */

/* ---------- The setting ---------- */
alter table public.profiles add column friends_allowed boolean not null default true;   -- existing children: ON
alter table public.profiles alter column friends_allowed set default false;               -- new children: OFF

create or replace function private.friends_on(p_child_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select friends_allowed from public.profiles where id = p_child_id and role = 'child'), false)
$$;

/* ---------- Codes and tries (server only) ---------- */
create table public.friend_codes (
  child_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z]{2,8}-[2-9]{5}$'),
  made_at timestamptz not null default now()
);
create table public.friend_code_tries (
  child_id uuid not null references public.profiles (id) on delete cascade,
  tried_on date not null,
  wrong int not null default 0,
  primary key (child_id, tried_on)
);
alter table public.friend_codes enable row level security;
alter table public.friend_code_tries enable row level security;
revoke all on public.friend_codes, public.friend_code_tries from anon, authenticated;
grant all on public.friend_codes, public.friend_code_tries to service_role;

-- 100 friendly words. Never shorten the list once codes are out: an existing code keeps working whatever the list says.
create or replace function private.friend_code_words() returns text[]
language sql immutable set search_path = '' as $$
  select array['FROG','FOX','BEAR','OWL','SEAL','PANDA','TIGER','LION','ZEBRA','HIPPO',
               'RHINO','KOALA','OTTER','BADGER','BUNNY','PUPPY','KITTEN','PONY','LLAMA','CAMEL',
               'MOOSE','GOOSE','DUCK','SWAN','ROBIN','WREN','EAGLE','HAWK','PARROT','PUFFIN',
               'WHALE','SHARK','DOLPHIN','CRAB','SQUID','SNAIL','BEETLE','BEE','GECKO','NEWT',
               'TOAD','TURTLE','LIZARD','DRAGON','UNICORN','COMET','PLANET','ROCKET','STAR','MOON',
               'CLOUD','RAIN','STORM','RIVER','OCEAN','ISLAND','FOREST','MAPLE','ACORN','CACTUS',
               'DAISY','TULIP','FERN','PEBBLE','CORAL','PEARL','AMBER','JADE','RUBY','MANGO',
               'LEMON','PEACH','PLUM','MELON','APPLE','BERRY','COOKIE','MUFFIN','WAFFLE','TOFFEE',
               'KITE','DRUM','PIANO','BANJO','ROBOT','PIXEL','TRAIN','BOAT','CASTLE','CROWN',
               'SHIELD','ARROW','COMPASS','LANTERN','BUBBLE','SPARK','MEADOW','VOLCANO','IGLOO','JELLY']
$$;

/* Gives the child a new random code, replacing any old one. Random like the grown-up invite codes: bytes from
   gen_random_uuid(). 8 digit choices divide 256 evenly; the word pick is from two bytes (the bias is tiny). */
create or replace function private.set_new_friend_code(p_child_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  words constant text[] := private.friend_code_words();
  random_bytes bytea;
  new_code text;
begin
  for attempt in 1 .. 10 loop
    random_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    new_code := words[(get_byte(random_bytes, 0) * 256 + get_byte(random_bytes, 1)) % cardinality(words) + 1] || '-';
    for digit_index in 2 .. 6 loop
      new_code := new_code || (get_byte(random_bytes, digit_index) % 8 + 2)::text;
    end loop;
    begin
      insert into public.friend_codes (child_id, code) values (p_child_id, new_code)
      on conflict (child_id) do update set code = excluded.code, made_at = now();
      return new_code;
    exception when unique_violation then null;   -- another child has that code: try again
    end;
  end loop;
  raise exception 'save-failed';
end $$;

/* Who a typed code belongs to: { childId } or { error }. Counts wrong codes, so it RETURNS its errors rather than
   raising them (raising would undo the count). Only children who are set up and have friends on can be found. */
create or replace function private.friend_by_code(p_me uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date := private.today_uk();
  parts text[] := regexp_match(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g'), '^([A-Z]{2,8})([0-9]{5})$');
  found_id uuid;
begin
  if parts is null then return jsonb_build_object('error', 'code-format'); end if;
  delete from public.friend_code_tries where child_id = p_me and tried_on < today;
  if coalesce((select wrong from public.friend_code_tries where child_id = p_me and tried_on = today), 0) >= 10   -- MAX_WRONG_FRIEND_CODES
    then return jsonb_build_object('error', 'too-many-tries'); end if;
  select fc.child_id into found_id
  from public.friend_codes fc join public.profiles p on p.id = fc.child_id
  where fc.code = parts[1] || '-' || parts[2] and p.role = 'child' and p.setup_complete and p.friends_allowed;
  if found_id = p_me then return jsonb_build_object('error', 'own-code'); end if;
  if found_id is null then
    insert into public.friend_code_tries (child_id, tried_on, wrong) values (p_me, today, 1)
    on conflict (child_id, tried_on) do update set wrong = public.friend_code_tries.wrong + 1;
    return jsonb_build_object('error', 'bad-code');
  end if;
  return jsonb_build_object('childId', found_id);
end $$;

/* ---------- Children's RPCs ---------- */
-- loadMyFriendCode() → { allowed, code }. Makes the code the first time a child with friends on asks for it.
create or replace function public.load_my_friend_code() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(false); my_code text;
begin
  if not private.friends_on(me) then return jsonb_build_object('allowed', false, 'code', null); end if;
  select code into my_code from public.friend_codes where child_id = me;
  if my_code is null then my_code := private.set_new_friend_code(me); end if;
  return jsonb_build_object('allowed', true, 'code', my_code);
end $$;

-- newFriendCode() → { code }: the old code stops working at once. Existing friends aren't affected.
create or replace function public.new_friend_code() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child();
begin
  if not private.friends_on(me) then raise exception 'friends-off'; end if;
  return jsonb_build_object('code', private.set_new_friend_code(me));
end $$;

-- lookUpFriendCode(code): who it is, before asking "Send a friend request?". Never returns the child's id.
create or replace function public.look_up_friend_code(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_child();   -- locks the profile, so tries are counted one at a time
  match jsonb;
  other uuid;
begin
  if not private.friends_on(me) then raise exception 'friends-off'; end if;
  match := private.friend_by_code(me, p_code);
  if match ? 'error' then return match; end if;
  other := (match ->> 'childId')::uuid;
  return (
    select jsonb_build_object('displayName', app.display_name, 'petType', app.pet_type, 'petLook', app.pet_look,
      'relationship', case when exists (select 1 from public.friendships f where f.child_id = me and f.friend_id = other) then 'friend'
                           when pending.from_child_id is null then 'none'
                           when pending.from_child_id = me then 'request-sent' else 'request-received' end)
    from private.app_profiles app
    left join lateral (
      select fr.from_child_id from public.friend_requests fr
      where fr.status = 'pending'
        and ((fr.from_child_id = me and fr.to_child_id = other) or (fr.from_child_id = other and fr.to_child_id = me))
      limit 1) pending on true
    where app.id = other);
end $$;

-- sendFriendRequest(code) → {} or { error } (as lookUpFriendCode). Errors: friends-off, already-friends, already-asked.
drop function public.send_friend_request(uuid);
create or replace function public.send_friend_request(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(); match jsonb; other uuid;
begin
  if not private.friends_on(me) then raise exception 'friends-off'; end if;
  match := private.friend_by_code(me, p_code);
  if match ? 'error' then return match; end if;
  other := (match ->> 'childId')::uuid;
  if exists (select 1 from public.friendships where child_id = me and friend_id = other) then raise exception 'already-friends'; end if;
  if exists (select 1 from public.friend_requests where status = 'pending'
             and ((from_child_id = me and to_child_id = other) or (from_child_id = other and to_child_id = me)))
    then raise exception 'already-asked'; end if;
  insert into public.friend_requests (from_child_id, to_child_id, sent_on) values (me, other, private.today_uk());
  return '{}'::jsonb;
exception when unique_violation then raise exception 'already-asked';
end $$;

/* As in 20261004120000_voxie_backend.sql, but only while friends are on (both children, when answering). */
create or replace function public.load_my_friend_requests() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(false);
begin
  if not private.friends_on(me) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', fr.id, 'fromChildId', app.id, 'displayName', app.display_name,
                                                       'petType', app.pet_type, 'petLook', app.pet_look) order by fr.created_at desc)
    from public.friend_requests fr join private.app_profiles app on app.id = fr.from_child_id
    where fr.to_child_id = me and fr.status = 'pending'), '[]'::jsonb);
end $$;

create or replace function public.load_my_sent_friend_requests() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(false);
begin
  if not private.friends_on(me) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', fr.id, 'toChildId', app.id, 'displayName', app.display_name,
                                                       'petType', app.pet_type, 'petLook', app.pet_look) order by fr.created_at desc)
    from public.friend_requests fr join private.app_profiles app on app.id = fr.to_child_id
    where fr.from_child_id = me and fr.status = 'pending'), '[]'::jsonb);
end $$;

-- answerFriendRequest(requestId, accept). Errors: friends-off, not-found (also when the other child's friends are off).
create or replace function public.answer_friend_request(p_request_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(); from_id uuid;
begin
  if not private.friends_on(me) then raise exception 'friends-off'; end if;
  select from_child_id into from_id from public.friend_requests where id = p_request_id and to_child_id = me and status = 'pending';
  if from_id is null or not private.friends_on(from_id) then raise exception 'not-found'; end if;
  update public.friend_requests set status = case when p_accept then 'accepted' else 'declined' end where id = p_request_id;
  if p_accept then
    insert into public.friendships (child_id, friend_id) values (me, from_id), (from_id, me) on conflict do nothing;
  end if;
end $$;

-- Friend search is gone: nobody can look children up by name any more.
drop function if exists public.search_players(text);

/* ---------- Grown-ups ---------- */
/* As in 20261004120000_voxie_backend.sql, with friendsAllowed. Turning it off cancels requests waiting to or from the
   child; their friends stay. */
create or replace function public.update_child_settings(p_child_id uuid, p_settings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare friends_now boolean;
begin
  perform private.require_my_child(p_child_id);
  update public.profiles set
    timed_missions = coalesce((p_settings ->> 'timedMissions')::boolean, timed_missions),
    reset_streak_on_miss = coalesce((p_settings ->> 'resetStreakOnMiss')::boolean, reset_streak_on_miss),
    chance_features = coalesce((p_settings ->> 'chanceFeatures')::boolean, chance_features),
    child_can_change_settings = coalesce((p_settings ->> 'childCanChangeSettings')::boolean, child_can_change_settings),
    friends_allowed = coalesce((p_settings ->> 'friendsAllowed')::boolean, friends_allowed)
  where id = p_child_id
  returning friends_allowed into friends_now;
  if not friends_now then
    update public.friend_requests set status = 'cancelled'
    where status = 'pending' and (from_child_id = p_child_id or to_child_id = p_child_id);
  end if;
end $$;

/* As in 20261004120000_voxie_backend.sql, with friendsAllowed in settings. */
create or replace function public.load_child_overview(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare child public.profiles;
begin
  perform private.require_my_child(p_child_id, false);
  select * into child from public.profiles where id = p_child_id;
  return jsonb_build_object(
    'child', private.child_for_parent(p_child_id),
    'settings', jsonb_build_object('timedMissions', child.timed_missions, 'resetStreakOnMiss', child.reset_streak_on_miss,
                                   'chanceFeatures', child.chance_features, 'childCanChangeSettings', child.child_can_change_settings,
                                   'friendsAllowed', child.friends_allowed),
    'tasks', coalesce((select jsonb_agg(task order by set_tasks_first, sort_order, created_at) from (
        select jsonb_build_object('id', id, 'title', title, 'daysOfWeek', '["mon","tue","wed","thu","fri","sat","sun"]'::jsonb,
                                  'timesPerDay', 1, 'setBy', 'parent') as task, 0 as set_tasks_first, sort_order, created_at
        from public.chores where child_id = p_child_id and active
        union all
        select private.scheduled_task_shape(st), 1, 0, st.created_at
        from public.scheduled_tasks st where st.child_id = p_child_id and st.active) tasks), '[]'::jsonb),
    'stats', private.child_stats(p_child_id),
    'login', jsonb_build_object('username', coalesce(child.username, '')),
    'grownUps', coalesce((select jsonb_agg(parent.display_name order by fl.linked_on, parent.display_name)
                          from public.family_links fl join public.profiles parent on parent.id = fl.parent_id
                          where fl.child_id = p_child_id), '[]'::jsonb),
    'birth', jsonb_build_object('month', child.birth_month, 'year', child.birth_year));
end $$;

/* ---------- Permissions ---------- */
revoke execute on function private.friends_on(uuid), private.friend_code_words(), private.set_new_friend_code(uuid),
  private.friend_by_code(uuid, text) from public, anon, authenticated;
revoke execute on function public.load_my_friend_code(), public.new_friend_code(), public.look_up_friend_code(text),
  public.send_friend_request(text) from public, anon;
grant execute on function public.load_my_friend_code(), public.new_friend_code(), public.look_up_friend_code(text),
  public.send_friend_request(text) to authenticated;
