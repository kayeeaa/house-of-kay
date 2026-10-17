/* TEST ONLY: made-up school data for one child, until the MCAS sync fills these tables for real.
   Paste into the Supabase SQL Editor, change the username on the first line, and run. Dates are from today, so run
   it again whenever you want fresh data. Running it again clears that child's school data first, including any
   homework they've ticked (and the XP and level points it gave). Never run it for a real child linked to MCAS. */
do $$
declare
  test_username constant text := 'kaytest';
  kid uuid;
  today date := private.today_uk();
  monday date := private.week_start(private.today_uk());
  day date;
  lesson record;
begin
  select id into kid from public.profiles where lower(username) = lower(test_username) and role = 'child';
  if kid is null then raise exception 'No child with the username %', test_username; end if;

  delete from public.school_homework where child_id = kid;
  delete from public.school_lessons where child_id = kid;
  delete from public.school_days where child_id = kid;
  insert into public.school_sync (child_id, school_name, last_synced_at) values (kid, 'Sample School', now() - interval '25 minutes')
  on conflict (child_id) do update set school_name = excluded.school_name, last_synced_at = excluded.last_synced_at;

  -- This week and next, with next Friday off (like an INSET day).
  foreach day in array array[monday, monday + 1, monday + 2, monday + 3, monday + 4, monday + 7, monday + 8, monday + 9, monday + 10] loop
    insert into public.school_days (child_id, school_day) values (kid, day);
    insert into public.school_lessons (child_id, lesson_date, start_time, end_time, subject, colour, teachers, mcas_class_id)
    values (kid, day, '08:40', '08:49', 'Tutor group', '000000', array['Mr Tutor'], 1);
    for lesson in
      select * from (values
        (1, 1, 'Science', '359de7', 'Ms Ray'), (1, 2, 'Geography', 'b187f1', 'Mr Hill'), (1, 3, 'English', '92d50d', 'Miss Page'), (1, 4, 'History', 'e0a030', 'Mrs Stone'), (1, 5, 'Technology', 'f06060', 'Mr Bolt'),
        (2, 1, 'Drama', 'e070c0', 'Mr Stage'), (2, 2, 'Music', '40c0c0', 'Mrs Lyre'), (2, 3, 'English', '92d50d', 'Miss Page'), (2, 4, 'Maths', '3060d0', 'Mr Sum'), (2, 5, 'Science', '359de7', 'Ms Ray'),
        (3, 1, 'French', 'd04040', 'Mme Dupont|Mr Lee'), (3, 2, 'Technology', 'f06060', 'Mr Bolt'), (3, 3, 'Maths', '3060d0', 'Mr Sum'), (3, 4, 'PE', '50b050', 'Mr Sprint'), (3, 5, 'Art', 'c08040', 'Ms Brush'),
        (4, 1, 'Computing', '606060', 'Mr Byte'), (4, 2, 'PSHE', 'a0a0e0', 'Miss Kind'), (4, 3, 'Maths', '3060d0', 'Mr Sum'), (4, 4, 'PE', '50b050', 'Mr Sprint'), (4, 5, 'English', '92d50d', 'Miss Page'),
        (5, 1, 'English', '92d50d', 'Miss Page'), (5, 2, 'Maths', '3060d0', 'Mr Sum'), (5, 3, 'French', 'd04040', 'Mme Dupont'), (5, 4, 'Science', '359de7', 'Ms Ray'), (5, 5, 'Ethics', 'a06030', 'Miss Good')
      ) as pattern (week_day, period, subject, colour, teachers)
      where week_day = extract(isodow from day)
    loop
      insert into public.school_lessons (child_id, lesson_date, start_time, end_time, subject, colour, teachers, mcas_class_id)
      values (kid, day,
        (array['08:50', '10:30', '11:30', '13:20', '14:10'])[lesson.period]::time,
        (array['09:49', '11:09', '12:29', '14:08', '15:09'])[lesson.period]::time,
        lesson.subject, lesson.colour, string_to_array(lesson.teachers, '|'), 100 + lesson.period);
    end loop;
  end loop;

  insert into public.school_homework (child_id, source, external_id, subject, title, due_date, due_time, instructions, links, set_by, submitted) values
    (kid, 'mcas', 'sample-1', 'French', 'Languagenut – this week''s assignment', today, '23:59',
     'Log on to Languagenut with the Microsoft login, go to Assignments and finish this week''s one.',
     '[{"label": "Open Languagenut", "url": "https://www.languagenut.com"}]', 'Mme Dupont', false),
    (kid, 'mcas', 'sample-2', 'Ethics', 'Revise for the assessment', today + 1, '23:59',
     'Do both Seneca assignments before the assessment.',
     '[{"label": "Seneca assignment 1", "url": "https://app.senecalearning.com"}, {"label": "Seneca assignment 2", "url": "https://app.senecalearning.com"}]', 'Miss Good', false),
    (kid, 'mcas', 'sample-3', 'Science', 'Tassomai weekly goal', today + 3, '20:30',
     'Answer questions until the bar at the top is full.', '[{"label": "Open Tassomai", "url": "https://www.tassomai.co.uk"}]', 'Ms Ray', false),
    (kid, 'mcas', 'sample-4', 'Maths', 'Sparx homework', today + 6, '09:00', '', '[{"label": "Open Sparx Maths", "url": "https://www.sparxmaths.uk"}]', 'Mr Sum', false),
    (kid, 'teams', 'sample-5', '', 'Code challenge', today - 1, '23:59', 'Finish the three challenges to get the secret code.', '[]', '', false),
    (kid, 'mcas', 'sample-6', 'English', 'Sparx Reader', today - 2, '23:59', '', '[]', 'Miss Page', true);
end $$;
