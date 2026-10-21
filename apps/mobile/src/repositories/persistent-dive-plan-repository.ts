import { createAsyncStorageKeyValueStore, type PersistentKeyValueStore } from '../storage/persistent-key-value-store';
import {
  PersistentJsonStore,
  UnsupportedStorageVersionError,
  type StoredEnvelope,
} from '../storage/persistent-json-store';
import { withLegacyDataMigrationLock } from '../storage/legacy-data-migration-lock';
import { mobileStorageKeys } from '../storage/storage-keys';
import type { DivePlan } from '../types/dive-plan';
import type {ConditionalDeleteResult, DeletePredicate} from './conditional-delete';
import type {
  ConditionalDeleteManyResult,
  ConditionalDeleteRequest,
} from './bulk-conditional-delete';
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
      readFailurePolicy: 'throw',
      recoveryKeys: {
        pending: `${storageKey}:journal:pending:v1`,
        commit: `${storageKey}:journal:commit:v1`,
        quarantinePrefix: `${storageKey}:quarantine:v1:`,
      },
    });
  }

  async list(): Promise<DivePlan[]> {
    return (await this.readPlans()).sort((left, right) => compareDivePlans(left, right, this.now()));
  }

  async get(localId: string): Promise<DivePlan | undefined> {
    const plan = (await this.store.read()).find(currentPlan => currentPlan.localId === localId);
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
    await this.deleteIf(localId, () => true);
  }

  async deleteIf(
    localId: string,
    predicate: DeletePredicate<DivePlan>,
  ): Promise<ConditionalDeleteResult> {
    return this.enqueueMutation(async () => {
      const plans = await this.readPlans();
      const current = plans.find(plan => plan.localId === localId);
      if (current === undefined) {
        return 'notFound';
      }
      if (!predicate(cloneDivePlan(current))) {
        return 'conditionFailed';
      }
      await this.writePlans(plans.filter(plan => plan.localId !== localId));
      return 'deleted';
    });
  }

  async deleteManyIf(
    requests: readonly ConditionalDeleteRequest<DivePlan>[],
  ): Promise<ConditionalDeleteManyResult> {
    return this.enqueueMutation(async () => {
      const plans = await this.readPlans();
      const plansByLocalId = new Map(
        plans.map(current => [current.localId, current]),
      );
      const deletedLocalIds = new Set<string>();
      const results = new Map<string, ConditionalDeleteResult>();

      for (const request of requests) {
        const current = plansByLocalId.get(request.localId);
        if (current === undefined || deletedLocalIds.has(request.localId)) {
          results.set(request.localId, 'notFound');
        } else if (!request.predicate(cloneDivePlan(current))) {
          results.set(request.localId, 'conditionFailed');
        } else {
          deletedLocalIds.add(request.localId);
          results.set(request.localId, 'deleted');
        }
      }

      if (deletedLocalIds.size > 0) {
        await this.writePlans(
          plans.filter(current => !deletedLocalIds.has(current.localId)),
        );
      }
      return results;
    });
  }

  private async readPlans(): Promise<DivePlan[]> {
    return (await this.store.read()).map(cloneDivePlan);
  }

  private async writePlans(plans: DivePlan[]): Promise<void> {
    await this.store.write(plans.map(normalizeDivePlan).sort((left, right) => compareDivePlans(left, right, this.now())));
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(() => withLegacyDataMigrationLock(operation));
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

  return migrateDivePlanbookEnvelope(parsed, storageKey);
}

export function migrateDivePlanbookEnvelope(
  envelope: unknown,
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
      const legacyPlan = { ...plan };
      delete legacyPlan.remoteId;
      delete legacyPlan.ownerUserId;
      delete legacyPlan.cloudSyncStatus;
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
    || !hasOnlyKeys(value, ['schemaVersion', 'updatedAt', 'value'])
    || !Number.isInteger(value.schemaVersion)
    || typeof value.updatedAt !== 'number'
    || !Number.isFinite(value.updatedAt)
    || !('value' in value)) {
    throw new Error(`Malformed planbook envelope for ${storageKey}`);
  }
}

function assertDivePlans(value: unknown, requireCloudStatus: boolean, storageKey: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed planbook value for ${storageKey}`);
  }

  for (const plan of value) {
    if (!isRecord(plan)
      || !hasOnlyKeys(plan, [
        'localId',
        'remoteId',
        'remoteRevision',
        'ownerUserId',
        'cloudSyncStatus',
        'status',
        'createdAt',
        'updatedAt',
        'plannedAt',
        'completedAt',
        'convertedLogLocalId',
        'title',
        'diveMode',
        'entryStyle',
        'site',
        'buddyIds',
        'gearIds',
        'tags',
        'objective',
        'notes',
        'plannedValues',
        'checklistItems',
      ])
      || !isNonEmptyString(plan.localId)
      || (plan.status !== 'draft' && plan.status !== 'planned' && plan.status !== 'completed')
      || !isFiniteNumber(plan.createdAt)
      || !isFiniteNumber(plan.updatedAt)
      || !optionalFiniteNumber(plan.plannedAt)
      || !optionalFiniteNumber(plan.completedAt)
      || !isOptionalNonEmptyString(plan.convertedLogLocalId)
      || !isOptionalString(plan.title)
      || !isOptionalEnum(plan.diveMode, ['scuba', 'freedive'])
      || !isOptionalEnum(plan.entryStyle, ['shore', 'boat', 'pool'])
      || !isOptionalString(plan.objective)
      || !isOptionalString(plan.notes)
      || !isOptionalNonEmptyString(plan.ownerUserId)
      || !isOptionalNonEmptyString(plan.remoteId)
      || !isOptionalPositiveInteger(plan.remoteRevision)
      || (requireCloudStatus ? !isCloudSyncStatus(plan.cloudSyncStatus) : plan.cloudSyncStatus !== undefined)) {
      throw new Error(`Malformed planbook entry for ${storageKey}`);
    }

    assertPlanSite(plan.site, storageKey);
    if (!isStringArray(plan.buddyIds) || !isStringArray(plan.gearIds) || !isStringArray(plan.tags)) {
      throw new Error(`Malformed planbook entry for ${storageKey}`);
    }
    assertPlannedValues(plan.plannedValues, storageKey);
    assertChecklistItems(plan.checklistItems, storageKey);
  }
}

function assertPlanSite(value: unknown, storageKey: string): void {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['siteId', 'name'])
    || !isOptionalString(value.siteId)
    || !isOptionalString(value.name)) {
    throw new Error(`Malformed planbook site for ${storageKey}`);
  }
}

function assertPlannedValues(value: unknown, storageKey: string): void {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'plannedMaxDepthMeters',
      'plannedDurationMinutes',
      'gasLabel',
      'waterCondition',
      'visibilityExpectation',
      'perceivedDifficulty',
      'trainingFocus',
      'repetitionTarget',
      'poolLengthMeters',
      'lapTarget',
      'plannedPressure',
    ])
    || !optionalFiniteNumber(value.plannedMaxDepthMeters)
    || !optionalFiniteNumber(value.plannedDurationMinutes)
    || !isOptionalString(value.gasLabel)
    || !isOptionalEnum(value.waterCondition, ['calm', 'mild', 'choppy', 'surge', 'current', 'unknown'])
    || !optionalFiniteNumber(value.visibilityExpectation)
    || !optionalFiniteNumber(value.perceivedDifficulty)
    || !isOptionalString(value.trainingFocus)
    || !optionalFiniteNumber(value.repetitionTarget)
    || !optionalFiniteNumber(value.poolLengthMeters)
    || !optionalFiniteNumber(value.lapTarget)) {
    throw new Error(`Malformed planbook planned values for ${storageKey}`);
  }

  if (value.plannedPressure !== undefined) {
    if (!isRecord(value.plannedPressure)
      || !hasOnlyKeys(value.plannedPressure, ['unit', 'start', 'end'])
      || !isOptionalEnum(value.plannedPressure.unit, ['bar', 'psi'])
      || !optionalFiniteNumber(value.plannedPressure.start)
      || !optionalFiniteNumber(value.plannedPressure.end)) {
      throw new Error(`Malformed planbook pressure values for ${storageKey}`);
    }
  }
}

function assertChecklistItems(value: unknown, storageKey: string): void {
  if (!Array.isArray(value)
    || value.some(item => !isRecord(item)
      || !hasOnlyKeys(item, ['id', 'label', 'completed'])
      || !isNonEmptyString(item.id)
      || typeof item.label !== 'string'
      || typeof item.completed !== 'boolean')) {
    throw new Error(`Malformed planbook checklist for ${storageKey}`);
  }
}

function isCloudSyncStatus(value: unknown): boolean {
  return value === 'notConfigured' || value === 'pending' || value === 'synced' || value === 'failed' || value === 'conflict';
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= 1);
}

function isOptionalEnum(value: unknown, values: readonly string[]): boolean {
  return value === undefined || (typeof value === 'string' && values.includes(value));
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(record).every(key => allowedKeys.includes(key));
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
