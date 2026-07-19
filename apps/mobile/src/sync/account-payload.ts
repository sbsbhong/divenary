import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils';
import type {RemoteDiveLog, RemoteDivePlan} from '@repo/supabase';

import type {DiveLogEntry} from '../types/dive-log-entry';
import type {DivePlan} from '../types/dive-plan';

export const ACCOUNT_PAYLOAD_SCHEMA_VERSION = 1;

const LOG_PAYLOAD_KEYS = [
  'source',
  'started_at',
  'ended_at',
  'duration_seconds',
  'max_depth_meters',
  'site_name',
  'title',
  'rating',
  'dive_mode',
  'manual_data',
  'mobile_data',
  'watch_metadata',
  'provenance',
  'profile_preview',
  'profile_content_revision',
  'profile_sha256',
  'profile_byte_count',
  'profile_sample_count',
  'source_plan_id',
] as const;

const PLAN_PAYLOAD_KEYS = [
  'status',
  'planned_at',
  'dive_mode',
  'site_name',
  'plan_data',
  'converted_log_id',
] as const;

export function createAccountRemoteLog(
  entry: DiveLogEntry,
  userId: string,
  profileByteCount?: number,
): RemoteDiveLog {
  if (!entry.remoteId) {
    throw new Error('Account log is missing a remote id');
  }
  const startedAt =
    entry.watchCapture?.measuredValues.startedAt ??
    entry.manual.measuredValues.startedAt ??
    entry.createdAt;
  const endedAt =
    entry.watchCapture?.measuredValues.endedAt ??
    entry.manual.measuredValues.endedAt;
  const durationSeconds =
    entry.watchCapture?.measuredValues.durationSeconds ??
    entry.manual.measuredValues.durationSeconds;
  const maxDepthMeters =
    entry.watchCapture?.measuredValues.maxDepthMeters ??
    entry.manual.measuredValues.maxDepthMeters;
  const contentRevision = entry.watchCapture?.profile?.contentRevision;
  const payload: Record<string, unknown> = {
    source: entry.source,
    started_at: new Date(startedAt * 1_000).toISOString(),
    ended_at:
      endedAt === undefined ? null : new Date(endedAt * 1_000).toISOString(),
    duration_seconds: durationSeconds ?? null,
    max_depth_meters: maxDepthMeters ?? null,
    site_name: entry.manual.site.name ?? null,
    title: entry.manual.title ?? null,
    rating: entry.manual.rating ?? null,
    dive_mode:
      entry.manual.measuredValues.diveMode ??
      entry.watchCapture?.session.diveMode ??
      null,
    manual_data: jsonRecord({
      ...entry.manual,
      _local_record: {
        schemaVersion: ACCOUNT_PAYLOAD_SCHEMA_VERSION,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
    }),
    mobile_data: jsonRecord(entry.mobile),
    watch_metadata: remoteWatchMetadata(entry.watchCapture) ?? null,
    provenance: jsonRecord(entry.provenance),
    profile_preview: entry.watchCapture
      ? jsonValue(entry.watchCapture.samples)
      : null,
    profile_content_revision: contentRevision ?? null,
    profile_sha256: entry.watchCapture?.profile?.sha256 ?? null,
    profile_byte_count: profileByteCount ?? null,
    profile_sample_count: entry.watchCapture?.profile?.sampleCount ?? null,
    source_plan_id: null,
  };
  return {
    id: entry.remoteId,
    localId: entry.localId,
    revision: entry.remoteRevision ?? 1,
    payloadSha256: canonicalAccountPayloadSha256(payload),
    payload,
    ...(contentRevision
      ? {
          profilePath: `${userId}/logs/${entry.remoteId}/${encodeURIComponent(
            contentRevision,
          )}.json`,
        }
      : {}),
  };
}

export function createAccountRemotePlan(
  plan: DivePlan,
  convertedLogId?: string,
): RemoteDivePlan {
  if (!plan.remoteId) {
    throw new Error('Account plan is missing a remote id');
  }
  const localPlan: Record<string, unknown> = {...plan};
  delete localPlan.remoteId;
  delete localPlan.remoteRevision;
  delete localPlan.ownerUserId;
  delete localPlan.cloudSyncStatus;
  const payload: Record<string, unknown> = {
    status: plan.status,
    planned_at:
      plan.plannedAt === undefined
        ? null
        : new Date(plan.plannedAt * 1_000).toISOString(),
    dive_mode: plan.diveMode ?? null,
    site_name: plan.site.name ?? null,
    plan_data: jsonRecord({
      ...localPlan,
      _schemaVersion: ACCOUNT_PAYLOAD_SCHEMA_VERSION,
    }),
    converted_log_id: convertedLogId ?? null,
  };
  return {
    id: plan.remoteId,
    localId: plan.localId,
    revision: plan.remoteRevision ?? 1,
    payloadSha256: canonicalAccountPayloadSha256(payload),
    payload,
  };
}

export function parseAccountRemoteLog(value: unknown): RemoteDiveLog {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'localId',
      'revision',
      'payloadSha256',
      'payload',
      'profilePath',
    ]) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.localId) ||
    !isPositiveInteger(value.revision) ||
    !isSha256(value.payloadSha256) ||
    !isRecord(value.payload) ||
    !hasExactKeys(value.payload, LOG_PAYLOAD_KEYS) ||
    (value.profilePath !== undefined && !isNonEmptyString(value.profilePath))
  ) {
    throw new Error('Malformed remote log payload');
  }
  assertLogPayload(value.payload);
  if (canonicalAccountPayloadSha256(value.payload) !== value.payloadSha256) {
    throw new Error('Malformed remote log payload digest');
  }
  return {
    id: value.id,
    localId: value.localId,
    revision: value.revision,
    payloadSha256: value.payloadSha256,
    payload: jsonRecord(value.payload),
    ...(value.profilePath === undefined
      ? {}
      : {profilePath: value.profilePath}),
  };
}

export function parseAccountRemotePlan(value: unknown): RemoteDivePlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'localId',
      'revision',
      'payloadSha256',
      'payload',
    ]) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.localId) ||
    !isPositiveInteger(value.revision) ||
    !isSha256(value.payloadSha256) ||
    !isRecord(value.payload) ||
    !hasExactKeys(value.payload, PLAN_PAYLOAD_KEYS)
  ) {
    throw new Error('Malformed remote plan payload');
  }
  assertPlanPayload(value.payload);
  if (canonicalAccountPayloadSha256(value.payload) !== value.payloadSha256) {
    throw new Error('Malformed remote plan payload digest');
  }
  return {
    id: value.id,
    localId: value.localId,
    revision: value.revision,
    payloadSha256: value.payloadSha256,
    payload: jsonRecord(value.payload),
  };
}

export function canonicalAccountPayloadSha256(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalStringify(value))));
}

function remoteWatchMetadata(
  watchCapture: DiveLogEntry['watchCapture'],
): Record<string, unknown> | undefined {
  if (!watchCapture) {
    return undefined;
  }
  const {profile, ...metadata} = watchCapture;
  return jsonRecord({
    ...metadata,
    ...(profile
      ? {
          profile: {
            contentRevision: profile.contentRevision,
            sampleCount: profile.sampleCount,
            sha256: profile.sha256,
          },
        }
      : {}),
  });
}

function assertLogPayload(payload: Record<string, unknown>): void {
  const localRecord = isRecord(payload.manual_data)
    ? payload.manual_data._local_record
    : undefined;
  if (
    (payload.source !== 'manual' && payload.source !== 'watch') ||
    !isNonEmptyString(payload.started_at) ||
    !isNullableString(payload.ended_at) ||
    !isNullableFiniteNumber(payload.duration_seconds) ||
    !isNullableFiniteNumber(payload.max_depth_meters) ||
    !isNullableString(payload.site_name) ||
    !isNullableString(payload.title) ||
    !isNullableFiniteNumber(payload.rating) ||
    !isNullableEnum(payload.dive_mode, ['scuba', 'freedive']) ||
    !isRecord(payload.manual_data) ||
    !isRecord(payload.mobile_data) ||
    !(payload.watch_metadata === null || isRecord(payload.watch_metadata)) ||
    !isRecord(payload.provenance) ||
    !(payload.profile_preview === null || Array.isArray(payload.profile_preview)) ||
    !isNullableString(payload.profile_content_revision) ||
    !(payload.profile_sha256 === null || isSha256(payload.profile_sha256)) ||
    !isNullableNonNegativeInteger(payload.profile_byte_count) ||
    !isNullableNonNegativeInteger(payload.profile_sample_count) ||
    !isNullableString(payload.source_plan_id) ||
    !isRecord(localRecord) ||
    !hasExactKeys(localRecord, ['schemaVersion', 'createdAt', 'updatedAt']) ||
    localRecord.schemaVersion !== ACCOUNT_PAYLOAD_SCHEMA_VERSION ||
    !isFiniteNumber(localRecord.createdAt) ||
    !isFiniteNumber(localRecord.updatedAt)
  ) {
    throw new Error('Malformed remote log payload schema');
  }
}

function assertPlanPayload(payload: Record<string, unknown>): void {
  if (
    !isNullableEnum(payload.status, ['draft', 'planned', 'completed']) ||
    payload.status === null ||
    !isNullableString(payload.planned_at) ||
    !isNullableEnum(payload.dive_mode, ['scuba', 'freedive']) ||
    !isNullableString(payload.site_name) ||
    !isRecord(payload.plan_data) ||
    payload.plan_data._schemaVersion !== ACCOUNT_PAYLOAD_SCHEMA_VERSION ||
    !isNullableString(payload.converted_log_id)
  ) {
    throw new Error('Malformed remote plan payload schema');
  }
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, nested]) =>
          `${JSON.stringify(key)}:${canonicalStringify(nested)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function jsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return jsonValue(value) as Record<string, unknown>;
}

function jsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => jsonValue(item));
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) {
        result[key] = jsonValue(nested);
      }
    }
    return result;
  }
  return value;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every(key => allowed.has(key));
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isNullableNonNegativeInteger(value: unknown): boolean {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isNullableEnum(value: unknown, options: readonly string[]): boolean {
  return value === null || (typeof value === 'string' && options.includes(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
