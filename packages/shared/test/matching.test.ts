import { describe, expect, it } from 'vitest';
import { findDuplicate, normTitle, similarity, splitYear, stripEdition, trimSynopsis } from '../src/index';

describe('normTitle', () => {
  it('normalizes titles', () => {
    expect(normTitle('The Dark Side of the Moon')).toBe('dark side of the moon');
    expect(normTitle("JoJo's Bizarre Adventure")).toBe('jojos bizarre adventure');
    expect(normTitle('Pokémon')).toBe('pokémon');
    expect(normTitle('進撃の巨人')).toBe('進撃の巨人');
    expect(normTitle('The')).toBe('the');
  });
});

describe('similarity', () => {
  it('scores letter-pair overlap', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('', 'x')).toBe(0);
    expect(similarity('進撃の巨人', '進撃の巨人')).toBe(1);
    const s = similarity('frieren', 'frieen');
    expect(s).toBeGreaterThan(0.7);
    expect(s).toBeLessThan(0.75);
  });
});

describe('splitYear', () => {
  it('splits a trailing year', () => {
    expect(splitYear('Chuck (2007)')).toEqual({ name: 'Chuck', year: '2007' });
    expect(splitYear('Speed Racer 2008')).toEqual({ name: 'Speed Racer', year: '2008' });
  });
  it('ignores implausible years', () => {
    const now = new Date('2026-11-10');
    expect(splitYear('Blade Runner 2049', now)).toEqual({ name: 'Blade Runner 2049', year: '' });
    expect(splitYear('Dune 2028', now)).toEqual({ name: 'Dune', year: '2028' });
    expect(splitYear('Plain Title')).toEqual({ name: 'Plain Title', year: '' });
  });
});

describe('stripEdition', () => {
  it('removes edition suffixes', () => {
    expect(stripEdition('Abbey Road (Remastered 2019)')).toBe('Abbey Road');
    expect(stripEdition('Rumours (Super Deluxe)')).toBe('Rumours');
    expect(stripEdition('Nevermind - 20th Anniversary Edition')).toBe('Nevermind');
    expect(stripEdition('Album [Bonus Track Version] (Remastered)')).toBe('Album');
  });
  it('leaves real titles alone', () => {
    expect(stripEdition('Live at Electric Lady')).toBe('Live at Electric Lady');
    expect(stripEdition('Blue (Live)')).toBe('Blue (Live)');
  });
});

describe('findDuplicate', () => {
  const blue = [{ id: '1', title: 'Blue', creator: 'Joni Mitchell' }];
  it('requires creator match for albums', () => {
    expect(findDuplicate(blue, { title: 'Blue', creator: 'Weezer' }, 'albums')).toBeNull();
    expect(findDuplicate(blue, { title: 'Blue', creator: 'Joni Mitchell' }, 'albums')).toBe('1');
    expect(findDuplicate(blue, { title: 'Blue', creator: '' }, 'albums')).toBeNull();
  });
  it('compares title only for anime', () => {
    const rows = [{ id: '2', title: 'Frieren', creator: 'Madhouse' }];
    expect(findDuplicate(rows, { title: 'Frieren', creator: '' }, 'anime')).toBe('2');
  });
  it('ignores the candidate itself', () => {
    expect(findDuplicate(blue, { id: '1', title: 'Blue', creator: 'Joni Mitchell' }, 'albums')).toBeNull();
  });
  it('returns null for an empty title', () => {
    expect(findDuplicate(blue, { title: '  ', creator: 'x' }, 'anime')).toBeNull();
  });
});

describe('trimSynopsis', () => {
  it('leaves short text unchanged', () => {
    expect(trimSynopsis('Short text.', 600)).toBe('Short text.');
  });
  it('strips tags and entities', () => {
    expect(trimSynopsis('<p>Hi &amp; bye</p>', 600)).toBe('Hi & bye');
    expect(trimSynopsis('a<br>b &lt;i&gt; &quot;q&quot; it&#39;s&nbsp;ok &#8217; &#x41;', 600)).toBe('ab <i> "q" it\'s ok ’ A');
  });
  it('cuts at the last sentence end before max', () => {
    const s = 'First one. Second one! Third one? Fourth sentence runs long and long.';
    expect(trimSynopsis(s, 40)).toBe('First one. Second one! Third one?…');
  });
  it('cuts at a space when there is no sentence end', () => {
    expect(trimSynopsis('alpha beta gamma delta epsilon', 14)).toBe('alpha beta…');
  });
});
