# Voxie missions: content and the engine changes they need

**468 missions** (469 as delivered; one duplicate puzzle was removed), one file each in `content/missions/`. Drop the folder into `public/voxie/content/missions/`. It **replaces** the 14 files there: those 14 are included with the same ids, plus an age range and the "Brain teaser" label.

| Kind | `type` | `kind` label | Count |
|---|---|---|---|
| Brain teaser (fun facts) | `trivia` | Brain teaser | 128 |
| Puzzle | `puzzle` | Puzzle | 126 |
| What would you do? | `scenario` | What would you do? | 124 |
| Feel good (self-care, kindness, mantras) | `challenge` (**new**) | Feel good | 90 |

Every mission was written to a shared style guide and then checked by someone other than the writer:
- every fact against reputable sources;
- every puzzle solved from scratch;
- every "What would you do?" and "Feel good" mission for tone, safety, age fit and stereotypes.

## New field on every mission

```js
ages: [8, 13],          // youngest and oldest age it suits, inclusive, within 5–13 (required)
```

- **Age bands used:** 5–7, 8–10 and 11–13. Many missions span two bands (e.g. `[8, 13]`), and many Feel good ones are `[5, 13]`.
- **No gender targeting.** Every mission is for every child of the right age. Missions about pressures that hit one gender more (e.g. "boys don't cry", "girls can't play", rating girls' looks) are told from a friend's or bystander's point of view, so every child practises backing someone up.

**How many each child can get:**

| Age | Brain teaser | Puzzle | What would you do? | Feel good | Total |
|---|---|---|---|---|---|
| 5–7 | 35 | 35–36 | 30 | 60 | ~160 |
| 8–10 | 47 | 49–50 | 47–48 | 55 | ~200 |
| 11–13 | 64 | 57 | 57–58 | 70 | ~250 |

## New mission type: `challenge` ("Feel good")

```js
{ type: "challenge", id: "feelgood-...", kind: "Feel good", ages: [5, 13], difficulty: 1-3,
  question: "the quest", tip: "optional one-liner", doneMessage: "shown after I did it!" }
```

It has **no options and no right answer**. It's a small real-life side quest on the honour system. `addMission` needs to accept it:
- `type` can be `"challenge"`;
- it needs `question` and `doneMessage`, with no `options` or `correctIndex`;
- `difficulty` is 1–3.

**How it plays:**
- **Card:** shows the question, then the `tip` (if there is one) in smaller text.
- **"I did it!":** saves the completion (`mission_completions` with `choice_index` null and `did_it` true), awards `difficulty` XP, and shows `doneMessage`.
- **"Not right now":** closes it. It stays on today's list, so they can come back later in the day. No XP.
- **No timer** (ever), and the Hint and Think again powers don't apply. Brain boost applies only to right answers, so not here either.
- **Bonus missions** (from the Bonus mission power) can be any kind.

## Daily picks: 3 a day, random mix

Each day a child gets 3 missions of **3 different kinds**, chosen at random from the 4 kinds. It's seeded by child id + date, so it doesn't change on reload. Steps:

1. **Eligible missions:** filter by the child's age (from their birth month and year, see below).
2. **Pick the kinds:** choose 3 of the 4 kinds at random (seeded), using only kinds that have at least one eligible mission.
3. **Pick a mission for each kind:** choose one the child has **never done**, in a per-child seeded shuffle order. If they've done every mission of that kind, pick the one they did longest ago. Base this on their `mission_completions` history, not just `(day + offset) % length`. That way:
   - adding new mission files never causes surprise repeats;
   - turning a year older brings in new missions straight away.
4. **Order:** sort the day's 3 by difficulty, as now.

Kids testing at 10–11 get about 2 months of missions before anything repeats.

## Child age (add to the grown-up's "Add a child" form)

- **Birth month and year:** two dropdowns. Store birth month and year, not a full date of birth (less personal data, and enough to work out their age). Age is worked out each day, so missions grow with them.
  - If it's not set, use the 8–13 missions.
- **Who can change it:** the grown-up can change it on the child's tab. The child can't.
- **No gender question.** It isn't needed for anything.
- **Why:** this is personal data about a child, so collect only what's needed (UK GDPR data minimisation and the ICO Children's code). Say on the form why it's asked: "So we can pick missions that suit their age".

## Other small changes

- **Parent stats:** "Questions right %" should count only `trivia`, `puzzle` and `scenario` answers. Add a stat for Feel good missions done in the last 7 days.
- **Timed missions for under-8s:** default to off for children under 8, since a 5–7 year old may need someone to read it to them.
  - Nice-to-have later: a "Read it to me" button using the browser's speech synthesis.
- **What would you do? answers:** some now have two good choices. The existing `isGoodChoice` logic handles this already.
- **Label change:** "Brain block" is now "Brain teaser" everywhere.

## Adding more later

**After adding or changing missions,** rebuild the public missions page (`/voxie/missions/`, questions only, never answers): `node scripts/build-voxie-missions-page.mjs`.

Copy any file in `content/missions/` and give it a new id starting with its type: `trivia-`, `puzzle-`, `scenario-` or `feelgood-`. Set its `ages` and drop it in. IDs are permanent: never reuse or rename one once kids have played it.
