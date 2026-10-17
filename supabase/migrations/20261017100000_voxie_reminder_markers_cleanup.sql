/* Tidy up the "already sent" reminder markers. push_reminders_sent and lesson_reminders_sent only stop a child getting
   the same reminder twice in a day, so nothing needs them after that. Every night at 3am (UTC) anything older than
   7 days is deleted. Needs 20261017090000_voxie_lesson_reminders.sql and pg_cron (turned on for the MCAS sync). */

create extension if not exists pg_cron;

create or replace function private.clean_up_reminder_markers() returns void
language sql set search_path = '' as $$
  delete from public.push_reminders_sent where sent_on < private.today_uk() - 7;
  delete from public.lesson_reminders_sent where for_date < private.today_uk() - 7;
$$;
revoke execute on function private.clean_up_reminder_markers() from public, anon, authenticated;

-- Scheduling a job with a name that already exists replaces it, so this is safe to run again.
select cron.schedule('voxie-reminder-markers-cleanup', '0 3 * * *', 'select private.clean_up_reminder_markers()');
