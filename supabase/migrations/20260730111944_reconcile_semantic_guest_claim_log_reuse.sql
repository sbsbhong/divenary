create or replace function private.account_float_readback_equal(
  p_typed_value double precision,
  p_source_value double precision
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    case
      when p_typed_value is null or p_source_value is null then
        p_typed_value is null and p_source_value is null
      when p_typed_value = p_source_value then true
      when p_typed_value::text in ('NaN', 'Infinity', '-Infinity')
        or p_source_value::text in ('NaN', 'Infinity', '-Infinity')
      then false
      else
        pg_catalog.abs(p_typed_value - p_source_value) <=
          greatest(
            pg_catalog.abs(p_typed_value),
            pg_catalog.abs(p_source_value)
          ) * 2.220446049250313e-16::double precision
        or p_typed_value = pg_catalog.round(
          p_source_value::numeric,
          greatest(
            -1000,
            least(
              1000,
              14 - pg_catalog.floor(
                pg_catalog.log(
                  10::numeric,
                  pg_catalog.abs(p_source_value)::numeric
                )
              )::integer
            )
          )
        )::double precision
    end;
$$;

create or replace function private.guest_claim_log_semantically_equal(
  p_log public.dive_logs,
  p_record public.guest_claim_records,
  p_source_plan_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    p_record.entity_kind = 'log'
    and p_log.user_id = p_record.user_id
    and p_log.local_id = p_record.client_record_id
    and p_log.deleted_at is null
    and p_log.source = 'watch'
    and p_record.payload->>'source' = 'watch'
    and p_record.payload ?& array[
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
      'profile_preview'
    ]
    and p_log.profile_path is not null
    and p_record.profile_path is not null
    and p_log.profile_content_revision is not null
    and p_record.profile_content_revision is not null
    and p_log.profile_sha256 is not null
    and p_record.profile_sha256 is not null
    and p_log.profile_byte_count is not null
    and p_record.profile_byte_count is not null
    and p_log.profile_sample_count is not null
    and p_record.profile_sample_count is not null
    and p_log.profile_content_revision is not distinct from
      p_record.profile_content_revision
    and p_log.profile_sha256 is not distinct from p_record.profile_sha256
    and p_log.profile_byte_count is not distinct from p_record.profile_byte_count
    and p_log.profile_sample_count is not distinct from
      p_record.profile_sample_count
    and p_log.source_plan_id is not distinct from p_source_plan_id
    and p_log.dive_mode is not distinct from
      nullif(p_record.payload->>'dive_mode', '')
    and p_log.source = p_record.payload->>'source'
    and p_log.started_at = (p_record.payload->>'started_at')::timestamptz
    and p_log.ended_at is not distinct from
      nullif(p_record.payload->>'ended_at', '')::timestamptz
    and private.account_float_readback_equal(
      p_log.duration_seconds,
      nullif(
        p_record.payload->>'duration_seconds',
        ''
      )::double precision
    )
    and private.account_float_readback_equal(
      p_log.max_depth_meters,
      nullif(
        p_record.payload->>'max_depth_meters',
        ''
      )::double precision
    )
    and p_log.site_name is not distinct from p_record.payload->>'site_name'
    and p_log.title is not distinct from p_record.payload->>'title'
    and p_log.rating is not distinct from
      nullif(p_record.payload->>'rating', '')::integer
    and (
      p_log.manual_data
        #- '{_local_record,createdAt}'
        #- '{_local_record,updatedAt}'
    ) = (
      p_record.payload->'manual_data'
        #- '{_local_record,createdAt}'
        #- '{_local_record,updatedAt}'
    )
    and p_log.mobile_data = p_record.payload->'mobile_data'
    and (
      p_log.watch_metadata #- '{importedAt}'
    ) is not distinct from (
      p_record.payload->'watch_metadata' #- '{importedAt}'
    )
    and p_log.provenance = p_record.payload->'provenance'
    and p_log.profile_preview is not distinct from
      p_record.payload->'profile_preview';
$$;

revoke all on function private.account_float_readback_equal(
  double precision,
  double precision
)
from public, anon, authenticated, service_role;

revoke all on function private.guest_claim_log_semantically_equal(
  public.dive_logs,
  public.guest_claim_records,
  uuid
)
from public, anon, authenticated, service_role;

create or replace function public.finalize_guest_claim(
  p_user_id uuid,
  p_batch_id uuid,
  p_verified_profiles jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_candidate_id uuid;
  v_record_id uuid;
  v_result jsonb;
begin
  -- Phase 1 fixes the staged record set and every candidate visible before
  -- publication. All callers use batch, records, plans, then logs.
  select batch.id
  into v_batch_id
  from public.guest_claim_batches as batch
  where batch.id = p_batch_id
    and batch.user_id = p_user_id
  for update of batch;

  for v_record_id in
    select record.id
    from public.guest_claim_records as record
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
    order by record.entity_kind, record.client_record_id, record.id
    for update of record
  loop
    null;
  end loop;

  for v_candidate_id in
    select plan.id
    from public.dive_plans as plan
    join public.guest_claim_records as record
      on record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'plan'
      and plan.user_id = p_user_id
      and plan.local_id = record.client_record_id
    order by plan.local_id, plan.id
    for update of plan
  loop
    null;
  end loop;

  for v_candidate_id in
    select log.id
    from public.dive_logs as log
    join public.guest_claim_records as record
      on record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'log'
      and log.user_id = p_user_id
      and log.local_id = record.client_record_id
    order by log.local_id, log.id
    for update of log
  loop
    null;
  end loop;

  -- Normalize a representation-only canonical mismatch while phase 1 locks are held.
  update public.dive_logs as log
  set
    dive_mode = nullif(record.payload->>'dive_mode', ''),
    source = record.payload->>'source',
    started_at = (record.payload->>'started_at')::timestamptz,
    ended_at =
      nullif(record.payload->>'ended_at', '')::timestamptz,
    duration_seconds = nullif(
      record.payload->>'duration_seconds',
      ''
    )::double precision,
    max_depth_meters = nullif(
      record.payload->>'max_depth_meters',
      ''
    )::double precision,
    site_name = record.payload->>'site_name',
    title = record.payload->>'title',
    rating = nullif(record.payload->>'rating', '')::integer,
    manual_data = record.payload->'manual_data',
    mobile_data = record.payload->'mobile_data',
    watch_metadata = record.payload->'watch_metadata',
    provenance = record.payload->'provenance',
    profile_preview = record.payload->'profile_preview',
    payload_sha256 = record.payload_sha256
  from public.guest_claim_records as record
  left join public.guest_claim_records as source_plan_record
    on source_plan_record.batch_id = record.batch_id
    and source_plan_record.user_id = record.user_id
    and source_plan_record.entity_kind = 'plan'
    and source_plan_record.client_record_id =
      record.source_plan_client_record_id
  left join public.dive_plans as source_plan
    on source_plan.user_id = p_user_id
    and source_plan.local_id = source_plan_record.client_record_id
  where record.batch_id = p_batch_id
    and record.user_id = p_user_id
    and record.entity_kind = 'log'
    and log.user_id = p_user_id
    and log.local_id = record.client_record_id
    and log.deleted_at is null
    and log.payload_sha256 <> record.payload_sha256
    and private.guest_claim_log_semantically_equal(
      log,
      record,
      source_plan.id
    );

  v_result := private.finalize_guest_claim(
    p_user_id,
    p_batch_id,
    p_verified_profiles
  );

  -- Phase 2 includes rows materialized by private publication or by a
  -- concurrent unique-key winner that was invisible during phase 1.
  -- Active and soft-deleted rows are both locked, plans before logs.
  for v_candidate_id in
    select plan.id
    from public.dive_plans as plan
    join public.guest_claim_records as record
      on record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'plan'
      and plan.user_id = p_user_id
      and plan.local_id = record.client_record_id
    order by plan.local_id, plan.id
    for update of plan
  loop
    null;
  end loop;

  for v_candidate_id in
    select log.id
    from public.dive_logs as log
    join public.guest_claim_records as record
      on record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'log'
      and log.user_id = p_user_id
      and log.local_id = record.client_record_id
    order by log.local_id, log.id
    for update of log
  loop
    null;
  end loop;

  -- Revalidate every now-materialized candidate while phase 2 locks are held.
  if exists (
    select 1
    from public.guest_claim_records as record
    left join public.dive_plans as plan
      on plan.user_id = p_user_id
      and plan.local_id = record.client_record_id
    left join public.guest_claim_records as converted_log_record
      on converted_log_record.batch_id = record.batch_id
      and converted_log_record.user_id = record.user_id
      and converted_log_record.entity_kind = 'log'
      and converted_log_record.client_record_id =
        record.converted_log_client_record_id
    left join public.dive_logs as converted_log
      on converted_log.user_id = p_user_id
      and converted_log.local_id = converted_log_record.client_record_id
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'plan'
      and (
        plan.id is null
        or plan.deleted_at is not null
        or plan.payload_sha256 <> record.payload_sha256
        or plan.converted_log_id is distinct from converted_log.id
      )
  ) or exists (
    select 1
    from public.guest_claim_records as record
    left join public.dive_logs as log
      on log.user_id = p_user_id
      and log.local_id = record.client_record_id
    left join public.guest_claim_records as source_plan_record
      on source_plan_record.batch_id = record.batch_id
      and source_plan_record.user_id = record.user_id
      and source_plan_record.entity_kind = 'plan'
      and source_plan_record.client_record_id =
        record.source_plan_client_record_id
    left join public.dive_plans as source_plan
      on source_plan.user_id = p_user_id
      and source_plan.local_id = source_plan_record.client_record_id
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'log'
      and (
        log.id is null
        or log.deleted_at is not null
        or log.payload_sha256 <> record.payload_sha256
        or log.profile_content_revision is distinct from
          record.profile_content_revision
        or log.profile_sha256 is distinct from record.profile_sha256
        or log.profile_byte_count is distinct from record.profile_byte_count
        or log.profile_sample_count is distinct from record.profile_sample_count
        or log.source_plan_id is distinct from source_plan.id
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'claim validation failed';
  end if;

  -- Remap only after locked equivalence validation succeeds.
  update public.guest_claim_records as record
  set target_record_id = plan.id
  from public.dive_plans as plan
  where record.batch_id = p_batch_id
    and record.user_id = p_user_id
    and record.entity_kind = 'plan'
    and plan.user_id = p_user_id
    and plan.local_id = record.client_record_id
    and plan.deleted_at is null
    and record.target_record_id <> plan.id;

  update public.guest_claim_records as record
  set target_record_id = log.id
  from public.dive_logs as log
  where record.batch_id = p_batch_id
    and record.user_id = p_user_id
    and record.entity_kind = 'log'
    and log.user_id = p_user_id
    and log.local_id = record.client_record_id
    and log.deleted_at is null
    and record.target_record_id <> log.id;

  if exists (
    select 1
    from public.guest_claim_records as record
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'plan'
      and (
        select pg_catalog.count(*)
        from public.dive_plans as plan
        where plan.user_id = p_user_id
          and plan.local_id = record.client_record_id
          and plan.id = record.target_record_id
          and plan.deleted_at is null
      ) <> 1
  ) or exists (
    select 1
    from public.guest_claim_records as record
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'log'
      and (
        select pg_catalog.count(*)
        from public.dive_logs as log
        where log.user_id = p_user_id
          and log.local_id = record.client_record_id
          and log.id = record.target_record_id
          and log.deleted_at is null
      ) <> 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'claim validation failed';
  end if;

  return v_result;
end;
$$;

revoke all on function public.finalize_guest_claim(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.finalize_guest_claim(uuid, uuid, jsonb)
to service_role;

comment on function private.account_float_readback_equal(
  double precision,
  double precision
) is
  'Accepts exact, adjacent-rounding, or fifteen-significant-digit account float readback equivalence.';

comment on function private.guest_claim_log_semantically_equal(
  public.dive_logs,
  public.guest_claim_records,
  uuid
) is
  'Accepts only an active profiled watch log with identical meaningful content and import-representation-only differences.';

comment on function public.finalize_guest_claim(uuid, uuid, jsonb) is
  'Normalizes locked representation-only watch-log reuse, then strictly publishes, revalidates, and remaps one guest claim.';

comment on function private.finalize_guest_claim(uuid, uuid, jsonb) is
  'Internal strict guest claim publisher invoked only inside the canonical candidate lock wrapper.';
