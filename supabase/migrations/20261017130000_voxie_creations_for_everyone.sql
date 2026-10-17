/* Making wall art is for everyone: no "creations" feature flag. Replaces make_creation from
   20261017120000_voxie_creations.sql without the flag check (everything else is the same), and removes the flag. */

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
  if (select count(*) from public.creations where buddy_id = buddy and not thrown_away) >= max_creations then raise exception 'too-many'; end if;
  if private.xp_to_spend(me) < creation_price then raise exception 'not-enough-xp'; end if;
  insert into public.creations (child_id, buddy_id, kind, name, pixels, price_paid, made_on)
  values (me, buddy, p_kind, clean_name, p_pixels, creation_price, private.today_uk())
  returning * into made;
  return jsonb_build_object('id', made.id, 'name', made.name, 'pixels', to_jsonb(made.pixels), 'pricePaid', made.price_paid);
end $$;

-- The flag isn't needed any more (this also clears who had it).
delete from public.features where id = 'creations';
