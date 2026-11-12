import { BackButton } from '../shell/BackButton';

/** About: Dan's welcome note and the data-source attributions (TMDB and IGDB require them). */
export function AboutScreen() {
  return (
    <div className="screen about">
      <div className="about__top"><BackButton to="/more" /></div>
      <div className="about__body">
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
