import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const SAMPLE = fileURLToPath(new URL('../test/fixtures/sample-tracker.xlsx', import.meta.url));

// Each project's server has one fixed dev user, so the first test to run does the username setup
// and the other finds it already done.
async function signInAndSetUsername(page: Page, username: string) {
  await page.goto('/');
  const field = page.getByLabel('Username');
  const nav = page.getByRole('navigation', { name: 'Lists' }).or(page.getByRole('link', { name: 'Anime' }).first());
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
  await page.getByRole('button', { name: 'Add anime' }).click();
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
  await page.getByRole('button', { name: 'Add anime' }).click();
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

test('search narrows the list to Frieren', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await ensureAnime(page, 'Frieren');
  await ensureAnime(page, 'Bleach');
  await page.goto('/list/anime');
  await expect(page.getByRole('link', { name: /Bleach/i }).first()).toBeVisible();

  // Phone: the header's Search button opens the box; PC: the filter box is always there.
  const toggle = page.getByRole('button', { name: 'Search', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('input[type=search]').fill('fri');

  await expect(page.getByRole('link', { name: /Frieren/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Bleach|Naruto|Trigun/i })).toHaveCount(0);
});

test('Settings → Appearance → Sakura sets the page background', async ({ page }) => {
  await signInAndSetUsername(page, 'e2e_user');
  await page.goto('/settings/appearance');
  await page.getByRole('radiogroup', { name: 'Theme' }).getByText('Sakura', { exact: true }).click();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 247, 249)');
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
