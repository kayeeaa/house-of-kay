// Voxie's Supabase project. Committed on purpose, so the live site (Render) gets it: the anon key is public by design,
// and Row Level Security plus checked database functions protect the data. NEVER put the service_role key here.
const VOXIE_SUPABASE_URL = 'https://gtazlqzloumjzzybrfpa.supabase.co';
const VOXIE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0YXpscXpsb3Vtanp6eWJyZnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwMTUyMTcsImV4cCI6MjEwNjU5MTIxN30.hI_-rTos-NMCsvwChF5TMaeQCqY-wZUEM8nBc-YZW6o';
// Web push (homework reminders): the PUBLIC half of the VAPID key pair, from `npx web-push generate-vapid-keys`.
// Public by design. The private half is only ever the Edge Function secret VAPID_PRIVATE_KEY. Empty = reminders off.
const VOXIE_VAPID_PUBLIC_KEY = 'BBbv4JI-jOHmIyFaU4c6m7sdjJqeVWPuKTjJNwbgl2g4VNcI8BnF9a1USx8jMA73c120ZiotK1zo9ZbUH1cSxcI';
// Visit counts on the logged-out front page: the site token from Cloudflare Web Analytics (no cookies, nothing personal).
// Public by design. Empty = no counting. Never loaded once someone is logged in (see countFrontPageVisit in app.js).
const VOXIE_ANALYTICS_TOKEN = 'ef3be9c7beed43f1ad24d1da14156936';
