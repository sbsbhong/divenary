import type { WatchLinkPayload } from '../companion/watch-link';

export type WatchImportScope = {
  readonly queryScope: string | undefined;
  readonly generation: number;
};

export type WatchImportGuard = {
  assertActive(): void;
};

export class StaleWatchImportError extends Error {
  constructor() {
    super('Watch connectivity import principal is stale');
    this.name = 'StaleWatchImportError';
  }
}

export function isStaleWatchImportError(
  error: unknown,
): error is StaleWatchImportError {
  return error instanceof StaleWatchImportError;
}

export class WatchImportCoordinator {
  private nextGeneration = 0;
  private activeScope: WatchImportScope | undefined;
  private readonly tailByGeneration = new Map<number, Promise<void>>();
  private readonly inFlightByImportKey = new Map<string, Promise<unknown>>();

  activateScope(queryScope?: string): WatchImportScope {
    if (this.activeScope && this.activeScope.queryScope === queryScope) {
      return this.activeScope;
    }

    const scope: WatchImportScope = {
      queryScope,
      generation: this.nextGeneration + 1,
    };
    this.nextGeneration = scope.generation;
    this.activeScope = scope;
    return scope;
  }

  invalidateScope(scope: WatchImportScope): void {
    if (this.activeScope?.generation !== scope.generation) {
      return;
    }

    this.nextGeneration += 1;
    this.activeScope = undefined;
  }

  run<T>(
    scope: WatchImportScope,
    payload: WatchLinkPayload,
    operation: (guard: WatchImportGuard) => Promise<T>,
  ): Promise<T> {
    const payloadId = payload.payloadId;
    const importKey = payloadId
      ? `${scope.generation}:${scope.queryScope ?? ''}:${payloadId}`
      : undefined;
    const existing = importKey
      ? this.inFlightByImportKey.get(importKey)
      : undefined;

    if (existing) {
      return existing as Promise<T>;
    }

    const guard: WatchImportGuard = {
      assertActive: () => this.assertScopeActive(scope),
    };
    const execute = () => {
      guard.assertActive();
      return operation(guard);
    };
    const tail = this.tailByGeneration.get(scope.generation) ?? Promise.resolve();
    const result = tail.then(execute, execute);
    const nextTail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tailByGeneration.set(scope.generation, nextTail);
    const clearTail = () => {
      if (this.tailByGeneration.get(scope.generation) === nextTail) {
        this.tailByGeneration.delete(scope.generation);
      }
    };
    void nextTail.then(clearTail);

    if (importKey) {
      this.inFlightByImportKey.set(importKey, result);
      const clearInFlight = () => {
        if (this.inFlightByImportKey.get(importKey) === result) {
          this.inFlightByImportKey.delete(importKey);
        }
      };
      void result.then(clearInFlight, clearInFlight);
    }

    return result;
  }

  private assertScopeActive(scope: WatchImportScope): void {
    if (
      this.activeScope?.generation !== scope.generation ||
      this.activeScope.queryScope !== scope.queryScope
    ) {
      throw new StaleWatchImportError();
    }
  }
}

export const defaultWatchImportCoordinator = new WatchImportCoordinator();
