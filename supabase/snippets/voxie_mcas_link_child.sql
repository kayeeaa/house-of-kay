/* Link a Voxie child to their MCAS pupil, so the mcas-sync function fills their School tab.
   Paste into the Supabase SQL Editor, set the two values on the first lines, and run.
   - pupil_id: the pupil's id on the MCAS login in the MCAS_EMAIL / MCAS_PASSWORD secrets
     (the test script printed it next to the child's name).
   - Linking first clears the child's school data (made-up sample data, or a previous link's), including any homework
     ticks and the XP and level points they gave.

   To move the link to another child later (e.g. from kaytest to jenson), run this again with the new username:
   it unlinks the pupil from whoever had them, clears that child's school data too, and links the new child. */
do $$
declare
  voxie_username constant text := 'kaytest';
  pupil_id constant bigint := 9582;           -- the MCAS pupil id
  kid uuid;
  clear_kid uuid;
begin
  select id into kid from public.profiles where lower(username) = lower(voxie_username) and role = 'child';
  if kid is null then raise exception 'No child with the username %', voxie_username; end if;

  -- Clear this child, and whoever had this pupil before.
  foreach clear_kid in array array_remove(array[kid, (select child_id from public.school_links where mcas_student_id = pupil_id)], null) loop
    delete from public.school_links where child_id = clear_kid;
    delete from public.school_homework where child_id = clear_kid;   -- also removes their homework ticks
    delete from public.school_lessons where child_id = clear_kid;
    delete from public.school_days where child_id = clear_kid;
    delete from public.school_sync where child_id = clear_kid;
  end loop;

  insert into public.school_links (child_id, mcas_student_id) values (kid, pupil_id);
  raise notice 'Linked % to MCAS pupil %. Their School tab fills on the next sync.', voxie_username, pupil_id;
end $$;
