let legacyDataMigrationQueue: Promise<void> = Promise.resolve();

export function withLegacyDataMigrationLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = legacyDataMigrationQueue.then(operation);
  legacyDataMigrationQueue = result.then(() => undefined, () => undefined);
  return result;
}
