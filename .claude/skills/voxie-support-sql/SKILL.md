---
name: voxie-support-sql
description: SQL for Kay to paste into the Supabase SQL Editor to look at or fix real Voxie accounts - give a child XP, take a buddy to a level, look a child or grown-up up, turn a feature flag on, add a site admin. Use whenever Kay asks to change, check or help a specific child's or grown-up's Voxie account, or asks "what SQL do I run to...".
---

# Voxie support SQL

Kay runs SQL by hand in the Supabase SQL Editor. Give Kay the SQL to paste; never try to run it yourself.

## How the game stores progress (read before writing anything)

Nothing stores "XP" or "level" directly. Both are worked out from other tables, **per buddy** (each child can have several buddies; `profiles.active_buddy_id` is the one playing now).

- **XP earned** (`private.xp_earned`): the playing buddy's `xp_awarded` summed from `mission_completions`, `game_results` and `homework_completions`.
- **XP to spend** (`private.xp_to_spend`): XP earned minus XP put into items (`item_xp`) minus Shop, Mystery box and making spends (`purchases`, `chance_rolls`, `creations.price_paid`).
- **Level points** (`private.buddy_points`): one per ticked task (`chore_completions`, `scheduled_task_completions`, `own_tasks` with `done`), plus `homework_completions.level_points`, for that buddy.
- **Level** (`private.calculate_level(points)`): level 2 at 2 points, 3 at 6, 4 at 11, then +4 points a level (from level 30, one more every 25 levels, never more than 10 a level). So **level 5 = 15 points**, level 10 = 35. Check with `select private.calculate_level(35);` or `select private.points_needed_for_level(10);`.
- **Unlocks** use the highest level ever (`buddies.highest_level_reached`). After raising points, call `private.record_highest_level(child_id)` so unlocks stay.
- If any of this looks different from what's here, check the latest `supabase/migrations/*.sql` that defines the function (`grep -n "function private.xp_earned" supabase/migrations/*.sql`, take the last file). The most recent definition wins.

## Rules for support SQL

- **Look the child up by `username` first** and show Kay a check query to run before the change. Usernames are lower case, `^[a-z0-9_-]{3,20}$`. Ask Kay for the exact username if unsure: guesses like `jenson` vs `jensonplays2014` don't match.
- **Only ever add.** Add rows that give XP or points. Never edit or delete existing rows to change progress.
- **Date bonuses yesterday** (`private.today_uk() - 1`), so they don't use up today's mission limit or game XP cap or show in today's task list.
- `mission_completions` is unique per child, mission id and day, so a bonus with the same id run twice on one day fails. Say so.
- Use a `do $$ ... $$` block that loops over the usernames, skips anyone with no buddy yet (`active_buddy_id is null`), and ends with `raise notice` showing the new level and XP to spend, so Kay can see it worked.
- Tell Kay the child sees the change the next time they open or refresh the game.

## Ready-made SQL

### Check children exist
```sql
select id, username, display_name, active_buddy_id is not null as has_buddy, setup_complete
from public.profiles where role = 'child' and username in ('child-one', 'child-two');
```

### See a child's progress
```sql
select p.username, private.active_level(p.id) as level, private.buddy_points(p.id) as points_per_buddy,
       private.xp_earned(p.id) as xp_earned, private.xp_to_spend(p.id) as xp_to_spend
from public.profiles p where p.username = 'child-one';
```

### Give XP and take the playing buddy to a level
```sql
do $$
declare
  kid record;
  yesterday date := private.today_uk() - 1;   -- doesn't use up today's missions or game XP
  bonus_xp constant int := 1000;
  points_for_level constant int := 15;        -- level 5; see "Level" above for others
  points_now int;
begin
  for kid in select id, username, active_buddy_id from public.profiles
             where role = 'child' and username in ('child-one', 'child-two') loop
    if kid.active_buddy_id is null then raise notice '% has no buddy yet, skipped', kid.username; continue; end if;

    insert into public.mission_completions (child_id, buddy_id, mission_id, completed_on, xp_awarded, did_it)
    values (kid.id, kid.active_buddy_id, 'bonus-from-kay', yesterday, bonus_xp, true);

    select points into points_now from private.buddy_points(kid.id) where buddy_id = kid.active_buddy_id;
    insert into public.own_tasks (child_id, title, added_on, done, done_by_buddy_id)
    select kid.id, 'Bonus from Kay', yesterday, true, kid.active_buddy_id
    from generate_series(1, greatest(0, points_for_level - coalesce(points_now, 0)));

    perform private.record_highest_level(kid.id);
    raise notice '%: level %, % XP to spend', kid.username, private.active_level(kid.id), private.xp_to_spend(kid.id);
  end loop;
end $$;
```
For XP only, drop the `own_tasks` insert. For a level only, drop the `mission_completions` insert.

### Look up a grown-up and their children
```sql
select parent.id, u.email, parent.display_name, child.username
from auth.users u
join public.profiles parent on parent.id = u.id and parent.role = 'parent'
left join public.family_links fl on fl.parent_id = parent.id
left join public.profiles child on child.id = fl.child_id
where u.email = 'grown-up@example.com';
```

### Feature flags
Full guide: `docs/voxie/FEATURES.md`.
```sql
select * from private.feature_report;
select private.turn_feature_on_for('school', 'child-one');                     -- a child, by username
select private.turn_feature_on_for('school', 'grown-up@example.com', true);    -- a grown-up and all their children
select private.turn_feature_off_for('school', 'child-one');
```

### Site admins (get the "new grown-up" push)
```sql
insert into public.site_admins (user_id) select id from auth.users where email = 'you@example.com';
```

## Things SQL shouldn't do

- **Passcodes:** a child's passcode is reset by their grown-up in the app (the child's tab), which goes through the `set-child-passcode` Edge Function and Supabase Auth. Don't write SQL for it.
- **Giving items:** `purchases.price_paid` must be at least 1, so a "free" item would still cost XP. Ask Kay what they want before inventing a way.
- **Deleting a child:** use the grown-up's delete option in the app (`delete-child-account`), not SQL, so their login goes too.
