create function public.finalize_guest_claim(
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
  v_batch public.guest_claim_batches%rowtype;
  v_plan_count integer;
  v_log_count integer;
  v_profile_count integer;
begin
  if p_user_id is null or p_batch_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  select batch.*
  into v_batch
  from public.guest_claim_batches as batch
  where batch.id = p_batch_id
    and batch.user_id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  if v_batch.status = 'committed' then
    return pg_catalog.jsonb_build_object(
      'batchId', v_batch.id,
      'status', 'committed',
      'planCount', v_batch.expected_plan_count,
      'logCount', v_batch.expected_log_count
    );
  end if;

  if v_batch.status <> 'uploading' then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  select
    count(*) filter (where record.entity_kind = 'plan'),
    count(*) filter (where record.entity_kind = 'log'),
    count(*) filter (where record.profile_path is not null)
  into v_plan_count, v_log_count, v_profile_count
  from public.guest_claim_records as record
  where record.batch_id = p_batch_id
    and record.user_id = p_user_id;

  if v_plan_count <> v_batch.expected_plan_count
    or v_log_count <> v_batch.expected_log_count
  then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  if exists (
    select 1
    from public.guest_claim_records as record
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and (
        pg_catalog.jsonb_typeof(record.payload) <> 'object'
        or (
          record.entity_kind = 'plan'
          and (
            record.payload->>'status' not in ('draft', 'planned', 'completed')
            or not record.payload ? 'plan_data'
          )
        )
        or (
          record.entity_kind = 'log'
          and (
            record.payload->>'source' not in ('manual', 'watch')
            or nullif(record.payload->>'started_at', '') is null
            or not record.payload ? 'manual_data'
            or not record.payload ? 'mobile_data'
            or not record.payload ? 'provenance'
          )
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  if exists (
    select 1
    from public.guest_claim_records as record
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and (
        pg_catalog.num_nonnulls(
          record.profile_path,
          record.profile_content_revision,
          record.profile_sha256,
          record.profile_byte_count,
          record.profile_sample_count
        ) not in (0, 5)
        or (record.entity_kind = 'plan' and record.profile_path is not null)
        or (
          record.profile_path is not null
          and (
            record.profile_path not like p_user_id::text || '/claims/%'
            or record.profile_content_revision = ''
          )
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  if exists (
    select 1
    from public.guest_claim_records as record
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and (
        (record.entity_kind = 'plan' and record.source_plan_client_record_id is not null)
        or (record.entity_kind = 'log' and record.converted_log_client_record_id is not null)
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  if exists (
    select 1
    from public.guest_claim_records as plan_record
    where plan_record.batch_id = p_batch_id
      and plan_record.user_id = p_user_id
      and plan_record.entity_kind = 'plan'
      and plan_record.converted_log_client_record_id is not null
      and not exists (
        select 1
        from public.guest_claim_records as log_record
        where log_record.batch_id = p_batch_id
          and log_record.user_id = p_user_id
          and log_record.entity_kind = 'log'
          and log_record.client_record_id =
            plan_record.converted_log_client_record_id
          and log_record.source_plan_client_record_id =
            plan_record.client_record_id
      )
  ) or exists (
    select 1
    from public.guest_claim_records as log_record
    where log_record.batch_id = p_batch_id
      and log_record.user_id = p_user_id
      and log_record.entity_kind = 'log'
      and log_record.source_plan_client_record_id is not null
      and not exists (
        select 1
        from public.guest_claim_records as plan_record
        where plan_record.batch_id = p_batch_id
          and plan_record.user_id = p_user_id
          and plan_record.entity_kind = 'plan'
          and plan_record.client_record_id =
            log_record.source_plan_client_record_id
          and plan_record.converted_log_client_record_id =
            log_record.client_record_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  if p_verified_profiles is null
    or pg_catalog.jsonb_typeof(p_verified_profiles) <> 'array'
    or pg_catalog.jsonb_array_length(p_verified_profiles) <> v_profile_count
  then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_verified_profiles) as verified(entry)
    where pg_catalog.jsonb_typeof(verified.entry) <> 'object'
      or verified.entry->>'record_id' is null
      or verified.entry->>'record_id' !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or verified.entry->>'sha256' !~ '^[0-9a-f]{64}$'
      or verified.entry->>'byte_count' !~ '^[0-9]+$'
      or verified.entry->>'sample_count' !~ '^[0-9]+$'
      or (
        select count(*)
        from public.guest_claim_records as record
        where record.batch_id = p_batch_id
          and record.user_id = p_user_id
          and record.id::text = verified.entry->>'record_id'
          and record.profile_path is not null
          and record.profile_sha256 = verified.entry->>'sha256'
          and record.profile_byte_count::text = verified.entry->>'byte_count'
          and record.profile_sample_count::text = verified.entry->>'sample_count'
      ) <> 1
  ) or exists (
    select 1
    from public.guest_claim_records as record
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.profile_path is not null
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_verified_profiles) as verified(entry)
        where verified.entry->>'record_id' = record.id::text
          and verified.entry->>'sha256' = record.profile_sha256
          and verified.entry->>'byte_count' = record.profile_byte_count::text
          and verified.entry->>'sample_count' = record.profile_sample_count::text
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  if exists (
    select 1
    from public.guest_claim_records as record
    join public.dive_plans as plan
      on plan.user_id = p_user_id
      and plan.local_id = record.client_record_id
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'plan'
      and plan.payload_sha256 <> record.payload_sha256
  ) or exists (
    select 1
    from public.guest_claim_records as record
    join public.dive_logs as log
      on log.user_id = p_user_id
      and log.local_id = record.client_record_id
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'log'
      and log.payload_sha256 <> record.payload_sha256
  ) then
    raise exception using
      errcode = '23505',
      message = 'claim validation failed';
  end if;

  insert into public.dive_plans (
    id,
    user_id,
    local_id,
    status,
    planned_at,
    dive_mode,
    site_name,
    plan_data,
    payload_sha256
  )
  select
    record.target_record_id,
    p_user_id,
    record.client_record_id,
    record.payload->>'status',
    nullif(record.payload->>'planned_at', '')::timestamptz,
    nullif(record.payload->>'dive_mode', ''),
    record.payload->>'site_name',
    record.payload->'plan_data',
    record.payload_sha256
  from public.guest_claim_records as record
  where record.batch_id = p_batch_id
    and record.user_id = p_user_id
    and record.entity_kind = 'plan'
  order by record.client_record_id
  on conflict (user_id, local_id) do nothing;

  if exists (
    select 1
    from public.guest_claim_records as record
    left join public.dive_plans as plan
      on plan.user_id = p_user_id
      and plan.local_id = record.client_record_id
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'plan'
      and (
        plan.id is null
        or plan.payload_sha256 <> record.payload_sha256
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'claim validation failed';
  end if;

  insert into public.dive_logs (
    id,
    user_id,
    local_id,
    source_plan_id,
    dive_mode,
    source,
    started_at,
    ended_at,
    duration_seconds,
    max_depth_meters,
    site_name,
    title,
    rating,
    manual_data,
    mobile_data,
    watch_metadata,
    provenance,
    profile_preview,
    profile_path,
    profile_content_revision,
    profile_sha256,
    profile_byte_count,
    profile_sample_count,
    payload_sha256
  )
  select
    record.target_record_id,
    p_user_id,
    record.client_record_id,
    source_plan.id,
    nullif(record.payload->>'dive_mode', ''),
    record.payload->>'source',
    (record.payload->>'started_at')::timestamptz,
    nullif(record.payload->>'ended_at', '')::timestamptz,
    nullif(record.payload->>'duration_seconds', '')::double precision,
    nullif(record.payload->>'max_depth_meters', '')::double precision,
    record.payload->>'site_name',
    record.payload->>'title',
    nullif(record.payload->>'rating', '')::integer,
    record.payload->'manual_data',
    record.payload->'mobile_data',
    record.payload->'watch_metadata',
    record.payload->'provenance',
    record.payload->'profile_preview',
    record.profile_path,
    record.profile_content_revision,
    record.profile_sha256,
    record.profile_byte_count,
    record.profile_sample_count,
    record.payload_sha256
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
  order by record.client_record_id
  on conflict (user_id, local_id) do nothing;

  if exists (
    select 1
    from public.guest_claim_records as record
    left join public.dive_logs as log
      on log.user_id = p_user_id
      and log.local_id = record.client_record_id
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'log'
      and (
        log.id is null
        or log.payload_sha256 <> record.payload_sha256
        or log.profile_path is distinct from record.profile_path
        or log.profile_content_revision is distinct from
          record.profile_content_revision
        or log.profile_sha256 is distinct from record.profile_sha256
        or log.profile_byte_count is distinct from record.profile_byte_count
        or log.profile_sample_count is distinct from record.profile_sample_count
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'claim validation failed';
  end if;

  if exists (
    select 1
    from public.guest_claim_records as record
    join public.dive_logs as log
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
      and log.source_plan_id is distinct from source_plan.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'claim validation failed';
  end if;

  if exists (
    select 1
    from public.guest_claim_records as record
    join public.dive_plans as plan
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
      and plan.converted_log_id is not null
      and plan.converted_log_id is distinct from converted_log.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'claim validation failed';
  end if;

  update public.dive_plans as plan
  set converted_log_id = converted_log.id
  from public.guest_claim_records as record
  join public.guest_claim_records as converted_log_record
    on converted_log_record.batch_id = record.batch_id
    and converted_log_record.user_id = record.user_id
    and converted_log_record.entity_kind = 'log'
    and converted_log_record.client_record_id =
      record.converted_log_client_record_id
  join public.dive_logs as converted_log
    on converted_log.user_id = p_user_id
    and converted_log.local_id = converted_log_record.client_record_id
  where record.batch_id = p_batch_id
    and record.user_id = p_user_id
    and record.entity_kind = 'plan'
    and plan.user_id = p_user_id
    and plan.local_id = record.client_record_id
    and plan.converted_log_id is null;

  if exists (
    select 1
    from public.guest_claim_records as record
    join public.dive_plans as plan
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
      and plan.converted_log_id is distinct from converted_log.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'claim validation failed';
  end if;

  update public.guest_claim_batches as batch
  set
    status = 'committed',
    committed_at = pg_catalog.transaction_timestamp()
  where batch.id = p_batch_id
    and batch.user_id = p_user_id
    and batch.status = 'uploading';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  return pg_catalog.jsonb_build_object(
    'batchId', p_batch_id,
    'status', 'committed',
    'planCount', v_plan_count,
    'logCount', v_log_count
  );
end;
$$;

revoke all on function public.finalize_guest_claim(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.finalize_guest_claim(uuid, uuid, jsonb)
to service_role;

comment on function public.finalize_guest_claim(uuid, uuid, jsonb) is
  'Atomically publishes a server-verified guest claim for one verified owner.';
