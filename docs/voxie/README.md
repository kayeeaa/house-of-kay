# Voxie content: items, buddies and locations

These are Voxie's content files, ready to go in the repo: **249 items, 15 buddy types and 15 locations**, one file each. Missions are not included and will be added next.

This bundle also includes the prototype itself, `voxie.html`, which is the full working game in one file. It contains exactly the same content blocks: every `/* ---------- content/items/<id>.js ---------- */` block in it matches the file here. The prototype is the reference for how each one looks and behaves.

`CATALOGUE.md` lists everything in readable tables: what unlocks at each level, Shop prices, rarities and powers.

## Folder layout

```
content/
  items/       249 files   (clothes, weapons, tools, pets, extras, house)
  pets/        15 files    (buddy types)
  locations/   15 files
```

Each file is a single `export default { ... };` with no imports. Register a whole folder with one line, as the prototype's registry comment says:

```js
Object.values(import.meta.glob("./items/*.js", { eager: true })).forEach(file => addItem(file.default));
Object.values(import.meta.glob("./pets/*.js", { eager: true })).forEach(file => addPetType(file.default));
Object.values(import.meta.glob("./locations/*.js", { eager: true })).forEach(file => addLocation(file.default));
```

Copy `addItem`, `addPetType` and `addLocation` from the prototype unchanged. They check every file and skip a broken one with a clear console message, so one bad file can't break the game.

**Load order matters:** pets (buddy types) are listed in the order they are registered. Sort the pets glob by a fixed list (`axolotl, seal, capybara, fox, frog, panda, penguin, cat, pug, dino, dragon, shark, owl, slime, robot`) or by file name, whichever you prefer.

## Rules that must not break

- **An id never changes.** Supabase stores ids in `equipped_items`, `item_xp`, `purchases`, `chance_rolls` and `item_colours`. Rename the `label` instead.
- **Every item is got exactly one way:** `unlockLevel`, `xpPrice` (sold in the Shop) or `chanceOnly: true`. The validator enforces this.
- **Powers** (`abilities: { advanced, master }`) must use ids from `content/powers.js`. House items never have powers.
- **Slots.** Only one item per slot can be in use at a time. The slots in use are:
  - **On the buddy:** `head`, `face` (glasses and masks), `mouth` (moustache), `neck`, `chest`, `back`, `float`, `hand`, `companion`.
  - **House:** `house-wall`, `house-floor`, `house-window`, `house-door`, `house-picture`, `house-wall-top` (neon sign, clock), `house-bed` (bed, sofa), `house-shelf`, `house-rug`, `house-plant`, `house-seat`, `house-ball`, `house-tech`, `house-showpiece`, `house-chest`, `house-lamp`, `house-disco`.

  Unknown slots are drawn last (on top), which is what `face` and `mouth` need.

## Wallpapers and floors

Every pattern in every colour is its own item, unlocked by levelling up.
- **Wallpapers:** 6 patterns (stripy, polka dot, check, zigzag, diamond, wavy) in 8 colours (blue, green, red, yellow, purple, orange, pink, black). That's 48 items with ids like `wallpaper-<pattern>-<colour>`, e.g. `wallpaper-dots-green`.
- **Floors:** floorboards in 5 woods (`floor-planks-oak` and so on), plus tiles, carpet and chequered floors in a range of colours (`floor-tiles-blue`, `floor-carpet-pink`, `floor-chequered-black`).
- **Spread:** they're spread evenly from level 20 to level 100, so each colour of each pattern comes at a different time. From level 20 a level has at most two unlocks: its main item plus one wall or floor.
- **Older ones kept:** the earlier walls and floors (Wallpaper, Painted wall, Starry, Space mural, Wood panels, Wooden floor, Carpet, Grass, Neon grid, Checkerboard, Lava) are still there. The early ones cover levels 6–14.

To add another colour, copy any wallpaper file, change the id, label and the four colours in its `drawInRoom`. Each colour family uses a light background, a mid pattern colour, a dark skirting colour and a deep shadow line.

## How each kind of file draws itself

Content files never touch the canvas directly. The game hands each one helpers.

**Items worn or held:** either a `sprite` grid or draw functions.

- **`sprite: { pixels: [...], colours: {...} }`.** Each letter is one pixel and `.` is see-through. On the buddy, one grid pixel is half a pet block. The game places the grid by its slot:
  - `head`: sits on top, centred.
  - `neck`: hangs from the neck.
  - `chest`: on the right of the chest.
  - `back`: sticks out on the left.
  - `float`: up by the left side.
  - `hand`: held on the right, with the grid's bottom at the feet.
  
  Small held things therefore have see-through rows at the bottom so they sit at hand height.
- **`drawOnPet(pet)` / `drawBehindPet(pet)`.** These get `pet.block(column, row, colour, width, height)`, `pet.rowEdges(row)`, `pet.topRow`, `pet.neckRow`, `pet.neck { first, last, centre }`, `pet.arms { row, leftX, rightX }`, `pet.face` and `pet.eyes { top, leftX, rightX }`. That means glasses, masks and wings fit every buddy shape.
  - Wings use `drawBehindPet` only. The prototype's validator was updated to accept that; keep the change: `!item.drawBehindPet` is in the "needs a sprite or a draw function" check.

**Pets (little pals) and house things standing on the floor:** a `sprite` (one grid pixel = one scene pixel) or `drawOnFloor(scene, x, groundY)`. House ones also have `floorPosition`: 0 is the left edge, 1 is the right.

**House things that change the room:** `drawInRoom(scene)` plus a `roomLayer` (`wall`, `on-wall`, `floor` or `on-floor`). `scene` has `fill`, `disc`, `mountain`, `sprite`, `themeShade`, `width`, `height` and `groundTop`. The canvas is low-res (about 1 pixel per 4 screen pixels) and its width changes with the screen, so everything is positioned from `width`, `height` and `groundTop`.

**Buddy types (`content/pets/`):** a 14 × 12 `pixelMap` using these letters:

| Letter | Meaning |
|---|---|
| B | body |
| D | dark |
| L | light |
| S | shade or spots |
| E | eyes |
| M | mouth |
| N | nose |

Each buddy also has:
- `face`: where the chosen face is drawn.
- `arms`: where arms go.
- `neckRow`: where scarves go.

Body colour options (Mint, Lilac and so on) recolour B, D, L and S, so every buddy can be any colour.

**Locations (`content/locations/`):** `drawScene(scene)` with the same scene helpers, or `showsHouse: true` (Home only).

## Game-design notes for whoever builds this

- **Level curve.** Every level from 2 to 100 has at least one unlock. Bigger moments come at 25, 30, 50, 75, 90 and 100.
- **Locations** unlock at 1, 6, 9, 15, 20, 26, 32, 38, 45, 52, 60, 70, 80, 90 and 100.
- **Mystery boxes and Take a chance** can give any item that isn't sold in the Shop, including level items a child hasn't reached yet. This is the existing design. With the bigger catalogue, each single item is rarer to win from a box, while the rarity odds stay the same.
- **Extra-hard items** use `chanceWithinRarity`:
  - Diamond crown: 0.02
  - Unicorn: 0.05
  - Lava floor: 0.5
  - Unicorn horn: 0.01
- **Rolls stay on the server.** All chance rolls must still happen in database functions; see the data layer notes in the prototype.

## Adding more later

Copy any file, give it a new id (lowercase-with-dashes), change the art and numbers, and drop it in the folder. No other code changes are needed. If a level gets two unlocks, the game shows both "New item!" pop-ups one after the other.

## Before launch: the rest of `voxie.html`

The prototype is one file with clearly labelled sections. Its comments carry the detail; this is the checklist.

- ✅ **`data/dataLayer.js` now talks to Supabase** (done). The backend is in `supabase/migrations/` and `supabase/functions/`; [BACKEND.md](BACKEND.md) maps every dataLayer function to its table, RPC or Edge Function. The browser's project URL and public (anon) key are in `public/voxie/data/supabase-config.js`, committed on purpose so the live site gets it; the key is public by design and the database rules protect the data. The secret service_role key must never go in any file the browser loads. The "New password" page for reset emails is `/voxie/new-passcode`.
  - **When items, missions or powers change**, refresh the server's copy of the numbers (prices, powers, mission answers and ages) with `node scripts/voxie-sync-catalogue.js`, with `SUPABASE_SERVICE_ROLE_KEY` set. Never put that key in the browser.
  - **Database changes** go in a new file in `supabase/migrations/`, run by hand in the Supabase SQL Editor before the site that needs it goes out. Edge Functions deploy with `npx supabase functions deploy <name>`.
- **Accounts are grown-up first.** Only grown-ups sign up (email and password). They add each child with a username, passcode and birth month and year, so every child account has a grown-up's agreement from the start.
  - **No child's real name, email, full date of birth or gender is ever collected.** The only things held about a child are their username and birth month and year. The grown-up is told not to use the child's real name as the username. At first setup the child makes up a game name (`display_name`, told not to use their real name); until then they're shown by their username.
  - **Why the birth month and year are collected:** only to work out the child's age each day, so they get missions that suit their age. Gender isn't collected: every mission is for every child of the right age. The grown-up can change the birth month and year on the child's tab; the child can't. Record this purpose wherever personal data is documented (privacy notice, data protection records) when the app moves to Supabase.
  - Child logins need Supabase auth users with hidden emails, created by a function using the service role. The data layer notes explain how, including the username lookup at log-in.
  - A child who forgets their passcode asks their grown-up, who sets a new one on the child's tab.
  - A second grown-up joins with an invite code from the first one.
  - A child's only grown-up can't unlink; they can delete the child's account instead, which removes all of its data.
  - Payments later go on the grown-up's profile (one plan covers the family): a child gets paid features if any of their grown-ups pays.
- ✅ **Prototype-only bits removed** (done): the homepage test accounts, the "Prototype controls" panel and `prototypeSettings`.
- **Still to do before launch:** a word filter for game names and pet names (other children see them).
- **Game names (2026-10-05):** a child's game name (what friends see) starts as the username their grown-up set. They choose it at setup (changing it in Settings was removed on 2026-10-15). Every game name is unique and can't be another child's username (ignoring capitals), so friend search never shows two children with the same name. When it changes, each of the child's grown-ups gets a pop-up next time they open their account (`parent_notifications`). The login username itself never changes.
- **New-task pop-up for children (2026-10-05):** each task a grown-up adds makes a `child_notifications` row. Next time the child opens the game (or taps Home), they get ONE pop-up listing everything added since they last looked, grouped by grown-up ("Mum added 3 tasks: …").
- **Starter buddies (2026-10-05):** at setup a child picks from `STARTER_PET_TYPES` in `content/customise.js` (axolotl, seal, capybara). Every other buddy is collected by rebirth.
- **Decided for now (2026-10-04): grown-ups don't approve friend requests.** Children send and accept requests themselves. Revisit later (see BACKEND.md, point 9).
- **Install the app:** a real install needs a web app manifest, icons and a service worker (see the comment in the install section).
- **Sign-up switch:** `SIGN_UP_OPEN` turns sign-up on or off ("Coming soon"); anyone with an account can still log in.
- **Missions:** 468 missions are in `content/missions/`, picked by the child's age. See [MISSIONS-README.md](MISSIONS-README.md) for how they work and [MISSIONS-LIST.md](MISSIONS-LIST.md) for the full list.
