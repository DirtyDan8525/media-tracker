import { buildWorkbook, type Cell, type SheetSpec } from './buildWorkbook';

// Headers are the REAL ones from docs/reference/sheet-template-headers.md.
const img = (url: string): Cell => ({ formula: `=IMAGE("${url}")` });
const avg = (): Cell => ({ formula: '=AVERAGE(A2:A3)' });

const ANIME = ['Cover', 'Rating', 'Title', 'Status', 'Genres', 'Studio', 'Season Avg', 'Notes', 'Cover URL'];
const MOVIES = ['Cover', 'Rating', 'Title', 'Genres', 'Director', 'Notes', 'Cover URL'];
const TV = ['Cover', 'Rating', 'Title', 'Status', 'Genres', 'Season Avg', 'Notes', 'Cover URL'];
const ALBUMS = ['Cover', 'Rating', 'Album', 'Genres', 'Artist', 'Notes', 'Cover URL'];
const SONGS = ['Cover', 'Rating', 'Song', 'Genres', 'Artist', 'Album', 'Notes', 'Cover URL'];
const GAMES = ['Cover', 'Rating', 'Title', 'Status', 'Genres', 'Developer', 'Notes', 'Cover URL'];
const BOOKS = ['Cover', 'Rating', 'Title', 'Status', 'Genres', 'Author', 'Notes', 'Cover URL'];

export const SAMPLE_SHEETS: SheetSpec[] = [
  {
    name: 'Start Here',
    rows: [['Welcome to the tracker'], ['Pick a tab and start rating']],
  },
  {
    // Renamed from "Anime": detection is by headers.
    name: 'My Anime',
    rows: [
      ANIME,
      [img('https://wrong.test/frieren.jpg'), 10, 'Frieren', 'Completed', 'Fantasy, Adventure', 'Madhouse', avg(), 'Loved it', 'https://img.test/frieren.jpg'],
      [null], // blank row
      ['https://wrong.test/mushishi.jpg', '8,5', 'Mushishi', 'completed', 'Slice of Life', 'Artland', null, '', ''],
      [null, 11, 'Overrated', 'Dropped', '', '', null, '', ''],
      [null, 'eight', 'Eight', 'Watching', '', '', null, '', ''],
      [null, 7, 'Odd Status', 'Finished', '', '', null, '', ''],
      [null, 6, 'Bad Cover', '', '', '', null, '', 'javascript:alert(1)'],
    ],
  },
  {
    name: 'Movies',
    rows: [
      MOVIES,
      [img('https://wrong.test/a.jpg'), 9.5, 'Spirited Away', 'Fantasy', 'Hayao Miyazaki', '', 'https://img.test/spirited.jpg'],
      [null, 8, 'Heat', 'Crime', 'Michael Mann', '', ''],
    ],
  },
  {
    name: 'TV Shows',
    rows: [
      TV,
      [null, 9, 'Severance', 'Completed', 'Thriller', avg(), '', 'https://img.test/severance.jpg'],
      [null, 8.75, 'Dark', 'In Progress', 'Sci-Fi', avg(), '', ''],
    ],
  },
  { name: 'Albums', rows: [ALBUMS, [null, 9, 'In Rainbows', 'Rock', 'Radiohead', '', '']] },
  {
    name: 'Songs',
    hidden: true,
    rows: [
      SONGS,
      [null, 9, 'Karma Police', 'Rock', 'Radiohead', 'OK Computer', '', ''],
      [null, 7, 'Creep', 'Rock', 'Radiohead', 'Pablo Honey', '', ''],
    ],
  },
  {
    name: 'Games',
    rows: [
      GAMES,
      [null, 9.5, 'Hades', 'Completed', 'Roguelike', 'Supergiant Games', '', ''],
      [null, 9, 'Celeste', 'Planned', 'Platformer', 'Maddy Makes Games', '', ''],
    ],
  },
  { name: 'Books', rows: [BOOKS, [null, 9, 'Dune', 'Plan to Watch', 'Sci-Fi', 'Frank Herbert', '', '']] },
  {
    name: 'Anime Seasons',
    hidden: true,
    rows: [
      ['Anime', 'Season / Part', 'Rating', 'Notes'],
      ['Frieren', 'Season 1', 9.5, 'Strong start'],
      ['Frieren', 2, 10, ''],
      ['Ghost Show', 'Season 1', 8, ''], // no such anime
      ['FRIEREN', 'OVA', null, ''],
    ],
  },
  {
    name: 'TV Seasons',
    hidden: true,
    rows: [
      ['Show', 'Season', 'Rating', 'Notes'],
      ['Severance', 1, 9, ''],
      ['Severance', 2, 9.5, ''],
      ['Nobody', 1, 5, ''], // no such show
    ],
  },
  {
    name: 'Settings',
    rows: [
      [null, '① TABS'],
      [null, 'TAB', 'SHOW', 'WHAT IT IS'],
      [null, 'Movies', true, 'Movies tab'],
      [null, 'TV Shows', true, 'TV tab'],
      [null, 'TV Seasons', true, ''],
      [null, 'Anime Seasons', true, ''],
      [null, 'Albums', true, ''],
      [null, 'Songs', false, ''],
      [null, 'Games', true, ''],
      [null, 'Books', true, ''],
      [null, '② COLORS'],
      [null, 'SETTING', 'VALUE', 'WHERE IT SHOWS'],
      [null, 'Theme', 'Ocean', ''],
      [null, 'Background', '#0F1C2B', ''],
      [null, 'Highlight', 'red', ''],
      [null, '③ COMPARING'],
      [null, 'SETTING', 'VALUE', 'WHAT IT DOES'],
      [null, 'Ask to compare', 'Only when I start it', ''],
      [null, 'Re-rating style', 'Swap the numbers', ''],
      [null, "When there's no room", 'Give the same score', ''],
      [null, 'Compare within', '1.5', ''],
    ],
  },
  { name: 'Stats', rows: [['Total', 'Average'], [16, 8.6]] },
];

export const buildSampleTracker = () => buildWorkbook(SAMPLE_SHEETS);
