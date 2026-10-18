---
name: voxie-migration
description: How to write and release a Supabase migration for Voxie the way this repo does it - file naming, header comment, security definer RPCs, grants, error codes the app shows, changing an existing function safely, and the order to release in. Use whenever a Voxie change needs a new table, column, RPC, trigger or change to an existing SQL function, or when Kay asks what to run or deploy.
---

# Voxie migrations

The database is Supabase. Kay runs each migration by hand in the Supabase SQL Editor and deploys Edge Functions with the Supabase CLI. Nothing runs them automatically.

## The file

- `supabase/migrations/YYYYMMDDHHMMSS_voxie_<what_it_does>.sql`, timestamped after the newest file there (`ls supabase/migrations`).
- One feature per file. Start with a block comment that says, in plain words:
  - what the change does and why,
  - each new table or column and who can read it,
  - each RPC with its app name and error codes (`/* giveCreation(creationId, friendId). Errors: not-found, ... */`),
  - `Needs <earlier migration files>.`
- Match the comment density and voice of the files around it: short, plain English, British spelling.

## Tables

```sql
create table public.thing (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.profiles (id) on delete cascade,
  buddy_id uuid references public.buddies (id) on delete cascade,   -- if it belongs to a buddy, like items and XP
  created_at timestamptz not null default now()
);
alter table public.thing enable row level security;
create policy "children read their own things" on public.thing for select to authenticated using (child_id = (select auth.uid()));
grant select on public.thing to authenticated;
grant all on public.thing to service_role;
```
- The app only **reads** tables directly, through RLS policies. All writes go through RPCs.
- Grown-ups read a child's rows with `private.can_see_child(child_id)`. **Grown-ups never see a child's friends.** Anything about a friend (names, who gave what) is readable by the child only.
- Friends only ever see `private.public_look`. Children's own creations stay out of it.
- Server-only tables: `revoke all ... from anon, authenticated;` and no policy.

## RPCs

```sql
create or replace function public.do_thing(p_thing_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_child();   -- locks the profile row; require_child(false) to not lock
begin
  if not found then raise exception 'not-found'; end if;
  ...
end $$;
revoke execute on function public.do_thing(uuid) from public, anon;
grant execute on function public.do_thing(uuid) to authenticated;
```
- Always `security definer set search_path = ''`, and schema-qualify everything (`public.`, `private.`).
- Who's calling: `private.require_child()`, `private.require_parent()`, `private.require_user()`, or `private.require_my_child(p_child_id)` for a grown-up acting on their child.
- Per-buddy data uses `private.active_buddy(me)`.
- Behind a feature flag: `if not private.has_feature(me, '<id>') then raise exception 'not-available'; end if;` (see `docs/voxie/FEATURES.md`).
- Errors are short kebab-case codes (`'friend-full'`). `dataLayer.js` turns them into `Error("friend-full")` and `app.js` maps each code to a message a child understands. Add every new code to both.
- `private.*` helpers: `revoke execute ... from public, anon, authenticated;`.
- Calling an Edge Function from the database (e.g. a push notification): `net.http_post` with the Vault secrets `voxie_project_url` and `voxie_mcas_sync_secret`, wrapped in `exception when others then` so a failed notification never stops the real change. Copy `private.push_gift_notice` in `20261019090000_voxie_wall_art_gifts.sql`.

## Changing a function that already exists

This is where mistakes happen. Functions like `make_creation`, `xp_earned` and `claim_homework_reminders` have been rewritten in several later migrations.

1. Find the latest definition: `grep -n "function public.make_creation" supabase/migrations/*.sql`. **The last file listed is the live one.**
2. Copy that whole definition into the new migration and change only what's needed.
3. Say so above it: `/* As in 20261017130000_voxie_creations_for_everyone.sql, with "and not received_as_gift" in the count. */`.
4. Changing the arguments or return type needs `drop function public.name(old arg types);` first, then the new `revoke` and `grant`.
5. A check constraint written inline is named `<table>_<column>_check`. To widen one: `drop constraint`, then `add constraint` with the same name.

## The app side, in the same change

- `public/voxie/data/dataLayer.js`: one method per RPC with a `/** ... */` comment giving the shape and every `Error("code")` it throws.
- `app.js`: escape anything a person typed (`escapeHtml`) before it goes into `innerHTML`, especially if it can reach another child.
- `docs/voxie/BACKEND.md`: one line for the migration under the list of files.
- If what's collected or who can see it changes, update `public/voxie/privacy/index.html` and its "Last updated" date.

## Releasing (tell Kay this every time)

1. **Run the migration in the SQL Editor before the site goes out.** If new app code reads a new column, the game won't load until the migration has run.
2. Deploy any new or changed Edge Function: `npx supabase functions deploy <name>`. Add `--no-verify-jwt` for ones the database or a schedule calls (`send-reminders`, `notify-admins`, `notify-child`).
3. Mention any new secrets or Vault entries, and any feature flag to turn on.

**Has Kay already run an earlier version?** A migration file can't be run twice: `create table` and `add column` fail the second time. If the file changed after Kay ran it, don't ask them to run it again. Give them cleanup SQL instead: `drop ... if exists` for what was removed, and the changed functions pasted on their own. Ask Kay if you don't know which version they ran.

## Git

Never commit or push unless Kay says "commit", "push" or "sync" in that same message (see `CLAUDE.md`).
