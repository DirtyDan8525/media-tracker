import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** Opens the Add sheet for anime: the Add link in the Main nav (the phone's bottom bar, the PC's side nav). */
async function openAddAnime(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add anime' }).click();
  await expect(page.getByRole('dialog', { name: 'Add to Anime' })).toBeVisible();
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

// Adds an anime through the Add sheet with a typed rating (it joins the compare queue).
async function addRatedAnime(page: Page, title: string, rating: string) {
  await page.goto('/list/anime');
  await openAddAnime(page);
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('or type a number').fill(rating);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(title, 'i') }).first()).toBeVisible();
}

// Makes sure an (unrated) anime with this title exists, through the API, so a test does not depend on what
// an earlier test left behind. Unrated, so it never joins the compare queue.
async function ensureAnime(page: Page, title: string) {
  const res = await page.request.get('/api/entries?category=anime');
  const rows = (await res.json()) as { title: string }[];
  if (rows.some((r) => r.title.toLowerCase().includes(title.toLowerCase()))) return;
  const made = await page.request.post('/api/entries', { data: { category: 'anime', title } });
  expect(made.ok()).toBeTruthy();
}

const banner = (page: Page) => page.getByTestId('compare-banner-status');

test('Compare: three new Liked ratings are placed and saved; a stopped run changes nothing', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await ensureAnime(page, 'Frieren'); // the list checks below look for it

  // Start from an empty queue (the first test left a rating in it), so the count is exactly the three.
  const queue = async () => ((await (await page.request.get('/api/compare/queue')).json()) as { items: { entryId: string }[] }).items;
  for (const q of await queue()) expect((await page.request.delete(`/api/compare/queue/${q.entryId}`)).ok()).toBeTruthy();

  await addRatedAnime(page, 'bleach', '8');
  await addRatedAnime(page, 'naruto', '8.1');
  await addRatedAnime(page, 'trigun', '8.2');

  await page.goto('/list/anime');
  await expect(banner(page)).toContainText('3 new ratings to double-check');

  // Compare: place each title, always answering with the first card, then save every review.
  await banner(page).getByRole('link', { name: 'Compare' }).click();
  const firstCard = page.getByRole('group', { name: 'Pick the better one' }).getByRole('button').first();
  const save = page.getByRole('button', { name: /^Save (new ratings|picks)$/ });
  const onward = page.getByRole('button', { name: /^(Close|Next)$/ });
  const home = page.getByRole('heading', { level: 1, name: 'Fix my ratings' });
  await expect(firstCard).toBeVisible(); // the first run has started (the loading screen has the home's heading too)
  for (let i = 0; i < 100; i++) {
    await expect(firstCard.or(save).or(onward).or(home).first()).toBeVisible();
    // The home shows briefly between two runs while the next title loads: only an empty queue means done.
    if (await home.isVisible()) {
      if ((await queue()).length === 0) break;
      await page.waitForTimeout(200);
      continue;
    }
    if (await firstCard.isVisible()) await firstCard.click();
    else if (await save.isVisible()) await save.click();
    else await onward.click();
  }
  await expect(home).toBeVisible();

  // Back on the list the banner is gone: the count is back to where it started.
  await page.goto('/list/anime');
  await expect(page.getByRole('link', { name: /Frieren/ }).first()).toBeVisible();
  await expect(banner(page).getByText(/new rating/)).toBeHidden();
  expect(await queue()).toEqual([]);

  // Compare → Anime → Liked → one pick → "Belongs in another tier" → Loved → Stop and review → Don't save.
  const entries = async () => JSON.stringify(await (await page.request.get('/api/entries?category=anime')).json());
  const before = await entries();

  await page.goto('/compare');
  await page.getByRole('button', { name: /^Anime \(\d+\)$/ }).click();
  await page.getByRole('button', { name: /^Liked \d+ titles?$/ }).click();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  await expect(firstCard).toBeVisible(); // the next question
  await page.getByRole('button', { name: /^Belongs in another tier/ }).first().click();
  await page.getByRole('menuitem', { name: /^Loved/ }).click();
  await page.getByRole('button', { name: 'Stop and review' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New ratings' })).toBeVisible();
  await page.getByRole('button', { name: "Don't save" }).click();
  await expect(home).toBeVisible();

  expect(await entries()).toEqual(before);
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

test('phone shell: Lists button picks a list, Add from Activity opens that list\'s sheet, profile button opens Profile', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'the bottom bar, Lists button and profile button are phone-only');
  await signInAndSetUsername(page, 'e2e_user');
  await page.goto('/list/anime');
  await expect(page.getByRole('heading', { level: 1, name: 'Anime' })).toBeVisible();

  // Lists: the see-through menu above the button; pick Movies.
  const lists = page.getByRole('button', { name: 'Lists' });
  await lists.click();
  const menu = page.getByRole('navigation', { name: 'Lists' });
  await expect(menu.getByRole('link', { name: /^Anime/ })).toHaveAttribute('aria-current', 'page');
  await menu.getByRole('link', { name: /^Movies/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Movies' })).toBeVisible();
  await expect(menu).toBeHidden();
  await expect(lists).toBeFocused();

  // Escape closes it too.
  await lists.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Activity, then Add: back on Movies with its Add sheet open, and no ?add=1 left in the URL.
  const bar = page.getByRole('navigation', { name: 'Main' });
  await bar.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  await bar.getByRole('link', { name: 'Add movie' }).click();
  await expect(page.getByRole('dialog', { name: 'Add to Movies' })).toBeVisible();
  await expect(page).toHaveURL(/\/list\/movies$/);
  await page.getByRole('button', { name: 'Close' }).click();

  // The profile button on the themed bar opens Profile.
  await page.locator('.page-header--bar').getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('main').getByText('@e2e_user')).toBeVisible();
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
