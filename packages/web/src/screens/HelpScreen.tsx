import { useState } from 'react';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { Button } from '../design/components/Button';
import { Walkthrough } from './onboarding/Walkthrough';
import '../design/onboarding.css';
import '../design/settings.css';

interface Section { title: string; lines: string[]; adminOnly?: boolean }

const SECTIONS: Section[] = [
  { title: 'Adding titles', lines: [
    'Tap the + bubble, pick a list and type a title. Typos are fine: the official title, cover and creator fill in for you.',
    "Can't find it? Paste a Spotify link for a song or album, or a YouTube link for a video, into the title box.",
    'Wrong match? Open the title, then Edit info. Re-fetch looks it up again (type a better search first if you like), or fix the title, artist and cover by hand.',
  ] },
  { title: 'Rating', lines: [
    'The number is what counts: type 0 to 10 with one decimal. Leave it empty to skip.',
    'When two titles are very close, you may get a close-call question: which one is better? Your answer nudges the numbers apart.',
    'Sharpen my ratings (More) walks through more of those questions whenever you want.',
  ] },
  { title: 'Plan to watch and drag order', lines: [
    'Mark a title Plan to watch (or Plan to play, read, listen) and it goes on your plan list without a rating.',
    'On that list, drag titles up or down to put them in the order you want to get to them.',
  ] },
  { title: 'Episode progress', lines: [
    'Shows, anime and manga can track where you are. Open the title and set the episode or chapter number.',
  ] },
  { title: 'Lists and filters', lines: [
    'Tap the list name at the top to switch lists. Use the filter chips and the sort to narrow what you see.',
    'Search (the magnifier) finds a title across all your lists.',
  ] },
  { title: 'Friends', lines: [
    'Open Friends, tap Add friend and share your code or enter theirs. Once they accept you can see each other\'s lists, ratings and Top 5, and compare.',
  ] },
  { title: 'Messages and recommendations', lines: [
    'Message a friend or start a group from Messages. Use Share on a title to recommend it; recommendations land in Recommended.',
  ] },
  { title: 'Activity and reactions', lines: [
    'Activity shows what friends rate and add. React with an emoji or leave a comment on a rating.',
  ] },
  { title: 'Public profile link', lines: [
    'In Edit profile (or Settings) you can turn on a public link. Anyone with it can see your lists read-only, without signing in. On your Profile, tap Share to send it. Turn it off or make a new link any time.',
  ] },
  { title: 'Privacy', lines: [
    'Mark a title private and friends will not see it. Private notes stay yours: notes are only shown to friends when you choose.',
  ] },
  { title: 'Installing the app', lines: [
    'Put the app on your home screen or desktop. See More, then Install instructions, for the steps on iPhone, Android and PC.',
  ] },
  { title: 'Admin', adminOnly: true, lines: [
    'The Admin screen (More) holds the switches, announcement, lists, look, defaults, content, moderation, lookup tools, backup and numbers. Approve new people there too.',
  ] },
];

/** More → Help & how-tos: short plain sections, each collapsible, with a search box and a way back into the walkthrough. */
export function HelpScreen() {
  const me = useSessionMe();
  const [q, setQ] = useState('');
  const [tour, setTour] = useState(false);
  const needle = q.trim().toLowerCase();
  const shown = SECTIONS.filter((s) => (!s.adminOnly || me.isAdmin)
    && (!needle || `${s.title} ${s.lines.join(' ')}`.toLowerCase().includes(needle)));
  return (
    <div className="screen">
      <PageHeader title="Help & how-tos" backTo="/more" backUsesHistory />
      <div className="screen__body stack-18">
        <input type="search" className="input" aria-label="Search help" placeholder="Search help" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="group__card help__list">
          {shown.map((s) => (
            <details key={s.title} className="help__item" open={needle ? true : undefined}>
              <summary className="help__summary">{s.title}</summary>
              <div className="help__body">{s.lines.map((l) => <p key={l}>{l}</p>)}</div>
            </details>
          ))}
          {shown.length === 0 && <p className="help__empty muted">Nothing matches "{q.trim()}".</p>}
        </div>
        <Button onClick={() => setTour(true)}>Show the walkthrough again</Button>
      </div>
      {tour && <Walkthrough onDone={() => setTour(false)} />}
    </div>
  );
}
