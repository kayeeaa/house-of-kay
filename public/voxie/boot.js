/* ======================================================================
   boot.js — runs before the page is shown, so a visitor sees the front page straight away instead of "Loading…"
   while the whole game downloads. Someone with a saved login (Supabase keeps it in localStorage as
   sb-<project>-auth-token), or arriving from an email link, gets the has-session class: they see "Loading…" until the
   game knows who they are (styles.css). showScreen in app.js takes over and removes the class. If a grown-up last
   used this device (voxie-last-role, saved at sign-in), grown-up-device makes Loading the dashboard's width.
   ====================================================================== */
(() => {
  let signedIn = /access_token=|[?&]code=/.test(location.hash + location.search);
  try {
    for (let index = 0; index < localStorage.length; index++) if (/^sb-.+-auth-token$/.test(localStorage.key(index))) signedIn = true;
  } catch (error) { signedIn = true; }   // can't tell: show "Loading…" as before
  if (signedIn) document.documentElement.classList.add("has-session");
  try { if (localStorage.getItem("voxie-last-role") === "parent") document.documentElement.classList.add("grown-up-device"); } catch (error) {}
})();
