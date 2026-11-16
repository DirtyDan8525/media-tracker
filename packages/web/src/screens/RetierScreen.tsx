import {
  applyMove, compareRated, RATING_SETS, tierFor, tierRange, tiersFor, type RatingSet, type SetItem, type Tier,
} from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, Navigate, useBlocker, useParams } from 'react-router';
import { ratingSetKey, saveRatingsResult, useRatingSet } from '../data/ratings';
import { Button } from '../design/components/Button';
import { CoverImage } from '../design/components/CoverImage';
import { EmptyState } from '../design/components/EmptyState';
import { RatingBadge } from '../design/components/RatingBadge';
import { Sheet } from '../design/components/Sheet';
import { Skeleton } from '../design/components/Skeleton';
import { TierPicker, TIERS_TOP_FIRST, tierRangeLabels } from '../design/components/TierPicker';
import { useToast } from '../design/components/Toast';
import { useIsWide } from '../hooks';
import { enabledLists, LIST_LABEL, seasonsEnabled } from '../nav';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { MoveMenu } from './compare/MoveMenu';
import '../design/compare.css';

const SEASON_LABEL: Partial<Record<RatingSet, string>> = { anime_seasons: 'Anime Seasons', tv_seasons: 'TV Seasons' };
const labelOf = (set: RatingSet): string => SEASON_LABEL[set] ?? LIST_LABEL[set as keyof typeof LIST_LABEL];

export const RETIER_INTRO = 'Check which tier each title is in. Scores from the Sheet may have been lowered by its old compare system, so some may belong higher. A moved title starts near the edge of its new tier closest to where it was.';

const isSet = (s: string | undefined): s is RatingSet => RATING_SETS.includes(s as RatingSet);

/** Re-tier review (route /retier/:set): move titles between tiers, then Save. Nothing is saved before that. */
export function RetierScreen() {
  const { set } = useParams();
  const me = useSessionMe();
  const first = enabledLists(me.settings)[0];
  const parent = isSet(set) ? (set === 'anime_seasons' ? 'anime' : set === 'tv_seasons' ? 'tv' : set) : null;
  const allowed = parent !== null && enabledLists(me.settings).includes(parent)
    && (parent === set || seasonsEnabled(me.settings, parent));
  // An unknown or switched-off set goes to the first list that is on (Settings when none is).
  if (!isSet(set) || !allowed) return <Navigate to={first ? `/retier/${first}` : '/settings'} replace />;
  // A new set starts with no moves: leaving a set discards them.
  return <Retier key={set} set={set} />;
}

function Retier({ set }: { set: RatingSet }) {
  const me = useSessionMe();
  const wide = useIsWide();
  const qc = useQueryClient();
  const toast = useToast();
  const data = useRatingSet(set);
  const tiers = tiersFor(me.settings, set);
  const names = tiers.names;
  const ranges = useMemo(() => tierRangeLabels(tiers), [tiers]);

  /** The moves so far: id → the tier the title is in now. Only titles that differ from where they started. */
  const [moves, setMoves] = useState<ReadonlyMap<string, Tier>>(new Map());
  const [saving, setSaving] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [overTier, setOverTier] = useState<Tier | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** The save went through but the reload after it failed: the moves are already saved, so they stay on screen. */
  const [reloadFailed, setReloadFailed] = useState(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [focusId, setFocusId] = useState<string | null>(null);

  const base = useMemo(() => {
    const out = new Map<string, SetItem & { tier: Tier }>();
    for (const i of data.data?.items ?? []) {
      const tier = i.tier ?? (i.rating !== null ? tierFor(i.rating, tiers) : null);
      if (tier !== null) out.set(i.id, { ...i, tier });
    }
    return out;
  }, [data.data, tiers]);

  // Each moved title is applyMove(base, final tier): moving it twice never compounds, and the preview is what Save makes.
  const shown = useMemo(() => {
    const rows: { item: SetItem & { tier: Tier }; was: Tier | null }[] = [];
    for (const [id, item] of base) {
      const to = moves.get(id);
      rows.push(to === undefined ? { item, was: null } : { item: { ...item, ...applyMove(item, to, tiers), tier: to }, was: item.tier });
    }
    return rows;
  }, [base, moves, tiers]);

  const sections = useMemo(() => TIERS_TOP_FIRST.map((tier) => ({
    tier,
    rows: shown.filter((r) => r.item.tier === tier).sort((a, b) => compareRated(a.item, b.item)),
  })), [shown]);

  // After a move the row sits in another section (a new element): keep keyboard focus on its Move button.
  useEffect(() => {
    if (focusId === null) return;
    buttons.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId, moves]);

  const moved = moves.size;

  // Unsaved moves are one tap from lost (a chip, Back, the nav): ask first.
  const blocker = useBlocker(moved > 0 && !reloadFailed);

  function move(id: string, to: Tier) {
    if (saving) return;
    const item = base.get(id);
    if (!item) return;
    const now = moves.get(id) ?? item.tier;
    if (to === now) return; // same tier: nothing
    const next = new Map(moves);
    if (to === item.tier) next.delete(id); else next.set(id, to);
    setMoves(next);
    setAnnounce(`Moved ${item.title} to ${names[to]}.`);
    setFocusId(id);
  }

  async function reload(): Promise<boolean> {
    try {
      await qc.refetchQueries({ queryKey: ratingSetKey(set) }, { throwOnError: true });
      return true;
    } catch {
      return false;
    }
  }

  async function save() {
    if (!moved || saving || reloadFailed) return;
    setSaving(true);
    const result = await saveRatingsResult(qc, set, {
      picks: [], moves: [...moves].map(([id, tier]) => ({ id, tier })), done: [],
    });
    if (result === 'ok') {
      // The set reloads with the Worker's numbers; clear the moves only once it has, so no row jumps back.
      if (await reload()) {
        setMoves(new Map());
        toast.show(moved === 1 ? 'Saved. 1 title moved.' : `Saved. ${moved} titles moved.`);
      } else {
        setReloadFailed(true);
      }
    } else {
      toast.show(result === 'conflict'
        ? 'Your ratings changed elsewhere. Your moves are still here; check them and save again.'
        : "Couldn't save your moves. Try again.");
    }
    setSaving(false);
  }

  async function retryReload() {
    setSaving(true);
    if (await reload()) {
      setMoves(new Map());
      setReloadFailed(false);
      toast.show(moved === 1 ? 'Saved. 1 title moved.' : `Saved. ${moved} titles moved.`);
    }
    setSaving(false);
  }

  const onDragStart = (e: DragEvent, id: string) => {
    if (saving) { e.preventDefault(); return; }
    setDraggingId(id);
    e.dataTransfer?.setData?.('text/plain', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e: DragEvent, tier: Tier) => {
    e.preventDefault();
    const id = draggingId ?? e.dataTransfer?.getData?.('text/plain');
    setDraggingId(null);
    setOverTier(null);
    if (id) move(id, tier);
  };

  const lists = enabledLists(me.settings);
  const chips: RatingSet[] = lists.flatMap((c) => {
    const s = c === 'anime' ? 'anime_seasons' : c === 'tv' ? 'tv_seasons' : null;
    return s !== null && seasonsEnabled(me.settings, c) ? [c, s as RatingSet] : [c];
  });
  const saveButton = (
    <Button variant="primary" disabled={!moved || saving || reloadFailed} onClick={() => void save()}
      className={wide ? undefined : 'retier__save'}>
      Save ({moved} moved)
    </Button>
  );

  const sheetItem = sheetFor !== null ? base.get(sheetFor) : undefined;
  const sheetNow = sheetFor !== null ? moves.get(sheetFor) ?? sheetItem?.tier ?? null : null;

  const body = (() => {
    if (data.isPending) return <div className="stack-10" aria-busy="true" aria-label="Loading"><Skeleton height={64} /><Skeleton height={64} /></div>;
    if (data.isError && !data.data) {
      return <EmptyState icon="info" title="Couldn't load your ratings" body="Check your connection and try again."
        actionLabel="Retry" onAction={() => void data.refetch()} />;
    }
    if (base.size === 0) {
      return <EmptyState icon="compare" title="Nothing to check yet" body="Titles with a score or a tier show up here. Rate a few, then come back." />;
    }
    return (
      <div className={wide ? 'retier__cols' : 'retier__stack'}>
        {sections.map(({ tier, rows }) => (
          <section key={tier} aria-labelledby={`retier-h-${tier}`}
            className={overTier === tier ? 'retier__sec is-over' : 'retier__sec'}
            onDragOver={wide ? (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; setOverTier(tier); } : undefined}
            onDragLeave={wide ? () => setOverTier((t) => (t === tier ? null : t)) : undefined}
            onDrop={wide ? (e) => onDrop(e, tier) : undefined}>
            <div className="retier__sec-head">
              <h2 id={`retier-h-${tier}`} className="retier__h">{names[tier]} · {rows.length}</h2>
              <span className="retier__range">{ranges[tier]}</span>
            </div>
            <ul className="retier__list">
              {rows.map(({ item, was }) => (
                <li key={item.id} className={draggingId === item.id ? 'retier__row is-dragging' : 'retier__row'}
                  draggable={wide ? !saving : undefined}
                  onDragStart={wide ? (e) => onDragStart(e, item.id) : undefined}
                  onDragEnd={wide ? () => { setDraggingId(null); setOverTier(null); } : undefined}>
                  <CoverImage src={item.cover} alt={`${item.title} cover`} square={item.square} width={wide ? 32 : 36} />
                  <div className="retier__meta">
                    <span className="retier__title">{item.title}</span>
                    {was !== null && <span className="retier__was">was {names[was]}</span>}
                  </div>
                  <RatingBadge rating={item.rating} size="xs" />
                  <div className="retier__move">
                    <button type="button" className="btn btn--compact retier__move-btn" aria-haspopup={wide ? 'menu' : 'dialog'}
                      aria-expanded={wide ? menuFor === item.id : undefined}
                      aria-label={`Move ${item.title} to…`} disabled={saving}
                      ref={(el) => { if (el) buttons.current.set(item.id, el); else buttons.current.delete(item.id); }}
                      onClick={() => (wide ? setMenuFor(menuFor === item.id ? null : item.id) : setSheetFor(item.id))}>
                      Move to…
                    </button>
                    {wide && menuFor === item.id && (
                      <MoveMenu title={item.title} current={item.tier} names={names} ranges={ranges}
                        anchor={{ current: buttons.current.get(item.id) ?? null }}
                        onClose={() => { setMenuFor(null); buttons.current.get(item.id)?.focus(); }}
                        onPick={(t) => { setMenuFor(null); move(item.id, t); }} />
                    )}
                  </div>
                </li>
              ))}
              {rows.length === 0 && <li className="retier__empty">{wide ? 'Drop a title here, or use Move to… on a row.' : 'No titles in this tier.'}</li>}
            </ul>
          </section>
        ))}
      </div>
    );
  })();

  return (
    <div className={wide ? 'screen retier retier--wide' : 'screen retier'}>
      <PageHeader title="Re-tier" sub={labelOf(set)} backTo="/settings" backUsesHistory actions={wide ? saveButton : undefined} profile />
      <div className="screen__body stack-10">
        <p className="compare__sub retier__intro">{RETIER_INTRO}</p>
        <nav aria-label="Lists to re-tier" className="retier__chips">
          {chips.map((s) => (
            <Link key={s} to={`/retier/${s}`} className={s === set ? 'btn btn--chip is-active' : 'btn btn--chip'} aria-current={s === set ? 'page' : undefined}>
              {labelOf(s)}
            </Link>
          ))}
        </nav>
        {reloadFailed && (
          <div role="alert" className="field-error stack-10">
            <span>Saved, but couldn't reload your ratings. Your moves are saved; the scores shown may be out of date.</span>
            <Button onClick={() => void retryReload()} disabled={saving}>Reload</Button>
          </div>
        )}
        {body}
        <div role="status" className="sr-only">{announce}</div>
      </div>
      {!wide && <div className="retier__footer">{saveButton}</div>}
      <Sheet open={blocker.state === 'blocked'} title="Discard your moves?" onClose={() => blocker.reset?.()}>
        <p>{moved === 1 ? '1 title has moved' : `${moved} titles have moved`} but not been saved. Leaving now throws that away.</p>
        <div className="import__actions">
          <Button variant="primary" onClick={() => blocker.reset?.()}>Keep editing</Button>
          <Button onClick={() => blocker.proceed?.()}>Discard moves</Button>
        </div>
      </Sheet>
      <Sheet open={sheetItem !== undefined} title={sheetItem ? `Move “${sheetItem.title}” to…` : 'Move to…'} onClose={() => setSheetFor(null)}>
        {sheetItem && (
          <TierPicker label="Tier" names={names} ranges={([0, 1, 2, 3] as Tier[]).map((t) => tierRange(tiers, t))}
            value={sheetNow} onPick={(t) => { const id = sheetFor!; setSheetFor(null); move(id, t); }} />
        )}
      </Sheet>
    </div>
  );
}
