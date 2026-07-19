import type {Database, Json} from './database.types.ts';
import type {RemoteDiveLog, RemoteDivePlan} from './account-data-types.ts';

export type DiveLogRow = Database['public']['Tables']['dive_logs']['Row'];
export type DivePlanRow = Database['public']['Tables']['dive_plans']['Row'];

type JsonRecord = {[key: string]: Json | undefined};

function invalidPayload(): never {
  throw new TypeError('Invalid account data payload');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidPayload();
  }

  return value as Record<string, unknown>;
}

function asJson(value: unknown): Json {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(asJson);
  }

  if (typeof value === 'object') {
    const result: JsonRecord = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = asJson(nested);
    }
    return result;
  }

  return invalidPayload();
}

function optionalString(payload: Record<string, unknown>, key: string): string | null | undefined {
  const value = payload[key];
  if (value === undefined || value === null || typeof value === 'string') {
    return value;
  }
  return invalidPayload();
}

function optionalNumber(payload: Record<string, unknown>, key: string): number | null | undefined {
  const value = payload[key];
  if (value === undefined || value === null || typeof value === 'number') {
    return value;
  }
  return invalidPayload();
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    return invalidPayload();
  }
  return value;
}

function requiredJson(payload: Record<string, unknown>, key: string): Json {
  if (!(key in payload)) {
    return invalidPayload();
  }
  return asJson(payload[key]);
}

function setOptional(
  target: Record<string, unknown>,
  key: string,
  value: string | number | null | undefined,
) {
  if (value !== undefined) {
    target[key] = value;
  }
}

export function boundProfilePreview(payload: Record<string, unknown>): Record<string, unknown> {
  const preview = payload.profile_preview;
  if (preview === undefined || !Array.isArray(preview)) {
    return {...payload};
  }

  return {...payload, profile_preview: preview.slice(0, 160)};
}

export function fromDiveLogRow(row: DiveLogRow): RemoteDiveLog {
  const payload: Record<string, unknown> = {
    source: row.source,
    started_at: row.started_at,
    ended_at: row.ended_at,
    duration_seconds: row.duration_seconds,
    max_depth_meters: row.max_depth_meters,
    site_name: row.site_name,
    title: row.title,
    rating: row.rating,
    manual_data: row.manual_data,
    mobile_data: row.mobile_data,
    watch_metadata: row.watch_metadata,
    provenance: row.provenance,
    profile_preview: row.profile_preview,
    profile_content_revision: row.profile_content_revision,
    profile_sha256: row.profile_sha256,
    profile_byte_count: row.profile_byte_count,
    profile_sample_count: row.profile_sample_count,
    source_plan_id: row.source_plan_id,
  };
  const result: RemoteDiveLog = {
    id: row.id,
    localId: row.local_id,
    revision: row.revision,
    payloadSha256: row.payload_sha256,
    payload,
  };

  if (row.profile_path !== null) {
    result.profilePath = row.profile_path;
  }

  return result;
}

export function fromDivePlanRow(row: DivePlanRow): RemoteDivePlan {
  return {
    id: row.id,
    localId: row.local_id,
    revision: row.revision,
    payloadSha256: row.payload_sha256,
    payload: {
      status: row.status,
      planned_at: row.planned_at,
      dive_mode: row.dive_mode,
      site_name: row.site_name,
      plan_data: row.plan_data,
      converted_log_id: row.converted_log_id,
    },
  };
}

export function toDiveLogFields(value: RemoteDiveLog): Record<string, unknown> {
  const payload = boundProfilePreview(asRecord(value.payload));
  const fields: Record<string, unknown> = {
    local_id: value.localId,
    payload_sha256: value.payloadSha256,
    source: requiredString(payload, 'source'),
    started_at: requiredString(payload, 'started_at'),
    manual_data: requiredJson(payload, 'manual_data'),
    mobile_data: requiredJson(payload, 'mobile_data'),
    provenance: requiredJson(payload, 'provenance'),
  };
  setOptional(fields, 'ended_at', optionalString(payload, 'ended_at'));
  setOptional(fields, 'duration_seconds', optionalNumber(payload, 'duration_seconds'));
  setOptional(fields, 'max_depth_meters', optionalNumber(payload, 'max_depth_meters'));
  setOptional(fields, 'site_name', optionalString(payload, 'site_name'));
  setOptional(fields, 'title', optionalString(payload, 'title'));
  setOptional(fields, 'rating', optionalNumber(payload, 'rating'));
  setOptional(fields, 'dive_mode', optionalString(payload, 'dive_mode'));
  setOptional(fields, 'source_plan_id', optionalString(payload, 'source_plan_id'));
  if ('watch_metadata' in payload) fields.watch_metadata = asJson(payload.watch_metadata);
  if ('profile_preview' in payload) fields.profile_preview = asJson(payload.profile_preview);
  setOptional(fields, 'profile_content_revision', optionalString(payload, 'profile_content_revision'));
  setOptional(fields, 'profile_sha256', optionalString(payload, 'profile_sha256'));
  setOptional(fields, 'profile_byte_count', optionalNumber(payload, 'profile_byte_count'));
  setOptional(fields, 'profile_sample_count', optionalNumber(payload, 'profile_sample_count'));
  if (value.profilePath !== undefined) fields.profile_path = value.profilePath;
  return fields;
}

export function toDivePlanFields(value: RemoteDivePlan): Record<string, unknown> {
  const payload = asRecord(value.payload);
  const fields: Record<string, unknown> = {
    local_id: value.localId,
    payload_sha256: value.payloadSha256,
    status: requiredString(payload, 'status'),
    plan_data: requiredJson(payload, 'plan_data'),
  };
  setOptional(fields, 'planned_at', optionalString(payload, 'planned_at'));
  setOptional(fields, 'dive_mode', optionalString(payload, 'dive_mode'));
  setOptional(fields, 'site_name', optionalString(payload, 'site_name'));
  setOptional(fields, 'converted_log_id', optionalString(payload, 'converted_log_id'));
  return fields;
}

export function toJsonPayload(value: Record<string, unknown>): Json {
  return asJson(value);
}
