import type {SupabaseClient} from '@supabase/supabase-js';

import type {Database} from './database.types.ts';
import {
  fromDiveLogRow,
  fromDivePlanRow,
  sameAccountTimestamp,
  toDiveLogFields,
  toDivePlanFields,
  type DiveLogRow,
  type DivePlanRow,
} from './account-data-mappers.ts';
import type {
  AccountDataCursor,
  AccountDataPage,
  AccountDataRepository,
  AccountMutationResult,
  RemoteDiveLog,
  RemoteDivePlan,
  VerifiedCurrentUser,
} from './account-data-types.ts';

export type AccountDataRepositoryOperation = 'list' | 'save' | 'delete';

export class AccountDataRepositoryError extends Error {
  readonly operation: AccountDataRepositoryOperation;

  constructor(operation: AccountDataRepositoryOperation) {
    super('Account data operation failed');
    this.name = 'AccountDataRepositoryError';
    this.operation = operation;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const maximumPageSize = 100;

function fail(operation: AccountDataRepositoryOperation): never {
  throw new AccountDataRepositoryError(operation);
}

function assertIdentity(identity: VerifiedCurrentUser): string {
  if (!uuidPattern.test(identity.userId)) {
    return fail('list');
  }
  return identity.userId;
}

function assertIdentifier(id: string, operation: AccountDataRepositoryOperation): string {
  if (!uuidPattern.test(id)) return fail(operation);
  return id;
}

function assertRevision(revision: number, operation: AccountDataRepositoryOperation): number {
  if (!Number.isSafeInteger(revision) || revision < 1) return fail(operation);
  return revision;
}

function pageLimit(value: number | undefined): number {
  if (value === undefined) return 30;
  if (!Number.isSafeInteger(value) || value < 1) return fail('list');
  return Math.min(value, maximumPageSize);
}

function cursorFilter(cursor: AccountDataCursor, column: 'started_at' | 'created_at'): string {
  if (
    !timestampPattern.test(cursor.sortTime)
    || !Number.isFinite(Date.parse(cursor.sortTime))
    || !uuidPattern.test(cursor.id)
  ) {
    return fail('list');
  }

  // The input is constrained to PostgREST-safe timestamp and UUID grammar before use.
  return `${column}.lt.${cursor.sortTime},and(${column}.eq.${cursor.sortTime},id.lt.${cursor.id})`;
}

function resultError(result: {error?: unknown}): boolean {
  return result.error !== null && result.error !== undefined;
}

function duplicateError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = Reflect.get(error, 'code');
  const status = Reflect.get(error, 'status') ?? Reflect.get(error, 'statusCode');
  return code === '23505' || status === 409 || status === '409';
}

function single<T>(data: unknown, operation: AccountDataRepositoryOperation): T {
  if (data === null || data === undefined || Array.isArray(data)) return fail(operation);
  return data as T;
}

function rows<T>(data: unknown, operation: AccountDataRepositoryOperation): T[] {
  if (!Array.isArray(data)) return fail(operation);
  return data as T[];
}

function ownedRow<T extends {user_id: string}>(
  data: unknown,
  userId: string,
  operation: AccountDataRepositoryOperation,
): T {
  const row = single<T>(data, operation);
  if (row.user_id !== userId) return fail(operation);
  return row;
}

function optionalOwnedRow<T extends {user_id: string}>(
  data: unknown,
  userId: string,
  operation: AccountDataRepositoryOperation,
): T | undefined {
  if (data === null) return undefined;
  return ownedRow<T>(data, userId, operation);
}

function ownedRows<T extends {user_id: string}>(
  data: unknown,
  userId: string,
  operation: AccountDataRepositoryOperation,
): T[] {
  const result = rows<T>(data, operation);
  if (result.some(row => row.user_id !== userId)) return fail(operation);
  return result;
}

function samePersistedValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((item, index) => samePersistedValue(item, right[index]));
  }
  if (
    typeof left === 'object'
    && left !== null
    && !Array.isArray(left)
    && typeof right === 'object'
    && right !== null
    && !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => (
        key === rightKeys[index]
        && samePersistedValue(leftRecord[key], rightRecord[key])
      ));
  }
  return false;
}

function hasPersistedFields(
  row: Record<string, unknown>,
  fields: Record<string, unknown>,
): boolean {
  return Object.entries(fields).every(([key, value]) => (
    key === 'started_at' || key === 'ended_at' || key === 'planned_at'
      ? sameAccountTimestamp(row[key], value)
      : samePersistedValue(row[key], value)
  ));
}

function savedLogResult(
  row: DiveLogRow,
  value: RemoteDiveLog,
  appliedRevision: number,
  fields: Record<string, unknown>,
): AccountMutationResult<RemoteDiveLog> {
  const remote = fromDiveLogRow(row);
  return row.id === value.id
    && row.local_id === value.localId
    && row.payload_sha256 === value.payloadSha256
    && row.revision === appliedRevision
    && row.deleted_at === null
    && hasPersistedFields(row as unknown as Record<string, unknown>, fields)
    ? {status: 'saved', value: remote}
    : {status: 'conflict', remote};
}

function savedPlanResult(
  row: DivePlanRow,
  value: RemoteDivePlan,
  appliedRevision: number,
  fields: Record<string, unknown>,
): AccountMutationResult<RemoteDivePlan> {
  const remote = fromDivePlanRow(row);
  return row.id === value.id
    && row.local_id === value.localId
    && row.payload_sha256 === value.payloadSha256
    && row.revision === appliedRevision
    && row.deleted_at === null
    && hasPersistedFields(row as unknown as Record<string, unknown>, fields)
    ? {status: 'saved', value: remote}
    : {status: 'conflict', remote};
}

function deletedLogResult(
  row: DiveLogRow,
  id: string,
  appliedRevision: number,
): AccountMutationResult<RemoteDiveLog> {
  const remote = fromDiveLogRow(row);
  return row.id === id && row.revision === appliedRevision && row.deleted_at !== null
    ? {status: 'saved', value: remote}
    : {status: 'conflict', remote};
}

function deletedPlanResult(
  row: DivePlanRow,
  id: string,
  appliedRevision: number,
): AccountMutationResult<RemoteDivePlan> {
  const remote = fromDivePlanRow(row);
  return row.id === id && row.revision === appliedRevision && row.deleted_at !== null
    ? {status: 'saved', value: remote}
    : {status: 'conflict', remote};
}

function accountError(error: unknown, operation: AccountDataRepositoryOperation): AccountDataRepositoryError {
  return error instanceof AccountDataRepositoryError ? error : new AccountDataRepositoryError(operation);
}

export function createAccountDataRepository(
  client: SupabaseClient<Database>,
  verifiedCurrentUser: VerifiedCurrentUser,
): AccountDataRepository {
  const userId = assertIdentity(verifiedCurrentUser);

  async function listLogs(input: {cursor?: AccountDataCursor; limit?: number} = {}): Promise<AccountDataPage<RemoteDiveLog>> {
    try {
      const limit = pageLimit(input.limit);
      let query = client.from('dive_logs').select().eq('user_id', userId).is('deleted_at', null);
      if (input.cursor !== undefined) query = query.or(cursorFilter(input.cursor, 'started_at'));
      const result = await query.order('started_at', {ascending: false}).order('id', {ascending: false}).limit(limit + 1);
      if (resultError(result)) return fail('list');
      const rawRows = ownedRows<DiveLogRow>(result.data, userId, 'list');
      const hasMore = rawRows.length > limit;
      const itemRows = rawRows.slice(0, limit);
      const items = itemRows.map(fromDiveLogRow);
      const last = itemRows[itemRows.length - 1];
      return hasMore && last !== undefined
        ? {items, nextCursor: {sortTime: last.started_at, id: last.id}}
        : {items};
    } catch (error) {
      throw accountError(error, 'list');
    }
  }

  async function listPlans(input: {cursor?: AccountDataCursor; limit?: number} = {}): Promise<AccountDataPage<RemoteDivePlan>> {
    try {
      const limit = pageLimit(input.limit);
      let query = client.from('dive_plans').select().eq('user_id', userId).is('deleted_at', null);
      if (input.cursor !== undefined) query = query.or(cursorFilter(input.cursor, 'created_at'));
      const result = await query.order('created_at', {ascending: false}).order('id', {ascending: false}).limit(limit + 1);
      if (resultError(result)) return fail('list');
      const rawRows = ownedRows<DivePlanRow>(result.data, userId, 'list');
      const hasMore = rawRows.length > limit;
      const itemRows = rawRows.slice(0, limit);
      const items = itemRows.map(fromDivePlanRow);
      const last = itemRows[itemRows.length - 1];
      return hasMore && last !== undefined
        ? {items, nextCursor: {sortTime: last.created_at, id: last.id}}
        : {items};
    } catch (error) {
      throw accountError(error, 'list');
    }
  }

  async function remoteLogRow(
    id: string,
    operation: AccountDataRepositoryOperation,
  ): Promise<DiveLogRow> {
    const result = await client.from('dive_logs').select().eq('user_id', userId).eq('id', id).maybeSingle();
    if (resultError(result)) return fail(operation);
    return ownedRow<DiveLogRow>(result.data, userId, operation);
  }

  async function remotePlanRow(
    id: string,
    operation: AccountDataRepositoryOperation,
  ): Promise<DivePlanRow> {
    const result = await client.from('dive_plans').select().eq('user_id', userId).eq('id', id).maybeSingle();
    if (resultError(result)) return fail(operation);
    return ownedRow<DivePlanRow>(result.data, userId, operation);
  }

  async function insertedLogRow(value: RemoteDiveLog): Promise<DiveLogRow> {
    const byId = await client.from('dive_logs').select().eq('user_id', userId).eq('id', value.id).maybeSingle();
    if (resultError(byId)) return fail('save');
    const row = optionalOwnedRow<DiveLogRow>(byId.data, userId, 'save');
    if (row !== undefined) return row;
    const byLocalId = await client.from('dive_logs').select().eq('user_id', userId).eq('local_id', value.localId).maybeSingle();
    if (resultError(byLocalId)) return fail('save');
    return ownedRow<DiveLogRow>(byLocalId.data, userId, 'save');
  }

  async function insertedPlanRow(value: RemoteDivePlan): Promise<DivePlanRow> {
    const byId = await client.from('dive_plans').select().eq('user_id', userId).eq('id', value.id).maybeSingle();
    if (resultError(byId)) return fail('save');
    const row = optionalOwnedRow<DivePlanRow>(byId.data, userId, 'save');
    if (row !== undefined) return row;
    const byLocalId = await client.from('dive_plans').select().eq('user_id', userId).eq('local_id', value.localId).maybeSingle();
    if (resultError(byLocalId)) return fail('save');
    return ownedRow<DivePlanRow>(byLocalId.data, userId, 'save');
  }

  async function saveLog(value: RemoteDiveLog, expectedRevision?: number): Promise<AccountMutationResult<RemoteDiveLog>> {
    try {
      const id = assertIdentifier(value.id, 'save');
      const fields = toDiveLogFields(value);
      if (expectedRevision === undefined) {
        const result = await client.from('dive_logs').insert({id, user_id: userId, ...fields} as never).select().maybeSingle();
        if (resultError(result) && !duplicateError(result.error)) return fail('save');
        const row = resultError(result) || result.data === null
          ? await insertedLogRow(value)
          : ownedRow<DiveLogRow>(result.data, userId, 'save');
        return savedLogResult(row, value, 1, fields);
      }
      const revision = assertRevision(expectedRevision, 'save');
      const result = await client.from('dive_logs').update({...fields, revision: revision + 1} as never).eq('user_id', userId).eq('id', id).eq('revision', revision).is('deleted_at', null).select().maybeSingle();
      if (resultError(result)) return fail('save');
      const row = result.data === null
        ? await remoteLogRow(id, 'save')
        : ownedRow<DiveLogRow>(result.data, userId, 'save');
      return savedLogResult(row, value, revision + 1, fields);
    } catch (error) {
      throw accountError(error, 'save');
    }
  }

  async function savePlan(value: RemoteDivePlan, expectedRevision?: number): Promise<AccountMutationResult<RemoteDivePlan>> {
    try {
      const id = assertIdentifier(value.id, 'save');
      const fields = toDivePlanFields(value);
      if (expectedRevision === undefined) {
        const result = await client.from('dive_plans').insert({id, user_id: userId, ...fields} as never).select().maybeSingle();
        if (resultError(result) && !duplicateError(result.error)) return fail('save');
        const row = resultError(result) || result.data === null
          ? await insertedPlanRow(value)
          : ownedRow<DivePlanRow>(result.data, userId, 'save');
        return savedPlanResult(row, value, 1, fields);
      }
      const revision = assertRevision(expectedRevision, 'save');
      const result = await client.from('dive_plans').update({...fields, revision: revision + 1} as never).eq('user_id', userId).eq('id', id).eq('revision', revision).is('deleted_at', null).select().maybeSingle();
      if (resultError(result)) return fail('save');
      const row = result.data === null
        ? await remotePlanRow(id, 'save')
        : ownedRow<DivePlanRow>(result.data, userId, 'save');
      return savedPlanResult(row, value, revision + 1, fields);
    } catch (error) {
      throw accountError(error, 'save');
    }
  }

  async function deleteLog(id: string, expectedRevision: number): Promise<AccountMutationResult<RemoteDiveLog>> {
    try {
      const identifier = assertIdentifier(id, 'delete');
      const revision = assertRevision(expectedRevision, 'delete');
      const result = await client.from('dive_logs').update({deleted_at: new Date().toISOString(), revision: revision + 1}).eq('user_id', userId).eq('id', identifier).eq('revision', revision).select().maybeSingle();
      if (resultError(result)) return fail('delete');
      const row = result.data === null
        ? await remoteLogRow(identifier, 'delete')
        : ownedRow<DiveLogRow>(result.data, userId, 'delete');
      return deletedLogResult(row, identifier, revision + 1);
    } catch (error) {
      throw accountError(error, 'delete');
    }
  }

  async function deletePlan(id: string, expectedRevision: number): Promise<AccountMutationResult<RemoteDivePlan>> {
    try {
      const identifier = assertIdentifier(id, 'delete');
      const revision = assertRevision(expectedRevision, 'delete');
      const result = await client.from('dive_plans').update({deleted_at: new Date().toISOString(), revision: revision + 1}).eq('user_id', userId).eq('id', identifier).eq('revision', revision).select().maybeSingle();
      if (resultError(result)) return fail('delete');
      const row = result.data === null
        ? await remotePlanRow(identifier, 'delete')
        : ownedRow<DivePlanRow>(result.data, userId, 'delete');
      return deletedPlanResult(row, identifier, revision + 1);
    } catch (error) {
      throw accountError(error, 'delete');
    }
  }

  return {listLogs, listPlans, saveLog, savePlan, deleteLog, deletePlan};
}
