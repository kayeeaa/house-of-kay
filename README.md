# House of Kay

> **⚠️ Never commit or push without checking with Kay first.**

The website at [www.house-of-kay.co.uk](https://www.house-of-kay.co.uk). It serves **Voxie**: a free game for children that turns everyday jobs and responsibilities into missions, rewards and a pixel buddy to level up. Grown-ups set up their children's accounts and can see how they're getting on.

---

## Routes

| URL | What it is |
|---|---|
| `/` | Redirects to `/voxie` (301) |
| `/voxie` | Voxie: the game for children and the grown-up dashboard |
| `/voxie/new-passcode` | Where a grown-up picks a new password from a reset email |
| `/voxie/privacy/` | Privacy notice |
| `/menu`, `/slap-war`, `/planner` | Old pages (now removed): redirect to `/voxie` (301) |

`house-of-kay.co.uk` (no www) redirects to `https://www.house-of-kay.co.uk` so search engines see one address for each page.

---

## Running it locally

```
npm install
npm start
```

Then open http://localhost:3000/voxie. The local site talks to the same Supabase project as the live one.

---

## Where things are

| Path | What's there |
|---|---|
| `server.js` | The Express server: redirects, the Voxie content list, static files |
| `public/voxie/` | The Voxie app: `index.html`, `app.js`, `styles.css`, `sw.js` (push notifications), `manifest.webmanifest` |
| `public/voxie/data/dataLayer.js` | Voxie's only way to talk to Supabase |
| `public/voxie/content/` | Items, buddies, places and missions, one file each |
| `supabase/migrations/` | The database (tables, security rules, functions). Apply with `npx supabase db push` |
| `supabase/functions/` | Edge Functions: child accounts, the MyChildAtSchool sync, reminders |
| `supabase/snippets/` | SQL to paste into the Supabase SQL Editor (test data, linking MCAS, schedules) |
| `docs/voxie/` | How Voxie works: backend, feature flags, content, missions, email templates |

Start with [docs/voxie/README.md](docs/voxie/README.md) and [docs/voxie/BACKEND.md](docs/voxie/BACKEND.md).
