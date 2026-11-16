/**
 * A9: gives an existing account a password and marks it active (Dan's account from the Access days,
 * or anyone who is locked out). Hashes on this computer with the Worker's own function, then runs
 * one `wrangler d1 execute`. Usage, from the project folder:
 *
 *   npm run set-password -w packages/worker -- <username>           (the live database)
 *   npm run set-password -w packages/worker -- <username> --local   (your local test database)
 *
 * The password is typed twice and never shown, never passed on a command line you can see in
 * history, and never stored anywhere except as the hash.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, validPassword } from '../src/auth/password';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

let piped: Promise<string[]> | null = null;
let pipedAt = 0;
/** The next line of piped stdin (all of it is read once). */
async function nextPipedLine(): Promise<string> {
  piped ??= new Promise((done) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d: string) => (buf += d));
    process.stdin.on('end', () => done(buf.split(/\r?\n/)));
  });
  return (await piped)[pipedAt++] ?? '';
}

/** Reads one line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(question);
  if (!stdin.isTTY) {
    // Piped input (not a terminal): one line per question.
    return nextPipedLine().then((line) => {
      stdout.write('\n');
      return line;
    });
  }
  return new Promise((done) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          done(value);
          return;
        }
        if (ch === '\u0003') {
          // Ctrl+C
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('');
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
  throw new Error(message); // not reached
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes('--local');
  const names = args.filter((a: string) => !a.startsWith('--'));
  if (names.length !== 1) fail('Usage: npm run set-password -w packages/worker -- <username> [--local]');
  const username = names[0]!.replace(/^@/, '').toLowerCase();
  if (!USERNAME_RE.test(username)) fail(`"${names[0]}" is not a username (3-20 letters, numbers or _).`);

  console.log(`Setting a password for @${username} in the ${local ? 'LOCAL test' : 'LIVE'} database.`);
  const password = await askHidden(`New password (${PASSWORD_MIN}-${PASSWORD_MAX} characters, nothing shows as you type): `);
  if (!validPassword(password)) fail(`The password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters. Nothing was changed.`);
  const again = await askHidden('Type it again: ');
  if (again !== password) fail('The two passwords are different. Nothing was changed.');

  const hash = await hashPassword(password);
  // Both values are safe inside single quotes: the username is [a-z0-9_] and the hash is
  // "pbkdf2$100000$" plus base64 ([A-Za-z0-9+/=]) and "$".
  if (!/^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(hash)) fail('Unexpected hash format. Nothing was changed.');
  const sql =
    `UPDATE users SET password_hash = '${hash}', status = 'active' WHERE username = '${username}'; ` +
    `DELETE FROM login_failures WHERE username = '${username}'; ` +
    `SELECT username, status FROM users WHERE username = '${username}' AND password_hash = '${hash}';`;

  // Run Wrangler's own script with this Node (no shell), so nothing in the SQL is touched by
  // PowerShell, cmd or bash quoting.
  const require = createRequire(import.meta.url);
  const wranglerBin = resolve(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
  const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const where = local ? ['--local'] : ['--remote', '--env', 'production'];
  const result = spawnSync(process.execPath, [wranglerBin, 'd1', 'execute', 'media-tracker', ...where, '--json', '--command', sql], {
    cwd: workerDir,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    fail('Wrangler failed (see above). If it says "Authentication error", log in to Cloudflare first (SETUP, "Log in to Cloudflare").');
  }
  let found = false;
  try {
    const out = JSON.parse(result.stdout) as { results?: { username?: string }[] }[];
    found = out.some((r) => r.results?.some((row) => row.username === username));
  } catch {
    console.error(result.stdout);
    fail('Could not read Wrangler\'s answer. Try signing in with the new password to check.');
  }
  if (!found) fail(`There is no account called @${username}. Nothing was changed. (Usernames are listed by: wrangler d1 execute media-tracker ${where.join(' ')} --command "SELECT username FROM users")`);
  console.log(`Done: @${username} has a new password and is active. Sign in with it now.`);
}

void main();
