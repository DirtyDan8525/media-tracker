// Records real API responses as test fixtures. Needs network access and the
// keys in packages/worker/.dev.vars. See test/fixtures/README.md.
//
//   npm run record -w packages/worker                               every case in test/fixtures/cases.ts
//   npm run record -w packages/worker -- <source> <case> <url...>   save these URLs as one case
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '../src/env';
import { lookupChain } from '../src/lookup/chain';
import { SOURCES, type LookupDeps } from '../src/lookup/sources/index';
import { CASES, type FixtureCase } from '../test/fixtures/cases';
import {
  buildFixtureFiles, createRecorder, memoryD1, parseDevVars, secretsFromVars, summarize, type CaseResult,
} from './recordLib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const NAME = /^[a-z0-9][a-z0-9_-]*$/i; // source and case names become directory names
const AD_HOC_UA = 'media-tracker-fixture-recorder (personal project)';

async function loadVars(): Promise<Record<string, string>> {
  const path = join(ROOT, '.dev.vars');
  if (!existsSync(path)) {
    console.warn('No packages/worker/.dev.vars: recording without API keys.');
    return {};
  }
  return parseDevVars(await readFile(path, 'utf8'));
}

function envFrom(vars: Record<string, string>): Env {
  return {
    DB: memoryD1(),
    ENVIRONMENT: 'dev',
    ACCESS_TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ADMIN_EMAIL: '',
    TMDB_KEY: vars.TMDB_KEY || undefined,
    IGDB_ID: vars.IGDB_ID || undefined,
    IGDB_SECRET: vars.IGDB_SECRET || undefined,
  } as unknown as Env; // ASSETS isn't used by lookups
}

async function writeCase(source: string, caseName: string, result: CaseResult): Promise<void> {
  const dir = join(FIXTURES, source, caseName);
  await rm(dir, { recursive: true, force: true });
  if (result.records.length === 0) return;
  await mkdir(dir, { recursive: true });
  const { files } = buildFixtureFiles(result.records);
  for (const f of files) await writeFile(join(dir, f.name), f.content);
}

const message = (err: unknown) => String(err instanceof Error ? err.message : err);

async function runCase(c: FixtureCase, vars: Record<string, string>, secrets: string[]): Promise<CaseResult> {
  const label = `${c.source}/${c.case}`;
  const rec = createRecorder(globalThis.fetch, secrets);
  const d: LookupDeps = { fetch: rec.fetch, env: envFrom(vars), log: [] };
  let error: string | undefined;
  try {
    if ('details' in c) {
      const fn = SOURCES[c.source]?.details;
      if (!fn) throw new Error(`${c.source} has no registered details function`);
      console.log(`${label}:`, JSON.stringify(await fn(c.details, d)));
    } else if (c.chain) {
      console.log(`${label}:`, JSON.stringify(await lookupChain(c.query.category, c.query, d)));
    } else {
      const entry = SOURCES[c.source];
      if (!entry) throw new Error(`${c.source} is not registered in SOURCES`);
      console.log(`${label}:`, JSON.stringify(await entry.search(c.query, d)));
    }
  } catch (err) {
    error = message(err);
  }
  for (const line of d.log ?? []) console.log(`  · ${line}`);
  return { label, records: rec.records, error };
}

async function recordCases(): Promise<CaseResult[]> {
  if (CASES.length === 0) {
    console.log('No cases in test/fixtures/cases.ts.');
    return [];
  }
  const vars = await loadVars();
  const secrets = secretsFromVars(vars);
  const results: CaseResult[] = [];
  for (const c of CASES) {
    if (!NAME.test(c.source) || !NAME.test(c.case)) throw new Error(`bad case name ${c.source}/${c.case}`);
    // Sequential, through the adapters' own paced() calls: paced exactly as production.
    const r = await runCase(c, vars, secrets);
    await writeCase(c.source, c.case, r);
    results.push(r);
  }
  return results;
}

async function recordUrls(source: string, caseName: string, urls: string[]): Promise<CaseResult[]> {
  if (!NAME.test(source) || !NAME.test(caseName)) throw new Error('source and case must match [a-z0-9_-]');
  const vars = await loadVars();
  const rec = createRecorder(globalThis.fetch, secretsFromVars(vars));
  let error: string | undefined;
  for (const url of urls) {
    try {
      await rec.fetch(url, { headers: { 'User-Agent': AD_HOC_UA } });
    } catch (err) {
      error = message(err);
    }
  }
  const result: CaseResult = { label: `${source}/${caseName}`, records: rec.records, error };
  await writeCase(source, caseName, result);
  return [result];
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length > 0 && args.length < 3) {
    console.error('usage: record-fixtures.ts                      (all cases in test/fixtures/cases.ts)');
    console.error('       record-fixtures.ts <source> <case> <url...>');
    return 2;
  }
  const results = args.length === 0 ? await recordCases() : await recordUrls(args[0]!, args[1]!, args.slice(2));
  const { lines, exitCode } = summarize(results);
  if (lines.length) console.log(`\nSummary (test/fixtures/<source>/<case>/):\n${lines.join('\n')}`);
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
