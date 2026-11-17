import type { Category } from '@media-tracker/shared';
import { useMemo } from 'react';
import { useAppSettings } from '../data/appSettings';
import { enabledLists } from '../nav';
import { useSessionMe } from './SessionGate';

/** The signed-in person's lists in the admin's order, minus the ones hidden for everyone and the ones they turned off. */
export function useEnabledLists(): Category[] {
  const me = useSessionMe();
  const { lists } = useAppSettings();
  return useMemo(() => enabledLists(me.settings, lists), [me.settings, lists]);
}
