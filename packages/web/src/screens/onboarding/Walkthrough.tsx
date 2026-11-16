import { useState } from 'react';
import { Button } from '../../design/components/Button';
import { Icon, type IconName } from '../../design/components/Icon';
import { Sheet } from '../../design/components/Sheet';
import '../../design/onboarding.css';

const CARDS: { title: string; icon: IconName; text: string }[] = [
  { title: 'Your lists', icon: 'lists', text: 'Home shows the list you used last. Tap the title at the top to switch between Anime, Movies, TV, Games, Music and Books.' },
  { title: 'Add anything', icon: 'plus', text: 'Tap the + bubble, pick a list, type a title.' },
  { title: 'Rate and compare', icon: 'compare', text: 'Give a score, or Compare two titles to place them.' },
  { title: 'Friends and Activity', icon: 'activity', text: 'Add friends to see what they rate, react to their posts and compare lists.' },
];

/** The four-card walkthrough (Walkthrough.wf): dots, Skip, Next, and Start on the last card. Skip, Start and closing all call `onDone`. */
export function Walkthrough({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const card = CARDS[i]!;
  const last = i === CARDS.length - 1;
  return (
    <Sheet open title={card.title} onClose={onDone}
      footer={
        <div className="walk__footer">
          <Button variant="ghost" onClick={onDone}>Skip</Button>
          <Button variant="primary" onClick={last ? onDone : () => setI(i + 1)}>{last ? 'Start' : 'Next'}</Button>
        </div>
      }>
      <div className="walk">
        <p className="walk__count muted">{i + 1} of {CARDS.length}</p>
        <div className="walk__art" aria-hidden="true"><Icon name={card.icon} size={40} /></div>
        <p className="walk__text">{card.text}</p>
        <div className="walk__dots" aria-hidden="true">
          {CARDS.map((_, n) => <span key={n} className={n === i ? 'walk__dot is-on' : 'walk__dot'} />)}
        </div>
      </div>
    </Sheet>
  );
}
