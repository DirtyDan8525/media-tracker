import { seasonSetOf, type Category, type CustomList, type ListsSetting, type RatingSet, type SetItem } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAppSettings } from '../../data/appSettings';
import { CLOSE_COUNTS_KEY, saveClosePick, useCloseCounts, useClosePairs } from '../../data/ratings';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Icon } from '../../design/components/Icon';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { useIsWide } from '../../hooks';
import { enabledLists, seasonsEnabled } from '../../nav';
import { PageHeader } from '../../shell/PageHeader';
import { useSessionMe } from '../../shell/SessionGate';
import { addNudged, NudgedList, PICK_FAILED, type Nudged } from './CloseCallSheet';
import { ClosePair, type CloseAnswer } from './ClosePair';
import '../../design/settings.css';
import { listLabel } from '../../lists/registry';

export const SHARPEN_PATH = '/sharpen';

const SEASON_LABEL: Partial<Record<RatingSet, string>> = { anime_seasons: 'Anime Seasons', tv_seasons: 'TV Seasons' };
const setLabel = (s: RatingSet): string => SEASON_LABEL[s] ?? listLabel(s as Category);
const countLine = (n: number | undefined): string =>
  n === undefined ? '' : n === 0 ? '0 — all clear' : n === 1 ? '1 close call' : `${n} close calls`;

/** The enabled lists (your custom lists too: each is its own rating set), each followed by its season tab when that tab is on. */
function setsOf(settings: Parameters<typeof enabledLists>[0], lists: ListsSetting, custom: readonly CustomList[]): RatingSet[] {
  return enabledLists(settings, lists, custom).flatMap((c) => {
    const s = seasonSetOf(c);
    return s !== null && seasonsEnabled(settings, c) ? [c, s] : [c];
  });
}

/**
 * "Sharpen my ratings" (Ruling N7, Sharpen board), from More: pick a list, then answer only its
 * close calls, nearest numbers first, with Done. Each answer saves at once.
 */
export function SharpenScreen() {
  const [params, setParams] = useSearchParams();
  const me = useSessionMe();
  const { lists } = useAppSettings();
  const sets = setsOf(me.settings, lists, me.customLists);
  const chosen = params.get('list') as RatingSet | null;
  if (chosen !== null && sets.includes(chosen)) {
    return <SharpenSession key={chosen} set={chosen} onDone={() => setParams({}, { replace: false })} />;
  }
  return <SharpenHome sets={sets} />;
}

function SharpenHome({ sets }: { sets: RatingSet[] }) {
  const { data, isPending, isError, refetch } = useCloseCounts();
  return (
    <div className="screen">
      <PageHeader title="Sharpen my ratings" backTo="/more" backUsesHistory />
      <div className="screen__body stack-18">
        <p className="muted">Pick a list. Only close ratings come up.</p>
        {isPending && <Skeleton height={140} />}
        {isError && (
          <EmptyState icon="info" title="Couldn't load your lists" body="Check your connection and try again."
            actionLabel="Try again" onAction={() => void refetch()} />
        )}
        {data && (
          <div className="group__card">
            {sets.map((s) => {
              const n = data[s] ?? 0;
              return (
                <Link key={s} to={`?list=${s}`} className="group__row" aria-label={`${setLabel(s)}, ${countLine(n)}`}>
                  <span className="group__row-start">{setLabel(s)}</span>
                  <span className="group__row-end">
                    <span className={n > 0 ? 'count-pill' : 'group__value'}>{n > 0 ? countLine(n) : countLine(0)}</span>
                    <span className="group__chev"><Icon name="chevron" size={18} /></span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SharpenSession({ set, onDone }: { set: RatingSet; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const wide = useIsWide();
  const { data, isPending, isError, refetch } = useClosePairs(set);
  // Pairs are reloaded after every answer: picks change the shown order, which changes which
  // neighbours are still open, and can settle later pairs (Dan, 2026-11-19: far too many questions).
  const [k, setK] = useState(0); // answered or skipped this session
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set()); // pairs answered or skipped
  const keyOf = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);
  const [busy, setBusy] = useState(false);
  const [nudged, setNudged] = useState<Nudged>(new Map());
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [k]);

  const finish = () => { void qc.invalidateQueries({ queryKey: CLOSE_COUNTS_KEY }); onDone(); };
  const byId = new Map<string, SetItem>((data?.items ?? []).map((i) => [i.id, i]));
  const now = (x: SetItem): SetItem => ({ ...x, rating: nudged.get(x.id)?.rating ?? x.rating });
  const pairs = (data?.pairs ?? []).filter(([a, b]) => !seen.has(keyOf(a, b)));
  const pair = pairs[0];

  async function answer(x: CloseAnswer) {
    if (pair === undefined || busy) return;
    const done = new Set(seen).add(keyOf(pair[0], pair[1]));
    if (x === 'skip') { setSeen(done); setK(k + 1); return; }
    const [a, b] = pair;
    const [w, l] = x === 'b' ? [b, a] : [a, b];
    setBusy(true);
    const changed = await saveClosePick(qc, set, { winnerId: w, loserId: l, isTie: x === 'same' });
    if (changed === null) { setBusy(false); toast.show(PICK_FAILED); return; }
    setNudged(addNudged(nudged, changed));
    setSeen(done);
    await refetch();
    setBusy(false);
    setK(k + 1);
  }

  const title = `Sharpen: ${setLabel(set)}`;
  const doneButton = <Button variant="ghost" compact onClick={finish}>Done</Button>;
  let body;
  if (isPending) body = <Skeleton height={320} />;
  else if (isError) {
    body = <EmptyState icon="info" title="Couldn't load the close calls" body="Check your connection and try again."
      actionLabel="Try again" onAction={() => void refetch()} />;
  } else if (pair === undefined) {
    body = (
      <div className="stack-18">
        <EmptyState icon="check" title={k === 0 ? 'All clear' : 'That was the last one'}
          body={k === 0 ? `No close ratings to compare on ${setLabel(set)}.` : 'Nothing close is left to ask about here.'} />
        {nudged.size > 0 && <NudgedList nudged={nudged} />}
        <Button variant="primary" className="btn--block" onClick={finish}>Done</Button>
      </div>
    );
  } else {
    const [a, b] = pair;
    body = (
      <div className="close-call">
        <div className="close-call__bar">
          <span className="close-call__count" aria-live="polite">Close call {k + 1} of {k + pairs.length}</span>
          <Button variant="ghost" compact disabled={busy} onClick={() => void answer('skip')}>Skip</Button>
        </div>
        <ClosePair key={`${a}|${b}`} a={now(byId.get(a)!)} b={now(byId.get(b)!)} busy={busy} wide={wide} onAnswer={(x) => void answer(x)} />
      </div>
    );
  }
  return (
    <div className="screen">
      <PageHeader title={title} titleRef={headingRef} actions={doneButton} />
      <div className="screen__body sharpen">{body}</div>
    </div>
  );
}
