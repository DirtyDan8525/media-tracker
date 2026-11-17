import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** Opens the Add sheet for anime: the floating Add bubble (phone) or the side nav's Add link (PC). */
async function openAddAnime(page: Page) {
  await page.getByRole('link', { name: 'Add anime' }).click();
  await expect(page.getByRole('dialog', { name: 'Add' })).toBeVisible();
}

const SAMPLE = fileURLToPath(new URL('../test/fixtures/sample-tracker.xlsx', import.meta.url));

// Each project's server has one fixed dev user, so the first test to run does the username setup
// and the other finds it already done.
async function signInAndSetUsername(page: Page, username: string) {
  await page.goto('/');
  const field = page.getByLabel('Username');
  // Phone: the bottom bar. PC: the side nav. Both are navigation "Main".
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(field.or(nav).first()).toBeVisible();
  if (await field.isVisible()) {
    await field.fill(username);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(field).toBeHidden();
  }
  // Phase 5: the first-run walkthrough and install banner (seen/dismissed flags live in localStorage per browser).
  const skip = page.getByRole('dialog', { name: 'Your lists' }).getByRole('button', { name: 'Skip' });
  // The walkthrough can open a beat after the nav shows (slow under two projects at once): wait briefly for it.
  if (await skip.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false)) await skip.click();
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
  await page.evaluate(() => { try { localStorage.setItem('mt-install-dismissed', '1'); } catch { /* ignore */ } });
}

test.describe.configure({ mode: 'serial' });

test('first visit: username, add Frieren, rate it 9.5', async ({ page }) => {
  // Username setup.
  await signInAndSetUsername(page, 'e2e_user');

  // Anime tab, empty.
  await page.goto('/list/anime');
  await expect(page.getByText('No anime yet')).toBeVisible();

  // Add Frieren.
  await openAddAnime(page);
  await page.getByLabel('Title').fill('frieren');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // The card/row appears with the (fake) cover.
  const item = page.getByRole('link', { name: /Frieren/ }).first();
  await expect(item).toBeVisible();
  const row = page.locator('li.entry-card, tr').filter({ hasText: 'Frieren' }).first();
  await expect(row.locator('img[src$="/icon-192.png"]')).toBeVisible();

  // Open the entry and set the rating.
  await item.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Frieren' })).toBeVisible();
  const rating = page.getByRole('spinbutton', { name: 'Rating' });
  await rating.fill('9.5');
  await rating.press('Enter');

  // Back to the list: the badge shows 9.5.
  await page.goBack();
  await expect(page.getByLabel('Rating 9.5').first()).toBeVisible();
});

// Adds an anime through the Add sheet with a typed rating.
async function addRatedAnime(page: Page, title: string, rating: string) {
  await page.goto('/list/anime');
  await openAddAnime(page);
  await page.getByLabel('Title').fill(title);
  await page.getByRole('spinbutton', { name: 'Rating' }).fill(rating);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(title, 'i') }).first()).toBeVisible();
}

// Makes sure an (unrated) anime with this title exists, through the API, so a test does not depend on what
// an earlier test left behind.
async function ensureAnime(page: Page, title: string) {
  const res = await page.request.get('/api/entries?category=anime');
  const rows = (await res.json()) as { title: string }[];
  if (rows.some((r) => r.title.toLowerCase().includes(title.toLowerCase()))) return;
  const made = await page.request.post('/api/entries', { data: { category: 'anime', title } });
  expect(made.ok()).toBeTruthy();
}

type Row = { id: string; title: string; rating: number | null; typed: number | null };
const animeRows = async (page: Page) => (await (await page.request.get('/api/entries?category=anime')).json()) as Row[];
const ratingOf = async (page: Page, re: RegExp) => (await animeRows(page)).find((r) => re.test(r.title))!;

test('close call: a second 3.0 asks "Which did you like more?" right after Add; the pick nudges both (3.02 / 2.98)', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await addRatedAnime(page, 'bleach', '3');
  // Nothing else sits within 0.3 of 3.0 yet: no sheet.
  await expect(page.getByRole('dialog', { name: 'Close call' })).toBeHidden();
  await addRatedAnime(page, 'naruto', '3');

  const sheet = page.getByRole('dialog', { name: 'Close call' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Which did you like more?')).toBeVisible();
  await expect(sheet.getByText('1 of 1')).toBeVisible();
  await sheet.getByRole('button', { name: /^Naruto/i }).click();
  await expect(sheet.getByText('Nudged to break the tie.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();

  const n = await ratingOf(page, /naruto/i), b = await ratingOf(page, /bleach/i);
  expect([n.rating, n.typed, b.rating, b.typed]).toEqual([3.02, 3, 2.98, 3]);
  await expect(page.getByLabel('Rating 3.02').first()).toBeVisible();
});

test('Sharpen my ratings (More): asks only the close pairs, then the list is all clear', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  // Trigun 3.1 is close to Bleach and Naruto (both typed 3.0); added through the API, so nothing is asked yet.
  const made = await page.request.post('/api/entries', { data: { category: 'anime', title: 'Trigun', rating: 3.1 } });
  expect(made.ok()).toBeTruthy();

  await page.goto('/more');
  await page.getByRole('link', { name: 'Sharpen my ratings' }).click();
  await expect(page.getByText('Pick a list. Only close ratings come up.')).toBeVisible();
  await page.getByRole('link', { name: 'Anime, 2 close calls' }).click();
  await expect(page.getByText('Close call 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'About the same' }).click();
  await expect(page.getByText('Close call 2 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'About the same' }).click();
  await expect(page.getByText('That was the last one')).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Done' }).last().click();
  await expect(page.getByRole('link', { name: 'Anime, 0 — all clear' })).toBeVisible();
  // "About the same" never reorders: Trigun keeps its number.
  expect((await ratingOf(page, /trigun/i)).rating).toBe(3.1);
});

test('search finds Frieren: the phone\'s bottom-bar Search, the PC list\'s filter box', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await ensureAnime(page, 'Frieren');
  await ensureAnime(page, 'Bleach');
  await page.goto('/list/anime');
  await expect(page.getByRole('link', { name: /Bleach/i }).first()).toBeVisible();

  const bar = page.getByRole('navigation', { name: 'Main' });
  if (await bar.isVisible()) {
    // Phone (B6): no search in the list header; the raised Search opens the global Search screen.
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
    await bar.getByRole('link', { name: 'Search' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    await page.getByRole('searchbox').fill('fri');
    await expect(page).toHaveURL(/\/search\?q=fri/);
  } else {
    await page.getByRole('searchbox', { name: 'Filter Anime' }).fill('fri');
  }
  await expect(page.getByRole('link', { name: /Frieren/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Bleach|Naruto|Trigun/i })).toHaveCount(0);
});

test('phone shell: the title dropdown picks a list, Home returns to it, Add (bubble) takes an "Add to" list, profile button opens Profile', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'the bottom bar, Add bubble and profile button are phone-only');
  await signInAndSetUsername(page, 'e2e_user');
  await page.goto('/list/anime');
  await expect(page.getByRole('heading', { level: 1, name: 'Anime' })).toBeVisible();

  // The list title is a dropdown: pick Movies.
  const title = page.getByRole('heading', { level: 1 }).getByRole('button');
  await title.click();
  const menu = page.getByRole('menu', { name: 'Switch list' });
  await expect(menu.getByRole('menuitem', { name: /^Anime/ })).toHaveAttribute('aria-current', 'true');
  await menu.getByRole('menuitem', { name: /^Movies/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Movies' })).toBeVisible();
  await expect(menu).toBeHidden();

  // Escape closes it too, and focus returns to the title button.
  await page.getByRole('heading', { level: 1 }).getByRole('button').click();
  await expect(page.getByRole('menu', { name: 'Switch list' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Switch list' })).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 }).getByRole('button')).toBeFocused();

  // Activity, then Home: back on Movies (the last list). The bubble is there, but not on More.
  const bar = page.getByRole('navigation', { name: 'Main' });
  await bar.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add movie' })).toBeVisible();
  await bar.getByRole('link', { name: 'More' }).click();
  await expect(page.getByRole('link', { name: 'Add movie' })).toHaveCount(0);
  await bar.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Movies' })).toBeVisible();

  // Add: the sheet defaults to Movies; "Add to" can pick another list.
  await page.getByRole('link', { name: 'Add movie' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add' });
  await expect(sheet.getByRole('button', { name: 'Add to Movies' })).toBeVisible();
  await expect(page).toHaveURL(/\/list\/movies$/);
  await sheet.getByRole('button', { name: 'Add to Movies' }).click();
  await page.getByRole('menuitemradio', { name: 'Anime' }).click();
  await expect(sheet.getByRole('button', { name: 'Add to Anime' })).toBeFocused();
  await page.getByRole('button', { name: 'Close' }).click();

  // The profile button on the themed bar opens Profile.
  await page.locator('.page-header--bar').getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('main').getByText('@e2e_user')).toBeVisible();
});

test('Activity (You) shows "You added Frieren to Anime", reached from the Main nav', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await ensureAnime(page, 'Frieren');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Activity' }).click();
  await expect(page).toHaveURL(/\/activity/);
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  // Everyone is the default since Phase 4 (S6); a bare "added" shows only under You.
  await expect(page.getByRole('radio', { name: 'Everyone' })).toBeChecked();
  await page.getByRole('radio', { name: 'You' }).click(); // controlled by the URL, so the state settles after the navigation
  await expect(page.getByRole('radio', { name: 'You' })).toBeChecked();
  await expect(page.getByText(/You\s+added\s+Frieren\s+to\s+Anime/).first()).toBeVisible();
});

test('number flow: a typed 9.7 counts as Loved in the Profile tier counts; Planned titles have no rating field', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  const lovedCount = async () => (await animeRows(page)).filter((e) => e.rating !== null && e.rating >= 9).length;
  const before = await lovedCount();

  await addRatedAnime(page, 'Monster', '9.7');
  expect(await lovedCount()).toBe(before + 1);

  // The entry has the Rating field (holding 9.7) and no tier chips or Lock.
  await page.getByRole('link', { name: /Monster/i }).first().click();
  await expect(page.getByRole('spinbutton', { name: 'Rating' })).toHaveValue('9.7');
  await expect(page.getByRole('group', { name: 'Tier' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Lock score' })).toHaveCount(0);

  // Profile: the tier bar and its line count it (Loved comes first in the line).
  await page.goto('/profile');
  await expect(page.getByRole('img', { name: new RegExp(`^Loved ${before + 1} · `) })).toBeVisible();

  // The Add sheet hides the rating field for a planned title.
  await page.goto('/list/anime');
  await openAddAnime(page);
  await expect(page.getByRole('spinbutton', { name: 'Rating' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Add' }).getByRole('button', { name: 'Plan to watch' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rating' })).toHaveCount(0);
});

test('Profile → Log out ends the session (POST /api/auth/logout)', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await page.goto('/profile');
  const logout = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/auth/logout');
  await page.getByRole('button', { name: 'Log out' }).click();
  await logout;
});

test('Settings → Appearance → Sakura sets the page background', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await page.goto('/settings/appearance');
  await page.getByRole('radiogroup', { name: 'Theme' }).getByText('Sakura', { exact: true }).click();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 247, 249)');
});

test('Profile: pick a photo, crop it with the keyboard, save, and it survives a reload', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await page.goto('/profile');
  await expect(page.getByRole('main').getByText('@e2e_user')).toBeVisible();

  // A real 600 x 400 PNG made in the browser (the crop, resize and WebP/JPEG encode all run for real).
  const b64 = await page.evaluate<string>(`(async () => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 400;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3366cc'; ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = '#ffcc00'; ctx.fillRect(200, 100, 200, 200);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  })()`);

  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });

  const crop = page.getByRole('dialog', { name: 'Crop photo' });
  await expect(crop).toBeVisible();
  await crop.getByRole('slider', { name: 'Zoom' }).fill('2');
  await crop.getByRole('group', { name: /Photo crop area/ }).press('ArrowLeft');
  await crop.getByRole('button', { name: 'Use photo' }).click();

  const preview = page.getByRole('dialog', { name: 'Your new photo' });
  await expect(preview.getByRole('img', { name: 'Preview of your new photo' })).toBeVisible();
  await preview.getByRole('button', { name: 'Save' }).click();

  const avatar = page.locator('.profile__photo img');
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute('src', /^\/api\/me\/avatar\?v=/);
  await expect.poll(() => page.evaluate<number>("document.querySelector('.profile__photo img').naturalWidth")).toBe(256);

  await page.reload();
  await expect(page.locator('.profile__photo img')).toBeVisible();
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.locator('.profile__photo img')).toHaveCount(0);
});

test('import the sample workbook: counts match the preview', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_import');

  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles(SAMPLE);

  const counts = page.getByLabel('What will be imported').locator('.import__count strong');
  await expect(counts.first()).toBeVisible();
  const total = (await counts.allTextContents()).reduce((s, t) => s + Number(t), 0);
  expect(total).toBeGreaterThan(0);

  await page.getByRole('button', { name: `Import ${total} ${total === 1 ? 'title' : 'titles'}` }).click();
  await expect(page.getByRole('heading', { name: `Imported ${total} ${total === 1 ? 'title' : 'titles'}` })).toBeVisible();
});

test('Top 5: Share Anime Top 5 previews a 1080 × 1350 PNG and Save image downloads it', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await page.goto('/top5');
  await page.getByRole('button', { name: 'Share Anime Top 5' }).click();
  const sheet = page.getByRole('dialog', { name: 'Share your Anime Top 5' });
  const preview = sheet.getByRole('img', { name: 'Preview of your My Anime Top 5 image' });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((img) => [(img as unknown as { naturalWidth: number }).naturalWidth, (img as unknown as { naturalHeight: number }).naturalHeight])).toEqual([1080, 1350]);
  const download = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Save image' }).click();
  expect((await download).suggestedFilename()).toBe('top5-anime.png');
  await expect(page.getByText('Image saved')).toBeVisible();
});

test('Messages: it has its own place in the nav (phone bottom bar, PC side nav) and Top 5 is not in the phone bar', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await page.goto('/list/anime');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Messages' })).toBeVisible();
  const phone = await page.locator('.bottom-tabs').isVisible();
  if (phone) {
    // Phone: Home, Activity, Search, Messages, More; Top 5 lives in More.
    await expect(nav.getByRole('link', { name: /Top 5/ })).toHaveCount(0);
    await nav.getByRole('link', { name: 'More' }).click();
    await expect(page.getByRole('link', { name: 'Top 5' })).toBeVisible();
  }
  await nav.getByRole('link', { name: 'Messages' }).click();
  await expect(page).toHaveURL(/\/messages$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recommended to you' })).toBeVisible();
  await page.getByRole('link', { name: 'New' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New chat' })).toBeVisible();
});
