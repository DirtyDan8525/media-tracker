import { useMemo } from 'react';
import { useDeviceEntries } from '../data/useEntries';
import { CoverBackdrop } from '../design/components/CoverBackdrop';
import { enabledLists } from '../nav';
import { BackButton } from '../shell/BackButton';
import { useSessionMe } from '../shell/SessionGate';

/** Where each fanned cover sits, back to front (from About.v2): the #1 cover is the front card. */
const FAN = ['about__fan-card--1', 'about__fan-card--2', 'about__fan-card--3', 'about__fan-card--4'];

/** About: Dan's welcome note and the data-source attributions (TMDB and IGDB require them). */
export function AboutScreen() {
  const me = useSessionMe();
  const lists = useMemo(() => enabledLists(me.settings), [me.settings]);
  // Device cache only (no fetches for a credits page).
  const entries = useDeviceEntries(lists);
  // The person's top-rated covers across their lists: #1 is the backdrop and the front of the fan.
  const top = useMemo(
    () => entries
      .filter((e) => e.rating !== null && e.coverUrl)
      .sort((a, b) => (b.rating as number) - (a.rating as number) || a.title.localeCompare(b.title))
      .map((e) => e.coverUrl)
      .filter((src, i, all) => all.indexOf(src) === i) // one card per cover, so cards can be keyed by src
      .slice(0, 4),
    [entries],
  );
  // Back to front: 4th, 3rd, 2nd, then #1 on top.
  const fan = [...top].reverse();

  return (
    <div className="screen about has-backdrop">
      <CoverBackdrop src={top[0]} className="backdrop--top backdrop--about" />
      <div className="about__top"><BackButton to="/more" /></div>
      <div className="about__body">
        {fan.length > 0 && (
          <div className="about__fan" aria-hidden="true">
            {fan.map((src, i) => (
              <img key={src} className={`about__fan-card ${FAN[i + 4 - fan.length]}`} src={src} alt="" decoding="async" referrerPolicy="no-referrer" />
            ))}
          </div>
        )}
        <div className="about__heading">
          <h1 className="about__title">WELCOME TO MEDIA TRACKER</h1>
          <span className="about__byline">Created by Dan</span>
        </div>
        <p className="about__p">Hey! I got tired of keeping track of everything I watch, listen to, play and read across a bunch of different websites and random notes apps, so I made this to keep it all in one spot. Just type in a title, give it a rating, and it fills in the cover and the rest for you.</p>
        <p className="about__p">I'm super hyped that other people might actually use this. Make it yours, fill it up with your favorite stuff, and let's compare and share what we love!</p>
        <section aria-label="Credits" className="about__credits">
          <span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span>
          <span>Game data from IGDB.com.</span>
        </section>
      </div>
    </div>
  );
}
