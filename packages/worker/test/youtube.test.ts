import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { redactParams, SourceFailure } from '../src/lookup/http';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import { details, durationLabel, parseYouTubeLink, search } from '../src/lookup/sources/youtube';
import { fakeFetch, replayFetch } from './fakeFetch';

const withKey = (key?: string): Env => ({ ...(env as Env), YOUTUBE_API_KEY: key });
const deps = (f: typeof fetch, key?: string): LookupDeps & { log: string[] } => ({ fetch: f, env: withKey(key), log: [] });
const q = (term: string): LookupQuery => ({ term, typedTitle: term, hint: '', category: 'youtube' });

const ID = 'dQw4w9WgXcQ';
const OEMBED = 'https://www.youtube.com/oembed?url=';
const oembedUrl = (id: string) => `${OEMBED}${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
const oembedBody = { title: 'Never Gonna Give You Up', author_name: 'Rick Astley', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', type: 'video' };
const SEARCH = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=';
const VIDEOS = 'https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=';

describe('parseYouTubeLink', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`],
    [`http://m.youtube.com/watch?feature=share&v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abcDEF&t=10`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/shorts/${ID}?feature=share`],
    [`  www.youtube.com/watch?v=${ID}  `],
    [`https://music.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/live/${ID}`],
    [`https://www.youtube.com/embed/${ID}`],
  ])('%s -> the video id', (link) => {
    expect(parseYouTubeLink(link)).toEqual({ id: ID, url: `https://www.youtube.com/watch?v=${ID}` });
  });

  it.each([
    ['frieren'], [''], ['https://www.youtube.com/'], ['https://www.youtube.com/@RickAstley'], ['https://www.youtube.com/watch?v=short'],
    ['https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ'], ['https://evil.example/?u=youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://vimeo.com/123456789'], ['watch me on youtube'],
  ])('%s is not a video link', (s) => {
    expect(parseYouTubeLink(s)).toBeNull();
  });
});

describe('youtube: pasted link (oEmbed, no key)', () => {
  // test/fixtures/youtube/* are hand-written in the real response shapes (the recording host had no network
  // access); `npm run record -w packages/worker` replaces them with real recordings.
  it('maps title, channel, the hqdefault thumbnail and the video id, with no key set', async () => {
    const f = replayFetch('youtube', 'link-rickroll');
    const r = await search(q(`https://youtu.be/${ID}?si=xyz`), deps(f));
    expect(r).toEqual({
      title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)', trusted: true, cover: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`, genres: '',
      creator: 'Rick Astley', source: 'youtube', sourceId: ID,
    });
    expect(f.unmatched).toEqual([]);
    expect(f.calls).toEqual([oembedUrl(ID)]);
  });

  it('a link never goes to the Data API, even with a key', async () => {
    const f = fakeFetch({ [OEMBED]: { body: JSON.stringify(oembedBody) } });
    await search(q(`https://www.youtube.com/shorts/${ID}`), deps(f, 'KEY'));
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('/oembed?');
  });

  it('null when oEmbed says no (private, deleted or not embeddable: 401/404), and for a 5xx', async () => {
    for (const status of [401, 404, 503]) expect(await search(q(`https://youtu.be/${ID}`), deps(fakeFetch({ [OEMBED]: status })))).toBeNull();
  });

  it('a reply with no title is no match', async () => {
    const f = fakeFetch({ [OEMBED]: { body: JSON.stringify({ author_name: 'x' }) } });
    expect(await search(q(`https://youtu.be/${ID}`), deps(f))).toBeNull();
  });
});

describe('youtube: search by title (Data API v3)', () => {
  const items = [
    { id: { kind: 'youtube#video', videoId: 'aaaaaaaaaaa' }, snippet: { title: 'Cats &amp; Dogs: The &quot;Best&quot; Of', channelTitle: 'Pet Channel', thumbnails: { high: { url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg' } } } },
    { id: { kind: 'youtube#video', videoId: 'bbbbbbbbbbb' }, snippet: { title: 'Cats vs Dogs', channelTitle: 'Other', thumbnails: {} } },
    { id: { kind: 'youtube#channel', channelId: 'UC123' }, snippet: { title: 'Not a video' } },
    { id: { videoId: 'bad id' }, snippet: { title: 'Bad id' } },
  ];

  it('fixture: search then details, the key stripped from the recorded URLs', async () => {
    const f = replayFetch('youtube', 'search-rickroll');
    const d = deps(f, 'SECRET-KEY');
    const r = await search(q('never gonna give you up'), d);
    expect(r).toMatchObject({ title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)', creator: 'Rick Astley', sourceId: 'dQw4w9WgXcQ' });
    expect(r?.choices).toHaveLength(2);
    expect(await details('dQw4w9WgXcQ', d)).toMatchObject({ releaseDate: '2009-10-25', lengthLabel: '3:33' });
    expect(f.unmatched).toEqual([]);
  });

  it('without YOUTUBE_API_KEY: no request at all and no match', async () => {
    const f = fakeFetch({});
    const d = deps(f);
    expect(await search(q('cats and dogs'), d)).toBeNull();
    expect(f.calls).toEqual([]);
    expect(d.log.join('\n')).toMatch(/not configured/i);
  });

  it('with a key: sends the key and maxResults=8, returns the top hit with every video as a choice (entities decoded, thumbnail built from the id)', async () => {
    const f = fakeFetch({ [SEARCH]: { body: JSON.stringify({ items }) } });
    const r = await search(q('cats and dogs'), deps(f, 'SECRET-KEY'));
    expect(f.calls).toEqual([`${SEARCH}cats%20and%20dogs&maxResults=8&key=SECRET-KEY`]);
    const first = { title: 'Cats & Dogs: The "Best" Of', trusted: true, cover: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', genres: '', creator: 'Pet Channel', source: 'youtube', sourceId: 'aaaaaaaaaaa' };
    const second = { title: 'Cats vs Dogs', trusted: true, cover: 'https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg', genres: '', creator: 'Other', source: 'youtube', sourceId: 'bbbbbbbbbbb' };
    expect(r).toEqual({ ...first, choices: [first, second] });
  });

  it('a single result is returned without choices', async () => {
    const f = fakeFetch({ [SEARCH]: { body: JSON.stringify({ items: [items[0]] }) } });
    const r = await search(q('cats'), deps(f, 'K'));
    expect(r?.sourceId).toBe('aaaaaaaaaaa');
    expect(r?.choices).toBeUndefined();
  });

  it('no items, a 403 (quota or a restricted key) or a 5xx is no match; the key never reaches the log', async () => {
    expect(await search(q('x'), deps(fakeFetch({ [SEARCH]: { body: '{"items":[]}' } }), 'K'))).toBeNull();
    const d = deps(fakeFetch({ [SEARCH]: { status: 403, body: '{"error":{"code":403,"message":"quotaExceeded"}}' } }), 'SECRET-KEY');
    expect(await search(q('x'), d)).toBeNull();
    expect(await search(q('x'), deps(fakeFetch({ [SEARCH]: 503 }), 'K'))).toBeNull();
    expect(d.log.join('\n')).not.toContain('SECRET-KEY');
    expect(d.log.join('\n')).not.toMatch(/key=/);
  });

  it('the registered youtube source is always callable (link lookups need no key)', () => {
    expect(SOURCES.youtube).toBeDefined();
  });
});

describe('durationLabel', () => {
  it.each([
    ['PT12M34S', '12:34'], ['PT1H2M3S', '1:02:03'], ['PT45S', '0:45'], ['PT5M', '5:00'], ['PT1H', '1:00:00'], ['PT10H0M5S', '10:00:05'],
    ['P0D', ''], ['PT0S', ''], ['', ''], ['garbage', ''],
  ])('%s -> "%s"', (iso, label) => expect(durationLabel(iso)).toBe(label));
});

describe('youtube details (videos.list)', () => {
  const body = { items: [{ id: ID, snippet: { publishedAt: '2009-10-25T06:57:33Z', title: 'x', description: 'The official video &amp; more.\nLine two.' }, contentDetails: { duration: 'PT3M33S' } }] };

  it('duration and publish date (and the description as the synopsis), asking for contentDetails,snippet', async () => {
    const f = fakeFetch({ [VIDEOS]: { body: JSON.stringify(body) } });
    expect(await details(ID, deps(f, 'SECRET-KEY'))).toEqual({
      releaseDate: '2009-10-25', synopsis: 'The official video & more. Line two.', lengthLabel: '3:33', origin: '',
    });
    expect(f.calls).toEqual([`${VIDEOS}${ID}&key=SECRET-KEY`]);
  });

  it('no key: null without a request; a bad id: null without a request', async () => {
    const f = fakeFetch({});
    expect(await details(ID, deps(f))).toBeNull();
    expect(await details('bad id', deps(f, 'K'))).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it('an unknown video (no items) is null; a 403/5xx fails so the client retries', async () => {
    expect(await details(ID, deps(fakeFetch({ [VIDEOS]: { body: '{"items":[]}' } }), 'K'))).toBeNull();
    await expect(details(ID, deps(fakeFetch({ [VIDEOS]: 503 }), 'K'))).rejects.toBeInstanceOf(SourceFailure);
    await expect(details(ID, deps(fakeFetch({ [VIDEOS]: 403 }), 'K'))).rejects.toBeInstanceOf(SourceFailure);
  });
});

describe('secrets', () => {
  it('the key param is scrubbed from logged text', () => {
    expect(redactParams('GET https://www.googleapis.com/youtube/v3/search?q=a&key=AIzaSECRET&maxResults=8')).toBe(
      'GET https://www.googleapis.com/youtube/v3/search?q=a&key=REDACTED&maxResults=8',
    );
  });
});
