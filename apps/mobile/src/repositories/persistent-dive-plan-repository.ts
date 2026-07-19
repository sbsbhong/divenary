import { createAsyncStorageKeyValueStore, type PersistentKeyValueStore } from '../storage/persistent-key-value-store';
import {
  PersistentJsonStore,
  UnsupportedStorageVersionError,
  type StoredEnvelope,
} from '../storage/persistent-json-store';
import { mobileStorageKeys } from '../storage/storage-keys';
import type { DivePlan } from '../types/dive-plan';
import type { DivePlanRepository } from './dive-plan-repository';
import { cloneDivePlan, compareDivePlans } from './local-dive-plan-repository';

export type PersistentDivePlanRepositoryOptions = {
  storage?: PersistentKeyValueStore;
  storageKey?: string;
  now?: () => number;
  initialPlans?: DivePlan[];
  onReadError?: (error: Error) => void;
};

export const DIVE_PLANBOOK_SCHEMA_VERSION = 3;

export class PersistentDivePlanRepository implements DivePlanRepository {
  private readonly store: PersistentJsonStore<DivePlan[]>;
  private readonly now: () => number;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: PersistentDivePlanRepositoryOptions = {}) {
    const initialPlans = options.initialPlans ?? [];
    this.now = options.now ?? getCurrentTimestampSeconds;
    const storageKey = options.storageKey ?? mobileStorageKeys.planbook;
    this.store = new PersistentJsonStore<DivePlan[]>({
      key: storageKey,
      schemaVersion: DIVE_PLANBOOK_SCHEMA_VERSION,
      defaultValue: () => initialPlans.map(normalizeDivePlan),
      migrate: envelope => migrateDivePlanbookEnvelope(envelope, storageKey),
      storage: options.storage ?? createAsyncStorageKeyValueStore(),
      now: this.now,
      onReadError: options.onReadError,
    });
  }

  async list(): Promise<DivePlan[]> {
    return (await this.readPlans()).map(cloneDivePlan).sort((left, right) => compareDivePlans(left, right, this.now()));
  }

  async get(localId: string): Promise<DivePlan | undefined> {
    const plan = (await this.readPlans()).find(currentPlan => currentPlan.localId === localId);
    return plan ? cloneDivePlan(plan) : undefined;
  }

  async save(plan: DivePlan): Promise<DivePlan> {
    return this.enqueueMutation(async () => {
      const normalizedPlan = normalizeDivePlan(plan);
      const plans = await this.readPlans();
      const nextPlans = plans.some(currentPlan => currentPlan.localId === plan.localId)
        ? plans.map(currentPlan => (currentPlan.localId === plan.localId ? normalizedPlan : currentPlan))
        : [...plans, normalizedPlan];

      await this.writePlans(nextPlans);
      return cloneDivePlan(normalizedPlan);
    });
  }

  async delete(localId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const plans = await this.readPlans();
      await this.writePlans(plans.filter(plan => plan.localId !== localId));
    });
  }

  private async readPlans(): Promise<DivePlan[]> {
    return (await this.store.read()).map(cloneDivePlan);
  }

  private async writePlans(plans: DivePlan[]): Promise<void> {
    await this.store.write(plans.map(normalizeDivePlan).sort((left, right) => compareDivePlans(left, right, this.now())));
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const createDefaultPersistentDivePlanRepository = (
  options: PersistentDivePlanRepositoryOptions = {},
): PersistentDivePlanRepository => new PersistentDivePlanRepository(options);

export const defaultPersistentDivePlanRepository = createDefaultPersistentDivePlanRepository();

function getCurrentTimestampSeconds(): number {
  return Date.now() / 1000;
}

export function parseDivePlanbookEnvelope(
  rawValue: string,
  storageKey: string = mobileStorageKeys.planbook,
): DivePlan[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`Malformed planbook envelope for ${storageKey}`);
  }

  return migrateDivePlanbookEnvelope(parsed as StoredEnvelope<unknown>, storageKey);
}

export function migrateDivePlanbookEnvelope(
  envelope: StoredEnvelope<unknown>,
  storageKey: string = mobileStorageKeys.planbook,
): DivePlan[] {
  assertEnvelope(envelope, storageKey);

  if (envelope.schemaVersion === DIVE_PLANBOOK_SCHEMA_VERSION) {
    assertDivePlans(envelope.value, true, storageKey);
    return (envelope.value as DivePlan[]).map(normalizeDivePlan);
  }

  if (envelope.schemaVersion === 2) {
    assertDivePlans(envelope.value, false, storageKey);
    return (envelope.value as DivePlan[]).map(plan => {
      const {
        remoteId: _legacyRemoteId,
        ownerUserId: _legacyOwnerUserId,
        cloudSyncStatus: _legacyCloudSyncStatus,
        ...legacyPlan
      } = plan;
      return normalizeDivePlan(legacyPlan);
    });
  }

  throw new UnsupportedStorageVersionError(storageKey, Number(envelope.schemaVersion));
}

function normalizeDivePlan(plan: DivePlan): DivePlan {
  return cloneDivePlan({ ...plan, cloudSyncStatus: plan.cloudSyncStatus ?? 'notConfigured' });
}

function assertEnvelope(value: unknown, storageKey: string): asserts value is StoredEnvelope<unknown> {
  if (!isRecord(value)
    || !Number.isInteger(value.schemaVersion)
    || typeof value.updatedAt !== 'number'
    || !Number.isFinite(value.updatedAt)
    || !('value' in value)) {
    throw new Error(`Malformed planbook envelope for ${storageKey}`);
  }
}

function assertDivePlans(value: unknown, requireCloudStatus: boolean, storageKey: string): asserts value is DivePlan[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed planbook value for ${storageKey}`);
  }

  for (const plan of value) {
    if (!isRecord(plan)
      || !isNonEmptyString(plan.localId)
      || (plan.status !== 'draft' && plan.status !== 'planned' && plan.status !== 'completed')
      || !isFiniteNumber(plan.createdAt)
      || !isFiniteNumber(plan.updatedAt)
      || !isRecord(plan.site)
      || !Array.isArray(plan.buddyIds)
      || !Array.isArray(plan.gearIds)
      || !Array.isArray(plan.tags)
      || !isRecord(plan.plannedValues)
      || !Array.isArray(plan.checklistItems)
      || (requireCloudStatus && !isCloudSyncStatus(plan.cloudSyncStatus))
      || (plan.ownerUserId !== undefined && typeof plan.ownerUserId !== 'string')
      || (plan.remoteId !== undefined && typeof plan.remoteId !== 'string')) {
      throw new Error(`Malformed planbook entry for ${storageKey}`);
    }
  }
}

function isCloudSyncStatus(value: unknown): boolean {
  return value === 'notConfigured' || value === 'pending' || value === 'synced' || value === 'failed';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
