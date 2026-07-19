import type { PersistentKeyValueStore } from '../storage/persistent-key-value-store';
import {
  dataProfileKeyPrefix,
  dataStorageKeys,
  principalScope,
  type DataPrincipal,
} from '../storage/data-principal';
import type { WatchProfileStorage } from '../storage/watch-profile-storage';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import type { DiveLogRepository } from './dive-log-repository';
import type { DivePlanRepository } from './dive-plan-repository';
import { PersistentDiveLogRepository } from './persistent-dive-log-repository';
import { PersistentDivePlanRepository } from './persistent-dive-plan-repository';

export type PrincipalRepositories = {
  principal: DataPrincipal;
  queryScope: string;
  logbook: DiveLogRepository;
  planbook: DivePlanRepository;
};

export type PrincipalRepositoryDependencies = {
  metadataStorage: PersistentKeyValueStore;
  profileStorage: WatchProfileStorage;
  now?: () => number;
};

export function createPrincipalRepositories(
  principal: DataPrincipal,
  dependencies: PrincipalRepositoryDependencies,
): PrincipalRepositories {
  const keys = dataStorageKeys(principal);

  return {
    principal,
    queryScope: principalScope(principal),
    logbook: new PersistentDiveLogRepository({
      storage: dependencies.metadataStorage,
      storageKey: keys.logbook,
      profileStorage: dependencies.profileStorage,
      profileKeyPrefix: dataProfileKeyPrefix(principal),
      now: dependencies.now,
      initialEntries: [],
    }),
    planbook: new PersistentDivePlanRepository({
      storage: dependencies.metadataStorage,
      storageKey: keys.planbook,
      now: dependencies.now,
      initialPlans: [],
    }),
  };
}

type PrincipalRow = DiveLogEntry | DivePlan;

export function composeAccountAndDeferredGuestRows<T extends PrincipalRow>(
  accountRows: readonly T[],
  guestRows: readonly T[],
): T[] {
  const seenLocalIds = new Set<string>();
  const rows: T[] = [];

  for (const row of accountRows) {
    if (!seenLocalIds.has(row.localId)) {
      seenLocalIds.add(row.localId);
      rows.push(row);
    }
  }
  for (const row of guestRows) {
    if (!seenLocalIds.has(row.localId)) {
      seenLocalIds.add(row.localId);
      rows.push({ ...row, ownerUserId: undefined });
    }
  }

  return rows;
}
