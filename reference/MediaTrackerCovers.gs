/**
 * Media Tracker: auto-fill for your media lists.
 * Setup and how-to are on the "Start Here" tab of the sheet; this file is the engine behind it.
 *
 * Type a title, and this fills in the rest of the row for you:
 *   Anime          cover, genres, studio       AniList
 *   Movies         cover, genres, director     TMDB (free key) or Wikipedia
 *   TV Shows       cover, genres               TVmaze, then Wikipedia
 *   Albums         cover, genres, artist       Deezer, then Apple; a pasted Spotify link also works
 *   Books & Manga  cover, genres, author       Open Library, then Apple
 *   Games          cover, genres, developer    IGDB (free Twitch keys), then Steam, then Wikipedia
 *
 * It only fills empty cells, so anything you typed yourself is never overwritten
 * (except by "Re-fetch selected row", which replaces the looked-up fields on that row).
 * Movie data and posters from TMDB: "This product uses the TMDB API but is not endorsed or certified by TMDB."
 * Game data from IGDB.com.
 */

// Tabs are found by their internal sheet ID (kept when the file is copied), so renaming a tab is safe.
const TABS = {
  anime:  { id: 0,  source: 'anilist',                     creator: 'Studio',    seasonsId: 9 },
  movies: { id: 1,  source: 'movie', kind: 'film',         creator: 'Director' },
  tv:     { id: 2,  source: 'tvmaze',                      creator: null,        wikiFallback: 'tv', seasonsId: 12 },
  albums: { id: 3,  source: 'deezer', media: 'music', entity: 'album', creator: 'Artist', creatorIsSearchHint: true, square: true },
  songs:  { id: 13, source: 'songs',                       creator: 'Artist',    creatorIsSearchHint: true, square: true, albumCol: true },
  games:  { id: 4,  source: 'game', kind: 'game',          creator: 'Developer' },
  books:  { id: 5,  source: 'books', media: 'ebook', entity: 'ebook', creator: 'Author', creatorIsSearchHint: true },
};
const TOP5_ID = 8, START_ID = 10, SETTINGS_ID = 11;
const VERSION = '2026-11-06i';

function cfgOf_(sheet) {
  const id = sheet.getSheetId();
  for (const [key, c] of Object.entries(TABS)) if (c.id === id) return Object.assign({ key }, c);
  return null;
}
function cfgFor_(key) { return TABS[key] ? Object.assign({ key }, TABS[key]) : null; }
function sheetById_(id) { return SpreadsheetApp.getActive().getSheets().find(s => s.getSheetId() === id) || null; }
function sheetFor_(key) { return TABS[key] ? sheetById_(TABS[key].id) : null; }

const DELAY_MS = { anilist: 2500, itunes: 3000, wiki: 1000, deezer: 1000, songs: 1000, movie: 1000, tvmaze: 800, books: 1200, game: 1000 }; // stay under each API's rate limit
const TIME_BUDGET_MS = 5 * 60 * 1000;            // Apps Script stops runs at 6 minutes

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Media Tracker')
    .addItem('Fill in missing info now', 'fillAllMissing')
    .addItem('Re-fetch selected row', 'refetchSelectedRow')
    .addItem('Open cover viewer', 'openCoverViewer')
    .addItem('Compare ratings…', 'openCompareDialog')
    .addItem('Sort this tab by rating', 'sortThisTabByRating')
    .addItem('Sort all tabs by rating', 'sortAllTabsByRating')
    .addSeparator()
    .addSubMenu(ui.createMenu('Setup')
      .addItem('Turn on auto-fill', 'turnOnAutoFill')
      .addItem('Apply settings (tabs and colors)', 'applySettings')
      .addItem('Go to Settings', 'showSettings')
      .addItem('Always open cover viewer', 'turnOnViewerAutoOpen')
      .addSeparator()
      .addItem('Movies key (TMDB)…', 'setTmdbKey')
      .addItem('Games keys (IGDB)…', 'setIgdbKeys')
      .addSeparator()
      .addItem('Turn off auto-fill', 'turnOffAutoFill')
      .addItem("Don't auto-open cover viewer", 'turnOffViewerAutoOpen'))
    .addSubMenu(ui.createMenu('Help')
      .addItem('Go to Start Here', 'showStartHere')
      .addItem('Test connection', 'testConnection')
      .addItem('Diagnose selected row', 'diagnoseSelectedRow'))
    .addToUi();
  refreshSetupStatus_(); // fills in the Setup Status box (script version, keys, auto-fill) every time the sheet opens
  // First visit (or a fresh copy): point to the setup steps.
  try {
    if (PropertiesService.getDocumentProperties().getProperty('AUTOFILL_ON') !== 'yes')
      SpreadsheetApp.getActive().toast('New here? Open the Start Here tab, then Media Tracker → Setup → Turn on auto-fill.', 'Media Tracker', 12);
  } catch (err) { /* not authorized yet: the Start Here tab explains it */ }
}

function showStartHere() {
  const sh = sheetById_(START_ID);
  if (sh) sh.activate();
  refreshSetupStatus_();
}

// ---------- menu actions ----------

function turnOnAutoFill() {
  turnOffAutoFill_(true);
  ScriptApp.newTrigger('autoFillOnEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  PropertiesService.getDocumentProperties().setProperty('AUTOFILL_ON', 'yes');
  refreshSetupStatus_();
  SpreadsheetApp.getUi().alert('Auto-fill is on. Type a title and the rest of the row fills in a few seconds later.');
}

function turnOffAutoFill() { turnOffAutoFill_(false); }

function turnOffAutoFill_(silent) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoFillOnEdit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (!silent) {
    PropertiesService.getDocumentProperties().deleteProperty('AUTOFILL_ON');
    refreshSetupStatus_();
    SpreadsheetApp.getUi().alert('Auto-fill is off.');
  }
}

function autoFillOnEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getSheetId() === SETTINGS_ID) { onSettingsEdit_(e); return; }
  const cfg = cfgOf_(sheet);
  if (!cfg) return;
  const cols = findColumns_(sheet, cfg);
  if (!cols) return;
  if (queueNewRating_(e, sheet, cfg, cols)) return;
  // Only react when a title cell was edited (also handles pasting several titles at once).
  if (e.range.getColumn() > cols.title || e.range.getLastColumn() < cols.title) return;
  const first = Math.max(2, e.range.getRow());
  const last = Math.min(e.range.getLastRow(), first + 19); // cap a big paste; use the menu for the rest
  const ss = SpreadsheetApp.getActive();
  for (let row = first; row <= last; row++) {
    if (handlePendingPick_(sheet, row, cols)) continue;
    const title = String(sheet.getRange(row, cols.title).getValue() || '').trim();
    if (!title) continue;
    const dup = duplicateRow_(sheet, cols, row, title);
    if (dup) { warnDuplicate_(sheet, title, dup); continue; } // already on the list: don't look it up again
    ss.toast(`Looking up "${title}"…`, 'Media Tracker', 5);
    // Replacing an existing title: the old cover/genres/artist belonged to the old title, so redo them.
    const retitled = first === last && e.oldValue !== undefined && String(e.oldValue).trim() !== '';
    if (retitled) [cols.cover, cols.genres, cols.creator].forEach(c => { if (c) sheet.getRange(row, c).setValue(''); });
    const ok = fillRow_(sheet, row, cfg, cols, retitled, null, 'dropdown', retitled);
    if (ok === 'asked') continue;
    ss.toast(ok ? `Filled in "${title}".`
      : `Couldn't find "${title}". Try the full title, or use Media Tracker > Re-fetch selected row.`,
      'Media Tracker', 8);
    if (row < last) Utilities.sleep(DELAY_MS[cfg.source]);
  }
}

function fillAllMissing() {
  const ss = SpreadsheetApp.getActive();
  const start = Date.now();
  let filled = 0, asked = 0, missed = [], stoppedEarly = false;

  for (const key of Object.keys(TABS)) {
    const cfg = cfgFor_(key);
    const sheet = sheetFor_(key);
    if (!sheet || sheet.isSheetHidden()) continue;
    const tabName = sheet.getName();
    const cols = findColumns_(sheet, cfg);
    if (!cols || sheet.getLastRow() < 2) continue;

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    for (let i = 0; i < data.length; i++) {
      if (Date.now() - start > TIME_BUDGET_MS) { stoppedEarly = true; break; }
      const title = String(data[i][cols.title - 1] || '').trim();
      if (!title || String(data[i][cols.cover - 1] || '').trim()) continue;
      // Rows with several versions get a dropdown in the title cell instead of a guess.
      const result = fillRow_(sheet, i + 2, cfg, cols, false, null, 'dropdown');
      if (result === 'asked') asked++; else if (result) filled++; else missed.push(`${tabName}: ${title}`);
      Utilities.sleep(DELAY_MS[cfg.source]);
    }
    if (stoppedEarly) break;
  }

  let msg = `Filled in ${filled} row(s).`;
  if (missed.length) msg += `\nNo match for ${missed.length}: ${missed.slice(0, 10).join('; ')}${missed.length > 10 ? '…' : ''}`;
  if (stoppedEarly) msg += '\nStopped before the time limit. Run it again to continue.';
  if (asked) msg += `\n${asked} title(s) have several versions. Their title cells are highlighted: pick one from each dropdown.`;
  SpreadsheetApp.getUi().alert(msg);
}

function refetchSelectedRow() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const cfg = cfgOf_(sheet);
  if (!cfg) { ui.alert('Select a row on one of the media tabs first (Anime, Movies, TV Shows, Albums, Songs, Games or Books).'); return; }
  const row = sheet.getActiveRange().getRow();
  if (row < 2) { ui.alert('Select a data row, not the header.'); return; }
  const cols = findColumns_(sheet, cfg);
  const title = String(sheet.getRange(row, cols.title).getValue() || '').trim();
  if (!title) { ui.alert('That row has no title.'); return; }

  const resp = ui.prompt('Re-fetch', `Search term (leave blank to search for "${title}"):`, ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const term = resp.getResponseText().trim();

  PropertiesService.getDocumentProperties().deleteProperty(pendingKey_(sheet, row));
  sheet.getRange(row, cols.title).setDataValidation(null).setBackground(null);
  const ok = fillRow_(sheet, row, cfg, cols, true, term || null, 'popup', true);
  if (ok === 'asked') return; // the picker pop-up takes it from here
  ui.alert(ok ? 'Row updated.' : `No match for "${term || title}". You can paste an image URL into the Cover URL column instead.`);
}

// Checks each lookup service and shows exactly what it answered.
function testConnection() {
  const checks = [
    ['AniList', () => UrlFetchApp.fetch('https://graphql.anilist.co', {
      method: 'post', contentType: 'application/json', headers: { Accept: 'application/json' },
      payload: JSON.stringify({ query: '{ Media(search: "JoJo", type: ANIME) { title { romaji } } }' }),
      muteHttpExceptions: true })],
    ['Kitsu', () => UrlFetchApp.fetch('https://kitsu.io/api/edge/anime?page[limit]=1&filter[text]=jojo',
      { headers: { Accept: 'application/vnd.api+json' }, muteHttpExceptions: true })],
    ['Wikipedia', () => UrlFetchApp.fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=1&srsearch=speed+racer+film',
      { muteHttpExceptions: true })],
    ['Open Library', () => UrlFetchApp.fetch('https://openlibrary.org/search.json?limit=1&fields=title&q=we%20are%20legion', { headers: OL_HEADERS, muteHttpExceptions: true })],
    ['IGDB', () => igdbKeys_() ? igdbFetch_('fields name; limit 1; search "portal";')
      : { getResponseCode: () => 0, getContentText: () => 'no keys set. Menu: Set IGDB keys (Games)' }],
    ['Steam', () => UrlFetchApp.fetch('https://store.steampowered.com/api/storesearch/?cc=us&l=en&term=portal', { muteHttpExceptions: true })],
    ['TVmaze', () => UrlFetchApp.fetch('https://api.tvmaze.com/search/shows?q=chuck', { muteHttpExceptions: true })],
    ['TMDB', () => tmdbKey_() ? tmdbFetch_('/search/movie?query=speed%20racer')
      : { getResponseCode: () => 0, getContentText: () => 'no key set (Movies use Wikipedia). Menu: Set TMDB key' }],
    ['Deezer', () => UrlFetchApp.fetch('https://api.deezer.com/search/album?limit=1&q=dark%20side%20of%20the%20moon', { muteHttpExceptions: true })],
    ['iTunes', () => UrlFetchApp.fetch('https://itunes.apple.com/search?limit=1&media=music&entity=album&term=abbey+road',
      { muteHttpExceptions: true })],
  ];
  const lines = checks.map(([name, call]) => {
    try {
      const res = call();
      const body = res.getContentText().replace(/\s+/g, ' ').slice(0, 120);
      return `${name}: ${res.getResponseCode() === 200 ? 'OK' : 'FAILED'} (${res.getResponseCode()}) ${body}`;
    } catch (err) {
      return `${name}: ERROR ${String(err.message || err).slice(0, 200)}`;
    }
  });
  SpreadsheetApp.getUi().alert('Connection test', lines.join('\n\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

// ---------- "which one?" picker ----------

function showPicker_(sheet, row, typed, choices) {
  choices = choices.map(plainChoice_);
  const token = Utilities.getUuid();
  CacheService.getUserCache().put(token, JSON.stringify({ tab: cfgOf_(sheet).key, row, typed, choices }), 1800);
  const html = PICKER_HTML
    .replace('__DATA__', JSON.stringify({ token, typed, choices, square: !!cfgOf_(sheet).square }).replace(/</g, '\\u003c'));
  try {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(html).setWidth(760).setHeight(580), 'Which one did you mean?');
    return true;
  } catch (err) {
    console.warn(`Could not show picker: ${err}`);
    return false; // caller falls back to the dropdown
  }
}

// ---------- dropdown picker (works while auto-filling in the background) ----------

const PENDING_PREFIX = 'pick|';

function pendingKey_(sheet, row) { return `${PENDING_PREFIX}${sheet.getSheetId()}|${row}`; }

function offerDropdown_(sheet, row, cols, typed, choices) {
  choices = choices.map(plainChoice_);
  const used = new Set();
  const labeled = choices.map(c => {
    let label = c.sub ? `${c.title} (${c.sub})` : c.title;
    while (used.has(label)) label += ' ';
    used.add(label);
    return Object.assign({}, c, { label });
  });
  PropertiesService.getDocumentProperties().setProperty(pendingKey_(sheet, row), JSON.stringify({ typed, choices: labeled }));
  const cell = sheet.getRange(row, cols.title);
  cell.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(labeled.map(c => c.label), true)
    .setAllowInvalid(true)
    .setHelpText('Several versions found. Pick the one you mean from this dropdown.')
    .build());
  cell.setBackground('#5C4A12');
  SpreadsheetApp.getActive().toast(`Several versions of "${typed}" found. Click the highlighted title cell, then pick one in the cover viewer panel or from the cell's dropdown.`, 'Media Tracker', 10);
}

// Returns true if this edit was you picking from a pending dropdown (and handles it).
function handlePendingPick_(sheet, row, cols) {
  const props = PropertiesService.getDocumentProperties();
  const key = pendingKey_(sheet, row);
  const raw = props.getProperty(key);
  if (!raw) return false;
  const pending = JSON.parse(raw);
  const cell = sheet.getRange(row, cols.title);
  const value = String(cell.getValue() || '');
  props.deleteProperty(key);
  cell.setDataValidation(null);
  cell.setBackground(null);
  const choice = pending.choices.find(c => c.label === value);
  if (!choice) return false; // you typed something new instead, so look that up normally
  applyInfo_(sheet, row, cols, pending.typed, Object.assign(choice, { trusted: true }), true);
  SpreadsheetApp.getActive().toast(`Filled in "${choice.title}".`, 'Media Tracker', 5);
  return true;
}

// Called by the picker's search box: runs a new lookup and replaces the choices shown.
function searchAgain(token, query) {
  const cache = CacheService.getUserCache();
  const saved = JSON.parse(cache.get(token) || 'null');
  if (!saved) throw new Error('This pop-up expired. Use Media Tracker > Re-fetch selected row.');
  const info = lookup_(cfgFor_(saved.tab), query, query, '');
  saved.choices = info ? (info.choices || [info]).map(plainChoice_) : [];
  cache.put(token, JSON.stringify(saved), 1800);
  return saved.choices;
}

// Called by the picker when you click a choice.
function applyChoice(token, index) {
  const saved = JSON.parse(CacheService.getUserCache().get(token) || 'null');
  if (!saved) throw new Error('This choice expired. Use Media Tracker > Re-fetch selected row.');
  const sheet = sheetFor_(saved.tab);
  const cols = findColumns_(sheet, cfgFor_(saved.tab));
  // If rows were sorted while the pop-up was open, find the row again by its title.
  let row = saved.row;
  if (String(sheet.getRange(row, cols.title).getValue()).trim() !== saved.typed) {
    row = findRowByTitle_(sheet, saved.typed);
    if (!row) throw new Error(`Couldn't find "${saved.typed}" anymore.`);
  }
  PropertiesService.getDocumentProperties().deleteProperty(pendingKey_(sheet, row));
  sheet.getRange(row, cols.title).setDataValidation(null).setBackground(null);
  applyInfo_(sheet, row, cols, saved.typed, Object.assign(saved.choices[index], { trusted: true }), true);
  SpreadsheetApp.getActive().toast(`Filled in "${saved.choices[index].title}".`, 'Media Tracker', 5);
}

const PICKER_HTML = `<!DOCTYPE html><html><head><base target="_top"><style>
  body{margin:0;font-family:Inter,Arial,sans-serif;background:#1B1B26;color:#fff}
  .top{padding:12px 16px;color:#9A9AB0;font-size:13px}
  .search{display:flex;gap:8px;padding:0 16px 12px}
  .search input{flex:1;background:#24243A;border:1px solid #3A3A52;border-radius:6px;color:#fff;padding:8px 10px;font-size:13px}
  .search button,.none{background:none;border:1px solid #444460;color:#C8C8D8;padding:8px 14px;border-radius:6px;cursor:pointer}
  .search button:hover,.none:hover{border-color:#FFD166;color:#fff}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;padding:4px 16px 16px}
  .card{background:#24243A;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color .1s}
  .card:hover{border-color:#FFD166}
  .card img{width:100%;aspect-ratio:2/3;object-fit:cover;display:block;background:#2A2A3C}
  .t{font-size:13px;font-weight:bold;padding:8px 8px 2px;line-height:1.3}
  .s{font-size:11px;color:#9A9AB0;padding:0 8px 10px}
  .best{font-size:10px;color:#1B1B26;background:#FFD166;display:inline-block;padding:1px 6px;border-radius:3px;margin:8px 8px 0}
  .none{margin:0 16px 16px}
  .msg{padding:30px;text-align:center;color:#9A9AB0}
</style></head><body><div id="app"></div><script>
  const D = __DATA__;
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const app = document.getElementById('app');
  function render(note) {
    app.innerHTML = '<div class="top">' + (note || ('You typed <b>' + esc(D.typed) + '</b>. Click the one you mean, or search again (try adding the artist or year):')) + '</div>'
      + '<form class="search" onsubmit="again(event)"><input id="q" placeholder="e.g. pink floyd dark side of the moon" value="' + esc(D.query || '') + '"><button>Search</button></form>'
      + (D.choices.length ? '<div class="grid">' + D.choices.map((c, i) => '<div class="card" onclick="choose(' + i + ')"><img src="' + esc(c.cover) + '"'
          + (D.square ? ' style="aspect-ratio:1/1"' : '') + '>'
          + (i === 0 ? '<span class="best">Closest match</span>' : '')
          + '<div class="t">' + esc(c.title) + '</div><div class="s">' + esc(c.sub) + '</div></div>').join('') + '</div>'
        : '<div class="msg">No matches. Try different words.</div>')
      + '<button class="none" onclick="google.script.host.close()">None of these</button>';
  }
  function again(ev) {
    ev.preventDefault();
    const q = document.getElementById('q').value.trim();
    if (!q) return;
    D.query = q;
    app.innerHTML = '<div class="msg">Searching for ' + esc(q) + '…</div>';
    google.script.run.withSuccessHandler(list => { D.choices = list; render('Results for <b>' + esc(q) + '</b>. Click the one you mean:'); })
      .withFailureHandler(e => { app.innerHTML = '<div class="msg">' + esc(e.message) + '</div>'; })
      .searchAgain(D.token, q);
  }
  function choose(i) {
    app.innerHTML = '<div class="msg">Filling in ' + esc(D.choices[i].title) + '…</div>';
    google.script.run.withSuccessHandler(() => google.script.host.close())
      .withFailureHandler(e => { app.innerHTML = '<div class="msg">' + esc(e.message) + '</div>'; })
      .applyChoice(D.token, i);
  }
  render();
</script></body></html>`;

// ---------- cover viewer ----------
// A panel on the right that shows a large cover and details for whatever row you click.
// Works on every media tab and on the Top 5 page.

const TOP5_BLOCKS = [
  { rows: [7, 11],  cols: [2, 6],   tab: 'anime' },
  { rows: [7, 11],  cols: [8, 12],  tab: 'albums' },
  { rows: [7, 11],  cols: [14, 18], tab: 'movies' },
  { rows: [15, 19], cols: [2, 6],   tab: 'tv' },
  { rows: [15, 19], cols: [8, 12],  tab: 'games' },
  { rows: [15, 19], cols: [14, 18], tab: 'books' },
  { rows: [23, 27], cols: [2, 6],   tab: 'songs' },
];
const CREATOR_HEADERS = ['Studio', 'Director', 'Artist', 'Author', 'Developer'];

function openCoverViewer() {
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutput(VIEWER_HTML).setTitle('Cover viewer'));
}

// Called by the panel when you click one of the version cards.
function applyPendingChoice(tab, row, index) {
  const sheet = sheetFor_(tab);
  const cols = findColumns_(sheet, cfgFor_(tab));
  const props = PropertiesService.getDocumentProperties();
  const key = pendingKey_(sheet, row);
  const pending = JSON.parse(props.getProperty(key) || 'null');
  if (!pending || !pending.choices[index]) throw new Error('That choice is no longer waiting. Use Re-fetch selected row.');
  props.deleteProperty(key);
  sheet.getRange(row, cols.title).setDataValidation(null).setBackground(null);
  const choice = plainChoice_(pending.choices[index]);
  delete choice.label;
  applyInfo_(sheet, row, cols, pending.typed, Object.assign(choice, { trusted: true }), true);
  return choice.title;
}

// Called by the panel about once a second.
function getSelectedItem() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getActiveSheet();
  let row = ss.getActiveRange().getRow();

  if (sheet.getSheetId() === TOP5_ID) {
    const col = ss.getActiveRange().getColumn();
    const b = TOP5_BLOCKS.find(x => row >= x.rows[0] && row <= x.rows[1] && col >= x.cols[0] && col <= x.cols[1]);
    if (!b) return null;
    const title = String(sheet.getRange(row, b.cols[0] + 2).getValue() || '').trim();
    if (!title) return null;
    sheet = sheetFor_(b.tab);
    if (!sheet) return null;
    const found = findRowByTitle_(sheet, title);
    if (!found) return null;
    row = found;
  }

  const media = cfgOf_(sheet);
  if (!media || row < 2) return null;
  // A row waiting for you to pick a version: show the choices as cover cards in the panel.
  const pendingRaw = media ? PropertiesService.getDocumentProperties().getProperty(pendingKey_(sheet, row)) : null;
  if (pendingRaw) {
    const pending = JSON.parse(pendingRaw);
    return {
      key: `pick|${sheet.getName()}|${row}|${pending.choices.length}`, pick: true,
      tab: sheet.getName(), tabKey: media.key, row, typed: pending.typed, square: !!media.square,
      choices: pending.choices.map(c => ({ title: c.title, sub: c.sub || '', cover: c.cover || '' })),
    };
  }
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const vals = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];
  const field = h => { const i = headers.indexOf(h); return i >= 0 ? vals[i] : ''; };
  const title = field('Title') || field('Song') || field('Album');
  if (!title) return null;
  const creatorHeader = CREATOR_HEADERS.find(h => headers.includes(h)) || '';
  return {
    key: `${sheet.getName()}|${row}|${vals.join('|')}`,
    tab: sheet.getName(), title, cover: biggerCover_(field('Cover URL')),
    rating: field('Rating'), status: field('Status'), genres: field('Genres'),
    creatorLabel: creatorHeader, creator: creatorHeader ? field(creatorHeader) : '',
    seasonAvg: field('Season Avg'), notes: field('Notes'),
  };
}

function findRowByTitle_(sheet, title) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const c = (headers.indexOf('Title') + 1) || (headers.indexOf('Song') + 1) || (headers.indexOf('Album') + 1);
  if (!c || sheet.getLastRow() < 2) return 0;
  const vals = sheet.getRange(2, c, sheet.getLastRow() - 1, 1).getDisplayValues();
  const i = vals.findIndex(r => r[0].trim() === title);
  return i >= 0 ? i + 2 : 0;
}

// Asks the image servers for a larger version where they offer one.
function biggerCover_(url) {
  if (!url) return '';
  return url.replace(/\/\d+x\d+bb\./, '/600x600bb.')        // Apple: 600px instead of 300px
            .replace('/cover/medium/', '/cover/large/');     // AniList: largest size
}

const VIEWER_HTML = `<!DOCTYPE html><html><head><base target="_top"><style>
  body{margin:0;font-family:Arial,sans-serif;background:#1B1B26;color:#fff}
  .wrap{padding:16px}
  .empty{color:#9A9AB0;font-size:13px;line-height:1.5;padding:24px 4px;text-align:center}
  img{width:100%;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.5);display:block}
  .noimg{width:100%;aspect-ratio:2/3;border-radius:8px;background:#24243A;display:flex;align-items:center;justify-content:center;color:#6c6c88;font-size:12px}
  .tab{color:#9A9AB0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:14px}
  h1{font-size:18px;margin:4px 0 10px;line-height:1.3}
  .rating{font-size:30px;font-weight:bold;color:#FFD166}
  .rating small{font-size:13px;color:#9A9AB0;font-weight:normal}
  .row{font-size:13px;margin:6px 0;color:#d8d8e6}
  .row b{color:#9A9AB0;font-weight:normal;display:inline-block;min-width:70px}
  .notes{margin-top:12px;padding:10px;background:#24243A;border-radius:6px;font-size:13px;line-height:1.45;white-space:pre-wrap}
  .ask{color:#C8C8D8;font-size:13px;line-height:1.45;margin:0 0 12px}
  .opt{display:flex;gap:10px;align-items:center;background:#24243A;border:2px solid transparent;border-radius:8px;padding:6px;margin-bottom:8px;cursor:pointer}
  .opt:hover{border-color:#FFD166}
  .opt img{width:56px;height:80px;object-fit:cover;border-radius:4px;box-shadow:none;flex:none;background:#2A2A3C}
  .opt img.sq{height:56px}
  .opt .t{font-size:13px;font-weight:bold;line-height:1.3}
  .opt .s{font-size:11px;color:#9A9AB0;margin-top:2px}
  .opt .best{font-size:10px;color:#1B1B26;background:#FFD166;display:inline-block;padding:0 5px;border-radius:3px;margin-top:4px}
  .cmp{display:none;margin:12px 16px 0;padding:10px 12px;background:#2A2A3B;border-left:3px solid #FFD166;border-radius:6px;font-size:13px;line-height:1.4;cursor:pointer}
  .cmp b{color:#FFD166}
</style></head><body><div class="cmp" id="cmp" onclick="google.script.run.openCompareDialog()"></div><div class="wrap" id="v"><div class="empty">Click any row (or anything on the Top 5 page) to see its cover here.</div></div>
<script>
  let last = null;
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function render(d) {
    const v = document.getElementById('v');
    if (!d) { v.innerHTML = '<div class="empty">Click any row (or anything on the Top 5 page) to see its cover here.</div>'; return; }
    if (d.pick) {
      window.P = d;
      v.innerHTML = '<div class="tab" style="margin-top:0">' + esc(d.tab) + '</div><h1>Which one did you mean?</h1>'
        + '<p class="ask">You typed <b>' + esc(d.typed) + '</b>. Click one:</p>'
        + d.choices.map((c, i) => '<div class="opt" onclick="pick(' + i + ')"><img class="' + (d.square ? 'sq' : '') + '" src="' + esc(c.cover) + '">'
          + '<div><div class="t">' + esc(c.title) + '</div><div class="s">' + esc(c.sub) + '</div>'
          + (i === 0 ? '<span class="best">Closest match</span>' : '') + '</div></div>').join('');
      return;
    }
    const img = d.cover ? '<img src="' + esc(d.cover) + '" onerror="this.outerHTML=\\'<div class=noimg>No cover</div>\\'">'
                        : '<div class="noimg">No cover</div>';
    const line = (k, x) => x ? '<div class="row"><b>' + k + '</b>' + esc(x) + '</div>' : '';
    v.innerHTML = img + '<div class="tab">' + esc(d.tab) + '</div><h1>' + esc(d.title) + '</h1>'
      + (d.rating ? '<div class="rating">' + esc(d.rating) + ' <small>/ 10</small></div>' : '')
      + line('Status', d.status) + line('Genres', d.genres) + line(d.creatorLabel, d.creator)
      + line('Season avg', d.seasonAvg) + (d.notes ? '<div class="notes">' + esc(d.notes) + '</div>' : '');
  }
  function pick(i) {
    const d = window.P;
    document.getElementById('v').innerHTML = '<div class="empty">Filling in ' + esc(d.choices[i].title) + '…</div>';
    last = null; // show the filled-in row on the next refresh
    google.script.run.withFailureHandler(e => { document.getElementById('v').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; })
      .applyPendingChoice(d.tabKey || d.tab, d.row, i);
  }
  function poll() {
    google.script.run.withSuccessHandler(d => {
      const key = d ? d.key : '';
      if (key !== last) { last = key; render(d); }
      setTimeout(poll, 900);
    }).withFailureHandler(() => setTimeout(poll, 3000)).getSelectedItem();
  }
  poll();
  function pollCompare() {
    google.script.run.withSuccessHandler(n => {
      const c = document.getElementById('cmp');
      c.style.display = n ? 'block' : 'none';
      c.innerHTML = '<b>' + n + ' new rating' + (n === 1 ? '' : 's') + '</b> to double-check against similar ones. Click to compare.';
      setTimeout(pollCompare, 5000);
    }).withFailureHandler(() => setTimeout(pollCompare, 15000)).getCompareWaiting();
  }
  pollCompare();
</script></body></html>`;

// Opens the cover viewer every time the sheet is opened on a computer (sidebars don't exist in the
// phone app). Needs an installable trigger: Google doesn't let the basic onOpen open panels.
function turnOnViewerAutoOpen() {
  turnOffViewerAutoOpen_();
  ScriptApp.newTrigger('openViewerOnOpen').forSpreadsheet(SpreadsheetApp.getActive()).onOpen().create();
  openCoverViewer();
  SpreadsheetApp.getActive().toast('The cover viewer will now open automatically whenever you open this sheet.', 'Media Tracker', 6);
}
function turnOffViewerAutoOpen() {
  turnOffViewerAutoOpen_();
  SpreadsheetApp.getActive().toast('The cover viewer will no longer open automatically.', 'Media Tracker', 6);
}
function turnOffViewerAutoOpen_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'openViewerOnOpen')
    .forEach(t => ScriptApp.deleteTrigger(t));
}
function openViewerOnOpen() {
  try { openCoverViewer(); } catch (err) { console.warn(`Viewer auto-open failed: ${err}`); }
}

// ---------- Deezer lookup (music) ----------
// Free, no key. Search results come ranked by popularity and say whether each is an album, single or EP.
function deezer_(term, typedTitle, hint, log) {
  const { name: typedName, year } = splitYear_(typedTitle || term);
  const q = hint ? `artist:"${hint}" album:"${typedName}"` : splitYear_(term).name;
  const res = UrlFetchApp.fetch('https://api.deezer.com/search/album?limit=40&q=' + encodeURIComponent(q), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { if (log) log.push(`Deezer: HTTP ${res.getResponseCode()}`); return null; }
  const body = JSON.parse(res.getContentText());
  if (body.error) { if (log) log.push(`Deezer error: ${JSON.stringify(body.error).slice(0, 150)}`); return null; }
  const results = body.data || [];
  if (log) log.push(`Deezer search "${q}": ${results.length} results`
    + results.slice(0, 6).map(a => `\n   • ${a.title} | ${a.artist?.name} | ${a.record_type}`).join(''));
  if (!results.length) return null;

  const clean = t => String(t || '').replace(/\s*[\(\[][^\)\]]*(remaster|deluxe|edition|expanded|anniversary|version)[^\)\]]*[\)\]]/gi, '').trim();
  const target = normTitle_(typedName);
  const seen = new Set();
  const scored = [];
  results.forEach((a, rank) => {
    const title = clean(a.title), who = a.artist?.name || '';
    const key = normTitle_(title) + '|' + normTitle_(who);
    if (!title || seen.has(key)) return; // other editions of an album already listed
    seen.add(key);
    const name = normTitle_(title), w = normTitle_(who);
    const titleSim = Math.max(similarity_(target, name), similarity_(target, `${w} ${name}`), similarity_(target, `${name} ${w}`));
    let score = hint ? 0.7 * titleSim + 0.3 * similarity_(normTitle_(hint), w) : titleSim;
    if (a.record_type && a.record_type !== 'album') score -= 0.15; // singles and EPs below full albums
    score += 0.12 * (1 - rank / results.length);                    // Deezer's popularity order breaks near-ties
    scored.push({ a, title, who, score });
  });
  if (!scored.length) return null;
  scored.sort((x, y) => y.score - x.score);
  const top = scored[0];
  if (log) log.push(`Best match: ${top.title} / ${top.who} (score ${top.score.toFixed(2)})`);
  const picks = scored.filter(c => c === top || c.score >= top.score - 0.1).slice(0, 8);

  // Genres and release year come from each album's own page.
  const infos = picks.map((c, i) => {
    let genres = '', rel = '';
    if (i < 6) {
      try {
        const al = JSON.parse(UrlFetchApp.fetch(`https://api.deezer.com/album/${c.a.id}`, { muteHttpExceptions: true }).getContentText());
        genres = (al.genres?.data || []).map(g => g.name).join(', ');
        rel = (al.release_date || '').slice(0, 4);
      } catch (err) { /* genres are optional */ }
    }
    if (year && rel === year) c.score += 0.2;
    return {
      title: c.title, trusted: false, creator: c.who, genres,
      cover: c.a.cover_xl || c.a.cover_big || c.a.cover_medium || '',
      sub: [c.who, rel, c.a.record_type && c.a.record_type !== 'album' ? c.a.record_type.toUpperCase() : ''].filter(Boolean).join(' · '),
      _score: c.score,
    };
  });
  if (year) infos.sort((x, y) => y._score - x._score);
  infos.forEach(i => delete i._score);
  const info = infos[0];
  if (infos.length > 1) info.choices = infos.map(plainChoice_);
  return info;
}

// ---------- Wikipedia / Wikidata lookup (movies, and TV when Apple has nothing) ----------
// Search Wikipedia for pages described as a film (or TV series), take the poster from the page,
// then read director and genres from Wikidata. Free, no key.
const WIKI_KINDS = {
  film: { suffix: 'film', match: /\bfilm\b/i },
  game: { suffix: 'video game', match: /\bvideo game\b/i },
  tv:   { suffix: 'TV series', match: /\b(television|TV|web) series\b|\bsitcom\b|\bminiseries\b/i },
};

const WIKI_HEADERS = { 'Api-User-Agent': 'MediaTrackerSheet/1.0 (personal Google Sheet; Apps Script)' };

function wikiSearch_(query, log) {
  const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2'
    + '&generator=search&gsrlimit=15&gsrsearch=' + encodeURIComponent(query)
    + '&prop=pageimages|description|pageprops&piprop=thumbnail&pithumbsize=500&pilicense=any&ppprop=wikibase_item';
  const res = UrlFetchApp.fetch(url, { headers: WIKI_HEADERS, muteHttpExceptions: true });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code !== 200) {
    if (log) log.push(`Wikipedia search "${query}": HTTP ${code} ${text.replace(/\s+/g, ' ').slice(0, 150)}`);
    console.warn(`Wikipedia ${code} for "${query}"`);
    return [];
  }
  const pages = JSON.parse(text).query?.pages || [];
  if (log) log.push(`Wikipedia search "${query}": ${pages.length} pages`
    + pages.slice(0, 6).map(pg => `\n   • ${pg.title} | ${pg.description || '(no description)'}${pg.thumbnail ? '' : ' | no image'}`).join(''));
  return pages;
}

function wiki_(kind, term, typedTitle, log) {
  const k = WIKI_KINDS[kind];
  const keep = pg => k.match.test(pg.description || '') && !/character|franchise|soundtrack|episode|developer|publisher|company/i.test(pg.description || '');
  let pages = wikiSearch_(`${term} ${k.suffix}`, log).filter(keep);
  if (!pages.length) pages = wikiSearch_(splitYear_(term).name, log).filter(keep); // retry: plain title, no year or "film" hint
  if (log) log.push(`Kept ${pages.length} page(s) whose description says ${{ film: '"film"', game: '"video game"' }[kind] || 'TV series'}`);
  if (!pages.length) return null;
  pages.sort((a, b) => a.index - b.index);

  const { name: typedName, year } = splitYear_(typedTitle || term);
  const target = normTitle_(typedName);
  const scored = pages.map((pg, rank) => {
    const name = pg.title.replace(/\s*\([^)]*\)\s*$/, ''); // "Speed Racer (film)" -> "Speed Racer"
    const yearBonus = year && `${pg.title} ${pg.description || ''}`.includes(year) ? 0.2 : 0; // you said which year
    return { pg, name, score: similarity_(target, normTitle_(name)) + yearBonus + 0.02 * (1 - rank / pages.length) };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (log) log.push(`Best match: ${top.pg.title} (score ${top.score.toFixed(2)}; needs 0.45)`);
  if (top.score < 0.45) return null;
  const picks = scored.filter(c => c === top || c.score >= top.score - 0.1).slice(0, 10);

  const facts = wikidataFacts_(picks.map(c => c.pg.pageprops?.wikibase_item).filter(Boolean));
  const infos = picks.map(c => {
    const f = facts[c.pg.pageprops?.wikibase_item] || {};
    return {
      title: c.name, trusted: false,
      cover: c.pg.thumbnail?.source || '',
      genres: (f.genres || []).join(', '),
      creator: ((kind === 'film' ? f.directors : kind === 'game' ? f.developers : null) || []).join(', '),
      sub: c.pg.description || '',
    };
  });
  if (log) log.push(`Director: ${infos[0].creator || '(none)'} | Genres: ${infos[0].genres || '(none)'} | Poster: ${infos[0].cover ? 'yes' : 'no'}`);
  const info = infos[0];
  if (infos.length > 1) info.choices = infos.map(plainChoice_);
  return info;
}

// Director (P57), genres (P136) for a batch of Wikidata items, with readable English names.
function wikidataFacts_(ids) {
  if (!ids.length) return {};
  const get = q => JSON.parse(UrlFetchApp.fetch('https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&' + q,
    { headers: WIKI_HEADERS, muteHttpExceptions: true }).getContentText() || '{}').entities || {};
  try {
    const ents = get(`props=claims&ids=${ids.join('|')}`);
    const refs = (e, p) => (e.claims?.[p] || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
    const labelIds = [...new Set(ids.flatMap(id => ents[id] ? [...refs(ents[id], 'P57'), ...refs(ents[id], 'P136'), ...refs(ents[id], 'P178').slice(0, 3)] : []))].slice(0, 50);
    const labels = labelIds.length ? get(`props=labels&languages=en&ids=${labelIds.join('|')}`) : {};
    const name = id => labels[id]?.labels?.en?.value || '';
    const tidy = g => g.replace(/\s+(film|television series|TV series|video game)$/i, '').replace(/^./, ch => ch.toUpperCase());
    const out = {};
    ids.forEach(id => {
      const e = ents[id];
      if (!e) return;
      out[id] = {
        directors: refs(e, 'P57').map(name).filter(Boolean),
        developers: refs(e, 'P178').slice(0, 3).map(name).filter(Boolean),
        genres: [...new Set(refs(e, 'P136').map(name).filter(Boolean).map(tidy))].slice(0, 4),
      };
    });
    return out;
  } catch (err) {
    console.warn(`Wikidata error: ${err}`);
    return {};
  }
}

// Shows each step of the lookup for the selected row, so a failed match can be pinned down.
function diagnoseSelectedRow() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const cfg = cfgOf_(sheet);
  if (!cfg) { ui.alert('Select a row on one of the media tabs first.'); return; }
  const cols = findColumns_(sheet, cfg);
  const row = sheet.getActiveRange().getRow();
  const title = String(sheet.getRange(row, cols.title).getValue() || '').trim();
  if (row < 2 || !title) { ui.alert('Select a row that has a title.'); return; }
  const log = [`Tab: ${sheet.getName()} | Row ${row} | Title: "${title}" | Source: ${cfg.source}`];
  let info = null;
  try {
    if (cfg.source === 'game') {
      if (igdbKeys_()) { info = igdb_(title, title, log); if (!info) log.push('IGDB found nothing, trying Steam'); }
      else log.push('No IGDB keys set, so only Steam and Wikipedia are tried');
      if (!info) info = steam_(title, title, log);
      if (!info) { log.push('Steam found nothing, trying Wikipedia'); info = wiki_('game', title, title, log); }
    }
    else if (cfg.source === 'movie') {
      if (tmdbKey_()) { info = tmdbMovie_(title, title, log); if (!info) log.push('TMDB found nothing, trying Wikipedia'); }
      else log.push('No TMDB key set, using Wikipedia');
      if (!info) info = wiki_(cfg.kind, title, title, log);
    }
    else if (cfg.source === 'songs') { info = deezerTrack_(title, title, '', log); }
    else if (cfg.source === 'books') { info = openLibrary_(title, '', log); if (!info) { info = itunes_(cfg, title, title, ''); log.push(info ? `Apple backup: ${info.title} / ${info.creator}` : 'Apple backup: no results'); } }
    else if (cfg.source === 'tvmaze') { info = tvmaze_(title, title, log); if (!info) info = wiki_(cfg.wikiFallback, title, title, log); }
    else if (cfg.source === 'deezer') { info = deezer_(title, title, '', log); if (!info) { info = itunes_(cfg, title, title, ''); log.push(info ? `Apple backup: ${info.title} / ${info.creator}` : 'Apple backup: no results'); } }
    else if (cfg.source === 'anilist') { info = anime_(title); log.push(info ? 'AniList: match found' : 'AniList: no match'); }
    else {
      info = itunes_(cfg, title, title, '');
      log.push(info ? `Apple: ${info.title} / ${info.creator}` : 'Apple: no results');
      if (!info && cfg.wikiFallback) info = wiki_(cfg.wikiFallback, title, title, log);
    }
  } catch (err) {
    log.push(`ERROR: ${err.message || err}`);
  }
  log.push(info ? `RESULT: would fill in "${info.title}"${info.choices ? ` (and ask you to choose from ${info.choices.length})` : ''}` : 'RESULT: no match');
  ui.alert('Lookup details', log.join('\n\n'), ui.ButtonSet.OK);
}

// A copy of one choice without its own list of choices (keeps the saved data from looping back on itself).
function plainChoice_(c) {
  const copy = Object.assign({}, c);
  delete copy.choices;
  return copy;
}

// "Speed Racer 2008" / "Speed Racer (2008)" -> { name: "Speed Racer", year: "2008" }
function splitYear_(title) {
  const m = String(title).match(/^(.*?)[\s(\[]*\b((?:19|20)\d{2})\b[)\]]*\s*$/);
  // Only a plausible release year counts, so "Blade Runner 2049" keeps its name.
  const ok = m && m[1].trim() && Number(m[2]) <= new Date().getFullYear() + 2;
  return ok ? { name: m[1].trim(), year: m[2] } : { name: String(title).trim(), year: '' };
}

// ---------- duplicate check ----------
// Finds another row on the same tab with the same title, ignoring capitalization and punctuation.
// Albums, Movies and Books also compare the artist / director / author, so two different albums
// that share a name aren't flagged. Until that column is filled in, the row isn't flagged yet.
function duplicateRow_(sheet, cols, row, title) {
  const key = normTitle_(title);
  if (!key || sheet.getLastRow() < 2) return 0;
  const n = sheet.getLastRow() - 1;
  const vals = sheet.getRange(2, cols.title, n, 1).getDisplayValues();
  const byCreator = cols.creator && (cfgOf_(sheet) || {}).key !== 'anime';
  const who = byCreator ? sheet.getRange(2, cols.creator, n, 1).getDisplayValues().map(r => normTitle_(r[0])) : null;
  if (byCreator && !who[row - 2]) return 0;
  const i = vals.findIndex((r, idx) => idx + 2 !== row && normTitle_(r[0]) === key && (!byCreator || who[idx] === who[row - 2]));
  return i >= 0 ? i + 2 : 0;
}

function warnDuplicate_(sheet, title, dupRow) {
  SpreadsheetApp.getActive().toast(
    `"${title}" is already on your ${sheet.getName()} list (row ${dupRow}). Both are highlighted red; delete one if it was a mistake.`,
    'Already on your list', 15);
}

// ---------- core ----------

// Looks up a row's title and fills in the rest. Returns true (filled), false (no match) or
// 'asked' (several close matches, so a picker pop-up was shown and it fills in after you choose).
// Looks up a row's title and fills in the rest. Returns true (filled), false (no match) or
// 'asked' (several close matches, so it is waiting for you to pick one).
//   ask = 'popup'    show the cover picker (works from the menu)
//   ask = 'dropdown' turn the title cell into a dropdown of the choices (works in the background)
//   ask = 'none'     just take the closest match
function fillRow_(sheet, row, cfg, cols, overwrite, searchOverride, ask, ignoreHint) {
  const get = c => (c ? String(sheet.getRange(row, c).getValue() || '').trim() : '');
  const title = get(cols.title);
  if (!title) return false;

  // The Artist you typed narrows a music search, but not one left over from an earlier (possibly wrong) match.
  const hint = cfg.creatorIsSearchHint && !ignoreHint ? get(cols.creator) : '';
  const term = searchOverride || (hint ? `${title} ${hint}` : title);
  const info = lookup_(cfg, term, searchOverride || title, searchOverride ? '' : hint);
  if (!info) return false;

  if (info.choices && ask !== 'none') {
    if (ask === 'popup' && showPicker_(sheet, row, title, info.choices)) return 'asked';
    offerDropdown_(sheet, row, cols, title, info.choices);
    return 'asked';
  }
  applyInfo_(sheet, row, cols, title, info, overwrite);
  return !!(info.cover || info.genres || info.creator);
}

function applyInfo_(sheet, row, cols, typed, info, overwrite) {
  const get = c => (c ? String(sheet.getRange(row, c).getValue() || '').trim() : '');
  const put = (c, v) => { if (c && v && (overwrite || !get(c))) sheet.getRange(row, c).setValue(v); };
  put(cols.cover, info.cover);
  put(cols.genres, info.genres);
  put(cols.creator, info.creator);
  put(cols.album, info.album);
  const renamed = fixTitle_(sheet, row, cols, typed, info);
  if (!renamed && cols.creator && (cfgOf_(sheet) || {}).key !== 'anime') { // the artist/author is known now
    const title = String(sheet.getRange(row, cols.title).getValue() || '').trim();
    const dup = duplicateRow_(sheet, cols, row, title);
    if (dup) warnDuplicate_(sheet, title, dup);
  }
}

// Replaces what you typed with the official title (fixing spelling and capitalization) and leaves
// a note on the cell with your original text. Anime matches are ranked by title similarity already,
// so they are trusted; iTunes only returns its single best guess, so it must look close enough first.
function fixTitle_(sheet, row, cols, typed, info) {
  const official = (info.title || '').trim();
  const cell = sheet.getRange(row, cols.title);
  const current = String(cell.getValue() || '').trim(); // may be a dropdown label right after a pick
  if (!official || official === current) return false;
  if (!info.trusted && similarity_(normTitle_(typed), normTitle_(official)) < 0.5) return false;
  cell.setValue(official);
  // A pasted link turns the cell into black, underlined link text; put back the normal title style.
  if (/^https?:\/\//i.test(typed)) cell.setFontColor('#ffffff').setFontLine('none');
  if (official !== typed) cell.setNote(`You typed: ${typed}`);
  const dup = duplicateRow_(sheet, cols, row, official); // e.g. "JJBA" turned out to be a show you already have
  if (dup) warnDuplicate_(sheet, official, dup);
  const cfg = cfgOf_(sheet);
  if (cfg && cfg.seasonsId && official !== typed) renameSeasons_(cfg.seasonsId, typed, official);
  return true;
}

// Keeps the Seasons tab pointing at the renamed show so Season Avg keeps working.
function renameSeasons_(seasonsId, oldTitle, newTitle) {
  const seasons = sheetById_(seasonsId);
  if (!seasons || seasons.getLastRow() < 2) return;
  const range = seasons.getRange(2, 1, seasons.getLastRow() - 1, 1);
  const key = normTitle_(oldTitle);
  const vals = range.getValues();
  let changed = false;
  vals.forEach(r => { if (r[0] && normTitle_(r[0]) === key) { r[0] = newTitle; changed = true; } });
  if (changed) range.setValues(vals);
}

function findColumns_(sheet, cfg) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idx = name => (name ? headers.indexOf(name) + 1 : 0);
  const title = idx('Title') || idx('Song') || idx('Album');
  const cover = idx('Cover URL');
  if (!title || !cover) return null;
  return { title, cover, genres: idx('Genres'), creator: idx(cfg.creator), album: cfg.albumCol ? idx('Album') : 0 };
}

function lookup_(cfg, term, typedTitle, hint) {
  try {
    const sp = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?album\/([A-Za-z0-9]+)/.exec(term);
    if (sp) return spotifyAlbum_(sp[1]); // you pasted a Spotify album link
    const st = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]+)/.exec(term);
    if (st) return spotifyTrack_(st[1]);   // you pasted a Spotify song link
    if (cfg.source === 'songs') return deezerTrack_(term, typedTitle, hint);
    if (cfg.source === 'anilist') return anime_(term);
    if (cfg.source === 'game') return (igdbKeys_() ? igdb_(term, typedTitle) : null) || steam_(term, typedTitle) || wiki_('game', term, typedTitle);
    if (cfg.source === 'movie') return (tmdbKey_() ? tmdbMovie_(term, typedTitle) : null) || wiki_(cfg.kind, term, typedTitle);
    if (cfg.source === 'tvmaze') return tvmaze_(term, typedTitle) || wiki_(cfg.wikiFallback, term, typedTitle);
    if (cfg.source === 'deezer') return deezer_(term, typedTitle, hint) || itunes_(cfg, term, typedTitle, hint);
    if (cfg.source === 'books') return openLibrary_(typedTitle || term, hint) || itunes_(cfg, term, typedTitle, hint);
    return itunes_(cfg, term, typedTitle, hint) || (cfg.wikiFallback ? wiki_(cfg.wikiFallback, term, typedTitle) : null);
  } catch (err) {
    console.warn(`Lookup failed for "${term}": ${err}`);
    SpreadsheetApp.getActive().toast(`Lookup error: ${String(err.message || err).slice(0, 150)}`, 'Media Tracker', 10);
    return null;
  }
}

// Anime lookup that tolerates typos and loose titles.
// Pulls candidate lists from AniList (full title, then shorter versions of it), ranks each
// candidate by how closely its title matches what you typed, and keeps the best one.
// Kitsu's typo-tolerant search is used as a backup to find the official title.
const ANIME_FIELDS = 'id format episodes seasonYear startDate { year } title { romaji english } synonyms popularity coverImage { extraLarge large } genres '
  + 'studios(isMain: true) { nodes { name } }';

function anime_(term) {
  const norm = normTitle_(term);
  // "Jojo's" -> "Jojo": AniList matches the base word, not the possessive.
  const base = normTitle_(term.replace(/['’]s\b/gi, ''));
  const words = base.split(' ').filter(w => w.length >= 3);
  // Full title first, then each word on its own so one misspelled word can't block the match.
  const seen = new Set();
  const queries = [term, base, words.slice(0, 2).join(' '), ...words]
    .filter(q => q && q.length >= 2 && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()))
    .slice(0, 7);

  const pool = new Map(); // AniList id -> { media, score }
  const bestScore = () => Math.max(0, ...[...pool.values()].map(c => c.score));
  for (let i = 0; i < queries.length; i++) {
    if (i) Utilities.sleep(700);
    scoreInto_(pool, norm, anilistCandidates_(queries[i]));
    if (bestScore() >= 0.85) break;
  }
  if (bestScore() < 0.85) {
    const official = kitsuTitle_(base);
    if (official) {
      Utilities.sleep(700);
      // Kitsu already corrected the spelling, so score against its title.
      scoreInto_(pool, normTitle_(official), anilistCandidates_(official));
    }
  }

  const ranked = [...pool.values()].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top || top.score < 0.45) return null;

  // Other choices: near-ties, plus every entry of the same series (sequels, movies, OVAs),
  // which AniList stores as separate entries that share the first part of the title.
  const stems = [top.media.title?.english, top.media.title?.romaji].filter(Boolean)
    .map(t => normTitle_(t.split(':')[0].replace(/\([^)]*\)/g, '')));
  const sameSeries = m => [m.title?.english, m.title?.romaji].filter(Boolean)
    .some(t => stems.some(st => st.length >= 4 && normTitle_(t).startsWith(st)));
  const choices = ranked.filter(c => c === top || c.score >= top.score - 0.15 || sameSeries(c.media)).slice(0, 12);

  const info = toInfo_(top.media);
  if (choices.length > 1) {
    const rest = choices.slice(1).sort((a, b) => (yearOf_(a.media) || 9999) - (yearOf_(b.media) || 9999));
    info.choices = [top, ...rest].map(c => Object.assign(toInfo_(c.media), { sub: describe_(c.media) }));
  }
  return info;
}

function yearOf_(m) { return m.seasonYear || m.startDate?.year || 0; }

function describe_(m) {
  const fmt = { TV: 'TV series', TV_SHORT: 'TV short', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special', MUSIC: 'Music video' }[m.format] || m.format || '';
  return [fmt, yearOf_(m) || '', m.episodes ? `${m.episodes} ep` : ''].filter(Boolean).join(' · ');
}

function anilistCandidates_(q) {
  try {
    const query = 'query ($s: String) { Page(perPage: 15) { media(search: $s, type: ANIME, '
      + `sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${ANIME_FIELDS} } } }`;
    const res = UrlFetchApp.fetch('https://graphql.anilist.co', {
      method: 'post', contentType: 'application/json', headers: { Accept: 'application/json' },
      payload: JSON.stringify({ query, variables: { s: q } }), muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 429) { Utilities.sleep(61000); return anilistCandidates_(q); }
    if (res.getResponseCode() !== 200) {
      console.warn(`AniList ${res.getResponseCode()} for "${q}": ${res.getContentText().slice(0, 300)}`);
      return [];
    }
    return JSON.parse(res.getContentText()).data?.Page?.media || [];
  } catch (err) {
    console.warn(`AniList error for "${q}": ${err}`);
    return [];
  }
}

// Score = closest title match (romaji, English or any synonym), with a small nudge for popular shows.
function scoreInto_(pool, target, list) {
  const maxPop = Math.max(1, ...list.map(m => m.popularity || 0));
  for (const m of list) {
    const names = [m.title?.romaji, m.title?.english, ...(m.synonyms || [])].filter(Boolean);
    const sim = Math.max(0, ...names.map(n => similarity_(target, normTitle_(n))));
    const score = sim + 0.05 * ((m.popularity || 0) / maxPop);
    const prev = pool.get(m.id);
    if (!prev || score > prev.score) pool.set(m.id, { media: m, score });
  }
}

function toInfo_(m) {
  return {
    title: m.title?.english || m.title?.romaji || '',
    trusted: true,
    cover: m.coverImage?.extraLarge || m.coverImage?.large || '',
    genres: (m.genres || []).join(', '),
    creator: (m.studios?.nodes || []).map(s => s.name).join(', '),
  };
}

function normTitle_(s) {
  return String(s).toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .replace(/^(the|a|an) (?=\S)/, ''); // "The Dark Side of the Moon" matches "Dark Side of the Moon"
}

// Dice coefficient on letter pairs: 1 = identical, about 0.9 for a one-letter typo, near 0 = unrelated.
function similarity_(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pairs = s => { const p = new Map(); const t = s.replace(/ /g, '');
    for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); p.set(k, (p.get(k) || 0) + 1); } return p; };
  const pa = pairs(a), pb = pairs(b);
  let overlap = 0, total = 0;
  pa.forEach((n, k) => { overlap += Math.min(n, pb.get(k) || 0); total += n; });
  pb.forEach(n => { total += n; });
  return total ? (2 * overlap) / total : 0;
}

function kitsuTitle_(term) {
  try {
    const res = UrlFetchApp.fetch('https://kitsu.io/api/edge/anime?page[limit]=1&filter[text]='
      + encodeURIComponent(term), { headers: { Accept: 'application/vnd.api+json' }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return '';
    const a = (JSON.parse(res.getContentText()).data || [])[0]?.attributes;
    return a ? (a.titles?.en || a.canonicalTitle || a.titles?.en_jp || '') : '';
  } catch (err) { return ''; }
}

// Apple search: takes the top results, scores each by how well its name (and artist/creator)
// matches what you typed, merges duplicate editions, and offers a picker on close calls.
function itunes_(cfg, term, typedTitle, hint) {
  const url = 'https://itunes.apple.com/search?country=US&limit=50'
    + `&media=${cfg.media}&entity=${cfg.entity}&term=${encodeURIComponent(splitYear_(term).name)}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const results = JSON.parse(res.getContentText()).results || [];
  if (!results.length) return null;

  const { name: typedName, year } = splitYear_(typedTitle || term);
  const target = normTitle_(typedName);
  const seen = new Set();
  const scored = [];
  results.forEach((hit, rank) => {
    const info = itunesInfo_(cfg, hit);
    if (!info.title) return;
    const key = normTitle_(info.title) + '|' + normTitle_(info.creator);
    if (seen.has(key)) return; // same album/movie in another edition
    seen.add(key);
    const name = normTitle_(info.title), who = normTitle_(info.creator);
    // Matches "Dark Side of the Moon" as well as "Pink Floyd Dark Side of the Moon".
    const titleSim = Math.max(similarity_(target, name), similarity_(target, `${who} ${name}`), similarity_(target, `${name} ${who}`));
    let score = hint ? 0.7 * titleSim + 0.3 * similarity_(normTitle_(hint), who) : titleSim;
    if (year && (hit.releaseDate || '').startsWith(year)) score += 0.2; // you said which year
    // Lots of small singles share famous album names; rank full albums above them.
    if (cfg.entity === 'album' && (/\s-\s(Single|EP)$/i.test(hit.collectionName || '') || (hit.trackCount || 99) <= 3)) score -= 0.15;
    score += 0.02 * (1 - rank / results.length); // tiny tie-breaker: Apple's own order
    scored.push({ info, score });
  });
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const choices = scored.filter(c => c === top || c.score >= top.score - 0.1).slice(0, 10);
  const info = top.info;
  if (choices.length > 1) info.choices = choices.map(c => plainChoice_(c.info));
  return info;
}

function itunesInfo_(cfg, hit) {
  // Official name: album name for music, show name for TV, otherwise the movie or book title.
  let title = cfg.entity === 'album' ? hit.collectionName
    : cfg.entity === 'tvSeason' ? hit.artistName : (hit.trackName || hit.collectionName);
  if (title && cfg.entity === 'album') {
    title = title.replace(/\s+-\s+(EP|Single)$/i, '')
      .replace(/\s*[\(\[][^\)\]]*(remaster|deluxe|edition|expanded|anniversary|version)[^\)\]]*[\)\]]/gi, '').trim();
  }
  const genreList = Array.isArray(hit.genres) && hit.genres.length
    ? hit.genres.filter(g => typeof g === 'string' && g !== 'Books')
    : [hit.primaryGenreName].filter(Boolean);
  const year = (hit.releaseDate || '').slice(0, 4);
  const creator = cfg.entity === 'tvSeason' ? '' : (hit.artistName || '');
  return {
    title: title || '',
    trusted: false,
    cover: (hit.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/300x300bb.'),
    genres: genreList.join(', '),
    creator,
    sub: [creator, year, genreList[0]].filter(Boolean).join(' · '),
  };
}

// ---------- TV: TVmaze (free, no key) ----------
function tvmaze_(term, typedTitle, log) {
  const { name: typedName, year } = splitYear_(typedTitle || term);
  const q = splitYear_(term).name;
  const res = UrlFetchApp.fetch('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { if (log) log.push(`TVmaze: HTTP ${res.getResponseCode()}`); return null; }
  const results = JSON.parse(res.getContentText()) || [];
  if (log) log.push(`TVmaze search "${q}": ${results.length} results`
    + results.slice(0, 6).map(r => `\n   • ${r.show.name} | ${(r.show.premiered || '').slice(0, 4)} | ${(r.show.network || r.show.webChannel || {}).name || ''}`).join(''));
  if (!results.length) return null;
  const target = normTitle_(typedName);
  const scored = results.map(r => {
    const s = r.show, y = (s.premiered || '').slice(0, 4);
    const score = similarity_(target, normTitle_(s.name)) + (year && y === year ? 0.2 : 0) + 0.1 * (r.score || 0);
    return { s, y, score };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (log) log.push(`Best match: ${top.s.name} (${top.y}) score ${top.score.toFixed(2)}; needs 0.45`);
  if (top.score < 0.45) return null;
  const infos = scored.filter(c => c === top || c.score >= top.score - 0.1).slice(0, 8).map(c => ({
    title: c.s.name, trusted: false, creator: '',
    genres: (c.s.genres || []).join(', '),
    cover: c.s.image?.original || c.s.image?.medium || '',
    sub: [(c.s.network || c.s.webChannel || {}).name, c.y].filter(Boolean).join(' · '),
  }));
  const info = infos[0];
  if (infos.length > 1) info.choices = infos.map(plainChoice_);
  return info;
}

// ---------- Movies: TMDB (free key from themoviedb.org) ----------
function setTmdbKey() { showKeyDialog_('tmdb'); }
function tmdbKey_() { return PropertiesService.getScriptProperties().getProperty('TMDB_KEY') || ''; }
function tmdbFetch_(path) {
  const key = tmdbKey_();
  const bearer = key.length > 40; // the long "Read Access Token" goes in a header; the short "API Key" goes in the URL
  const url = 'https://api.themoviedb.org/3' + path + (bearer ? '' : (path.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(key));
  return UrlFetchApp.fetch(url, { headers: bearer ? { Authorization: 'Bearer ' + key, Accept: 'application/json' } : { Accept: 'application/json' }, muteHttpExceptions: true });
}
function tmdbMovie_(term, typedTitle, log) {
  const { name: typedName, year } = splitYear_(typedTitle || term);
  const q = splitYear_(term).name;
  const res = tmdbFetch_('/search/movie?include_adult=false&query=' + encodeURIComponent(q));
  if (res.getResponseCode() !== 200) { if (log) log.push(`TMDB: HTTP ${res.getResponseCode()} ${res.getContentText().slice(0, 120)}`); return null; }
  const results = (JSON.parse(res.getContentText()).results || []).slice(0, 20);
  if (log) log.push(`TMDB search "${q}": ${results.length} results`
    + results.slice(0, 6).map(m => `\n   • ${m.title} | ${(m.release_date || '').slice(0, 4)}`).join(''));
  if (!results.length) return null;
  const target = normTitle_(typedName);
  const byPop = results.map(m => m.popularity || 0).sort((a, b) => b - a);
  const scored = results.map(m => {
    const y = (m.release_date || '').slice(0, 4);
    const sim = Math.max(similarity_(target, normTitle_(m.title)), similarity_(target, normTitle_(m.original_title || '')));
    const popRank = byPop.indexOf(m.popularity || 0) / results.length;
    return { m, y, score: sim + (year && y === year ? 0.2 : 0) + 0.12 * (1 - popRank) };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (log) log.push(`Best match: ${top.m.title} (${top.y}) score ${top.score.toFixed(2)}; needs 0.45`);
  if (top.score < 0.45) return null;
  const picks = scored.filter(c => c === top || c.score >= top.score - 0.1).slice(0, 6);
  const infos = picks.map(c => {
    let genres = '', director = '';
    try {
      const d = JSON.parse(tmdbFetch_(`/movie/${c.m.id}?append_to_response=credits`).getContentText());
      genres = (d.genres || []).map(g => g.name).join(', ');
      director = (d.credits?.crew || []).filter(p => p.job === 'Director').map(p => p.name).join(', ');
    } catch (err) { /* details are optional */ }
    return {
      title: c.m.title, trusted: false, genres, creator: director,
      cover: c.m.poster_path ? 'https://image.tmdb.org/t/p/w500' + c.m.poster_path : '',
      sub: [c.y, director].filter(Boolean).join(' · '),
    };
  });
  if (log) log.push(`Director: ${infos[0].creator || '(none)'} | Genres: ${infos[0].genres || '(none)'} | Poster: ${infos[0].cover ? 'yes' : 'no'}`);
  const info = infos[0];
  if (infos.length > 1) info.choices = infos.map(plainChoice_);
  return info;
}

// ---------- Books: Open Library (free, no key) ----------
const OL_HEADERS = { 'User-Agent': 'MediaTrackerSheet/1.0 (personal Google Sheet; Apps Script)', Accept: 'application/json' };
const BOOK_GENRES = ['science fiction', 'fantasy', 'horror', 'mystery', 'thriller', 'romance', 'historical fiction',
  'humor', 'adventure', 'dystopia', 'space opera', 'young adult', 'graphic novel', 'manga', 'comics', 'biography',
  'memoir', 'history', 'philosophy', 'poetry', 'self-help', 'science', 'psychology', 'business', 'true crime', 'classics'];
function openLibrary_(typedTitle, hint, log) {
  const { name: typedName, year } = splitYear_(typedTitle);
  let url = 'https://openlibrary.org/search.json?limit=20&fields=key,title,subtitle,author_name,first_publish_year,cover_i,subject,edition_count'
    + '&q=' + encodeURIComponent(typedName);
  if (hint) url += '&author=' + encodeURIComponent(hint);
  const res = UrlFetchApp.fetch(url, { headers: OL_HEADERS, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { if (log) log.push(`Open Library: HTTP ${res.getResponseCode()}`); return null; }
  const docs = JSON.parse(res.getContentText()).docs || [];
  if (log) log.push(`Open Library search "${typedName}"${hint ? ` by ${hint}` : ''}: ${docs.length} results`
    + docs.slice(0, 6).map(d => `\n   • ${d.title} | ${(d.author_name || []).join(', ')} | ${d.first_publish_year || ''}`).join(''));
  if (!docs.length) return null;

  const strip = t => normTitle_(String(t || '').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')); // "We Are Legion (We Are Bob)" -> "we are legion"
  const target = normTitle_(typedName), targetShort = strip(typedName);
  const byEd = docs.map(d => d.edition_count || 0).sort((a, b) => b - a);
  const scored = docs.map(d => {
    const full = d.subtitle ? `${d.title} ${d.subtitle}` : d.title;
    const titleSim = Math.max(similarity_(target, normTitle_(d.title)), similarity_(target, normTitle_(full)), similarity_(targetShort, strip(d.title)));
    const who = (d.author_name || []).join(', ');
    let score = hint ? 0.7 * titleSim + 0.3 * similarity_(normTitle_(hint), normTitle_(who)) : titleSim;
    if (year && String(d.first_publish_year) === year) score += 0.2;
    score += 0.12 * (1 - byEd.indexOf(d.edition_count || 0) / docs.length); // more editions = better-known book
    return { d, who, score };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (log) log.push(`Best match: ${top.d.title} / ${top.who} (score ${top.score.toFixed(2)}; needs 0.45)`);
  if (top.score < 0.45) return null;

  const genresOf = d => {
    const subj = (d.subject || []).map(x => x.toLowerCase());
    const hits = BOOK_GENRES.filter(g => subj.some(x => x.includes(g)));
    return hits.filter(g => !hits.some(h => h !== g && h.includes(g))) // "science fiction" wins over "science"
      .slice(0, 3).map(g => g.replace(/\b\w/g, c => c.toUpperCase())).join(', ');
  };
  const infos = scored.filter(c => c === top || c.score >= top.score - 0.1).slice(0, 8).map(c => ({
    title: c.d.title, trusted: false, creator: c.who, genres: genresOf(c.d),
    cover: c.d.cover_i ? `https://covers.openlibrary.org/b/id/${c.d.cover_i}-L.jpg` : '',
    sub: [c.who, c.d.first_publish_year].filter(Boolean).join(' · '),
  }));
  if (log) log.push(`Genres: ${infos[0].genres || '(none)'} | Cover: ${infos[0].cover ? 'yes' : 'no'}`);
  const info = infos[0];
  if (infos.length > 1) info.choices = infos.map(plainChoice_);
  return info;
}

// ---------- Albums: a pasted Spotify link (for releases Deezer and Apple don't carry) ----------
function spotifyAlbum_(id) {
  const url = 'https://open.spotify.com/album/' + id;
  const meta = (html, prop) => {
    const m = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i').exec(html)
      || new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, 'i').exec(html);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"') : '';
  };
  let title = '', artist = '', year = '', type = '', cover = '';
  const page = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (page.getResponseCode() === 200) {
    const html = page.getContentText();
    // og:title "Listen to Live At Electric Lady - Album by Clairo | Spotify"; og:description "Clairo · EP · 2023 · 5 songs"
    const t = /^(?:Listen to )?(.*?) - (?:Album|Single|EP|Compilation) by (.*?)(?: \| Spotify)?$/i.exec(meta(html, 'og:title'));
    if (t) { title = t[1]; artist = t[2]; }
    const d = meta(html, 'og:description').split(' · ');
    if (d.length >= 3) { if (!artist) artist = d[0]; type = d[1]; year = d[2]; }
    cover = meta(html, 'og:image');
  }
  if (!title || !cover) { // backup: Spotify's embed info has the name and cover, but not the artist
    const o = UrlFetchApp.fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(url), { muteHttpExceptions: true });
    if (o.getResponseCode() === 200) {
      const j = JSON.parse(o.getContentText());
      title = title || j.title || '';
      cover = cover || String(j.thumbnail_url || '').replace('ab67616d00001e02', 'ab67616d0000b273'); // 300px -> 640px
    }
  }
  if (!title) return null;
  return { title, creator: artist, genres: '', cover, trusted: true,
           sub: [artist, year, type && !/album/i.test(type) ? type.toUpperCase() : ''].filter(Boolean).join(' · ') };
}

// ---------- Games: Steam store (free, no key). Console-only games fall through to Wikipedia. ----------
function steam_(term, typedTitle, log) {
  const { name: typedName, year } = splitYear_(typedTitle || term);
  const res = UrlFetchApp.fetch('https://store.steampowered.com/api/storesearch/?cc=us&l=en&term=' + encodeURIComponent(typedName), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { if (log) log.push(`Steam: HTTP ${res.getResponseCode()}`); return null; }
  const items = (JSON.parse(res.getContentText()).items || []).filter(it => !/soundtrack|\bost\b|\bdlc\b|demo|season pass|artbook/i.test(it.name));
  if (log) log.push(`Steam search "${typedName}": ${items.length} results` + items.slice(0, 6).map(it => `\n   • ${it.name}`).join(''));
  if (!items.length) return null;
  const target = normTitle_(typedName);
  const scored = items.map((it, rank) => ({ it, score: similarity_(target, normTitle_(it.name)) + 0.05 * (1 - rank / items.length) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (log) log.push(`Best match: ${top.it.name} (score ${top.score.toFixed(2)}; needs 0.6)`);
  if (top.score < 0.6) return null; // stricter than other tabs: Steam returns loosely related games
  const infos = scored.filter(c => c === top || c.score >= top.score - 0.1).slice(0, 5).map(c => {
    let genres = '', dev = '', y = '';
    try {
      const d = JSON.parse(UrlFetchApp.fetch(`https://store.steampowered.com/api/appdetails?appids=${c.it.id}&filters=basic,genres,developers,release_date`,
        { muteHttpExceptions: true }).getContentText())[c.it.id]?.data || {};
      genres = (d.genres || []).map(g => g.description).slice(0, 4).join(', ');
      dev = (d.developers || []).slice(0, 3).join(', ');
      y = ((d.release_date || {}).date || '').match(/\d{4}/)?.[0] || '';
    } catch (err) { /* details are optional */ }
    // Portrait box art when the game has it, otherwise the wide store banner.
    const art = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${c.it.id}/library_600x900.jpg`;
    let cover = art;
    try { if (UrlFetchApp.fetch(art, { muteHttpExceptions: true }).getResponseCode() !== 200) cover = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${c.it.id}/header.jpg`; } catch (err) {}
    return { title: c.it.name, trusted: false, creator: dev, genres, cover, sub: [y, dev].filter(Boolean).join(' · '), _y: y, _score: c.score };
  });
  if (year) { infos.forEach(i => { if (i._y === year) i._score += 0.2; }); infos.sort((a, b) => b._score - a._score); }
  infos.forEach(i => { delete i._y; delete i._score; });
  const info = infos[0];
  if (infos.length > 1) info.choices = infos.map(plainChoice_);
  return info;
}

// ---------- Games: IGDB (every platform, incl. Nintendo; free with a Twitch developer app) ----------
function setIgdbKeys() { showKeyDialog_('igdb'); }
function igdbKeys_() {
  const p = PropertiesService.getScriptProperties();
  return p.getProperty('IGDB_ID') && p.getProperty('IGDB_SECRET') ? true : false;
}
function igdbToken_(forceNew) {
  const p = PropertiesService.getScriptProperties();
  const tok = p.getProperty('IGDB_TOKEN'), exp = Number(p.getProperty('IGDB_TOKEN_EXP') || 0);
  if (!forceNew && tok && Date.now() < exp) return tok;
  const res = UrlFetchApp.fetch('https://id.twitch.tv/oauth2/token?grant_type=client_credentials&client_id='
    + encodeURIComponent(p.getProperty('IGDB_ID')) + '&client_secret=' + encodeURIComponent(p.getProperty('IGDB_SECRET')),
    { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return '';
  const j = JSON.parse(res.getContentText());
  p.setProperties({ IGDB_TOKEN: j.access_token, IGDB_TOKEN_EXP: String(Date.now() + (j.expires_in - 3600) * 1000) });
  return j.access_token;
}
function igdbFetch_(body) {
  const send = tok => UrlFetchApp.fetch('https://api.igdb.com/v4/games', {
    method: 'post', contentType: 'text/plain', payload: body, muteHttpExceptions: true,
    headers: { 'Client-ID': PropertiesService.getScriptProperties().getProperty('IGDB_ID'), Authorization: 'Bearer ' + tok, Accept: 'application/json' } });
  let res = send(igdbToken_(false));
  if (res.getResponseCode() === 401) res = send(igdbToken_(true)); // token expired early
  return res;
}
function igdb_(term, typedTitle, log) {
  const { name: typedName, year } = splitYear_(typedTitle || term);
  const q = typedName.replace(/"/g, '');
  const res = igdbFetch_(`search "${q}"; fields name,first_release_date,cover.image_id,genres.name,`
    + `involved_companies.company.name,involved_companies.developer,platforms.abbreviation,total_rating_count,version_parent,parent_game; limit 25;`);
  if (res.getResponseCode() !== 200) { if (log) log.push(`IGDB: HTTP ${res.getResponseCode()} ${res.getContentText().slice(0, 150)}`); return null; }
  const games = JSON.parse(res.getContentText()).filter(g => !g.version_parent); // skip "GOTY edition" style copies
  if (log) log.push(`IGDB search "${q}": ${games.length} results`
    + games.slice(0, 6).map(g => `\n   • ${g.name} | ${g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : ''}`).join(''));
  if (!games.length) return null;
  const target = normTitle_(typedName);
  const byPop = games.map(g => g.total_rating_count || 0).sort((a, b) => b - a);
  const scored = games.map(g => {
    const y = g.first_release_date ? String(new Date(g.first_release_date * 1000).getUTCFullYear()) : '';
    let score = similarity_(target, normTitle_(g.name)) + (year && y === year ? 0.2 : 0)
      + 0.15 * (1 - byPop.indexOf(g.total_rating_count || 0) / games.length); // well-known games first
    if (g.parent_game) score -= 0.1; // DLC and expansions below the main game
    return { g, y, score };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (log) log.push(`Best match: ${top.g.name} (${top.y}) score ${top.score.toFixed(2)}; needs 0.45`);
  if (top.score < 0.45) return null;
  const infos = scored.filter(c => c === top || c.score >= top.score - 0.12).slice(0, 8).map(c => {
    const dev = (c.g.involved_companies || []).filter(x => x.developer).map(x => x.company?.name).filter(Boolean).slice(0, 3).join(', ');
    const plats = (c.g.platforms || []).map(x => x.abbreviation).filter(Boolean).slice(0, 4).join('/');
    return {
      title: c.g.name, trusted: false, creator: dev,
      genres: (c.g.genres || []).map(x => x.name).slice(0, 4).join(', '),
      cover: c.g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${c.g.cover.image_id}.jpg` : '',
      sub: [c.y, plats, dev].filter(Boolean).join(' · '),
    };
  });
  const info = infos[0];
  if (infos.length > 1) info.choices = infos.map(plainChoice_);
  return info;
}

// ---------- key setup dialogs (step-by-step, with links) and the status on the Start Here tab ----------
const KEY_GUIDES = {
  tmdb: {
    title: 'Movies key (TMDB)', height: 560,
    why: 'Optional. With it, Movies get accurate posters, genres and directors. Without it, Movies fall back to Wikipedia, which misses some films. Free for personal use.',
    steps: [
      'Make a free account at <a href="https://www.themoviedb.org/signup" target="_blank">themoviedb.org/signup</a> and click the link in the confirmation email.',
      'Open <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org/settings/api</a> (profile picture → Settings → API).',
      'Under <b>Request an API Key</b>, click the link, choose <b>Developer</b>, and accept the terms.',
      'Fill in the form: Type of Use <b>Personal</b>, Application Name <b>Media Tracker</b>, Application URL <b>http://localhost</b>, Summary <b>Personal spreadsheet for tracking movies I have watched</b>. Submit.',
      'Back on the API page, copy the <b>API Key</b> (the short one). The long "API Read Access Token" works too.',
      'Paste it below and press <b>Save &amp; test</b>.',
    ],
    fields: [{ id: 'a', label: 'API Key' }],
  },
  igdb: {
    title: 'Games keys (IGDB)', height: 640,
    why: 'Optional. With it, Games work for every platform (Nintendo, PlayStation, Xbox, PC) with box art. Without it, only Steam games and some Wikipedia matches fill in. Free; IGDB is run by Twitch, which requires two-factor sign-in (a phone number).',
    steps: [
      'Sign in (or sign up) at <a href="https://www.twitch.tv" target="_blank">twitch.tv</a>, then turn on two-factor authentication: profile picture → Settings → Security and Privacy → <b>Set Up Two-Factor Authentication</b>.',
      'Open <a href="https://dev.twitch.tv/console/apps/create" target="_blank">dev.twitch.tv/console/apps/create</a> (Twitch Developers → Your Console → Applications → Register Your Application).',
      'Name: something nobody else has used, e.g. <b>media-tracker-</b> plus a few random letters and numbers. If the name is taken, the form fails without saying why.',
      'OAuth Redirect URLs: <b>http://localhost</b> (click Add). Category: <b>Application Integration</b>. Client Type: <b>Confidential</b>. Click <b>Create</b>.',
      'In the list of applications, click <b>Manage</b> next to yours. Copy the <b>Client ID</b>.',
      'Click <b>New Secret</b> and copy the <b>Client Secret</b> right away (Twitch only shows it once).',
      'Paste both below and press <b>Save &amp; test</b>.',
    ],
    fields: [{ id: 'a', label: 'Client ID' }, { id: 'b', label: 'Client Secret' }],
  },
};

function showKeyDialog_(service) {
  const g = KEY_GUIDES[service];
  const has = service === 'tmdb' ? !!tmdbKey_() : igdbKeys_();
  const html = `<!DOCTYPE html><html><head><base target="_top"><style>
    body{font:13px/1.5 Inter,Arial,sans-serif;color:#1b1b26;margin:14px 18px}
    .why{background:#f1f1f6;border-radius:8px;padding:8px 10px;margin-bottom:10px}
    ol{padding-left:20px;margin:0 0 12px} li{margin-bottom:6px} a{color:#3366cc}
    label{display:block;font-weight:600;margin:8px 0 2px} input{width:100%;box-sizing:border-box;padding:7px;font:13px monospace;border:1px solid #bbb;border-radius:6px}
    .row{display:flex;gap:8px;margin-top:12px} button{padding:8px 14px;border:0;border-radius:6px;cursor:pointer;font-weight:600}
    .go{background:#1f6b45;color:#fff} .rm{background:#eee} #msg{margin-top:10px;font-weight:600}
    .now{color:#555;margin-bottom:6px}
  </style></head><body>
  <div class="why">${g.why}</div>
  <div class="now">Current status: <b>${has ? 'key saved' : 'no key yet'}</b></div>
  <ol>${g.steps.map(x => `<li>${x}</li>`).join('')}</ol>
  ${g.fields.map(f => `<label for="${f.id}">${f.label}</label><input id="${f.id}" autocomplete="off" spellcheck="false">`).join('')}
  <div class="row"><button class="go" onclick="save()">Save &amp; test</button>
  ${has ? '<button class="rm" onclick="removeKey()">Remove saved key</button>' : ''}</div>
  <div id="msg"></div>
  <script>
    const v = id => (document.getElementById(id) || {}).value || '';
    function done(m){ document.getElementById('msg').innerHTML = m; }
    function save(){ done('Testing…'); google.script.run.withSuccessHandler(done).withFailureHandler(e => done('Error: ' + e.message)).saveKey('${service}', v('a'), v('b')); }
    function removeKey(){ google.script.run.withSuccessHandler(done).saveKey('${service}', '', ''); }
  </script></body></html>`;
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(g.height), g.title);
}

// Called by the key dialog.
function saveKey(service, a, b) {
  a = String(a || '').trim(); b = String(b || '').trim();
  const props = PropertiesService.getScriptProperties();
  let msg;
  if (service === 'tmdb') {
    if (!a) { props.deleteProperty('TMDB_KEY'); msg = 'Removed. Movies will use Wikipedia.'; }
    else {
      props.setProperty('TMDB_KEY', a);
      const code = tmdbFetch_('/search/movie?query=speed%20racer').getResponseCode();
      msg = code === 200 ? '<span style="color:#1f6b45">✓ Key works. Movies now use TMDB. You can close this window.</span>'
        : `<span style="color:#a33">TMDB said no (error ${code}). Check you copied the whole key, or wait a few minutes if you just made it.</span>`;
    }
  } else {
    if (!a && !b) { ['IGDB_ID', 'IGDB_SECRET', 'IGDB_TOKEN', 'IGDB_TOKEN_EXP'].forEach(k => props.deleteProperty(k)); msg = 'Removed. Games will use Steam and Wikipedia.'; }
    else if (!a || !b) return '<span style="color:#a33">Paste both the Client ID and the Client Secret.</span>';
    else {
      props.setProperties({ IGDB_ID: a, IGDB_SECRET: b });
      props.deleteProperty('IGDB_TOKEN');
      const res = igdbFetch_('fields name; limit 1; search "zelda";');
      msg = res.getResponseCode() === 200 ? '<span style="color:#1f6b45">✓ Keys work. Games now use IGDB. You can close this window.</span>'
        : `<span style="color:#a33">IGDB said no (error ${res.getResponseCode()}). Usually a mistyped secret: click New Secret in the Twitch console and paste the new one.</span>`;
    }
  }
  refreshSetupStatus_();
  return msg;
}

// Writes "set / not set" next to each item in the Start Here tab's status box.
function refreshSetupStatus_() {
  try {
    const sh = sheetById_(START_ID);
    if (!sh) return;
    // When the sheet is opening, Google doesn't let the script list its triggers, so fall back to the saved flag.
    let autofill;
    try { autofill = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'autoFillOnEdit'); }
    catch (err) { try { autofill = PropertiesService.getDocumentProperties().getProperty('AUTOFILL_ON') === 'yes'; } catch (e2) {} }
    const status = {
      'Auto-fill': autofill === undefined ? 'Reload the sheet to check' : autofill ? '✓ On' : '✗ Off: Setup → Turn on auto-fill',
      'Movies key (TMDB)': tmdbKey_() ? '✓ Saved' : '– Not set (optional)',
      'Games keys (IGDB)': igdbKeys_() ? '✓ Saved' : '– Not set (optional)',
      'Script version': '✓ ' + VERSION,
    };
    const labels = sh.getRange(1, 2, sh.getLastRow(), 1).getDisplayValues();
    labels.forEach((r, i) => {
      if (status[r[0]] === undefined) return;
      const ok = status[r[0]].startsWith('✓');
      sh.getRange(i + 1, 3).setValue(status[r[0]]).setFontColor(ok ? '#7ee2a8' : r[0] === 'Auto-fill' ? '#ff8a8a' : '#a6a6bb');
    });
  } catch (err) { console.warn(`Status refresh failed: ${err}`); }
}

// ---------- Songs: Deezer track search (free, no key) and pasted Spotify song links ----------
function deezerTrack_(term, typedTitle, hint, log) {
  const { name: typedName } = splitYear_(typedTitle || term);
  const q = hint ? `artist:"${hint}" track:"${typedName}"` : typedName;
  const res = UrlFetchApp.fetch('https://api.deezer.com/search/track?limit=40&q=' + encodeURIComponent(q), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { if (log) log.push(`Deezer: HTTP ${res.getResponseCode()}`); return null; }
  const body = JSON.parse(res.getContentText());
  const results = body.data || [];
  if (log) log.push(`Deezer song search "${q}": ${results.length} results`
    + results.slice(0, 6).map(t => `\n   • ${t.title} | ${t.artist?.name} | ${t.album?.title}`).join(''));
  if (!results.length) return null;
  const clean = t => String(t || '').replace(/\s*[\(\[][^\)\]]*(remaster|version|edit|mono|stereo|live)[^\)\]]*[\)\]]/gi, '').replace(/\s+-\s+.*remaster.*$/i, '').trim();
  const target = normTitle_(typedName);
  const seen = new Set(), scored = [];
  const ranks = results.map(t => t.rank || 0).sort((a, b) => b - a);
  results.forEach(t => {
    const title = clean(t.title_short || t.title), who = t.artist?.name || '';
    const key = normTitle_(title) + '|' + normTitle_(who);
    if (!title || seen.has(key)) return; // same song on several albums: keep the most popular
    seen.add(key);
    const name = normTitle_(title), w = normTitle_(who);
    const titleSim = Math.max(similarity_(target, name), similarity_(target, `${w} ${name}`), similarity_(target, `${name} ${w}`));
    let score = hint ? 0.7 * titleSim + 0.3 * similarity_(normTitle_(hint), w) : titleSim;
    score += 0.15 * (1 - ranks.indexOf(t.rank || 0) / results.length); // popular versions first
    scored.push({ t, title, who, score });
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (log) log.push(`Best match: ${top.title} / ${top.who} (score ${top.score.toFixed(2)}; needs 0.45)`);
  if (top.score < 0.45) return null;
  const infos = scored.filter(c => c === top || c.score >= top.score - 0.1).slice(0, 8).map((c, i) => {
    let genres = '', year = '';
    if (i < 4 && c.t.album?.id) {
      try {
        const al = JSON.parse(UrlFetchApp.fetch(`https://api.deezer.com/album/${c.t.album.id}`, { muteHttpExceptions: true }).getContentText());
        genres = (al.genres?.data || []).map(g => g.name).join(', ');
        year = (al.release_date || '').slice(0, 4);
      } catch (err) { /* optional */ }
    }
    return { title: c.title, trusted: false, creator: c.who, album: c.t.album?.title || '', genres,
             cover: c.t.album?.cover_xl || c.t.album?.cover_big || '', sub: [c.who, c.t.album?.title, year].filter(Boolean).join(' · ') };
  });
  const info = infos[0];
  if (infos.length > 1) info.choices = infos.map(plainChoice_);
  return info;
}
function spotifyTrack_(id) {
  const url = 'https://open.spotify.com/track/' + id;
  const meta = (html, prop) => {
    const m = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i').exec(html)
      || new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, 'i').exec(html);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"') : '';
  };
  let title = '', artist = '', album = '', year = '', cover = '';
  const page = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (page.getResponseCode() === 200) {
    const html = page.getContentText();
    // og:title "Song - song and lyrics by Artist | Spotify"; og:description "Artist · Album · Song · 2023"
    const t = /^(?:Listen to )?(.*?) - song(?: and lyrics)? by (.*?)(?: \| Spotify)?$/i.exec(meta(html, 'og:title'));
    if (t) { title = t[1]; artist = t[2]; }
    const d = meta(html, 'og:description').split(' · ');
    if (d.length >= 3) { if (!artist) artist = d[0]; album = d[1]; year = (d.find(x => /^\d{4}$/.test(x)) || ''); }
    cover = meta(html, 'og:image');
  }
  if (!title || !cover) {
    const o = UrlFetchApp.fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(url), { muteHttpExceptions: true });
    if (o.getResponseCode() === 200) {
      const j = JSON.parse(o.getContentText());
      title = title || j.title || '';
      cover = cover || String(j.thumbnail_url || '').replace('ab67616d00001e02', 'ab67616d0000b273');
    }
  }
  if (!title) return null;
  return { title, creator: artist, album, genres: '', cover, trusted: true, sub: [artist, album, year].filter(Boolean).join(' · ') };
}

// ---------- Settings tab: show/hide tabs and color themes ----------
const THEMES = {
  Midnight: { 'Background': '#1b1b25', 'Alternate rows': '#1f1f2c', 'Header row': '#13131c', 'Cards': '#232339', 'Panels': '#2a2a3b',
              'Text': '#e6e6ed', 'Bright text': '#ffffff', 'Muted text': '#a6a6bb', 'Grid lines': '#2e2e3e', 'Highlight': '#ffd166' },
  Light:    { 'Background': '#ffffff', 'Alternate rows': '#f4f5f8', 'Header row': '#e6e8ef', 'Cards': '#f7f7fb', 'Panels': '#e9e9f2',
              'Text': '#2a2b33', 'Bright text': '#111216', 'Muted text': '#6b6e7b', 'Grid lines': '#d9dbe3', 'Highlight': '#b7791f' },
  Ocean:    { 'Background': '#0f1c2b', 'Alternate rows': '#132235', 'Header row': '#0a1420', 'Cards': '#16283d', 'Panels': '#1c3049',
              'Text': '#e3eef8', 'Bright text': '#ffffff', 'Muted text': '#93a9bf', 'Grid lines': '#24384f', 'Highlight': '#5fd4ff' },
  Forest:   { 'Background': '#141d17', 'Alternate rows': '#18241c', 'Header row': '#0e1510', 'Cards': '#1c2b21', 'Panels': '#223327',
              'Text': '#e4efe6', 'Bright text': '#ffffff', 'Muted text': '#9bb3a1', 'Grid lines': '#2a3d30', 'Highlight': '#c8e06b' },
  Sakura:   { 'Background': '#fff7f9', 'Alternate rows': '#fdeef2', 'Header row': '#f8dde5', 'Cards': '#fff0f4', 'Panels': '#f6e1e8',
              'Text': '#3a2730', 'Bright text': '#2a1a22', 'Muted text': '#8d6b78', 'Grid lines': '#efd3dc', 'Highlight': '#d6457a' },
};
// Shades used before themes existed; they are treated as the matching Midnight color.
const LEGACY_SHADES = { 'Background': ['#1b1b26'], 'Alternate rows': ['#20202d'], 'Header row': ['#14141c'], 'Panels': ['#22222f'],
  'Text': ['#e6e6ee'], 'Muted text': ['#a6a6bc', '#9a9aaf', '#89899f', '#b8b8cc', '#c4c4d2', '#9a9ab0'] };
const COLOR_KEYS = Object.keys(THEMES.Midnight);
// Colors used by the automatic highlights (rating scale, status, duplicates). Dark themes need deep tones
// behind white text; light themes need soft tints behind dark text.
const CF_SETS = {
  Midnight: { low: '#6b2a35', mid: '#6b5a22', high: '#1f6b45', done: '#1f3d2c', active: '#1e3350', hold: '#4a3f1c', dropped: '#4a2026', dup: '#5a1f2a' },
  Light:    { low: '#f4c7c3', mid: '#fce8b2', high: '#b7e1cd', done: '#d9f2e3', active: '#dbe8fb', hold: '#fbefcf', dropped: '#f9d9dc', dup: '#f6c9cf' },
  Ocean:    { low: '#5e2b3a', mid: '#5c5426', high: '#1d5e55', done: '#173a34', active: '#173556', hold: '#3f3a1c', dropped: '#45202b', dup: '#4f1f2c' },
  Forest:   { low: '#5e2c2c', mid: '#5f5720', high: '#2f6a3a', done: '#1f3d26', active: '#1d3445', hold: '#47401c', dropped: '#472224', dup: '#562126' },
  Sakura:   { low: '#f6c6cf', mid: '#fbe6bf', high: '#cfe8d2', done: '#e2f3e5', active: '#e3ebfa', hold: '#fbf0d6', dropped: '#f9dbe1', dup: '#f5c2cf' },
};
const CF_LEGACY = { done: ['#1f3c2c'], active: ['#1e3350'], hold: ['#4a3e1c'], dropped: ['#4a1f25'], dup: ['#5a1f2a'] };
function cfSetFor_(themeName, colors) {
  if (CF_SETS[themeName]) return CF_SETS[themeName];
  const bg = colors['Background'] || '#1b1b25';
  const lum = [1, 3, 5].reduce((a, i) => a + parseInt(bg.substr(i, 2), 16), 0) / 3;
  return lum > 128 ? CF_SETS.Light : CF_SETS.Midnight; // custom colors: pick by how light the background is
}
const TAB_SWITCHES = { 'Movies': 1, 'TV Shows': 2, 'TV Seasons': 12, 'Anime Seasons': 9, 'Albums': 3, 'Songs': 13, 'Games': 4, 'Books': 5 };

function showSettings() { const sh = sheetById_(SETTINGS_ID); if (sh) sh.activate(); }

// Reads the Settings tab by its labels in column B, so rows can be moved around safely.
function readSettings_() {
  const sh = sheetById_(SETTINGS_ID);
  if (!sh) return null;
  const vals = sh.getRange(1, 2, sh.getLastRow(), 2).getValues();
  const out = { tabs: {}, colors: {}, theme: 'Midnight', rows: {}, compareStyle: 'Meet in the middle', compareAsk: 'Both', compareWindow: 1 };
  vals.forEach((r, i) => {
    const label = String(r[0]).trim();
    out.rows[label] = i + 1;
    if (label in TAB_SWITCHES) out.tabs[label] = r[1] === true;
    if (label === 'Theme') out.theme = String(r[1] || 'Midnight');
    if (COLOR_KEYS.includes(label)) out.colors[label] = String(r[1] || '').trim().toLowerCase();
    if (label === 'Re-rating style') out.compareStyle = String(r[1] || 'Meet in the middle');
    if (label === 'Ask to compare') out.compareAsk = String(r[1] || 'Both');
    if (label === "When there's no room") out.compareRoom = String(r[1] || 'Use in-between scores');
    if (label === 'Compare within') out.compareWindow = Number(r[1]) > 0 ? Number(r[1]) : 1;
  });
  return out;
}

function onSettingsEdit_(e) {
  const sh = e.range.getSheet();
  const label = String(sh.getRange(e.range.getRow(), 2).getValue()).trim();
  const ss = SpreadsheetApp.getActive();
  if (label in TAB_SWITCHES) { applyTabs_(readSettings_()); ss.toast('Tabs updated.', 'Settings', 3); return; }
  if (label === 'Theme') {
    const t = THEMES[String(e.range.getValue())];
    if (t) { // copy the theme's colors into the list, then repaint
      const st = readSettings_();
      COLOR_KEYS.forEach(k => { if (st.rows[k]) sh.getRange(st.rows[k], 3).setValue(t[k]); });
    }
    ss.toast('Applying colors… (takes a few seconds)', 'Settings', 5);
    applyTheme_(readSettings_());
    ss.toast('Colors applied.', 'Settings', 3);
    return;
  }
  if (COLOR_KEYS.includes(label)) {
    const st = readSettings_();
    if (st.rows['Theme']) sh.getRange(st.rows['Theme'], 3).setValue('Custom');
    ss.toast('Applying colors…', 'Settings', 5);
    applyTheme_(readSettings_());
    ss.toast('Colors applied.', 'Settings', 3);
  }
}

// Menu: Media Tracker → Setup → Apply settings
function applySettings() {
  const st = readSettings_();
  if (!st) { SpreadsheetApp.getUi().alert('The Settings tab is missing.'); return; }
  applyTabs_(st);
  applyTheme_(st);
  SpreadsheetApp.getActive().toast('Settings applied.', 'Settings', 4);
}

function applyTabs_(st) {
  const ss = SpreadsheetApp.getActive();
  for (const [label, id] of Object.entries(TAB_SWITCHES)) {
    const sh = sheetById_(id);
    if (!sh || !(label in st.tabs)) continue;
    const want = st.tabs[label];
    if (want && sh.isSheetHidden()) sh.showSheet();
    if (!want && !sh.isSheetHidden()) {
      if (ss.getActiveSheet().getSheetId() === id) (sheetById_(SETTINGS_ID) || ss.getSheets()[0]).activate();
      sh.hideSheet();
    }
  }
  // The Songs block on Top 5 has its own rows (20-27), so it can disappear with the Songs tab.
  const top5 = sheetById_(TOP5_ID);
  if (top5 && 'Songs' in st.tabs) {
    if (st.tabs['Songs']) top5.showRows(20, 8); else top5.hideRows(20, 8);
  }
  // The Season Avg column only makes sense while its Seasons tab is shown.
  [['anime', 'Anime Seasons'], ['tv', 'TV Seasons']].forEach(([key, label]) => {
    const sh = sheetFor_(key);
    if (!sh || !(label in st.tabs)) return;
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
    const c = headers.indexOf('Season Avg') + 1;
    if (!c) return;
    if (st.tabs[label]) sh.showColumns(c); else sh.hideColumns(c);
  });
}

function hexOk_(h) { return /^#[0-9a-f]{6}$/i.test(h); }
function hexDist_(a, b) {
  const p = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const x = p(a), y = p(b);
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
}

// Repaints every tab: each color that belongs to the old theme becomes the same role's new color.
// Accent colors (tab colors, Top 5 headers, status and rating colors) are left as they are.
function applyTheme_(st) {
  // One repaint at a time: switching themes quickly used to start a second run while the first
  // was halfway through. The waiting run re-reads Settings so it applies whatever was picked last.
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5 * 60 * 1000)) { SpreadsheetApp.getActive().toast('Still busy repainting; try again in a minute.', 'Settings', 6); return; }
  try { st = readSettings_() || st; applyThemeLocked_(st); } finally { lock.releaseLock(); }
}

function applyThemeLocked_(st) {
  const props = PropertiesService.getDocumentProperties();
  const to = {};
  COLOR_KEYS.forEach(k => { to[k] = hexOk_(st.colors[k] || '') ? st.colors[k] : THEMES.Midnight[k]; });
  const from = JSON.parse(props.getProperty('THEME_NOW') || 'null') || THEMES.Midnight;
  const cfFrom = JSON.parse(props.getProperty('THEME_CF_NOW') || 'null') || CF_SETS.Midnight;
  const cfTo = cfSetFor_(st.theme, to);
  // Fills only map to fill roles and text only to text roles: an empty cell reads as white (#ffffff),
  // which must never be mistaken for white text.
  const FILL_ROLES = ['Background', 'Alternate rows', 'Header row', 'Cards', 'Panels'];
  const TEXT_ROLES = ['Text', 'Bright text', 'Muted text', 'Highlight'];
  // A color is recognised by its role in ANY theme (plus the last custom colors), so a tab that missed
  // an earlier switch is still repainted correctly instead of being left behind.
  const palettes = [from, ...Object.values(THEMES)];
  const pairsFor = roles => {
    const out = [];
    palettes.forEach(pal => roles.forEach(k => { if (pal[k]) out.push([pal[k].toLowerCase(), k]); }));
    roles.forEach(k => (LEGACY_SHADES[k] || []).forEach(h => out.push([h, k])));
    return out;
  };
  const fillPairs = pairsFor(FILL_ROLES), textPairs = pairsFor(TEXT_ROLES);
  const mapWith = pairs => c => {
    if (!c || c[0] !== '#' || c.length !== 7) return null;
    c = c.toLowerCase();
    let best = null, bestD = 7; // only near-exact matches count
    for (const [h, k] of pairs) { const d = hexDist_(c, h); if (d < bestD) { bestD = d; best = k; if (!d) break; } }
    return best ? to[best] : null;
  };
  const mapFill = mapWith(fillPairs), mapText = mapWith(textPairs);
  const skip = new Set([SETTINGS_ID]); // the Settings page is repainted separately below
  const failed = [];
  SpreadsheetApp.getActive().getSheets().forEach(sh => {
    if (skip.has(sh.getSheetId())) return;
    try { repaintSheet_(sh); } catch (err) { failed.push(sh.getName()); console.warn(`Theme: ${sh.getName()} failed: ${err}`); }
  });
  function repaintSheet_(sh) {
    const rng = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
    const bgs = rng.getBackgrounds(), fgs = rng.getFontColors();
    let changed = false;
    const nb = bgs.map(r => r.map(c => { const m = mapFill(c); if (m && m !== c) { changed = true; return m; } return c; }));
    const nf = fgs.map(r => r.map(c => { const m = mapText(c); if (m && m !== c) { changed = true; return m; } return c; }));
    if (changed) { rng.setBackgrounds(nb); rng.setFontColors(nf); }
    recolorRules_(sh, cfFrom, cfTo);
    sh.getBandings().forEach(b => b.setHeaderRowColor(to['Header row']).setFirstRowColor(to['Background']).setSecondRowColor(to['Alternate rows']));
    if (cfgOf_(sh) || sh.getSheetId() === 9 || sh.getSheetId() === 12) { // list tabs: grid lines, then the accent line under the headers
      const used = sh.getRange(1, 1, sh.getMaxRows(), sh.getLastColumn());
      used.setBorder(true, true, true, true, true, true, to['Grid lines'], SpreadsheetApp.BorderStyle.SOLID);
      sh.getRange(1, 1, 1, sh.getLastColumn()).setBorder(null, null, true, null, null, null, sh.getTabColor() || to['Highlight'], SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    }
    SpreadsheetApp.flush();
  }
  if (failed.length) SpreadsheetApp.getActive().toast(`Couldn't recolor: ${failed.join(', ')}. Use Setup → Apply settings to try again.`, 'Settings', 10);
  // Settings tab: page colors + a swatch behind each color code.
  const set = sheetById_(SETTINGS_ID);
  if (set) {
    const rng = set.getRange(1, 1, set.getMaxRows(), set.getMaxColumns());
    const bgs = rng.getBackgrounds(), fgs = rng.getFontColors();
    rng.setBackgrounds(bgs.map(r => r.map(c => mapFill(c) || c)));
    rng.setFontColors(fgs.map(r => r.map(c => mapText(c) || c)));
    COLOR_KEYS.forEach(k => {
      const row = st.rows[k];
      if (!row) return;
      const h = to[k];
      const lum = [1, 3, 5].reduce((a, i) => a + parseInt(h.substr(i, 2), 16), 0) / 3;
      set.getRange(row, 3).setBackground(h).setFontColor(lum > 140 ? '#111111' : '#ffffff');
    });
  }
  props.setProperty('THEME_NOW', JSON.stringify(to));
  props.setProperty('THEME_CF_NOW', JSON.stringify(cfTo));
}

// Swaps the colors of the automatic highlights on one tab: the 1-10 rating scale and the
// status / duplicate fills. Rules with other colors (Top 5 rank medals, etc.) are left alone.
function recolorRules_(sh, cfFrom, cfTo) {
  const rules = sh.getConditionalFormatRules();
  if (!rules.length) return;
  const roles = ['done', 'active', 'hold', 'dropped', 'dup'];
  const match = hex => {
    if (!hex) return null;
    hex = hex.toLowerCase();
    let best = null, bestD = 10;
    roles.forEach(k => [cfFrom[k], ...(CF_LEGACY[k] || []), ...Object.values(CF_SETS).map(set => set[k])].forEach(h => {
      const d = hexDist_(hex, h.toLowerCase()); if (d < bestD) { bestD = d; best = k; }
    }));
    return best;
  };
  let changed = false;
  const out = rules.map(rule => {
    const g = rule.getGradientCondition();
    if (g) {
      changed = true;
      return rule.copy()
        .setGradientMinpointWithValue(cfTo.low, SpreadsheetApp.InterpolationType.NUMBER, '1')
        .setGradientMidpointWithValue(cfTo.mid, SpreadsheetApp.InterpolationType.NUMBER, '6')
        .setGradientMaxpointWithValue(cfTo.high, SpreadsheetApp.InterpolationType.NUMBER, '10')
        .build();
    }
    const b = rule.getBooleanCondition();
    let bg = null;
    try { bg = b && b.getBackgroundObject() ? b.getBackgroundObject().asRgbColor().asHexString() : null; } catch (err) {}
    const role = match(bg);
    if (!role) return rule;
    changed = true;
    return rule.copy().setBackground(cfTo[role]).build();
  });
  if (changed) sh.setConditionalFormatRules(out);
}

// ---------- Compare ratings: pick the better of two, and the scores adjust ----------
const QUEUE_KEY = 'COMPARE_QUEUE';

function compareSettings_() {
  const st = readSettings_() || {};
  return { style: st.compareStyle || 'Meet in the middle', ask: st.compareAsk || 'Both', window: st.compareWindow || 1,
           room: st.compareRoom || 'Use in-between scores' };
}
function readQueue_() { try { return JSON.parse(PropertiesService.getDocumentProperties().getProperty(QUEUE_KEY) || '[]'); } catch (e) { return []; } }
function writeQueue_(q) { PropertiesService.getDocumentProperties().setProperty(QUEUE_KEY, JSON.stringify(q.slice(-50))); }

// A rating typed by hand (one cell) gets queued so it can be checked against its neighbours.
function queueNewRating_(e, sheet, cfg, cols) {
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1 || e.range.getRow() < 2) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  if (e.range.getColumn() !== headers.indexOf('Rating') + 1) return false;
  const value = e.range.getValue();
  if (typeof value !== 'number') return true;
  const cs = compareSettings_();
  if (cs.ask !== 'Both' && cs.ask !== 'Only for new ratings') return true;
  const title = String(sheet.getRange(e.range.getRow(), cols.title).getValue() || '').trim();
  if (!title) return true;
  const q = readQueue_().filter(x => !(x.key === cfg.key && x.title === title));
  q.push({ key: cfg.key, title });
  writeQueue_(q);
  SpreadsheetApp.getActive().toast(`Want to double-check "${title}" against similar ratings? Media Tracker → Compare ratings (${q.length} waiting).`, 'Compare', 8);
  return true;
}

function getCompareWaiting() {
  const cs = compareSettings_();
  return cs.ask === 'Both' || cs.ask === 'Only for new ratings' ? readQueue_().length : 0;
}

function openCompareDialog() {
  const cs = compareSettings_();
  const tabs = Object.keys(TABS).map(key => {
    const sh = sheetFor_(key);
    if (!sh || sh.isSheetHidden()) return null;
    const n = getRatedItems(key).length;
    return n >= 2 ? { key, name: sh.getName(), count: n } : null;
  }).filter(Boolean);
  // Drop waiting items that were deleted or un-rated since.
  const queue = readQueue_().filter(q => TABS[q.key] && getRatedItems(q.key).some(i => i.title === q.title))
    .map(q => Object.assign(q, { tabName: sheetFor_(q.key).getName() }));
  writeQueue_(queue.map(q => ({ key: q.key, title: q.title })));
  const setup = { style: cs.style, ask: cs.ask, window: cs.window, room: cs.room,
    queue: (cs.ask === 'Both' || cs.ask === 'Only for new ratings') ? queue : [], tabs, unrated: getUnratedCompleted_() };
  const html = COMPARE_HTML.replace('__SETUP__', JSON.stringify(setup).replace(/</g, '\\u003c'));
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(780).setHeight(600), 'Compare ratings');
}

// Every rated row on a tab, best first.
function getRatedItems(key) {
  const sh = sheetFor_(key), cfg = cfgFor_(key);
  if (!sh || sh.getLastRow() < 2) return [];
  const cols = findColumns_(sh, cfg);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const rc = headers.indexOf('Rating') + 1;
  if (!cols || !rc) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  return vals.map((r, i) => ({ row: i + 2, title: String(r[cols.title - 1] || '').trim(), rating: r[rc - 1],
      cover: biggerCover_(String(r[cols.cover - 1] || '')), square: !!cfg.square }))
    .filter(x => x.title && typeof x.rating === 'number')
    .sort((a, b) => b.rating - a.rating || a.row - b.row);
}

// Titles with no rating yet that you've finished: Status "Completed", or any row on tabs without a
// Status column (Movies, Albums, Songs), since being on those lists means you've seen or heard it.
function getUnratedCompleted_() {
  const out = [];
  Object.keys(TABS).forEach(key => {
    const sh = sheetFor_(key), cfg = cfgFor_(key);
    if (!sh || sh.isSheetHidden() || sh.getLastRow() < 2) return;
    const cols = findColumns_(sh, cfg);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
    const rc = headers.indexOf('Rating') + 1, sc = headers.indexOf('Status') + 1;
    if (!cols || !rc) return;
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    vals.forEach((r, i) => {
      const title = String(r[cols.title - 1] || '').trim();
      if (!title || typeof r[rc - 1] === 'number' || String(r[rc - 1]).trim() !== '') return;
      if (sc && String(r[sc - 1]).trim() !== 'Completed') return;
      out.push({ key, tabName: sh.getName(), row: i + 2, title, cover: biggerCover_(String(r[cols.cover - 1] || '')), square: !!cfg.square });
    });
  });
  return out.slice(0, 300);
}

// Called by the dialog when you press Save.
function saveRatings(key, changes, doneTitle) {
  const sh = sheetFor_(key), cfg = cfgFor_(key);
  const cols = findColumns_(sh, cfg);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const rc = headers.indexOf('Rating') + 1;
  let n = 0;
  (changes || []).forEach(c => {
    let row = c.row;
    if (String(sh.getRange(row, cols.title).getValue()).trim() !== c.title) row = findRowByTitle_(sh, c.title);
    if (!row) return;
    sh.getRange(row, rc).setValue(c.rating);
    n++;
  });
  if (doneTitle) writeQueue_(readQueue_().filter(q => !(q.key === key && q.title === doneTitle)));
  return n;
}
function dropFromQueue(key, title) { writeQueue_(readQueue_().filter(q => !(q.key === key && q.title === title))); }

const COMPARE_HTML = `<!DOCTYPE html><html><head><base target="_top"><style>
  body{margin:0;font-family:Arial,sans-serif;background:#1B1B26;color:#fff}
  .w{padding:18px 22px}
  h2{margin:0 0 4px;font-size:20px} .sub{color:#A6A6BB;font-size:13px;margin-bottom:14px}
  .pair{display:flex;gap:18px;justify-content:center;margin:8px 0 14px}
  .card{width:300px;background:#232339;border:3px solid transparent;border-radius:12px;padding:12px;cursor:pointer;text-align:center;transition:border-color .1s}
  .card:hover{border-color:#FFD166}
  .card img{width:180px;height:260px;object-fit:cover;border-radius:8px;background:#2A2A3B}
  .card img.sq{height:180px}
  .card .t{font-weight:bold;font-size:15px;margin-top:10px;line-height:1.3}
  .card .r{color:#A6A6BB;font-size:12px;margin-top:4px}
  .btns{display:flex;gap:10px;justify-content:center}
  button{background:#2A2A3B;color:#E6E6ED;border:0;border-radius:8px;padding:9px 16px;font-size:13px;cursor:pointer}
  button.go{background:#1F6B45;color:#fff;font-weight:bold} button:hover{filter:brightness(1.2)}
  .tabs button{margin:4px;min-width:180px}
  .prog{color:#A6A6BB;font-size:12px;text-align:center;margin-top:12px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 14px} td{padding:5px 6px;border-bottom:1px solid #2E2E3E}
  .up{color:#7EE2A8} .down{color:#FF8A8A} .list{max-height:330px;overflow:auto}
  .key{color:#6c6c88;font-size:11px;text-align:center;margin-top:6px}
</style></head><body><div class="w" id="v"></div>
<script>
const S = __SETUP__;
const v = document.getElementById('v');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const id = x => x.row + '|' + x.title;
const pk = (a, b) => [id(a), id(b)].sort().join('~');
const call = (fn, ...args) => new Promise((ok, bad) => google.script.run.withSuccessHandler(ok).withFailureHandler(bad)[fn](...args));
let answer = null, asked = 0;
// Undo: every pick is recorded. "Back" reruns the current list from the start, replaying all picks but
// the last one instantly, so you land on the question you got wrong with everything else kept.
let history = [], replay = [], current = null;
const cache = {};
async function loadItems(key) { if (!cache[key]) cache[key] = await call('getRatedItems', key); return cache[key]; }
function startRun(fn, args) { history = []; current = { fn, args }; rerun(); }
function rerun() { replay = history.slice(); history = []; asked = 0; current.fn(...current.args); }
function back() { if (!history.length) return; history.pop(); rerun(); }

// Shows two things side by side and waits: 'a' (first is better), 'b', 'same', 'skip' or 'stop'.
function ask(a, b, title, progress) {
  asked++;
  if (replay.length) { const r = replay.shift(); history.push(r); return Promise.resolve(r); }
  const flip = Math.random() < 0.5; // don't always put the higher-rated one on the left
  const L = flip ? b : a, R = flip ? a : b;
  const card = (x, side) => '<div class="card" onclick="pickSide(\\'' + side + '\\')"><img class="' + (x.square ? 'sq' : '') + '" src="' + esc(x.cover) + '" onerror="this.style.visibility=\\'hidden\\'">'
    + '<div class="t">' + esc(x.title) + '</div><div class="r">' + (x.rating == null ? 'not rated yet' : 'now ' + esc(x.rating)) + '</div></div>';
  v.innerHTML = '<h2>' + esc(title) + '</h2><div class="sub">Which one do you think is better? Click it.</div>'
    + '<div class="pair">' + card(L, 'L') + card(R, 'R') + '</div>'
    + '<div class="btns"><button onclick="pickSide(\\'back\\')"' + (history.length ? '' : ' disabled style="opacity:.35;cursor:default"') + '>← Back</button><button onclick="pickSide(\\'same\\')">About the same</button><button onclick="pickSide(\\'skip\\')">Skip</button>'
    + '<button onclick="pickSide(\\'stop\\')">Stop and review</button></div>'
    + '<div class="prog">' + esc(progress || '') + '</div><div class="key">Keyboard: ← left · → right · ↓ same · S skip · Backspace back</div>';
  return new Promise(res => { answer = side => {
    if (side === 'back') { if (history.length) { answer = null; back(); } return; }
    answer = null;
    const r = side === 'L' ? (flip ? 'b' : 'a') : side === 'R' ? (flip ? 'a' : 'b') : side;
    if (r !== 'stop') history.push(r);
    res(r);
  }; });
}
function pickSide(s) { if (answer) answer(s); }
document.addEventListener('keydown', e => {
  const k = { ArrowLeft: 'L', ArrowRight: 'R', ArrowDown: 'same', s: 'skip', S: 'skip', Backspace: 'back' }[e.key];
  if (k) { e.preventDefault(); pickSide(k); }
});

// New ratings for an order the person chose. Works in tenths (hundredths if any score has two decimals),
// so untouched scores stay exactly as they are and new ones look like the ones you type.
function rescore(order, better, ties) {
  const U = order.every(o => Math.abs(o.rating * 10 - Math.round(o.rating * 10)) < 1e-6) ? 10 : 100, G = U / 10;
  const n = order.length, r = order.map(o => Math.round(o.rating * U)), strict = [];
  for (let i = 0; i < n - 1; i++) {
    const a = order[i], b = order[i + 1];
    if (ties.has(pk(a, b))) strict[i] = false;
    else if (better.has(id(a) + '>' + id(b))) strict[i] = true;
    else if (r[i] === r[i + 1]) strict[i] = false;
    else strict[i] = true;
  }
  let v;
  if (S.style === 'Swap the numbers') {
    v = r.slice().sort((x, y) => y - x);
  } else {
    // "Meet in the middle": the smallest changes that put things in the chosen order, 0.1 apart.
    const k = [0]; for (let i = 1; i < n; i++) k[i] = k[i - 1] + (strict[i - 1] ? G : 0);
    const s = r.map((x, i) => x + k[i]);
    let blocks = [];
    for (let i = 0; i < n; i++) {
      if (i > 0 && !strict[i - 1]) { const b = blocks[blocks.length - 1]; b.sum += s[i]; b.w++; b.end = i; }
      else blocks.push({ sum: s[i], w: 1, start: i, end: i });
    }
    const st = [];
    blocks.forEach(b => {
      st.push(b);
      while (st.length > 1 && st[st.length - 2].sum / st[st.length - 2].w < st[st.length - 1].sum / st[st.length - 1].w) {
        const top = st.pop(), prev = st.pop();
        st.push({ sum: prev.sum + top.sum, w: prev.w + top.w, start: prev.start, end: top.end });
      }
    });
    v = new Array(n);
    st.forEach(b => { for (let i = b.start; i <= b.end; i++) v[i] = Math.round(b.sum / b.w - k[i]); });
  }
  // Tied neighbours share a score; then keep everything in order and within 1-10.
  for (let i = 0; i < n;) { let j = i; while (j < n - 1 && !strict[j]) j++;
    if (j > i) { const avg = Math.round(v.slice(i, j + 1).reduce((x, y) => x + y, 0) / (j - i + 1)); for (let t = i; t <= j; t++) v[t] = avg; }
    i = j + 1; }
  v[0] = Math.min(v[0], 10 * U);
  for (let i = 1; i < n; i++) v[i] = strict[i - 1] ? Math.min(v[i], v[i - 1] - (S.style === 'Swap the numbers' ? 0 : G)) : Math.min(v[i], v[i - 1]);
  return order.map((o, i) => ({ row: o.row, title: o.title, old: o.isNew ? '—' : o.rating, isNew: !!o.isNew, rating: Math.max(0, v[i]) / U }))
    .filter(c => c.isNew || Math.round(c.old * U) !== Math.round(c.rating * U));
}

// Placing ONE title (a new or unrated one): only that title's score changes. Everything else keeps
// its score, so filling the top of a list never pushes good stuff further down. If the two neighbours
// are too close for a whole-tenth score in between, Settings → "When there's no room" decides:
// an in-between score like 9.45, or the same score as the one just above.
function placeScore(order, idx, tie) {
  const me = order[idx], above = order[idx - 1], below = order[idx + 1];
  const keep = (val) => {
    const old = me.isNew ? null : me.rating;
    return old != null && Math.round(old * 100) === Math.round(val * 100) ? []
      : [{ row: me.row, title: me.title, old: me.isNew ? '—' : old, isNew: !!me.isNew, rating: val }];
  };
  if (S.room === 'Push others down') return null; // use the old whole-list re-score
  if (tie) return keep(tie.rating);
  const hi = above ? above.rating : null, lo = below ? below.rating : null;
  const r = me.isNew ? null : me.rating;
  if (r != null && (hi == null || r < hi) && (lo == null || r > lo)) return keep(r); // already fits
  const r10 = x => Math.round(x * 10) / 10, r100 = x => Math.round(x * 100) / 100;
  if (hi == null) { const t = Math.min(10, r10(lo + 0.2)); return keep(t > lo ? t : 10); }
  if (lo == null) return keep(Math.max(0, r10(hi - 0.3)));
  const mid = (hi + lo) / 2, t = r10(mid);
  if (t < hi && t > lo) return keep(t);
  if (S.room === 'Give the same score' || hi - lo < 0.02) return keep(hi);
  return keep(r100(mid)); // e.g. 9.45 between 9.5 and 9.4
}

function review(key, changes, doneTitle, next) {
  if (!changes.length) {
    v.innerHTML = '<h2>All good</h2><div class="sub">Your ratings already match your picks' + (asked ? '' : ' (nothing close enough to compare)') + '. Nothing changes.</div><div class="btns">' + (history.length ? '<button id="bk">← Back to last pick</button>' : '') + '<button class="go" id="ok">' + (next ? 'Next' : 'Close') + '</button></div>';
    if (history.length) document.getElementById('bk').onclick = back;
    document.getElementById('ok').onclick = () => { if (doneTitle) call('dropFromQueue', key, doneTitle); next ? next() : google.script.host.close(); };
    return;
  }
  v.innerHTML = '<h2>New ratings</h2><div class="sub">Based on your picks (' + esc(S.style.toLowerCase()) + '). Nothing is saved until you press Save.</div>'
    + '<div class="list"><table>' + changes.map(c => '<tr><td>' + esc(c.title) + '</td><td>' + c.old + '</td><td>→</td><td class="' + (c.isNew || c.rating > c.old ? 'up' : 'down') + '"><b>' + c.rating + '</b></td></tr>').join('') + '</table></div>'
    + '<div class="btns">' + (history.length ? '<button id="bk">← Back to last pick</button>' : '') + '<button class="go" id="save">Save new ratings</button><button id="no">Don\\'t save</button></div>';
  if (history.length) document.getElementById('bk').onclick = back;
  document.getElementById('save').onclick = async () => {
    v.innerHTML = '<div class="sub">Saving…</div>';
    await call('saveRatings', key, changes, doneTitle || '');
    delete cache[key];
    next ? next() : (v.innerHTML = '<h2>Saved</h2><div class="sub">Top 5 and Stats update by themselves.</div><div class="btns"><button onclick="google.script.host.close()">Close</button></div>');
  };
  document.getElementById('no').onclick = () => next ? next() : google.script.host.close();
}

// Goes down the whole list; each item climbs past the ones above it for as long as you prefer it.
async function fullPass(key, name) {
  v.innerHTML = '<div class="sub">Loading ' + esc(name) + '…</div>';
  const items = await loadItems(key);
  const order = [items[0]], better = new Set(), ties = new Set();
  let stopped = false;
  for (let i = 1; i < items.length; i++) {
    const x = items[i];
    let pos = order.length;
    if (!stopped) while (pos > 0) {
      const y = order[pos - 1];
      if (y.rating - x.rating > S.window) break;
      const a = await ask(x, y, name, 'Going through ' + i + ' of ' + (items.length - 1) + ' · ' + asked + ' picks so far');
      if (a === 'a') { better.add(id(x) + '>' + id(y)); pos--; continue; }
      if (a === 'b') better.add(id(y) + '>' + id(x));
      if (a === 'same') ties.add(pk(x, y));
      if (a === 'stop') stopped = true;
      break;
    }
    order.splice(pos, 0, x);
  }
  review(key, rescore(order, better, ties), '', null);
}

// Slots one new rating in among the ones close to it (a few picks, like a binary search).
async function placeOne(q, next) {
  v.innerHTML = '<div class="sub">Loading…</div>';
  const items = await loadItems(q.key);
  const me = items.find(i => i.title === q.title);
  if (!me) return next();
  const others = items.filter(i => i !== me), better = new Set(), ties = new Set();
  const near = others.map((o, i) => Math.abs(o.rating - me.rating) <= S.window ? i : -1).filter(i => i >= 0);
  let lo = 0;
  while (lo < others.length && others[lo].rating > me.rating) lo++; // where its score already puts it
  if (near.length) {
    let L = near[0], H = near[near.length - 1] + 1;
    while (L < H) {
      const mid = (L + H) >> 1, o = others[mid];
      const a = await ask(me, o, 'Placing ' + me.title + ' (' + q.tabName + ')', 'New rating · ' + (S.queue.length) + ' waiting');
      if (a === 'a') { better.add(id(me) + '>' + id(o)); H = mid; }
      else if (a === 'b') { better.add(id(o) + '>' + id(me)); L = mid + 1; }
      else if (a === 'same') { ties.add(pk(me, o)); L = mid + 1; H = L; }
      else { L = Math.max(L, Math.min(lo, H)); H = L; if (a === 'stop') S.queue.length = 0; }
    }
    lo = L;
  }
  const order = others.slice(); order.splice(lo, 0, me);
  const tiedWith = others.find(o => ties.has(pk(me, o))) || null;
  review(q.key, placeScore(order, lo, tiedWith) || rescore(order, better, ties), q.title, next);
}

// Rates something you finished but never scored: a few picks find its spot, then it gets a score
// between its new neighbours (they shift a little if there isn't room).
async function placeUnrated(u, next, nth, total) {
  v.innerHTML = '<div class="sub">Loading…</div>';
  const items = (await loadItems(u.key)).filter(i => i.title !== u.title);
  if (!items.length) {
    v.innerHTML = '<h2>' + esc(u.title) + '</h2><div class="sub">Nothing on ' + esc(u.tabName) + ' is rated yet, so there\\'s nothing to compare with. Give a couple of things a rating first.</div><div class="btns"><button class="go" id="ok">Next</button></div>';
    document.getElementById('ok').onclick = next; return;
  }
  const me = Object.assign({}, u, { rating: null, isNew: true }), better = new Set(), ties = new Set();
  let L = 0, H = items.length, tie = null, skipped = false;
  while (L < H) {
    const mid = (L + H) >> 1, o = items[mid];
    const a = await ask(me, o, 'Rating ' + me.title + ' (' + u.tabName + ')', 'Unrated ' + nth + ' of ' + total);
    if (a === 'a') { better.add(id(me) + '>' + id(o)); H = mid; }
    else if (a === 'b') { better.add(id(o) + '>' + id(me)); L = mid + 1; }
    else if (a === 'same') { ties.add(pk(me, o)); tie = o; L = mid + 1; H = L; }
    else { skipped = true; if (a === 'stop') unratedList.length = 0; break; }
  }
  if (skipped) return next();
  const above = items[L - 1], below = items[L];
  const est = tie ? tie.rating : above && below ? (above.rating + below.rating) / 2
    : above ? Math.max(1, above.rating - 0.3) : Math.min(10, below.rating + 0.2);
  const order = items.slice(); order.splice(L, 0, me);
  const placed = placeScore(order, L, tie);
  if (placed) return review(u.key, placed, '', next);
  me.rating = Math.round(est * 10) / 10;
  review(u.key, rescore(order, better, ties), '', next);
}
let unratedList = [], unratedTotal = 0;
function startUnrated(key) {
  unratedList = S.unrated.filter(u => !key || u.key === key);
  unratedTotal = unratedList.length;
  nextUnrated();
}
function nextUnrated() {
  const u = unratedList.shift();
  if (!u) return home(false);
  S.unrated = S.unrated.filter(x => x !== u);
  startRun(placeUnrated, [u, nextUnrated, unratedTotal - unratedList.length, unratedTotal]);
}
function unratedButtons() {
  if (!S.unrated.length) return '';
  const byTab = {};
  S.unrated.forEach(u => { byTab[u.key] = byTab[u.key] || { name: u.tabName, n: 0 }; byTab[u.key].n++; });
  return '<h2 style="margin-top:22px">Rate finished things with no rating</h2><div class="sub">Completed titles with no score yet. Tabs without a Status column (Movies, Albums, Songs) count everything as finished. A few picks each.</div><div class="tabs">'
    + Object.entries(byTab).map(([k, t]) => '<button onclick="startUnrated(\\'' + k + '\\')">' + esc(t.name) + ' (' + t.n + ')</button>').join('') + '</div>';
}

function placeQueue() {
  const q = S.queue.shift();
  if (!q) return home(true);
  startRun(placeOne, [q, placeQueue]);
}

function home(afterQueue) {
  if (S.ask === 'Only for new ratings') {
    v.innerHTML = '<h2>Compare ratings</h2><div class="sub">' + (afterQueue ? 'All new ratings are placed.' : 'Nothing is waiting.')
      + ' Settings → “Ask to compare” is set to only check new ratings.</div>' + unratedButtons() + '<div class="btns" style="margin-top:14px"><button onclick="google.script.host.close()">Close</button></div>';
    return;
  }
  v.innerHTML = '<h2>Compare ratings</h2><div class="sub">' + (afterQueue ? 'New ratings are placed. ' : '')
    + 'Pick a list to go through. You only compare things rated within ' + S.window + ' of each other, and you can stop any time.</div>'
    + '<div class="tabs">' + S.tabs.map(t => '<button onclick="startRun(fullPass, [\\'' + t.key + '\\', \\'' + esc(t.name).replace(/'/g, '') + '\\'])">' + esc(t.name) + ' (' + t.count + ')</button>').join('') + '</div>'
    + unratedButtons() + '<div class="btns" style="margin-top:14px"><button onclick="google.script.host.close()">Close</button></div>';
}

if (S.ask === 'Off') v.innerHTML = '<h2>Comparing is off</h2><div class="sub">Turn it on in the Settings tab: “Ask to compare”.</div><div class="btns"><button onclick="google.script.host.close()">Close</button></div>';
else if (S.queue.length) placeQueue();
else home(false);
</script></body></html>`;

// ---------- Sort by rating (highest first; unrated rows go to the bottom) ----------
function sortThisTabByRating() {
  const sh = SpreadsheetApp.getActiveSheet();
  const ids = Object.values(TABS).map(t => t.id);
  if (!ids.includes(sh.getSheetId())) { SpreadsheetApp.getUi().alert('Open one of the lists (Anime, Movies, TV Shows, Albums, Songs, Games or Books) first.'); return; }
  sortSheetByRating_(sh);
  SpreadsheetApp.getActive().toast(`${sh.getName()} sorted by rating.`, 'Media Tracker', 4);
}
function sortAllTabsByRating() {
  const done = [];
  Object.keys(TABS).forEach(key => { const sh = sheetFor_(key); if (sh && sortSheetByRating_(sh)) done.push(sh.getName()); });
  SpreadsheetApp.getActive().toast(`Sorted by rating: ${done.join(', ')}.`, 'Media Tracker', 5);
}
function sortSheetByRating_(sh) {
  const last = sh.getLastRow();
  if (last < 3) return false;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const rc = headers.indexOf('Rating') + 1;
  const tc = (headers.indexOf('Title') + 1) || (headers.indexOf('Song') + 1) || (headers.indexOf('Album') + 1);
  if (!rc || !tc) return false;
  // "Which one?" choices are remembered by row number, so carry them along with their titles.
  const props = PropertiesService.getDocumentProperties();
  const prefix = `${PENDING_PREFIX}${sh.getSheetId()}|`;
  const pending = Object.entries(props.getProperties()).filter(([k]) => k.startsWith(prefix));
  pending.forEach(([k]) => props.deleteProperty(k));
  // Cover and Season Avg are formulas in the header that spill down their column; Sheets won't sort
  // through those, so park them as plain text for a moment and put them back right after.
  const head = sh.getRange(1, 1, 1, sh.getLastColumn());
  const formulas = head.getFormulas()[0];
  formulas.forEach((f, i) => { if (f) sh.getRange(1, i + 1).setValue(headers[i]); });
  try {
    SpreadsheetApp.flush();
    sh.getRange(2, 1, last - 1, sh.getLastColumn()).sort([{ column: rc, ascending: false }, { column: tc, ascending: true }]);
  } finally {
    formulas.forEach((f, i) => { if (f) sh.getRange(1, i + 1).setFormula(f); });
  }
  pending.forEach(([, v]) => {
    const row = findRowByTitle_(sh, JSON.parse(v).typed);
    if (row) props.setProperty(`${prefix}${row}`, v);
  });
  return true;
}