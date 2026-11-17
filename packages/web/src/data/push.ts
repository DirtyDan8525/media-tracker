import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { isInstalled, isIos } from '../screens/onboarding/install';

/**
 * What this device can do about notifications (Phase 6b, P4, P6):
 * - `install`: iPhone/iPad in Safari; web push works only in the home-screen app;
 * - `unsupported`: this browser has no push;
 * - `not-set-up`: the server has no VAPID keys yet;
 * - `denied`: the browser's permission is blocked (only the browser settings can undo it);
 * - `off` / `on`: this browser is not / is subscribed.
 */
export type PushState = 'loading' | 'install' | 'unsupported' | 'not-set-up' | 'denied' | 'off' | 'on';

const KEY = ['push-key'] as const;
const SUB = ['push-subscription'] as const;

const canPush = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

/** The VAPID public key (base64url) the browser needs, as the bytes subscribe() takes. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(key.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export function usePushDevice() {
  const qc = useQueryClient();
  const platform = isIos() && !isInstalled() ? 'install' : canPush() ? 'ok' : 'unsupported';
  const key = useQuery({
    queryKey: KEY,
    enabled: platform === 'ok',
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      try {
        return (await api.get<{ key: string }>('/api/push/key')).key;
      } catch (err) {
        if (err instanceof ApiError && err.status === 503) return null;
        throw err;
      }
    },
  });
  const sub = useQuery({
    queryKey: SUB,
    enabled: platform === 'ok' && typeof key.data === 'string',
    staleTime: Infinity,
    queryFn: async () => (await currentSubscription()) !== null,
  });

  const enable = useMutation({
    // Must start from a tap: the permission prompt needs a user gesture (iOS especially).
    mutationFn: async () => {
      if (typeof key.data !== 'string') throw new Error('not set up');
      if ((await Notification.requestPermission()) !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const s = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.data) }));
      try {
        await api.post('/api/push/subscribe', s.toJSON());
      } catch (err) {
        if (!existing) await s.unsubscribe().catch(() => false);
        throw err;
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SUB }),
  });
  const disable = useMutation({
    mutationFn: async () => {
      const s = await currentSubscription();
      if (!s) return;
      await api.post('/api/push/unsubscribe', { endpoint: s.endpoint }).catch(() => undefined);
      await s.unsubscribe();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SUB }),
  });

  let state: PushState;
  if (platform !== 'ok') state = platform;
  else if (key.isPending) state = 'loading';
  else if (key.data === null || key.isError) state = 'not-set-up';
  else if (sub.data === true) state = 'on';
  else if (Notification.permission === 'denied') state = 'denied';
  else state = sub.isPending ? 'loading' : 'off';
  return { state, enable, disable };
}
