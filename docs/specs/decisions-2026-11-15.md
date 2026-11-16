# Decisions — 2026-11-15 (Dan). These amend spec v1.2; they win on conflict.

## Phone navigation and profile
- Bottom bar, left to right: Add, Activity, Search (raised, centre), Compare, More.
- The round floating button (formerly Add) now opens Lists: a see-through menu that pops up just above it on the right side (thumb reach), scrollable, to pick the current list.
- Top right of every main screen: a round profile button showing the user's own profile image (initial when none). It opens the Profile: basic info, quick stats, My Top 5, the full Stats screen, Settings, and a Log out button at the bottom.
- Search moves out of the list header into the centre of the bottom bar. New setting: search all lists, or only the current list.
- Activity tab: shows the user's own recent activity until Phase 4 (friends) fills it in.
- Top 5 → Share: renders the Top 5 as a nicely formatted image the user can save to their phone.
- List title style: the list's icon plus an accent underline, same font (Inter). No new font.
- PC keeps the side nav; the same destinations (Profile, Lists, Activity, Search, Compare, Add) must be reachable there.
- Status wording per list (being fixed separately on phase3: Games "Plan to play/Playing/Replaying", Books "Plan to read/Reading/Rereading").

## Ratings
- Default tiers confirmed: Loved 9–10, Liked 7.5–9, Fine 6–7.5, Didn't like 0–6.
- Tiers are per list (each category can have its own names and ranges). Defaults as above for every list.
- Phase 3 shipped with the Sheet-style Compare hidden (COMPARE_ENABLED = false). The tier system replaces it and should reuse the existing Compare screens' question / review / Save UI where it fits.

## Process
- Dan wants low usage: cheap, simple mockups (wireframe level, calm style matching the approved v2 boards); no graphic-heavy work.

## Amendments (Dan, after wireframe review, 2026-11-15 evening)
- Bottom bar slot 4 is always **Compare** (the tier-rating Compare). Top 5 lives under Profile and More. Consequence: Phase 3b ships together with Phase 3c (Compare returns with the tier system); no interim Top 5 slot.
- List heading style changes to **option 1: themed bar** (solid band in the theme's Header colour with list icon + title; profile button on it).
- Top 5 share image styled like the approved Top5.v2 board: #1 large poster with blurred cover backdrop; ranks 1/2/3 gold, silver, bronze; 4–5 compact. "My #1s" image likewise with medal accents; small "Media Tracker · @username" footer.
- Activity is designed for **friends' activity** (Everyone / Friends / You filter). Friends are built in Phase 4; until then it shows your own activity.
- Profile is richer: cover-backdrop header band, big avatar, @username, member since, stat tiles incl. **Friends** count, **Add friend** button (shows "coming with friends" until Phase 4), My #1s strip, tier counts, rows My Top 5 / Stats / Settings, Log out.
