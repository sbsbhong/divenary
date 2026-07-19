import type {SupabaseClient} from '@supabase/supabase-js';

import type {Database} from './database.types.ts';
import {
  fromDiveLogRow,
  fromDivePlanRow,
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

function cursorFilter(cursor: AccountDataCursor, column: 'started_at' | 'planned_at'): string {
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

function single<T>(data: unknown, operation: AccountDataRepositoryOperation): T {
  if (data === null || data === undefined || Array.isArray(data)) return fail(operation);
  return data as T;
}

function rows<T>(data: unknown, operation: AccountDataRepositoryOperation): T[] {
  if (!Array.isArray(data)) return fail(operation);
  return data as T[];
}

function accountError(error: unknown, operation: AccountDataRepositoryOperation): AccountDataRepositoryError {
  return error instanceof AccountDataRepositoryError ? error : new AccountDataRepositoryError(operation);
}

export function createAccountDataRepository(
  client: SupabaseClient<Database>,
  verifiedCurrentUser: VerifiedCurrentUser,
): AccountDataRepository {
  assertIdentity(verifiedCurrentUser);

  async function listLogs(input: {cursor?: AccountDataCursor; limit?: number} = {}): Promise<AccountDataPage<RemoteDiveLog>> {
    try {
      const limit = pageLimit(input.limit);
      let query = client.from('dive_logs').select().is('deleted_at', null);
      if (input.cursor !== undefined) query = query.or(cursorFilter(input.cursor, 'started_at'));
      const result = await query.order('started_at', {ascending: false}).order('id', {ascending: false}).limit(limit + 1);
      if (resultError(result)) return fail('list');
      const mapped = rows<DiveLogRow>(result.data, 'list').map(fromDiveLogRow);
      const hasMore = mapped.length > limit;
      const items = mapped.slice(0, limit);
      const last = items[items.length - 1];
      return hasMore && last !== undefined
        ? {items, nextCursor: {sortTime: String(last.payload.started_at), id: last.id}}
        : {items};
    } catch (error) {
      throw accountError(error, 'list');
    }
  }

  async function listPlans(input: {cursor?: AccountDataCursor; limit?: number} = {}): Promise<AccountDataPage<RemoteDivePlan>> {
    try {
      const limit = pageLimit(input.limit);
      // Plans without a timestamp cannot participate in the required timestamp cursor.
      let query = client.from('dive_plans').select().is('deleted_at', null).not('planned_at', 'is', null);
      if (input.cursor !== undefined) query = query.or(cursorFilter(input.cursor, 'planned_at'));
      const result = await query.order('planned_at', {ascending: false}).order('id', {ascending: false}).limit(limit + 1);
      if (resultError(result)) return fail('list');
      const mapped = rows<DivePlanRow>(result.data, 'list').map(fromDivePlanRow);
      const hasMore = mapped.length > limit;
      const items = mapped.slice(0, limit);
      const last = items[items.length - 1];
      return hasMore && last !== undefined
        ? {items, nextCursor: {sortTime: String(last.payload.planned_at), id: last.id}}
        : {items};
    } catch (error) {
      throw accountError(error, 'list');
    }
  }

  async function remoteLog(id: string): Promise<RemoteDiveLog> {
    const result = await client.from('dive_logs').select().eq('id', id).maybeSingle();
    if (resultError(result)) return fail('save');
    return fromDiveLogRow(single<DiveLogRow>(result.data, 'save'));
  }

  async function remotePlan(id: string): Promise<RemoteDivePlan> {
    const result = await client.from('dive_plans').select().eq('id', id).maybeSingle();
    if (resultError(result)) return fail('save');
    return fromDivePlanRow(single<DivePlanRow>(result.data, 'save'));
  }

  async function saveLog(value: RemoteDiveLog, expectedRevision?: number): Promise<AccountMutationResult<RemoteDiveLog>> {
    try {
      const id = assertIdentifier(value.id, 'save');
      const fields = toDiveLogFields(value);
      if (expectedRevision === undefined) {
        const result = await client.from('dive_logs').insert({id, user_id: verifiedCurrentUser.userId, ...fields} as never).select().maybeSingle();
        if (resultError(result)) return fail('save');
        return {status: 'saved', value: fromDiveLogRow(single<DiveLogRow>(result.data, 'save'))};
      }
      const revision = assertRevision(expectedRevision, 'save');
      const result = await client.from('dive_logs').update({...fields, revision: revision + 1} as never).eq('id', id).eq('revision', revision).select().maybeSingle();
      if (resultError(result)) return fail('save');
      if (result.data === null) return {status: 'conflict', remote: await remoteLog(id)};
      return {status: 'saved', value: fromDiveLogRow(single<DiveLogRow>(result.data, 'save'))};
    } catch (error) {
      throw accountError(error, 'save');
    }
  }

  async function savePlan(value: RemoteDivePlan, expectedRevision?: number): Promise<AccountMutationResult<RemoteDivePlan>> {
    try {
      const id = assertIdentifier(value.id, 'save');
      const fields = toDivePlanFields(value);
      if (expectedRevision === undefined) {
        const result = await client.from('dive_plans').insert({id, user_id: verifiedCurrentUser.userId, ...fields} as never).select().maybeSingle();
        if (resultError(result)) return fail('save');
        return {status: 'saved', value: fromDivePlanRow(single<DivePlanRow>(result.data, 'save'))};
      }
      const revision = assertRevision(expectedRevision, 'save');
      const result = await client.from('dive_plans').update({...fields, revision: revision + 1} as never).eq('id', id).eq('revision', revision).select().maybeSingle();
      if (resultError(result)) return fail('save');
      if (result.data === null) return {status: 'conflict', remote: await remotePlan(id)};
      return {status: 'saved', value: fromDivePlanRow(single<DivePlanRow>(result.data, 'save'))};
    } catch (error) {
      throw accountError(error, 'save');
    }
  }

  async function deleteLog(id: string, expectedRevision: number): Promise<AccountMutationResult<RemoteDiveLog>> {
    try {
      const identifier = assertIdentifier(id, 'delete');
      const revision = assertRevision(expectedRevision, 'delete');
      const result = await client.from('dive_logs').update({deleted_at: new Date().toISOString(), revision: revision + 1}).eq('id', identifier).eq('revision', revision).select().maybeSingle();
      if (resultError(result)) return fail('delete');
      if (result.data === null) return {status: 'conflict', remote: await remoteLog(identifier)};
      return {status: 'saved', value: fromDiveLogRow(single<DiveLogRow>(result.data, 'delete'))};
    } catch (error) {
      throw accountError(error, 'delete');
    }
  }

  async function deletePlan(id: string, expectedRevision: number): Promise<AccountMutationResult<RemoteDivePlan>> {
    try {
      const identifier = assertIdentifier(id, 'delete');
      const revision = assertRevision(expectedRevision, 'delete');
      const result = await client.from('dive_plans').update({deleted_at: new Date().toISOString(), revision: revision + 1}).eq('id', identifier).eq('revision', revision).select().maybeSingle();
      if (resultError(result)) return fail('delete');
      if (result.data === null) return {status: 'conflict', remote: await remotePlan(identifier)};
      return {status: 'saved', value: fromDivePlanRow(single<DivePlanRow>(result.data, 'delete'))};
    } catch (error) {
      throw accountError(error, 'delete');
    }
  }

  return {listLogs, listPlans, saveLog, savePlan, deleteLog, deletePlan};
}
