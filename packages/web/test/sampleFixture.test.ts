import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { buildSampleTracker } from './helpers/sampleTracker';

it('the committed sample-tracker.xlsx equals a fresh generation (run `npm run gen:sample -w @media-tracker/web` after changing the generator)', async () => {
  const committed = new Uint8Array(await readFile(new URL('./fixtures/sample-tracker.xlsx', import.meta.url)));
  const fresh = await buildSampleTracker();
  expect(Buffer.from(fresh).equals(Buffer.from(committed))).toBe(true);
});
