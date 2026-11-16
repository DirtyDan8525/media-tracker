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
    - **Recommendations (built with Messages):** a small **Share** button on any title's page → pick one or more friends → sends a recommendation into your chat with them. In a chat, a **Recommend** button picks a title from your lists. The message shows as a card: cover, title, list, your rating and an optional note, with **Add to mine** (and "On your list" if they have it). Lists of what friends recommended you, for later.

## More tab
13. **What's new / Coming soon** list in More, updated with every release (static list in the app; each future update adds its new features and moves items from Coming soon).

## PC
12. Pages like Profile are too small on a full-screen PC; they should **scale up** to use the space.

## Bugs / polish already logged
- Rating and Status tiles squished side by side on phone.
- Re-rating one title several times made 5–6 posts (should fold into one within 10 minutes).

## Rating: "number first" (Dan chose option A, 2026-11-16)
14. You type or slide a number, as now; **your number is the truth**. Dan thinks in numbers, not Loved/Liked; the hard part is titles that are **close**.
    - After saving a rating, if other titles in that list sit **close** to it (within ±0.3 of the typed number), ask **1–2 "Which was better?"** taps right there (sheet over the entry; Skip always visible). Nothing to ask → nothing shown.
    - Picks only order close titles: a pick nudges scores by at most ±0.2 from the typed numbers, enough to separate near-ties (shown with two decimals when needed).
    - Tiers vanish from the UI (no Loved/Liked chips, no tier editor, no Re-tier review, no locks). They can stay inside the math.
    - The Compare tab goes; an optional **"Sharpen my ratings"** in More asks only about close pairs, one list at a time, with a simple "Done".
    - Settings: one switch "Ask me to compare close ratings" (on by default).
