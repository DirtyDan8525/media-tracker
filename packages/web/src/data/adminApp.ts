import type { ApplyKey, AppSettingKey, AppSettings } from '@media-tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AdminComment, AdminNumbers, Explanation, SourceCheck } from '../api/adminTypes';
import { APP_KEY } from './appSettings';
import { ME_KEY } from './useMe';

export const ADMIN_APP_KEY = ['admin-app'] as const;

export interface AdminApp {
  settings: AppSettings;
  /** The keys that have been saved (the rest are on their built-in default). */
  set: AppSettingKey[];
  /** Active people "Apply to everyone" reaches. */
  people?: number;
}

export function useAdminApp() {
  return useQuery({ queryKey: ADMIN_APP_KEY, queryFn: () => api.get<AdminApp>('/api/admin/app'), staleTime: 0 });
}

function refreshApp(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([qc.invalidateQueries({ queryKey: ADMIN_APP_KEY }), qc.invalidateQueries({ queryKey: APP_KEY })]);
}

/** PUT /api/admin/app/:key { value }: resolves with the value the server saved. */
export function useSaveSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: AppSettingKey; value: unknown }) => api.put<{ key: string; value: unknown }>(`/api/admin/app/${key}`, { value }),
    onSuccess: () => refreshApp(qc),
  });
}

/** POST /api/admin/defaults/apply { key }: writes the default into every active person's settings. Resolves with how many people it reached. */
export function useApplyDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: ApplyKey) => api.post<{ key: string; people: number }>('/api/admin/defaults/apply', { key }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

/** DELETE /api/admin/app/:key: back to the built-in default. */
export function useResetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: AppSettingKey) => api.del(`/api/admin/app/${key}`),
    onSuccess: () => refreshApp(qc),
  });
}

export function useAdminComments() {
  return useQuery({ queryKey: ['admin-comments'], queryFn: () => api.get<{ comments: AdminComment[] }>('/api/admin/comments?limit=50').then((r) => r.comments), staleTime: 0 });
}

export function useAdminNumbers() {
  return useQuery({ queryKey: ['admin-numbers'], queryFn: () => api.get<AdminNumbers>('/api/admin/numbers'), staleTime: 0 });
}

export function useCheckSources() {
  return useMutation({ mutationFn: () => api.post<{ sources: SourceCheck[] }>('/api/admin/lookup/check').then((r) => r.sources) });
}

export function useExplainLookup() {
  return useMutation({ mutationFn: (v: { category: string; title: string }) => api.post<Explanation>('/api/admin/lookup/explain', v) });
}

/** Deletes any comment (the admin may delete anyone's), then the Recent comments list refetches. */
export function useAdminDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/comments/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-comments'] }),
  });
}

/**
 * "Download a backup": fetch the JSON, make a Blob and click a hidden a[download]. The name follows the server's
 * `media-tracker-backup-YYYY-MM-DD.json`. Throws on a failed request.
 */
export async function downloadBackup(now: Date = new Date()): Promise<string> {
  const res = await fetch('/api/admin/backup', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`backup ${res.status}`);
  const blob = await res.blob();
  const name = `media-tracker-backup-${now.toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}
