import type { DivePlan } from '../types/dive-plan';
import type {ConditionalDeleteResult, DeletePredicate} from './conditional-delete';
import type {
  ConditionalDeleteManyResult,
  ConditionalDeleteRequest,
} from './bulk-conditional-delete';
import type { DivePlanRepository } from './dive-plan-repository';

export type LocalDivePlanRepositoryOptions = {
  now?: () => number;
};

export class LocalDivePlanRepository implements DivePlanRepository {
  private plansByLocalId = new Map<string, DivePlan>();
  private readonly now: () => number;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(initialPlans: DivePlan[] = [], options: LocalDivePlanRepositoryOptions = {}) {
    this.now = options.now ?? getCurrentTimestampSeconds;

    for (const plan of initialPlans) {
      this.plansByLocalId.set(plan.localId, cloneDivePlan(plan));
    }
  }

  async list(): Promise<DivePlan[]> {
    return this.listSync();
  }

  async get(localId: string): Promise<DivePlan | undefined> {
    return this.getSync(localId);
  }

  async save(plan: DivePlan): Promise<DivePlan> {
    return this.enqueueMutation(async () => {
      this.plansByLocalId.set(plan.localId, cloneDivePlan(plan));
      return cloneDivePlan(plan);
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
      const current = this.plansByLocalId.get(localId);
      if (current === undefined) {
        return 'notFound';
      }
      if (!predicate(cloneDivePlan(current))) {
        return 'conditionFailed';
      }
      this.plansByLocalId.delete(localId);
      return 'deleted';
    });
  }

  async deleteManyIf(
    requests: readonly ConditionalDeleteRequest<DivePlan>[],
  ): Promise<ConditionalDeleteManyResult> {
    return this.enqueueMutation(async () => {
      const nextPlans = new Map(this.plansByLocalId);
      const results = new Map<string, ConditionalDeleteResult>();

      for (const request of requests) {
        const current = nextPlans.get(request.localId);
        if (current === undefined) {
          results.set(request.localId, 'notFound');
        } else if (!request.predicate(cloneDivePlan(current))) {
          results.set(request.localId, 'conditionFailed');
        } else {
          nextPlans.delete(request.localId);
          results.set(request.localId, 'deleted');
        }
      }

      this.plansByLocalId = nextPlans;
      return results;
    });
  }

  listSync(): DivePlan[] {
    return Array.from(this.plansByLocalId.values()).map(cloneDivePlan).sort((left, right) => compareDivePlans(left, right, this.now()));
  }

  getSync(localId: string): DivePlan | undefined {
    const plan = this.plansByLocalId.get(localId);
    return plan ? cloneDivePlan(plan) : undefined;
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const defaultDivePlanRepository = new LocalDivePlanRepository();

function getCurrentTimestampSeconds(): number {
  return Date.now() / 1000;
}

export function cloneDivePlan(plan: DivePlan): DivePlan {
  return JSON.parse(JSON.stringify(plan)) as DivePlan;
}

export function compareDivePlans(left: DivePlan, right: DivePlan, now: number): number {
  const leftBucket = getSortBucket(left, now);
  const rightBucket = getSortBucket(right, now);

  if (leftBucket !== rightBucket) {
    return leftBucket - rightBucket;
  }

  return getSortTimestamp(left, now) - getSortTimestamp(right, now);
}

function getSortBucket(plan: DivePlan, now: number): number {
  if (plan.status === 'planned' && plan.plannedAt !== undefined && plan.plannedAt >= now) {
    return 0;
  }

  if (plan.status === 'planned') {
    return 1;
  }

  if (plan.status === 'draft') {
    return 2;
  }

  return 3;
}

function getSortTimestamp(plan: DivePlan, now: number): number {
  if (plan.status === 'planned' && plan.plannedAt !== undefined && plan.plannedAt >= now) {
    return plan.plannedAt;
  }

  if (plan.status === 'planned') {
    return -(plan.plannedAt ?? plan.updatedAt);
  }

  if (plan.status === 'draft') {
    return -plan.updatedAt;
  }

  return -(plan.completedAt ?? plan.updatedAt);
}
