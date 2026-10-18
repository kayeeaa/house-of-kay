# Voxie to do

Bigger pieces of work, planned but not started. Smaller changes from playing and testing are in [FEEDBACK.md](FEEDBACK.md).

## Grown-ups can see friends, and block and report (parked 2026-10-18)

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
