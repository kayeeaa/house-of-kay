/* A smaller Shop that changes every week. Needs 20261008090000_voxie_buddy_inventories.sql.

   Each buddy's Shop sells SHOP_ITEMS_A_WEEK (12) of the Shop items, a different 12 for every buddy (so for every
   child and every pet), the same all week, and a new 12 every Monday (UK). The 12 are picked by sorting the Shop
   items on a hash of the buddy, the week and the item, so there's nothing to store and no restock job: the server
   works out the same 12 whenever it's asked. Things already bought stay bought whatever the Shop has that week.
   buddy_shop (the old one-off two-thirds deal) is no longer used; its rows are left alone. */

-- This week's Shop for a buddy: item ids.
create or replace function private.shop_this_week(p_buddy_id uuid) returns setof text
language sql stable set search_path = '' as $$
  select id from public.item_catalogue
  where xp_price is not null
  order by md5(p_buddy_id::text || ':' || private.week_start(private.today_uk())::text || ':' || id)
  limit 12   -- SHOP_ITEMS_A_WEEK
$$;

-- Does this buddy's Shop sell this item this week? (buy_item checks this, so only this week's 12 can be bought.)
create or replace function private.in_buddy_shop(p_buddy_id uuid, p_item_id text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from private.shop_this_week(p_buddy_id) as item_id where item_id = p_item_id)
$$;

/* loadMyShopThisWeek() → { itemIds: [...], restocksOn: "2026-10-19" }: the playing buddy's 12, and when it changes. */
create or replace function public.load_my_shop_this_week() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child(false); buddy uuid := private.active_buddy(me);
begin
  return jsonb_build_object(
    'itemIds', coalesce((select jsonb_agg(item_id) from private.shop_this_week(buddy) as item_id where buddy is not null), '[]'::jsonb),
    'restocksOn', private.week_start(private.today_uk()) + 7);
end $$;

revoke execute on function private.shop_this_week(uuid), private.in_buddy_shop(uuid, text) from public, anon, authenticated;
revoke execute on function public.load_my_shop_this_week() from public, anon;
grant execute on function public.load_my_shop_this_week() to authenticated;
