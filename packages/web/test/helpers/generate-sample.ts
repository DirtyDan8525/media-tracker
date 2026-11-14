// Regenerates test/fixtures/sample-tracker.xlsx:  npm run gen:sample -w @media-tracker/web
import { writeFile } from 'node:fs/promises';
import { buildSampleTracker } from './sampleTracker';

const out = new URL('../fixtures/sample-tracker.xlsx', import.meta.url);
await writeFile(out, await buildSampleTracker());
console.log(`wrote ${out.pathname}`);
