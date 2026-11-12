# Media Tracker Sheet template — real headers and Settings layout

Read from Dan's "Template Media Tracker" Google Sheet on 2026-11-12 (row 1 of each tab; Settings column B labels / column C values). Use these exact strings for import detection and for building the sample workbook in tests.

## List tabs (row 1)

| Tab (default name) | Headers, in order |
|---|---|
| Anime | Cover, Rating, Title, Status, Genres, Studio, Season Avg, Notes, Cover URL |
| Movies | Cover, Rating, Title, Genres, Director, Notes, Cover URL |
| TV Shows | Cover, Rating, Title, Status, Genres, Season Avg, Notes, Cover URL |
| Albums | Cover, Rating, Album, Genres, Artist, Notes, Cover URL |
| Songs | Cover, Rating, Song, Genres, Artist, Album, Notes, Cover URL |
| Games | Cover, Rating, Title, Status, Genres, Developer, Notes, Cover URL |
| Books | Cover, Rating, Title, Status, Genres, Author, Notes, Cover URL |
| Anime Seasons | Anime, Season / Part, Rating, Notes |
| TV Seasons | Show, Season, Rating, Notes |

Notes:
- The **Cover** column holds an `=IMAGE(...)` formula; the URL to import is in **Cover URL**.
- Anime's ratings look like "10.0" / "9.9" (one decimal shown).
- In Dan's own Sheet, Anime Seasons, TV Seasons and Songs are **hidden** tabs.
- The Anime Seasons season column is **"Season / Part"** (not "Season").

## Settings tab (column B label → column C value)

Section ① TABS (header row: TAB | SHOW | WHAT IT IS) — value is TRUE/FALSE:
Movies, TV Shows, TV Seasons, Anime Seasons, Albums, Songs, Games, Books

Section ② COLORS (header row: SETTING | VALUE | WHERE IT SHOWS):
Theme (e.g. "Midnight"), Background, Alternate rows, Header row, Cards, Panels, Text, Bright text, Muted text, Grid lines, Highlight (hex values)

Section ③ COMPARING (header row: SETTING | VALUE | WHAT IT DOES):
Ask to compare ("Both"), Re-rating style ("Meet in the middle"), When there's no room ("Use in-between scores"), Compare within ("1")

There is no "Anime" switch: the Anime tab is always on in the Sheet.
