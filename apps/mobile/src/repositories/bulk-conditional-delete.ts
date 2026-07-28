import type {
  ConditionalDeleteResult,
  DeletePredicate,
} from './conditional-delete';

export type ConditionalDeleteRequest<T> = {
  localId: string;
  predicate: DeletePredicate<T>;
};

export type ConditionalDeleteManyResult = ReadonlyMap<
  string,
  ConditionalDeleteResult
>;
