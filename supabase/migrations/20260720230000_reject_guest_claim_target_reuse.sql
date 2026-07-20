alter function public.finalize_guest_claim(uuid, uuid, jsonb)
  set schema private;

revoke all on function private.finalize_guest_claim(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

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
  v_result jsonb;
begin
  v_result := private.finalize_guest_claim(
    p_user_id,
    p_batch_id,
    p_verified_profiles
  );

  if exists (
    select 1
    from public.guest_claim_records as record
    join public.dive_plans as plan
      on plan.user_id = p_user_id
      and plan.local_id = record.client_record_id
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'plan'
      and plan.id <> record.target_record_id
  ) or exists (
    select 1
    from public.guest_claim_records as record
    join public.dive_logs as log
      on log.user_id = p_user_id
      and log.local_id = record.client_record_id
    where record.batch_id = p_batch_id
      and record.user_id = p_user_id
      and record.entity_kind = 'log'
      and log.id <> record.target_record_id
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
  'Publishes one verified guest claim and rejects reuse of an existing local row under a different target id.';

comment on function private.finalize_guest_claim(uuid, uuid, jsonb) is
  'Internal guest claim publisher invoked only by the public target-id guard.';
