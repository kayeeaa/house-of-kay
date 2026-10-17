/* Run the mcas-sync Edge Function on a schedule. Run once in the Supabase SQL Editor, after deploying the function.

   Before running, put two values in below:
   - your project URL: Project Settings → API → Project URL (https://<ref>.supabase.co)
   - the same MCAS_SYNC_SECRET you added in Edge Functions → Secrets
   They're kept in Vault (encrypted), so they're not in this file once you've run it. Don't save this file with them in.

   Once a day, late at night: homework is set well ahead, so that's plenty. pg_cron runs on UTC, so '0 22 * * *' is
   11pm in summer (BST) and 10pm in winter (GMT). Running this again with a new time replaces the old schedule. */
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'voxie_project_url');
select vault.create_secret('PASTE-YOUR-MCAS_SYNC_SECRET-HERE', 'voxie_mcas_sync_secret');

select cron.schedule('voxie-mcas-sync', '0 22 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_project_url') || '/functions/v1/mcas-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_mcas_sync_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);

/* Handy afterwards:
   Sync now (same call as the schedule):
     select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_project_url') || '/functions/v1/mcas-sync',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'voxie_mcas_sync_secret')),
       body := '{}'::jsonb, timeout_milliseconds := 60000);
   How it went (a minute later):  select id, status_code, content from net._http_response order by created desc limit 5;
   Each child's last sync:        select * from public.school_sync;
   Stop the schedule:             select cron.unschedule('voxie-mcas-sync');
*/
