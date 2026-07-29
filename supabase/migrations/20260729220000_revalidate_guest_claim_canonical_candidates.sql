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

comment on function public.finalize_guest_claim(uuid, uuid, jsonb) is
  'Locks pre- and post-publication candidates, revalidates full equivalence, and remaps only active rows.';

comment on function private.finalize_guest_claim(uuid, uuid, jsonb) is
  'Internal guest claim publisher invoked only inside the two-phase canonical candidate lock wrapper.';
