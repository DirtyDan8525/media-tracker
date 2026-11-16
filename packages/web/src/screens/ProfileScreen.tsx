import { CATEGORY_CONFIG, formatRating, type Category, type Entry } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { logOut } from '../data/logout';
import { useRemoveAvatar, useSaveAvatar } from '../data/useAvatar';
import { useAllEntries } from '../data/useEntries';
import { Avatar } from '../design/components/Avatar';
import { Button } from '../design/components/Button';
import { CoverImage } from '../design/components/CoverImage';
import { Icon } from '../design/components/Icon';
import { useToast } from '../design/components/Toast';
import { sortEntries } from '../lists/sort';
import { enabledLists, LIST_LABEL } from '../nav';
import { computeStats } from '../ratings/stats';
import { numberOnes } from '../ratings/topFive';
import { useAddFriend } from '../shell/comingWithFriends';
import { useCurrentList } from '../shell/currentList';
import { PageHeader } from '../shell/PageHeader';
import { useSessionMe } from '../shell/SessionGate';
import { CropSheet, PhotoPreviewSheet, type CropRect } from './profile/AvatarEditor';
import { AvatarTooBigError, makeAvatar, readImage } from './profile/avatarImage';
import '../design/settings.css';
import '../design/nav.css';

const READ_ERROR = "Couldn't read that image. Try a JPEG or PNG.";
const SAVE_ERROR = "Couldn't save your photo. Try again.";
const TOO_BIG = 'That photo has too much detail to shrink. Try another.';
const DASH = '—';

/** "November 2026" from `users.created_at` (an ISO string; SQLite's "YYYY-MM-DD HH:MM:SS" counts as UTC). */
function memberSince(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const iso = /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(createdAt) ? createdAt : `${createdAt.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The banner's cover: the highest-rated title that has one, across the enabled lists. */
function bannerCover(byCategory: Partial<Record<Category, Entry[]>>, lists: Category[]): string | null {
  const rows = lists.flatMap((c) => byCategory[c] ?? []).filter((e) => e.coverUrl && e.rating !== null);
  return sortEntries(rows, 'rating')[0]?.coverUrl ?? null;
}

/** Profile (route /profile, B12): banner, photo, who you are, numbers, My #1s, then Top 5 / Stats / Settings and Log out. */
export function ProfileScreen() {
  const me = useSessionMe();
  const qc = useQueryClient();
  const toast = useToast();
  const addFriend = useAddFriend();
  const current = useCurrentList();
  const save = useSaveAvatar();
  const remove = useRemoveAvatar();
  const lists = useMemo(() => enabledLists(me.settings), [me.settings]);
  const { data, isPending } = useAllEntries(lists);

  const all = useMemo(() => computeStats(data, lists).all, [data, lists]);
  const ones = useMemo(() => numberOnes(data, lists), [data, lists]);
  const cover = useMemo(() => bannerCover(data, lists), [data, lists]);
  // Until every list has loaded (or failed), the totals would be partial: show a dash instead of a wrong number.
  const waiting = isPending && lists.some((c) => !data[c]);
  const num = (n: number | string) => (waiting ? DASH : n);

  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [draft, setDraft] = useState<{ type: 'image/webp' | 'image/jpeg'; data: string } | null>(null);

  const since = memberSince(me.createdAt);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be chosen again
    if (!file) return;
    setReading(true);
    try {
      setImage(await readImage(file));
    } catch {
      toast.show(READ_ERROR);
    } finally {
      setReading(false);
    }
  }

  function closeImage() {
    image?.close?.();
    setImage(null);
  }

  async function usePhoto(rect: CropRect) {
    if (!image) return;
    try {
      const made = await makeAvatar(image, rect);
      setDraft({ type: made.type, data: made.data });
      closeImage();
    } catch (err) {
      closeImage();
      toast.show(err instanceof AvatarTooBigError ? TOO_BIG : READ_ERROR);
    }
  }

  async function savePhoto() {
    if (!draft) return;
    try {
      await save.mutateAsync(draft);
      setDraft(null);
      toast.show('Photo saved');
    } catch {
      toast.show(SAVE_ERROR);
    }
  }

  async function removePhoto() {
    try {
      await remove.mutateAsync();
      toast.show('Photo removed');
    } catch {
      toast.show("Couldn't remove your photo. Try again.");
    }
  }

  return (
    <div className="screen profile">
      <PageHeader title="Profile" className="profile__banner" backdrop={cover}
        backTo={current ? `/list/${current}` : '/more'} backUsesHistory />
      <div className="screen__body profile__body">
        <div className="profile__id">
          <div className="profile__photo"><Avatar me={me} size={96} /></div>
          <div className="profile__photo-actions">
            <Button variant="ghost" compact disabled={reading} aria-busy={reading} onClick={() => fileInput.current?.click()}>
              {reading ? 'Reading photo…' : 'Change photo'}
            </Button>
            {me.avatarAt && <Button variant="ghost" compact disabled={remove.isPending} onClick={() => void removePhoto()}>Remove photo</Button>}
          </div>
          <input ref={fileInput} type="file" accept="image/*" hidden aria-label="Choose a photo" onChange={(e) => void onFile(e)} />
          <p className="profile__name">@{me.username}</p>
          {since && <p className="profile__since">Member since {since}</p>}
        </div>

        <div className="profile__tiles">
          <Tile value={num(all.entries)} label="Titles" />
          <Tile value={num(all.rated)} label="Rated" />
          <Tile value={waiting ? DASH : all.average === null ? DASH : formatRating(Math.round(all.average * 10) / 10)} label="Avg" />
          <Tile value={0} label="Friends" wide>
            <Button variant="primary" compact className="profile__add-friend" onClick={addFriend}>Add friend</Button>
          </Tile>
        </div>

        <section aria-labelledby="profile-ones" className="profile__ones">
          <h2 id="profile-ones" className="group__title">My #1s</h2>
          {ones.length === 0 ? (
            <p className="profile__empty">{waiting ? 'Loading your lists…' : 'Rate something to see your #1 of each list here.'}</p>
          ) : (
            <ul className="profile__strip plain-list">
              {ones.map((e) => (
                <li key={e.id}>
                  <Link to={`/entry/${e.id}`} className="profile__strip-link" aria-label={`${LIST_LABEL[e.category]} #1: ${e.title}`}>
                    <CoverImage src={e.coverUrl} alt={`${e.title} cover`} width={64} square={CATEGORY_CONFIG[e.category].square} />
                    <span className="profile__strip-label">{LIST_LABEL[e.category]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Task 11: the tier counts ("Loved 14 · Liked 22 · ...") go here, between My #1s and the rows. */}

        <div className="group__card">
          <Link to="/top5" className="group__row">
            <span className="group__row-start"><span className="tile-icon"><Icon name="top5" size={18} /></span>My Top 5</span>
            <span className="group__chev"><Icon name="chevron" size={18} /></span>
          </Link>
          <Link to="/stats" className="group__row">
            <span className="group__row-start"><span className="tile-icon"><Icon name="stats" size={18} /></span>Stats</span>
            <span className="group__chev"><Icon name="chevron" size={18} /></span>
          </Link>
          <Link to="/settings" className="group__row">
            <span className="group__row-start"><span className="tile-icon"><Icon name="settings" size={18} /></span>Settings</span>
            <span className="group__chev"><Icon name="chevron" size={18} /></span>
          </Link>
        </div>

        <div className="profile__logout">
          <Button className="profile__logout-btn" onClick={() => void logOut(qc)}><Icon name="logout" size={18} />Log out</Button>
        </div>
      </div>

      {image && <CropSheet image={image} onUse={(r) => void usePhoto(r)} onCancel={closeImage} />}
      {draft && <PhotoPreviewSheet photo={draft} saving={save.isPending} onSave={() => void savePhoto()} onCancel={() => setDraft(null)} />}
    </div>
  );
}

function Tile({ value, label, wide, children }: { value: number | string; label: string; wide?: boolean; children?: ReactNode }) {
  return (
    <div className={wide ? 'profile-tile profile-tile--wide' : 'profile-tile'}>
      <dl className="profile-stat">
        <div><dt>{label}</dt><dd>{value}</dd></div>
      </dl>
      {children}
    </div>
  );
}
