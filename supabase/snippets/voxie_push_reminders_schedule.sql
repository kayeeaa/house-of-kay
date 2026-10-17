/* Run the send-reminders Edge Function every hour (each child gets theirs at the time they picked in Settings, in UK
   time, so this stays right when the clocks change). Run once in the Supabase SQL Editor after deploying send-reminders. Uses the two Vault secrets that
   voxie_mcas_sync_schedule.sql already made, so there's nothing to fill in. */
select cron.schedule('voxie-homework-reminders', '0 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_mcas_sync_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);

/* Handy afterwards:
   Send now to every child, whatever their time (each child still only gets one a day):
     select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_project_url') || '/functions/v1/send-reminders',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_mcas_sync_secret')),
       body := '{"now": true}'::jsonb, timeout_milliseconds := 30000);
   Let today's reminder go again (for testing):  delete from public.push_reminders_sent where sent_on = private.today_uk();
   How it went (a minute later):                 select id, status_code, content from net._http_response order by created desc limit 5;
   Devices with reminders on:                    select user_id, created_at from public.push_subscriptions;
   Stop reminders:                               select cron.unschedule('voxie-homework-reminders');
*/
