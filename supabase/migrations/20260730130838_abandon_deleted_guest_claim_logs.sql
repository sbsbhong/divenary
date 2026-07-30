alter table public.guest_claim_batches
  drop constraint guest_claim_batches_status_check;

alter table public.guest_claim_batches
  add column abandoned_at timestamptz,
  add constraint guest_claim_batches_status_check
    check (status in ('uploading', 'committed', 'abandoned')),
  add constraint guest_claim_batches_terminal_timestamp_check
    check (
      (
        status = 'uploading'
        and committed_at is null
        and abandoned_at is null
      )
      or (
        status = 'committed'
        and committed_at is not null
        and abandoned_at is null
      )
      or (
        status = 'abandoned'
        and committed_at is null
        and abandoned_at is not null
      )
    );

create function private.abandon_guest_claim(
  p_user_id uuid,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.guest_claim_batches%rowtype;
  v_profile_paths jsonb;
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
  for update of batch;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  if v_batch.status = 'committed' then
    return pg_catalog.jsonb_build_object(
      'batchId', v_batch.id,
      'status', 'committed',
      'profilePaths', '[]'::jsonb
    );
  end if;

  if v_batch.status = 'uploading' then
    update public.guest_claim_batches as batch
    set
      status = 'abandoned',
      abandoned_at = pg_catalog.transaction_timestamp()
    where batch.id = p_batch_id
      and batch.user_id = p_user_id
      and batch.status = 'uploading';

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'claim validation failed';
    end if;
  elsif v_batch.status <> 'abandoned' then
    raise exception using
      errcode = 'P0001',
      message = 'claim validation failed';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(record.profile_path order by record.id)
      filter (where record.profile_path is not null),
    '[]'::jsonb
  )
  into v_profile_paths
  from public.guest_claim_records as record
  where record.batch_id = p_batch_id
    and record.user_id = p_user_id;

  return pg_catalog.jsonb_build_object(
    'batchId', p_batch_id,
    'status', 'abandoned',
    'profilePaths', v_profile_paths
  );
end;
$$;

create function public.abandon_guest_claim(
  p_user_id uuid,
  p_batch_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.abandon_guest_claim(p_user_id, p_batch_id);
$$;

revoke all on function private.abandon_guest_claim(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.abandon_guest_claim(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.abandon_guest_claim(uuid, uuid)
to service_role;

comment on column public.guest_claim_batches.abandoned_at is
  'Terminal timestamp for an upload batch deliberately excluded after a mobile Watch-log deletion.';

comment on function private.abandon_guest_claim(uuid, uuid) is
  'Locks one owner-bound guest claim and performs only the uploading-to-abandoned terminal transition.';

comment on function public.abandon_guest_claim(uuid, uuid) is
  'Service-role boundary for idempotent owner-bound guest claim abandonment and staged profile cleanup discovery.';
