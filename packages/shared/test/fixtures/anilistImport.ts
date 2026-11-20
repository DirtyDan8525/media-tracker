// Hand-written AniList MediaListCollection responses (the network is blocked in tests).
const date = (y: number | null = null, m: number | null = null, d: number | null = null) => ({ year: y, month: m, day: d });

export const ANIME_RESPONSE = {
  data: {
    MediaListCollection: {
      lists: [
        {
          entries: [
            {
              status: 'COMPLETED', score: 8.5, progress: 26, notes: 'Great ending', private: false, repeat: 1,
              startedAt: date(2020, 1, 5), completedAt: date(2020, 2, 1),
              media: {
                id: 1, idMal: 1, title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan' }, episodes: 25, chapters: null,
                coverImage: { large: 'https://s4.anilist.co/file/aot.jpg' }, startDate: { year: 2013 },
                genres: ['Action', 'Drama'], format: 'TV',
                studios: { nodes: [{ name: 'Wit Studio' }] }, staff: { nodes: [{ name: { full: 'Hajime Isayama' } }] },
              },
            },
            {
              status: 'CURRENT', score: 0, progress: 3, notes: null, private: true, repeat: 0,
              startedAt: date(), completedAt: date(),
              media: {
                id: 2, idMal: 2, title: { romaji: 'Only Romaji', english: null }, episodes: null, chapters: null,
                coverImage: { large: 'https://s4.anilist.co/file/romaji.jpg' }, startDate: { year: null },
                genres: [], format: 'TV', studios: { nodes: [] }, staff: { nodes: [] },
              },
            },
          ],
        },
        {
          entries: [
            {
              status: 'REPEATING', score: 9, progress: 12, notes: '', private: false, repeat: 2,
              startedAt: date(), completedAt: date(),
              media: {
                id: 3, idMal: 3, title: { romaji: 'Cowboy Bebop', english: 'Cowboy Bebop' }, episodes: 26, chapters: null,
                coverImage: { large: 'https://s4.anilist.co/file/bebop.jpg' }, startDate: { year: 1998 },
                genres: ['Sci-Fi'], format: 'TV', studios: { nodes: [{ name: 'Sunrise' }] }, staff: { nodes: [] },
              },
            },
            {
              status: 'PLANNING', score: 0, progress: 0, notes: null, private: false, repeat: 0,
              startedAt: date(), completedAt: date(),
              media: {
                id: 4, idMal: 4, title: { romaji: 'Planned One', english: 'Planned One' }, episodes: 12, chapters: null,
                coverImage: { large: 'https://s4.anilist.co/file/plan.jpg' }, startDate: { year: 2024 },
                genres: ['Comedy'], format: 'TV', studios: { nodes: [{ name: 'Studio X' }] }, staff: { nodes: [] },
              },
            },
            {
              status: 'PAUSED', score: 6, progress: 5, notes: null, private: false, repeat: 0,
              startedAt: date(), completedAt: date(),
              media: {
                id: 5, idMal: 5, title: { romaji: 'Paused One', english: 'Paused One' }, episodes: 12, chapters: null,
                coverImage: { large: null }, startDate: { year: 2022 },
                genres: [], format: 'TV', studios: { nodes: [] }, staff: { nodes: [] },
              },
            },
            {
              status: 'DROPPED', score: 3.5, progress: 2, notes: null, private: false, repeat: 0,
              startedAt: date(), completedAt: date(),
              media: {
                id: 6, idMal: 6, title: { romaji: 'Dropped One', english: 'Dropped One' }, episodes: 12, chapters: null,
                coverImage: { large: 'https://s4.anilist.co/file/drop.jpg' }, startDate: { year: 2021 },
                genres: [], format: 'TV', studios: { nodes: [] }, staff: { nodes: [] },
              },
            },
          ],
        },
      ],
    },
  },
};

export const MANGA_RESPONSE = {
  data: {
    MediaListCollection: {
      lists: [
        {
          entries: [
            {
              status: 'CURRENT', score: 7.5, progress: 40, notes: 'Slow start', private: false, repeat: 0,
              startedAt: date(), completedAt: date(),
              media: {
                id: 100, idMal: 100, title: { romaji: 'Berserk', english: 'Berserk' }, episodes: null, chapters: 364,
                coverImage: { large: 'https://s4.anilist.co/file/berserk.jpg' }, startDate: { year: 1989 },
                genres: ['Fantasy', 'Horror'], format: 'MANGA', studios: { nodes: [] },
                staff: { nodes: [{ name: { full: 'Kentaro Miura' } }] },
              },
            },
          ],
        },
      ],
    },
  },
};

export const EMPTY_RESPONSE = { data: { MediaListCollection: { lists: [] } } };
export const NOT_FOUND_RESPONSE = { data: { MediaListCollection: null }, errors: [{ message: 'User not found', status: 404 }] };
export const PRIVATE_RESPONSE = { data: { MediaListCollection: null }, errors: [{ message: 'Private User', status: 403 }] };
