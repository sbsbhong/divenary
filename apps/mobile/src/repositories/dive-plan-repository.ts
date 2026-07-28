import type { DivePlan } from '../types/dive-plan';
import type {
  ConditionalDeleteResult,
  DeletePredicate,
} from './conditional-delete';
import type {
  ConditionalDeleteManyResult,
  ConditionalDeleteRequest,
} from './bulk-conditional-delete';

export type DivePlanRepository = {
  list(): Promise<DivePlan[]>;
  get(localId: string): Promise<DivePlan | undefined>;
  save(plan: DivePlan): Promise<DivePlan>;
  delete(localId: string): Promise<void>;
  deleteIf(
    localId: string,
    predicate: DeletePredicate<DivePlan>,
  ): Promise<ConditionalDeleteResult>;
  deleteManyIf?(
    requests: readonly ConditionalDeleteRequest<DivePlan>[],
  ): Promise<ConditionalDeleteManyResult>;
};
