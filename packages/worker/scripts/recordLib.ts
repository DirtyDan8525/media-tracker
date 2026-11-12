// Pure logic for scripts/record-fixtures.ts (no Node APIs here, so the Workers
// test suite can unit-test it): parse .dev.vars, wrap fetch to record
// responses with secrets stripped, and lay recorded responses out as files.
import { redactSecrets, stripUrl } from '../src/lookup/http';

export interface Recorded {
  url: string; // stripped of credential query params and known secret values
  method: string;
  status: number; // 0 = the request failed (network/timeout)
  contentType: string;
  body: string; // redacted
}

export interface IndexEntry {
  file: string; // '' when nothing was received (status 0)
  status: number;
  contentType: string;
}

/** URL -> entry; or entries in request order when the same URL was requested more than once. */
export type FixtureIndex = Record<string, IndexEntry | IndexEntry[]>;

/** Minimal dotenv: KEY=value, optional `export `, quotes, # comments, CRLF. */
export function parseDevVars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!;
    const q = value[0];
    if ((q === '"' || q === "'") && value.indexOf(q, 1) > 0) {
      value = value.slice(1, value.indexOf(q, 1));
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]!] = value;
  }
  return out;
}

/** Values that must never be written: any non-empty var whose name looks like a credential. */
export function secretsFromVars(vars: Record<string, string>): string[] {
  return Object.entries(vars)
    .filter(([k, v]) => v !== '' && /KEY|SECRET|TOKEN|_ID$|PASSWORD/i.test(k))
    .map(([, v]) => v);
}

const TOKEN_FIELDS = /("(?:access_token|refresh_token|id_token|client_secret|api_key)"\s*:\s*)"[^"]*"/g;
const TOKEN_VALUES = /"(?:access_token|refresh_token|id_token)"\s*:\s*"([^"]+)"/g;

/** Replaces secret values and the values of token-like JSON fields with REDACTED. */
export function redactBody(text: string, secrets: readonly string[]): string {
  return redactSecrets(text, secrets).replace(TOKEN_FIELDS, '$1"REDACTED"');
}

export function extFor(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (/[/+]json\b/.test(ct)) return 'json';
  if (ct.includes('html')) return 'html';
  return 'txt';
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Wraps `base` so every request's response is recorded (URL stripped, body
 * redacted, request headers never kept). The caller still gets the real
 * response. A token seen in a response (e.g. Twitch's access_token) is added to
 * the secrets, so later bodies and URLs that echo it are redacted too (a token
 * can't appear before the response that issues it).
 */
export function createRecorder(base: typeof fetch, secrets: readonly string[]): { fetch: typeof fetch; records: Recorded[] } {
  const records: Recorded[] = [];
  const known = [...secrets];
  const scrubUrl = (u: string) => redactSecrets(stripUrl(u), known);
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let res: Response;
    try {
      res = await base(input, init);
    } catch (err) {
      records.push({ method, url: scrubUrl(url), status: 0, contentType: '', body: '' });
      throw err;
    }
    const text = await res.clone().text();
    for (const m of text.matchAll(TOKEN_VALUES)) if (!known.includes(m[1]!)) known.push(m[1]!);
    records.push({
      method,
      url: scrubUrl(url),
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body: redactBody(text, known),
    });
    return res;
  };
  return { fetch: f as typeof fetch, records };
}

/** Files for one case directory: `<n>.<ext>` per response (from 1) plus index.json. */
export function buildFixtureFiles(records: readonly Recorded[]): { files: { name: string; content: string }[]; index: FixtureIndex } {
  const files: { name: string; content: string }[] = [];
  const lists = new Map<string, IndexEntry[]>();
  let n = 0;
  for (const r of records) {
    let file = '';
    if (r.status !== 0) {
      n += 1;
      file = `${n}.${extFor(r.contentType)}`;
      files.push({ name: file, content: r.body });
    }
    const entry: IndexEntry = { file, status: r.status, contentType: r.contentType };
    const list = lists.get(r.url);
    if (list) list.push(entry);
    else lists.set(r.url, [entry]);
  }
  const index: FixtureIndex = {};
  for (const [url, list] of lists) index[url] = list.length === 1 ? list[0]! : list;
  files.push({ name: 'index.json', content: `${JSON.stringify(index, null, 2)}\n` });
  return { files, index };
}

export interface CaseResult {
  label: string; // '<source>/<case>'
  records: readonly Recorded[];
  error?: string;
}

/**
 * Whether a case's new recording may replace the committed fixtures: only if it
 * finished without an error and made at least one request. Otherwise the old
 * fixtures stay untouched (the case still fails the run).
 */
export function shouldReplaceFixtures(r: CaseResult): boolean {
  return !r.error && r.records.length > 0;
}

/** Human summary (case -> files, statuses). Exit code 1 if any case made zero requests or failed. */
export function summarize(results: readonly CaseResult[]): { lines: string[]; exitCode: number } {
  const lines: string[] = [];
  let exitCode = 0;
  for (const r of results) {
    const { files } = buildFixtureFiles(r.records);
    const data = files.filter((f) => f.name !== 'index.json');
    lines.push(`${r.label}: ${r.records.length} request(s)${r.error ? ` (error: ${r.error})` : ''}`);
    let i = 0;
    for (const rec of r.records) {
      const name = rec.status === 0 ? '(no response)' : data[i++]!.name;
      lines.push(`  ${name}  ${rec.status}  ${rec.method} ${rec.url}`);
    }
    if (r.records.length === 0) lines.push('  !! no requests recorded');
    if (!shouldReplaceFixtures(r)) lines.push('  !! kept existing fixtures (nothing was replaced)');
    if (r.records.length === 0 || r.error) exitCode = 1;
  }
  return { lines, exitCode };
}

/**
 * An in-memory stand-in for the D1 binding, enough for src/lookup/cache.ts
 * (the only DB code lookups use). Record mode gives each case a fresh one, so
 * no case is answered from another case's cached result, while in-case caching
 * (e.g. the IGDB token) behaves as in production. Other SQL throws.
 */
export function memoryD1(): D1Database {
  const rows = new Map<string, { result_json: string; fetched_at: string }>();
  const k = (source: unknown, key: unknown) => JSON.stringify([source, key]);
  const prepare = (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const stmt = (args: unknown[]) => ({
      bind: (...a: unknown[]) => stmt(a),
      async first<T>(): Promise<T | null> {
        if (!/^SELECT result_json, fetched_at FROM lookup_cache WHERE source = \? AND query_key = \?$/.test(s)) {
          throw new Error(`memoryD1: unsupported query: ${s}`);
        }
        return (rows.get(k(args[0], args[1])) as T | undefined) ?? null;
      },
      async run() {
        if (!/^INSERT INTO lookup_cache /.test(s)) throw new Error(`memoryD1: unsupported statement: ${s}`);
        rows.set(k(args[0], args[1]), { result_json: String(args[2]), fetched_at: String(args[3]) });
        return { success: true, meta: {}, results: [] };
      },
    });
    return stmt([]);
  };
  return { prepare } as unknown as D1Database;
}

/** How a recorder case runs: `details` (details of a fixed id), `search-then-details` (search, then details of the first result), `chain` or `search`. */
export type CaseMode = 'details' | 'search-then-details' | 'chain' | 'search';

export function caseMode(c: { details?: string; detailsFromSearch?: boolean; chain?: boolean }): CaseMode {
  if (c.details !== undefined) return 'details';
  if (c.detailsFromSearch) return 'search-then-details';
  return c.chain ? 'chain' : 'search';
}

/** The sourceId to ask details for after a search; throws (so the case fails and nothing is saved) when the search gave none. */
export function detailsTarget(result: { sourceId?: string } | null): string {
  if (!result) throw new Error('the search found nothing, so there is nothing to ask details for');
  if (!result.sourceId) throw new Error('the search result has no sourceId to ask details for');
  return result.sourceId;
}
