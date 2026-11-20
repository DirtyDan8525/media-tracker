import { FEATURE_KEYS, type FeatureKey, type Features } from '@media-tracker/shared';
import { useState } from 'react';
import { useSaveSetting } from '../../data/adminApp';
import { AdminPage, Result, saveError, useFeedback } from './parts';

const SWITCHES: Record<FeatureKey, { label: string; desc: string; off?: string }> = {
  signups: { label: 'Sign-ups open', desc: 'Off: Create account says closed. Sign-up links still work.' },
  friends: { label: 'Friends', desc: 'Adding, requests and friend pages' },
  feed: { label: 'Activity feed', desc: 'Feed tab and its posts' },
  comments: { label: 'Comments', desc: 'Comments on feed posts' },
  reactions: { label: 'Reactions', desc: 'Emoji reactions on posts' },
  messages: { label: 'Messages', desc: 'Chats between friends' },
  closeCalls: { label: 'Close-call questions', desc: 'Compare asks about near-equal picks' },
  walkthrough: { label: 'Walkthrough', desc: 'First-run tour for new people' },
  installBanner: { label: 'Install banner', desc: '"Add to Home screen" prompt' },
  everyoneNotes: { label: 'Everyone feed shows notes to non-friends', desc: 'Off: only friends see the note on a post. Private notes stay hidden either way.' },
  customLists: { label: 'Custom lists', desc: 'Off: no one can make a new list. Lists people already have keep working.' },
};

/** /admin/switches (AD2): one switch per feature, saved the moment it is flipped. */
export function SwitchesScreen() {
  return <AdminPage title="Switches">{(app) => <Switches initial={app.settings.features} />}</AdminPage>;
}

function Switches({ initial }: { initial: Features }) {
  const save = useSaveSetting();
  const fb = useFeedback();
  const [features, setFeatures] = useState<Features>(initial);

  async function flip(key: FeatureKey, on: boolean) {
    const next = { ...features, [key]: on };
    const prev = features;
    setFeatures(next);
    try {
      await save.mutateAsync({ key: 'features', value: next });
      fb.ok(`${SWITCHES[key].label} is now ${on ? 'on' : 'off'}.`);
    } catch (err) {
      setFeatures(prev);
      fb.fail(saveError(err, 'switch'));
    }
  }

  return (
    <section aria-labelledby="sw-title" className="group">
      <h2 id="sw-title" className="group__title">Switches</h2>
      <p className="friend-note">Turning a feature off hides it for everyone and the server refuses it too. Old data stays.</p>
      <Result fb={fb.fb} />
      <div className="group__card">
        {FEATURE_KEYS.map((k) => {
          const id = `sw-${k}`;
          return (
            <label key={k} className="admin-switch" htmlFor={id}>
              <span className="admin-switch__text">
                <b id={`${id}-l`}>{SWITCHES[k].label}</b>
                <span id={`${id}-d`} className="admin-switch__desc">{SWITCHES[k].desc}</span>
              </span>
              <span className="switch-row">
                <input id={id} type="checkbox" role="switch" checked={features[k]} disabled={save.isPending}
                  aria-labelledby={`${id}-l`} aria-describedby={`${id}-d`} onChange={(e) => void flip(k, e.target.checked)} />
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
