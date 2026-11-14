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
