import toml from '../wrangler.toml?raw';
import { describe, expect, it } from 'vitest';

// Guard: the dev-only switches must never be in the production vars of wrangler.toml.

/** The text of a [section] up to the next section header (comments stripped). */
function section(name: string): string {
  const lines = toml.split('\n').map((l) => l.replace(/#.*$/, ''));
  const start = lines.findIndex((l) => l.trim() === `[${name}]`);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\s*\[/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

describe('wrangler.toml production vars', () => {
  const prod = section('env.production.vars');

  it('has a production vars section with ENVIRONMENT = "prod"', () => {
    expect(prod).toMatch(/ENVIRONMENT\s*=\s*"prod"/);
    expect(prod).toMatch(/ACCESS_TEAM_DOMAIN/);
    expect(prod).toMatch(/ACCESS_AUD/);
    expect(prod).toMatch(/ADMIN_EMAIL/);
  });

  it('never sets DEV_EMAIL or LOOKUP_FAKE in production', () => {
    expect(prod).not.toMatch(/DEV_EMAIL/);
    expect(prod).not.toMatch(/LOOKUP_FAKE/);
  });

  it('binds the D1 database and assets in production', () => {
    expect(toml).toMatch(/\[\[env\.production\.d1_databases\]\]/);
    expect(toml).toMatch(/\[env\.production\.assets\]/);
  });

  it('has no DEV_EMAIL or LOOKUP_FAKE anywhere in the production block', () => {
    const lines = toml.split('\n').map((l) => l.replace(/#.*$/, ''));
    const start = lines.findIndex((l) => /^\s*\[+env\.production/.test(l));
    expect(start).toBeGreaterThan(-1);
    expect(lines.slice(start).join('\n')).not.toMatch(/DEV_EMAIL|LOOKUP_FAKE/);
  });

  it('turns off preview URLs in production', () => {
    expect(section('env.production')).toMatch(/preview_urls\s*=\s*false/);
  });

  it('keeps DEV_EMAIL and LOOKUP_FAKE out of the top-level vars too', () => {
    expect(section('vars')).not.toMatch(/DEV_EMAIL|LOOKUP_FAKE/);
  });
});
