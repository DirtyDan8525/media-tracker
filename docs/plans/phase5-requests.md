# Phase 5 requests (Dan, 2026-11-16) — to plan and wireframe

Changes the 2026-11-15 nav decision (docs/specs/decisions-2026-11-15.md) and S7 (fixed 6 reactions).

## Navigation and Home
1. Bottom-left tab becomes **Home** (house icon), replacing Add; Lists move here.
2. Home opens the **last list you had selected**.
3. The list title at the top (e.g. "Anime") becomes a **dropdown** to switch lists.
4. **Add** goes back to a floating bubble, bottom right; hidden on Profile, More, Compare, Settings.
5. Add asks **which list** (dropdown) so it can add to any list.

## New users
6. Short **walkthrough** after the first sign-in.
7. An **"Install as an app"** prompt with steps (for when the browser popup doesn't show).

## Feed (Activity)
8. Show **profile pictures** on posts.
9. Posts look bland: redesign them.
10. Replace the 6-emoji row with one **React** button that opens the emoji picker, plus a **+** for any emoji typed from the keyboard (custom reactions; validate one emoji, cap length).

## Friends
11. **Messages** from a friend's profile (later; bigger feature).

## More tab
13. **What's new / Coming soon** list in More, updated with every release (static list in the app; each future update adds its new features and moves items from Coming soon).

## PC
12. Pages like Profile are too small on a full-screen PC; they should **scale up** to use the space.

## Bugs / polish already logged
- Rating and Status tiles squished side by side on phone.
- Re-rating one title several times made 5–6 posts (should fold into one within 10 minutes).
