import { isBuiltinCategory, type Category } from '@media-tracker/shared';
import { useMemo } from 'react';
import { useAppSettings } from '../data/appSettings';
import { enabledLists } from '../nav';
import { useSessionMe } from './SessionGate';

/** The signed-in person's lists in the admin's order (their custom lists after), minus the ones hidden for everyone and the ones they turned off. */
export function useEnabledLists(): Category[] {
  const me = useSessionMe();
  const { lists } = useAppSettings();
  return useMemo(() => enabledLists(me.settings, lists, me.customLists), [me.settings, lists, me.customLists]);
}

/** Your lists that are built in (Group Top 5 and Recommend cover these only: a custom list is yours alone). */
export function useEnabledBuiltinLists(): Category[] {
  const lists = useEnabledLists();
  return useMemo(() => lists.filter((c) => isBuiltinCategory(c)), [lists]);
}
