import type {SupabaseClient} from '@supabase/supabase-js';

import type {Database, Json} from './database.types.ts';
import {
  boundProfilePreview,
  fromDiveLogRow,
  fromDivePlanRow,
  toJsonPayload,
  type DiveLogRow,
  type DivePlanRow,
} from './account-data-mappers.ts';
import type {
  GuestClaimBatchInput,
  GuestClaimRemoteRepository,
  GuestClaimStageInput,
  RemoteDiveLog,
  RemoteDivePlan,
  VerifiedCurrentUser,
} from './account-data-types.ts';

export type GuestClaimRepositoryOperation = 'batch' | 'stage' | 'profile' | 'finalize' | 'list';

export class GuestClaimRepositoryError extends Error {
  readonly operation: GuestClaimRepositoryOperation;

  constructor(operation: GuestClaimRepositoryOperation) {
    super('Guest claim operation failed');
    this.name = 'GuestClaimRepositoryError';
    this.operation = operation;
  }
}

type BatchRow = Database['public']['Tables']['guest_claim_batches']['Row'];
type ClaimRow = Database['public']['Tables']['guest_claim_records']['Row'];
type FinalRecordRow = {
  id: string;
  user_id: string;
  local_id: string;
  payload_sha256: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/;

function fail(operation: GuestClaimRepositoryOperation): never {
  throw new GuestClaimRepositoryError(operation);
}

function validUuid(value: string): boolean { return uuidPattern.test(value); }
function validSha(value: string): boolean { return sha256Pattern.test(value); }
function errorResult(result: {error?: unknown}): boolean { return result.error !== null && result.error !== undefined; }

function safeCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function duplicateObject(error: unknown): boolean {
  if (safeCode(error) === '23505') return true;
  if (typeof error !== 'object' || error === null) return false;
  const status = Reflect.get(error, 'statusCode') ?? Reflect.get(error, 'status');
  return status === 409 || status === '409';
}

function claimError(error: unknown, operation: GuestClaimRepositoryOperation): GuestClaimRepositoryError {
  return error instanceof GuestClaimRepositoryError ? error : new GuestClaimRepositoryError(operation);
}

function single<T>(data: unknown, operation: GuestClaimRepositoryOperation): T {
  if (data === null || data === undefined || Array.isArray(data)) return fail(operation);
  return data as T;
}

function array<T>(data: unknown, operation: GuestClaimRepositoryOperation): T[] {
  if (!Array.isArray(data)) return fail(operation);
  return data as T[];
}

function sameJson(left: Json, right: Json): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameJson(item, right[index] as Json));
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null && !Array.isArray(left) && !Array.isArray(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key] as Json, right[key] as Json));
  }
  return false;
}

function assertBatchInput(input: GuestClaimBatchInput) {
  if (!input.clientBatchId || input.clientBatchId.length > 256 || !validSha(input.manifestSha256) || !Number.isSafeInteger(input.expectedPlanCount) || input.expectedPlanCount < 0 || !Number.isSafeInteger(input.expectedLogCount) || input.expectedLogCount < 0) fail('batch');
}

function assertStageInput(input: GuestClaimStageInput) {
  if (!validUuid(input.batchId) || !input.clientRecordId || input.clientRecordId.length > 256 || !validSha(input.payloadSha256)) fail('stage');
}

function assertBatchRow(row: BatchRow, input: GuestClaimBatchInput, userId: string) {
  if (row.user_id !== userId || row.client_batch_id !== input.clientBatchId || row.manifest_sha256 !== input.manifestSha256 || row.expected_plan_count !== input.expectedPlanCount || row.expected_log_count !== input.expectedLogCount || (row.status !== 'uploading' && row.status !== 'committed')) fail('batch');
}

function assertCommittedBatchRow(row: BatchRow, batchId: string, userId: string) {
  if (row.id !== batchId || row.user_id !== userId || row.status !== 'committed') fail('list');
}

function assertClaimRow(row: ClaimRow, input: GuestClaimStageInput, userId: string, payload: Json) {
  if (row.user_id !== userId || row.batch_id !== input.batchId || row.entity_kind !== input.entityKind || row.client_record_id !== input.clientRecordId || row.payload_sha256 !== input.payloadSha256 || row.source_plan_client_record_id !== (input.sourcePlanClientRecordId ?? null) || row.converted_log_client_record_id !== (input.convertedLogClientRecordId ?? null) || !sameJson(row.payload, payload)) fail('stage');
}

function assertProfileInput(input: {stagingRecordId: string; path: string; contentRevision: string; sha256: string; byteCount: number; sampleCount: number}) {
  if (!validUuid(input.stagingRecordId) || !input.path || !input.contentRevision || !validSha(input.sha256) || !Number.isSafeInteger(input.byteCount) || input.byteCount < 0 || !Number.isSafeInteger(input.sampleCount) || input.sampleCount < 0) fail('profile');
}

function assertProfileRow(row: ClaimRow, input: {path: string; contentRevision: string; sha256: string; byteCount: number; sampleCount: number}) {
  if (row.profile_path !== input.path || row.profile_content_revision !== input.contentRevision || row.profile_sha256 !== input.sha256 || row.profile_byte_count !== input.byteCount || row.profile_sample_count !== input.sampleCount) fail('profile');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function committedRecordsByKind(records: ClaimRow[], batchId: string, userId: string): {plans: ClaimRow[]; logs: ClaimRow[]} {
  const plans: ClaimRow[] = [];
  const logs: ClaimRow[] = [];
  const targetIds = {plan: new Set<string>(), log: new Set<string>()};
  const localIds = {plan: new Set<string>(), log: new Set<string>()};
  for (const record of records) {
    if (record.user_id !== userId || record.batch_id !== batchId || (record.entity_kind !== 'plan' && record.entity_kind !== 'log') || !validUuid(record.target_record_id) || !record.client_record_id || !validSha(record.payload_sha256)) fail('list');
    const kind = record.entity_kind;
    if (targetIds[kind].has(record.target_record_id) || localIds[kind].has(record.client_record_id)) fail('list');
    targetIds[kind].add(record.target_record_id);
    localIds[kind].add(record.client_record_id);
    if (kind === 'plan') plans.push(record);
    else logs.push(record);
  }
  return {plans, logs};
}

function orderedCommittedRows<T extends FinalRecordRow>(stagingRows: ClaimRow[], finalRows: T[], userId: string): T[] {
  if (stagingRows.length !== finalRows.length) fail('list');
  const expected = new Map(stagingRows.map(row => [row.target_record_id, row]));
  const finalById = new Map<string, T>();
  for (const row of finalRows) {
    const staged = expected.get(row.id);
    if (staged === undefined || row.user_id !== userId || row.local_id !== staged.client_record_id || row.payload_sha256 !== staged.payload_sha256 || finalById.has(row.id)) fail('list');
    finalById.set(row.id, row);
  }
  return stagingRows.map(staged => {
    const row = finalById.get(staged.target_record_id);
    return row === undefined ? fail('list') : row;
  });
}

export function createGuestClaimRemoteRepository(
  client: SupabaseClient<Database>,
  verifiedCurrentUser: VerifiedCurrentUser,
): GuestClaimRemoteRepository {
  if (!validUuid(verifiedCurrentUser.userId)) fail('batch');
  const userId = verifiedCurrentUser.userId;

  async function createOrLoadBatch(input: GuestClaimBatchInput) {
    try {
      assertBatchInput(input);
      const inserted = await client.from('guest_claim_batches').insert({user_id: userId, client_batch_id: input.clientBatchId, manifest_sha256: input.manifestSha256, expected_plan_count: input.expectedPlanCount, expected_log_count: input.expectedLogCount}).select().maybeSingle();
      let row: BatchRow;
      if (!errorResult(inserted)) {
        row = single<BatchRow>(inserted.data, 'batch');
      } else if (safeCode(inserted.error) === '23505') {
        const existing = await client.from('guest_claim_batches').select().eq('user_id', userId).eq('client_batch_id', input.clientBatchId).maybeSingle();
        if (errorResult(existing)) return fail('batch');
        row = single<BatchRow>(existing.data, 'batch');
      } else {
        return fail('batch');
      }
      assertBatchRow(row, input, userId);
      return {id: row.id, status: row.status as 'uploading' | 'committed'};
    } catch (error) {
      throw claimError(error, 'batch');
    }
  }

  async function stageRecord(input: GuestClaimStageInput) {
    try {
      assertStageInput(input);
      const payload = toJsonPayload(input.entityKind === 'log' ? boundProfilePreview(input.payload) : input.payload);
      const inserted = await client.from('guest_claim_records').upsert({user_id: userId, batch_id: input.batchId, entity_kind: input.entityKind, client_record_id: input.clientRecordId, payload_sha256: input.payloadSha256, payload, ...(input.sourcePlanClientRecordId === undefined ? {} : {source_plan_client_record_id: input.sourcePlanClientRecordId}), ...(input.convertedLogClientRecordId === undefined ? {} : {converted_log_client_record_id: input.convertedLogClientRecordId})}, {onConflict: 'batch_id,entity_kind,client_record_id', ignoreDuplicates: true});
      if (errorResult(inserted)) return fail('stage');
      const existing = await client.from('guest_claim_records').select().eq('batch_id', input.batchId).eq('entity_kind', input.entityKind).eq('client_record_id', input.clientRecordId).maybeSingle();
      if (errorResult(existing)) return fail('stage');
      const row = single<ClaimRow>(existing.data, 'stage');
      assertClaimRow(row, input, userId, payload);
      return {stagingRecordId: row.id, targetRecordId: row.target_record_id};
    } catch (error) {
      throw claimError(error, 'stage');
    }
  }

  async function attachProfile(input: {stagingRecordId: string; path: string; contentRevision: string; sha256: string; byteCount: number; sampleCount: number}) {
    try {
      assertProfileInput(input);
      const update = await client.from('guest_claim_records').update({profile_path: input.path, profile_content_revision: input.contentRevision, profile_sha256: input.sha256, profile_byte_count: input.byteCount, profile_sample_count: input.sampleCount}).eq('id', input.stagingRecordId).eq('user_id', userId).is('profile_path', null).select().maybeSingle();
      if (errorResult(update)) return fail('profile');
      let row: ClaimRow;
      if (update.data === null) {
        const existing = await client.from('guest_claim_records').select().eq('id', input.stagingRecordId).eq('user_id', userId).maybeSingle();
        if (errorResult(existing)) return fail('profile');
        row = single<ClaimRow>(existing.data, 'profile');
      } else {
        row = single<ClaimRow>(update.data, 'profile');
      }
      assertProfileRow(row, input);
    } catch (error) {
      throw claimError(error, 'profile');
    }
  }

  async function uploadProfile(path: string, bytes: Uint8Array) {
    try {
      if (!path || !(bytes instanceof Uint8Array)) return fail('profile');
      const result = await client.storage.from('dive-profiles').upload(path, bytes, {upsert: false, contentType: 'application/json'});
      if (result.error && !duplicateObject(result.error)) return fail('profile');
      if (result.error) {
        const stored = await downloadProfile(path);
        if (!sameBytes(stored, bytes)) return fail('profile');
      }
    } catch (error) {
      throw claimError(error, 'profile');
    }
  }

  async function downloadProfile(path: string): Promise<Uint8Array> {
    try {
      if (!path) return fail('profile');
      const result = await client.storage.from('dive-profiles').download(path);
      if (result.error || result.data === null) return fail('profile');
      return new Uint8Array(await result.data.arrayBuffer());
    } catch (error) {
      throw claimError(error, 'profile');
    }
  }

  async function finalize(batchId: string) {
    try {
      if (!validUuid(batchId)) return fail('finalize');
      const result = await client.functions.invoke('finalize-guest-claim', {body: {batchId}});
      if (result.error || typeof result.data !== 'object' || result.data === null) return fail('finalize');
      const data = result.data as Record<string, unknown>;
      const planCount = data.planCount;
      const logCount = data.logCount;
      if (data.status !== 'committed' || typeof planCount !== 'number' || typeof logCount !== 'number' || !Number.isSafeInteger(planCount) || !Number.isSafeInteger(logCount) || planCount < 0 || logCount < 0) return fail('finalize');
      return {status: 'committed' as const, planCount, logCount};
    } catch (error) {
      throw claimError(error, 'finalize');
    }
  }

  async function listCommittedBatch(batchId: string): Promise<{plans: RemoteDivePlan[]; logs: RemoteDiveLog[]}> {
    try {
      if (!validUuid(batchId)) return fail('list');
      const batch = await client.from('guest_claim_batches').select().eq('id', batchId).eq('user_id', userId).maybeSingle();
      if (errorResult(batch)) return fail('list');
      assertCommittedBatchRow(single<BatchRow>(batch.data, 'list'), batchId, userId);
      const recordsResult = await client.from('guest_claim_records').select().eq('batch_id', batchId).eq('user_id', userId);
      if (errorResult(recordsResult)) return fail('list');
      const records = array<ClaimRow>(recordsResult.data, 'list');
      const {plans: stagedPlans, logs: stagedLogs} = committedRecordsByKind(records, batchId, userId);
      const planIds = stagedPlans.map(record => record.target_record_id);
      const logIds = stagedLogs.map(record => record.target_record_id);
      const plansResult = planIds.length === 0 ? {data: [] as unknown[], error: null} : await client.from('dive_plans').select().in('id', planIds).eq('user_id', userId).is('deleted_at', null);
      const logsResult = logIds.length === 0 ? {data: [] as unknown[], error: null} : await client.from('dive_logs').select().in('id', logIds).eq('user_id', userId).is('deleted_at', null);
      if (errorResult(plansResult) || errorResult(logsResult)) return fail('list');
      const plans = orderedCommittedRows(stagedPlans, array<DivePlanRow>(plansResult.data, 'list'), userId).map(fromDivePlanRow);
      const logs = orderedCommittedRows(stagedLogs, array<DiveLogRow>(logsResult.data, 'list'), userId).map(fromDiveLogRow);
      return {plans, logs};
    } catch (error) {
      throw claimError(error, 'list');
    }
  }

  return {createOrLoadBatch, stageRecord, attachProfile, uploadProfile, downloadProfile, finalize, listCommittedBatch};
}
