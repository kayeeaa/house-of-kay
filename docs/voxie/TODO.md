# Voxie to do

Bigger pieces of work, planned but not started. Smaller changes from playing and testing are in [FEEDBACK.md](FEEDBACK.md).

## Grown-ups can see friends, and block and report how(parked 2026-10-18)

Needed before opening Voxie to the public. At the moment grown-ups can't see who their child is friends with, and nobody can block or report another child.

### 1. Grown-ups can see their child's friends

On the child's tab in the grown-up account, a **Friends** section:
- **Friends:** each friend's game name and buddy (what other children already see), with **Remove** and **Block**.
- **Requests:** waiting requests from other children (**Decline**, **Block**) and requests the child has sent (**Cancel**).
- **Blocked:** children the child has blocked, with **Unblock**.

This reverses the rule that grown-ups never see a child's friends, so the privacy notice, `docs/voxie/BACKEND.md` and the `voxie-migration` skill need updating to match.

### 2. Block

- A new table of who has blocked whom, per child.
- **Where:** on a friend's card, on a waiting request, and on a gifted picture's pop-up (to block whoever sent it). The child's grown-up can also block from the Friends section.
- **What it does:** removes the friendship, cancels waiting requests, and stops future requests and gifts in both directions.
- **The blocked child is never told:** to them the code just "doesn't work", and gifting says they can't be found.
- **Unblock** from the same lists.

### 3. Report

- A short form from the same places, plus the grown-up's Friends section.
- **Reasons are choices, not free text,** so children don't type personal details: "Rude or unkind name", "Rude picture", "I don't know them in real life", "Something else".
- **Saved:** the reported child's game name, buddy name, any gifted picture involved, the reason, and who reported it and when.
- **Kay is told** through the existing `notify-admins` push (e.g. "🚩 New report: rude picture"). Details are read with SQL, to be added to the `voxie-support-sql` skill.
- **Reporting also offers to block:** "Block them too?"

### Database and deploy

- One migration:
  - tables for blocks and reports;
  - block, unblock and report functions, plus grown-up versions acting for their child;
  - the friends lists added to the child overview;
  - block checks in friend codes, requests and gifts;
  - a database trigger that calls `notify-admins` for a new report.
- `notify-admins` gets a second kind of message, so it needs redeploying.
- The privacy notice needs a new "Last updated" date.

### Questions to answer before building

1. **Whose block is it?** If a grown-up blocks someone, can the child unblock them? Suggested: only grown-ups can undo a grown-up's block; a child can undo their own.
2. **Accepting requests:** can grown-ups accept requests for the child? Suggested: no. They can decline, cancel and block, but only the child says yes.
3. **Gift senders:** now that grown-ups see friends, should they see who sent each gift? Suggested: yes, for consistency.
4. **Child's buddy name:** is it OK for reports to include the reported child's buddy name (which other children already see)?
5. **Reading reports:** is a push plus SQL enough for now, or is a page to read and close reports needed (a bigger job)?

## Reasons to come back: a buddy you visit, not a list you check (ideas, 2026-10-18)

Lists and trackers only reward you once you've done something, so there's no pull to open them. A pet gives a reason to visit before doing anything: to see what it's up to. Curiosity and novelty work far better than obligation, especially with ADHD. These build on what Voxie already has: snacks for tasks, buddy messages, houses, places, friends and push notifications.

**Try first:**
1. Overnight surprises, with buddy-voiced notifications.
2. Tap reactions and feeding.
3. A grown-up buddy for Kay.

Ask Jenson and Roux which they'd want first.

### Something waiting for you tomorrow

Missing these never hurts; you just don't find out what happened.
- [ ] **Overnight surprises:** the buddy goes exploring overnight and brings something back (a shell, a note, a small item or a bit of XP). It's collected when you open the app, and it's different each day.
- [ ] **Things that grow:** a seed in the house that sprouts over a few days, or an egg that hatches into a companion pet.
- [ ] **Notifications from the buddy:** "Bubbles found something shiny at the beach 👀" instead of "You have 3 tasks". Uses the existing push notifications; mostly writing.
- [ ] **A small daily event:** a visitor at the door, weather in a place, a mini-quest. Small, random, short.

### The buddy as a toy

- [ ] **Tap reactions:** stroke, tickle, poke, each with a different response.
- [ ] **Feeding:** drag a snack to the buddy and watch it eat. Tasks already earn snacks, so feeding becomes the reward.
- [ ] **Moods that show:** sleepy at night, excited when a task is done, bored if nobody's played today, but never sad or ill.
- [ ] **Play items:** a ball to throw, and toys in the house the buddy actually uses.
- [ ] **Visit friends' houses:** see their buddy and leave a sticker or a wave. No chat.

### Feeling good, not guilty

- [ ] **No punishment for gaps:** after a missed day, "You're back! Bubbles missed you", never a broken streak or a sad pet.
- [ ] **Tiny visits count:** 30 seconds of seeing the buddy, getting a surprise and ticking one thing is a good visit.
- [ ] **Short lists on show:** a few tasks at a time, so the list looks doable.

### A grown-up buddy

- [ ] **A buddy and task list for grown-ups,** in the grown-up account, reusing the children's game with a slightly more grown-up look. Optional for other parents. Kay plays alongside the boys ("My buddy found a crab today, what did yours find?").
- [ ] **Grown-ups choose their pet's look:** the pixel buddies, or one smooth, illustrated pet. The pixel style can feel too childlike for adults.
  - **The smooth pet is a single kind of creature** (the Finch approach). Every outfit and animation is drawn once for one body, which keeps the art affordable. It needs an artist or a bought art pack, animated with a tool like Rive.
  - **A calmer grown-up skin to go with it:** a clean font instead of the pixel one, softer colours, rounded cards, fewer bold borders.
  - Children keep the pixel buddies; everything underneath (tasks, XP, notifications) is shared.
