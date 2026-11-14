import type { Entry } from '@media-tracker/shared';
import Dexie, { type Table } from 'dexie';
import type { Me } from '../api/types';

export interface MeRecord { key: 'me'; value: Me }

/** The on-device cache: lists paint instantly from here, then refresh from the API. */
export class LocalDb extends Dexie {
  entries!: Table<Entry, string>;
  me!: Table<MeRecord, string>;

  constructor() {
    super('media-tracker');
    this.version(1).stores({
      entries: 'id, category, [category+rating]',
      me: 'key',
    });
  }
}

export const localDb = new LocalDb();
