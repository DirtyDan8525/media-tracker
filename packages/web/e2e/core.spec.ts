import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { COMPARE_ENABLED } from '../src/features';

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

// Adds an anime through the Add sheet and gives it a rating on its page (a hand-typed rating joins
// the compare queue).
async function addRatedAnime(page: Page, title: string, rating: string) {
  await page.goto('/list/anime');
  await page.getByRole('button', { name: 'Add anime' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: new RegExp(title, 'i') }).first().click();
  const field = page.getByRole('spinbutton', { name: 'Rating' });
  await field.fill(rating);
  await field.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(title, 'i') })).toBeVisible();
  // Let the save land before leaving the page.
  await expect(field).toHaveValue(rating);
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

// The Compare flow is hidden in this build (src/features.ts); its flow test runs when the flag is on.
test('Compare is hidden: no banner, nav link or Comparing section; /compare goes home', async ({ page }) => {
  test.skip(COMPARE_ENABLED, 'Compare is enabled');
  await signInAndSetUsername(page, 'e2e_user');
  const queueRequests: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/compare/')) queueRequests.push(r.url()); });
  await addRatedAnime(page, 'bleach', '9'); // a hand-typed rating would have joined the queue
  await page.goto('/list/anime');
  await expect(page.getByRole('link', { name: /Bleach/i }).first()).toBeVisible();
  await expect(page.getByText(/to double-check/)).toBeHidden();
  await expect(page.getByRole('link', { name: /^Compare/ })).toHaveCount(0);
  await page.goto('/more');
  await expect(page.getByRole('heading', { level: 1, name: 'More' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Compare/ })).toHaveCount(0);
  await page.getByRole('link', { name: /^Appearance/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Comparing' })).toHaveCount(0);
  await page.goto('/compare');
  await expect(page).toHaveURL(/\/list\/anime$/);
  expect(queueRequests).toEqual([]);
});

test('new ratings: banner, Compare places them, banner clears; Stop then Don\'t save changes nothing', async ({ page }) => {
  test.skip(!COMPARE_ENABLED, 'Compare is hidden until the tier system lands');
  await signInAndSetUsername(page, 'e2e_user');

  await ensureAnime(page, 'Frieren'); // the list checks below look for it
  // Count what is already waiting (earlier tests may have left some), then check the exact increase.
  const queued = async () => ((await (await page.request.get('/api/compare/queue')).json()) as { items: unknown[] }).items.length;
  const waiting = await queued();

  await addRatedAnime(page, 'bleach', '9');
  await addRatedAnime(page, 'naruto', '8.8');
  await addRatedAnime(page, 'trigun', '8.5');

  await page.goto('/list/anime');
  await expect(banner(page)).toContainText(`${waiting + 3} new ratings to double-check`);

  // Compare the waiting ratings: answer "About the same" to every question.
  await banner(page).getByRole('link', { name: 'Compare' }).click();
  const same = page.getByRole('button', { name: 'About the same' });
  const save = page.getByRole('button', { name: 'Save new ratings' });
  const onward = page.getByRole('button', { name: /^(Close|Next)$/ });
  const home = page.getByRole('heading', { level: 1, name: 'Compare ratings' });
  // Each waiting rating is one run: answer "About the same" to every question, save the review when
  // it has changes (or Close/Next when it says "All good"), until the Compare home shows again.
  await expect(same).toBeVisible(); // the first run has started (the loading screen has the home's heading too)
  for (let i = 0; i < 300; i++) {
    await expect(same.or(save).or(onward).or(home).first()).toBeVisible();
    if (await home.isVisible()) break;
    if (await same.isVisible()) await same.click();
    else if (await save.isVisible()) await save.click();
    else await onward.click();
  }
  await expect(home).toBeVisible();

  // Back on the list the banner is gone.
  await page.goto('/list/anime');
  await expect(page.getByRole('link', { name: /Frieren/ }).first()).toBeVisible();
  await expect(banner(page).getByText(/new rating/)).toBeHidden();

  // Compare → Anime → one answer → Stop and review → Don't save: nothing changes.
  const ratingsOf = async () => {
    await page.goto('/list/anime');
    await expect(page.getByRole('link', { name: /Frieren/ }).first()).toBeVisible();
    return page.getByLabel(/^Rating \d/).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).sort());
  };
  const listBefore = await ratingsOf();

  await page.goto('/compare');
  await page.getByRole('button', { name: /^Anime \(\d+\)$/ }).click();
  await expect(same).toBeVisible();
  // Call the lower-rated one better, so the review has a change to throw away.
  const picks = page.getByRole('group', { name: 'Pick the better one' }).getByRole('button');
  const nows = (await picks.evaluateAll((els) => els.map((e) => Number(/now ([\d.]+)/.exec(e.getAttribute('aria-label') ?? '')?.[1]))));
  await picks.nth(nows[0] <= nows[1] ? 0 : 1).click();
  await page.getByRole('button', { name: 'Stop and review' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New ratings' })).toBeVisible();
  await page.getByRole('button', { name: "Don't save" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compare ratings' })).toBeVisible();

  expect(await ratingsOf()).toEqual(listBefore);
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
