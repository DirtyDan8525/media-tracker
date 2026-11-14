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
