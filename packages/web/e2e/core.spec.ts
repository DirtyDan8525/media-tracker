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
  await expect(page.locator('img[src$="/icon-192.png"]').first()).toBeVisible();

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
