# Phase 3 build decisions

Judgement calls made while building Phase 3 (Ratings), with what each costs if wrong. The plan's own rulings (P1–P15) are in `docs/plans/2026-11-13-phase3-ratings.md`; this file records the values and calls made while building.

## Theme colours (Task 9)

Method for every value below (Rulings P10 and P15): convert the script's hex to HLS, lower only the lightness in steps of 0.001 until the colour reaches 4.5:1 against both the theme's Background and its Cards, and round each channel to the nearest 0–255 value. A step of 0.0005 gives the same hex values, so they are the smallest such darkening. Hue and saturation are unchanged.

| Theme | Role | Script value | New value | On Background | On Cards |
|---|---|---|---|---|---|
| Sakura | Muted text (P10, supersedes R1's `#8b6a77`) | `#8d6b78` | `#876773` | 4.72:1 | 4.51:1 |
| Light | Highlight (P15) | `#b7791f` | `#9b671a` | 4.83:1 | 4.52:1 |
| Sakura | Highlight (P15) | `#d6457a` | `#ce2d68` | 4.74:1 | 4.53:1 |

- Every other theme's Highlight already reached 4.5:1 on Background and Cards, so none changed. The lowest are Matcha (4.84 / 4.66), Arctic (5.37 / 5.27) and Sand (5.50 / 5.27). The shared theme test checks all 12.
- After P15, the primary-button label (`--on-highlight`: whichever of Header row, Background or Bright text reads best on Highlight) reaches 4.5:1 on Highlight in all 12 themes. Before the change Sakura was 3.99:1. The lowest are now Sakura at 4.74:1 (Background `#fff7f9`) and Light at 4.83:1. Light's label changes from Bright text `#111216` to Background `#ffffff`, because white reads better on the darker gold. The web theme test checks all 12.
- `--on-highlight-small` now equals `--on-highlight` in all 12 built-in themes. It stays because a Custom Highlight can still need the black/white fallback, and a test covers that case. Cost if wrong: none.
- Ruling (Task 9): a contrast warning's ratio is rounded **down** to one decimal, so 4.47:1 reads "4.4:1; aim for 4.5:1" rather than "4.5:1; aim for 4.5:1". Cost if wrong: one function.
