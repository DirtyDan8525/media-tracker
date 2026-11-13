import { formatRating, type Season } from '@media-tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { entriesKey, entryKey } from '../../data/entryCache';
import { Button } from '../../design/components/Button';
import { IconButton } from '../../design/components/IconButton';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { parseRating } from '../../lists/validate';
import { DetailField } from './DetailField';
import type { Entry } from '@media-tracker/shared';

const seasonsKey = (entryId: string) => ['seasons', entryId] as const;

/** The average of the rated seasons, as the API computes it (2 decimals). */
export function averageOf(seasons: Season[]): number | null {
  const r = seasons.map((s) => s.rating).filter((x): x is number => x !== null);
  return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 100) / 100 : null;
}

/** Seasons for an anime or TV entry: add, rename, rate, note, remove. The entry's average updates as you go. */
export function SeasonsEditor({ entry }: { entry: Pick<Entry, 'id' | 'category'> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = seasonsKey(entry.id);
  const { data, isPending, isError } = useQuery({ queryKey: key, queryFn: () => api.get<Season[]>(`/api/entries/${entry.id}/seasons`) });
  const seasons = data ?? [];

  /** Keep the list row's Season Avg in step without refetching the whole list. */
  function syncAverage(next: Season[]) {
    const seasonAvg = averageOf(next);
    qc.setQueryData<Entry[]>(entriesKey(entry.category), (rows) => rows?.map((e) => (e.id === entry.id ? { ...e, seasonAvg } : e)));
    qc.setQueryData<Entry>(entryKey(entry.id), (e) => e && { ...e, seasonAvg });
  }
  const fail = () => { toast.show("Couldn't save that change"); void qc.invalidateQueries({ queryKey: key }); };
  const set = (next: Season[]) => { qc.setQueryData(key, next); syncAverage(next); };

  const add = useMutation({
    mutationFn: () => api.post<Season>(`/api/entries/${entry.id}/seasons`, { label: `Season ${seasons.length + 1}` }),
    onSuccess: (s) => set([...(qc.getQueryData<Season[]>(key) ?? []), s]),
    onError: fail,
  });

  async function patch(s: Season, body: Partial<Pick<Season, 'label' | 'rating' | 'notes'>>) {
    const before = qc.getQueryData<Season[]>(key) ?? [];
    set(before.map((x) => (x.id === s.id ? { ...x, ...body } : x)));
    try { await api.patch<Season>(`/api/seasons/${s.id}`, body); } catch { set(before); fail(); }
  }
  async function remove(s: Season) {
    const before = qc.getQueryData<Season[]>(key) ?? [];
    set(before.filter((x) => x.id !== s.id));
    try { await api.del(`/api/seasons/${s.id}`); } catch { set(before); fail(); }
  }

  const avg = averageOf(seasons);
  return (
    <section className="detail__section" aria-labelledby="seasons-h">
      <div className="detail__h-row">
        <h2 id="seasons-h" className="detail__h">
          Seasons{avg !== null && <span className="detail__h-sub"> · avg {formatRating(avg)}</span>}
        </h2>
        <Button variant="ghost" compact disabled={add.isPending} onClick={() => add.mutate()}>Add season</Button>
      </div>
      {isPending && <Skeleton height={44} />}
      {isError && <p className="field-hint">Couldn't load seasons.</p>}
      {seasons.map((s, i) => (
        <div key={s.id} className="season-row">
          <DetailField hideLabel label={`Season ${i + 1} name`} value={s.label} maxLength={100} className="season-row__f"
            check={(v) => (v.trim() === '' ? 'Give the season a name.' : null)} onSave={(label) => void patch(s, { label })} />
          <DetailField hideLabel label={`Season ${i + 1} rating`} type="number" value={s.rating === null ? '' : String(s.rating)}
            placeholder="–" check={(v) => { const p = parseRating(v); return p.ok ? null : p.error; }}
            onSave={(v) => { const p = parseRating(v); if (p.ok) void patch(s, { rating: p.value }); }} />
          <DetailField hideLabel label={`Season ${i + 1} notes`} value={s.notes} maxLength={5000} placeholder="Notes" onSave={(notes) => void patch(s, { notes })} />
          <IconButton label={`Remove season ${i + 1}`} icon="close" look="plain" onClick={() => void remove(s)} />
        </div>
      ))}
    </section>
  );
}
