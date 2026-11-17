# Design notes

## Phase 1–2 mockups (Task 0)

- Canvas: https://claude.ai/artifact/DaP4U2kMthcpVQqXFQpE1n (8 artboards, Midnight theme)
  - Phone: Anime list (home), Add entry, "Which one did you mean?" picker, entry details, import preview, More/Settings, About
  - PC: Anime list as an inline-editable table
- **Approved by Dan on 2026-11-10 with no changes.**

### Decisions shown in the mockups
- Phone bottom bar: the first 4 enabled list tabs, plus **More**. The other lists, Import, Settings and About live under More.
- Add entry is a bottom sheet with Title, an optional creator, a Rating slider (can be left unrated) and Status chips. The entry saves instantly; the row shows "Looking it up…" and then fills in.
- A failed lookup row shows "Couldn't find it" with **Retry** and **Paste image link**.
- The picker is a 2-column cover grid with the closest match badged first, a search box, and "None of these — keep what I typed".
- Entry details: cover, meta line (year · length · origin label), synopsis with More, rating and status tiles, seasons with their average, notes, Re-fetch and Delete.
- Covers in the mockups are placeholders; the import counts are examples.

## Phase 3 mockups (Task 0) — approved 2026-11-14

- First Phase 3 set (`Compare`, `Top5`, `Stats`, … without `.v2`) was "okay but a bit bland".
- A livelier v2 (display font + accent glows/gradients) was rejected as "tacky".
- **Approved: the calm v2 boards (`*.v2.dc.html`, plus `Main.v2.sakura.dc.html`)** — v1's restraint and Inter font, plus: bigger covers; blurred cover backdrops under a scrim (entry detail = its own cover, Compare cards = each card's cover, Top 5 #1 = the #1 cover, list header = the list's highest-rated title); Stats charts in plain theme colours (rated ring, 1–10 distribution in rating colours, genre and per-list bars); calm motion inside `prefers-reduced-motion: no-preference` (Compare cards slide in, ratings count up, Save → "✓ Saved" with badges settling, list rows ease in); rating badges coloured red→green by the theme's rating scale.
- Applies to the whole app: Phase 1–2 screens get the same refresh (plan Task 14).
- Dan kept the list-header backdrop as the top-rated title (offered "most recently added"; declined).
- Assumptions in the orange "Phase 3" canvas note stand (PC Status/Genre buttons, 44 px chips, etc.).

## Navigation, profile and tier-rating wireframes — approved 2026-11-15
- Approved: docs/design/mockups/*.wf.dc.html (after one revision round). Decisions: docs/specs/decisions-2026-11-15.md incl. "Amendments".
- Wireframe level: build to the calm v2 visual language (approved *.v2 boards) with these layouts.
- Every main screen, Activity included, keeps the profile button and the Lists button (the Activity board omitted them only for room).
- Medal colours for Share images: gold #f2c14e, silver #c9cfd9, bronze #e0925a (checked ≥4.5:1 on the card surface).

## Phase 4 mockups (social) — approved 2026-11-16
- Approved with no changes: `FriendProfile`, `Friends`, `AddFriend`, `Feed`, `CompareFriend`, `EntryPrivacy`, `Admin` (`*.wf.dc.html`). Build to the calm v2 visual language with these layouts.
- Copy drafted on the boards and approved: "Wants to be friends", "Add a friend to see what they rate.", privacy notes "Friends can't see it, its posts or its notes." / "Friends see the title, not your notes.", remove-access confirm "They won't be able to sign in. Their data stays."
- Admin rows carry **Remove access** with a confirm (Dan's answer 1). Sub-screens use a back button instead of the profile button.

## Own sign-in wireframes (Phase 4b) — approved 2026-11-16
- Approved with no changes: `SignIn`, `Waiting`, `ResetPassword`, `AdminSignups` (`*.wf.dc.html`); `AdminSignups` replaces `Admin.wf` for the Admin screen.
- Copy as drawn: "Dan approves new accounts — you'll get in as soon as he does.", errors "That username or password isn't right." / "Too many tries. Wait 15 minutes and try again." / "That username is taken.", waiting "Dan needs to approve your account. This page updates by itself.", removed "Your access was removed. Ask Dan if this is a mistake.", expired reset "This link has expired. Ask Dan for a new one."

## Phase 5 wireframes — approved 2026-11-16
- Approved with no changes: `Home`, `AddPicker`, `Walkthrough`, `FeedV2`, `ProfilePC`, `EntryTiles` (`*.wf.dc.html`). Supersedes the 2026-11-15 bottom bar (Add tab → Home tab; Add is a floating bubble again) and S7's fixed reaction set (any single emoji via "+").
- Plus: a "What's new / Coming soon" list in More (no wireframe; simple list rows).

## Number-first rating wireframes — approved 2026-11-16
- `RateClose`, `AddRate`, `Sharpen` (`*.wf.dc.html`) approved with no changes (item 14 of docs/plans/phase5-requests.md).

## Header, Plan to watch, bio wireframes — approved 2026-11-16
- `ListHeader`, `PlanToWatch`, `ProfileBio` (`*.wf.dc.html`) approved with no changes (items 15–18 of docs/plans/phase5-requests.md).

## Messages wireframes — approved 2026-11-17
- `MessagesList`, `Chat`, `NewChat`, `ShareRec`, `Recommended` (`*.wf.dc.html`) approved, with one change: on phones Messages replaces Top 5 in the bottom bar (not a top-bar button); Top 5 returns to More.

## Admin powers wireframes — approved 2026-11-17
- `AdminHome`, `AdminSwitches`, `AdminLook`, `AdminContent`, `AdminTools` (`*.wf.dc.html`) approved with no changes (docs/plans/2026-11-17-phase6c-admin.md).
