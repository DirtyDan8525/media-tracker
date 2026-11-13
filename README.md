# Media Tracker

A private, installable web app that replaces Dan's Media Tracker Google Sheet.

- Spec: `docs/specs/media-tracker-app-spec.md`
- Current plan: `docs/plans/2026-11-10-phase1-2-foundation-core.md`
- Source behavior being ported: `reference/MediaTrackerCovers.gs` (v2026-11-06i)

## Develop / Test / Deploy

- **Develop:** `npm ci` (Node 24 LTS, npm 11), copy `packages/worker/.dev.vars.example` to `packages/worker/.dev.vars`, then `npm run dev -w packages/worker` for the Worker and `npm run dev -w packages/web` for the web app. `DEV_EMAIL` only works when `ENVIRONMENT` is `dev`.
- **Test:** `npm test` (unit tests, offline), `npm run typecheck`, and `npm run e2e` (Playwright on Pixel 7 and Desktop Chrome against `wrangler dev` with canned lookups; needs Google Chrome installed). To record real API fixtures see `packages/worker/test/fixtures/README.md`.
- **Deploy:** follow `docs/SETUP.md` (Cloudflare account, D1, secrets, Access, install, import), then `npm run deploy`.
