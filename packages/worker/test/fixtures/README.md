# Test fixtures

Real API responses, saved to disk so the adapter tests run offline. Tests
serve them with `replayFetch(source, case)` or `fakeFetch({...})` from
`test/fakeFetch.ts`; nothing in the test suite touches the network.

Layout: `<source>/<case>/<n>.<json|html|txt>` plus `index.json`, which maps
each request URL to `{ file, status, contentType }` (a list, in order, when
the same URL was requested more than once). `_stub/` holds hand-written files
for the infrastructure tests.

## Recording

Needs network access, so run it on your own machine:

1. Put the API keys in `packages/worker/.dev.vars` (see `.dev.vars.example`):
   `TMDB_KEY`, `IGDB_ID`, `IGDB_SECRET`. Sources without keys don't need any.
   The `spotify/live-at-electric-lady` case also needs `SPOTIFY_ALBUM_URL` (a Spotify
   album link for Clairo – Live at Electric Lady); without it the recorder skips that
   case and says so, and the run still succeeds.
2. Record every case in `cases.ts` through the real adapters:
   `npm run record -w packages/worker`
   or save specific URLs as one case:
   `npm run record -w packages/worker -- <source> <case> <url> [url...]`
3. Check the summary (a case that made no requests exits non-zero), look over
   the diff, and commit the fixtures.

Re-recording a case replaces its directory. Requests are paced exactly as in
production.

## Secrets

Fixtures are committed, so the recorder strips secrets before writing: the
`api_key`, `client_id`, `client_secret` and `access_token` query params are
removed from stored URLs, request headers are never stored, token fields in
response bodies (`access_token` and the like) become `REDACTED`, and every
value from `.dev.vars` that looks like a key is replaced with `REDACTED`
wherever it appears. Still glance at the diff before committing.
