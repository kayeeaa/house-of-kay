/* Things children make themselves (feature "creations"). The first kind is wall art: a 16 × 16 pixel picture for the
   house's picture slot, drawn in the Creative tab. Needs 20261017110000_voxie_weekly_shop.sql.

   - Making one costs CREATION_PRICE (20) XP from the playing buddy, at most MAX_CREATIONS (20) per buddy. It belongs
     to that buddy, like everything else, and is put up in the house like any other item (item id "made-<id>").
   - Private: only the child and their linked grown-ups can read creations, and they're taken out of the look friends
     see (public_look), so friends never see them.
   - No powers, can't be sold, and never comes out of a Mystery box (those roll from item_catalogue only).
   - Throwing one away hides it (thrown_away) rather than deleting it, so the XP it cost stays spent.
   - pixels: 16 rows of 16 characters, "0"–"f" for the 16 colours in the app's CREATION_PALETTE and "." for empty.
     The colours themselves live in the app, so nothing but those characters is ever stored. */

create or replace function private.wall_art_pixels_ok(p_pixels text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(p_pixels) = 16
    and (select bool_and(row_text ~ '^[0-9a-f.]{16}$') from unnest(p_pixels) as row_text)
    and array_to_string(p_pixels, '') ~ '[0-9a-f]'   -- at least one pixel painted
$$;

create table public.creations (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.profiles (id) on delete cascade,
  buddy_id uuid not null references public.buddies (id) on delete cascade,
  kind text not null check (kind in ('wall-art')),
  name text not null check (char_length(name) between 1 and 24),
  pixels text[] not null check (private.wall_art_pixels_ok(pixels)),
  price_paid int not null check (price_paid >= 0),
  made_on date not null,
  thrown_away boolean not null default false,
  created_at timestamptz not null default now()
);
create index creations_buddy on public.creations (buddy_id) where not thrown_away;
alter table public.creations enable row level security;
create policy "read own or linked child rows" on public.creations for select to authenticated using (private.can_see_child(child_id));
grant select on public.creations to authenticated;
grant all on public.creations to service_role;

/* ---------- Making them part of the game ---------- */
-- XP spent now includes making things (thrown-away ones too: their XP stays spent).
create or replace function private.xp_spent_in_shop(p_child_id uuid) returns int
language sql stable set search_path = '' as $$
  select (coalesce((select sum(price_paid) from public.purchases where child_id = p_child_id and buddy_id = private.active_buddy(p_child_id)), 0)
        + coalesce((select sum(xp_paid - xp_refunded) from public.chance_rolls where child_id = p_child_id and buddy_id = private.active_buddy(p_child_id)), 0)
        + coalesce((select sum(price_paid) from public.creations where child_id = p_child_id and buddy_id = private.active_buddy(p_child_id)), 0))::int
$$;

-- The playing buddy's items, plus the things it made (so they can be put up).
create or replace function private.owned_item_ids(p_child_id uuid) returns setof text
language sql stable set search_path = '' as $$
  with me as (select private.active_buddy(p_child_id) as buddy_id, private.best_level(p_child_id) as level)
  select won_item_id from public.chance_rolls, me where chance_rolls.child_id = p_child_id and chance_rolls.buddy_id = me.buddy_id and won_item_id is not null
  union
  select item_id from public.purchases, me where purchases.child_id = p_child_id and purchases.buddy_id = me.buddy_id
  union
  select item.id from public.item_catalogue item
  cross join me
  left join public.buddy_unlocks dealt on dealt.buddy_id = me.buddy_id and dealt.kind = 'item' and dealt.option_id = item.id
  where item.unlock_level is not null and coalesce(dealt.unlock_level, item.unlock_level) <= me.level
    and item.id not in (select risked_item_id from public.chance_rolls
                        where child_id = p_child_id and buddy_id = me.buddy_id and kind = 'gamble' and outcome in ('rarer', 'common'))
  union
  select 'made-' || creation.id::text from public.creations creation, me
  where creation.child_id = p_child_id and creation.buddy_id = me.buddy_id and not creation.thrown_away
$$;

-- What friends see: as before, without anything the child made.
create or replace function private.public_look(p_child_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'displayName', app.display_name, 'petType', app.pet_type, 'petName', app.pet_name, 'petLook', app.pet_look,
    'themeColour', app.theme_colour, 'location', app.location,
    'level', private.active_level(p_child_id),
    'equipped', to_jsonb(array(select item_id from unnest(app.equipped_items) as item_id where item_id not like 'made-%')),
    'itemColours', private.item_colours_for(p_child_id))
  from private.app_profiles app where app.id = p_child_id
$$;

/* ---------- RPCs (children with the "creations" feature) ---------- */
/* makeCreation(kind, name, pixels) → { id, name, pixels, pricePaid }. Errors: not-enough-xp, too-many, bad-name, bad-pixels. */
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
  if not private.has_feature(me, 'creations') then raise exception 'not-available'; end if;
  if buddy is null or p_kind is distinct from 'wall-art' then raise exception 'bad-request'; end if;
  if char_length(clean_name) not between 1 and 24 then raise exception 'bad-name'; end if;
  if p_pixels is null or not private.wall_art_pixels_ok(p_pixels) then raise exception 'bad-pixels'; end if;
  if (select count(*) from public.creations where buddy_id = buddy and not thrown_away) >= max_creations then raise exception 'too-many'; end if;
  if private.xp_to_spend(me) < creation_price then raise exception 'not-enough-xp'; end if;
  insert into public.creations (child_id, buddy_id, kind, name, pixels, price_paid, made_on)
  values (me, buddy, p_kind, clean_name, p_pixels, creation_price, private.today_uk())
  returning * into made;
  return jsonb_build_object('id', made.id, 'name', made.name, 'pixels', to_jsonb(made.pixels), 'pricePaid', made.price_paid);
end $$;

/* throwAwayCreation(id): it's taken down and gone from My stuff. The XP isn't given back. */
create or replace function public.throw_away_creation(p_creation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child();
begin
  update public.creations set thrown_away = true where id = p_creation_id and child_id = me;
  update public.buddies set equipped_items = array_remove(equipped_items, 'made-' || p_creation_id::text) where child_id = me;
end $$;

revoke execute on function private.wall_art_pixels_ok(text[]) from public, anon, authenticated;
revoke execute on function public.make_creation(text, text, text[]), public.throw_away_creation(uuid) from public, anon;
grant execute on function public.make_creation(text, text, text[]), public.throw_away_creation(uuid) to authenticated;
