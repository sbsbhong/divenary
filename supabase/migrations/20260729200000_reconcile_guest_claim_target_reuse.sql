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
  v_result jsonb;
begin
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
    and record.target_record_id <> plan.id;

  update public.guest_claim_records as record
  set target_record_id = log.id
  from public.dive_logs as log
  where record.batch_id = p_batch_id
    and record.user_id = p_user_id
    and record.entity_kind = 'log'
    and log.user_id = p_user_id
    and log.local_id = record.client_record_id
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
  'Publishes one verified guest claim and reconciles equivalent target ids to canonical account rows.';

comment on function private.finalize_guest_claim(uuid, uuid, jsonb) is
  'Internal guest claim publisher invoked only by the public canonical target-id wrapper.';
