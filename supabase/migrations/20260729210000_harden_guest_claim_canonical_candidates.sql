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
  -- Lock order starts with the batch, then records by (entity_kind, client_record_id, id).
  -- This fixes the staged record set before account candidate locks are chosen.
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

  -- Lock order: all plans by (local_id, id), then all logs by (local_id, id).
  -- Both active and soft-deleted candidates are locked so their state cannot
  -- change during private validation, publication, remap, or final readback.
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
  'Locks canonical candidates, publishes one verified claim, and remaps only to active account rows.';

comment on function private.finalize_guest_claim(uuid, uuid, jsonb) is
  'Internal guest claim publisher invoked only while the public wrapper holds canonical candidate locks.';
