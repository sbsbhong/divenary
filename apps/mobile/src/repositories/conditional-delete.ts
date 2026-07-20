export type ConditionalDeleteResult =
  | 'deleted'
  | 'notFound'
  | 'conditionFailed';

export type DeletePredicate<T> = (current: T) => boolean;
