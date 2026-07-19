create table public.dive_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null check (length(local_id) between 1 and 256),
  status text not null check (status in ('draft', 'planned', 'completed')),
  planned_at timestamptz,
  dive_mode text check (
    dive_mode is null or dive_mode in ('scuba', 'freedive')
  ),
  site_name text,
  plan_data jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  converted_log_id uuid,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  deleted_at timestamptz,
  unique (user_id, local_id),
  unique (user_id, id)
);

create table public.dive_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null check (length(local_id) between 1 and 256),
  source_plan_id uuid,
  dive_mode text check (
    dive_mode is null or dive_mode in ('scuba', 'freedive')
  ),
  source text not null check (source in ('manual', 'watch')),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds double precision,
  max_depth_meters double precision,
  site_name text,
  title text,
  rating integer check (rating is null or rating between 1 and 5),
  manual_data jsonb not null,
  mobile_data jsonb not null,
  watch_metadata jsonb,
  provenance jsonb not null,
  profile_preview jsonb,
  profile_path text,
  profile_content_revision text,
  profile_sha256 text check (
    profile_sha256 is null or profile_sha256 ~ '^[0-9a-f]{64}$'
  ),
  profile_byte_count bigint check (
    profile_byte_count is null or profile_byte_count >= 0
  ),
  profile_sample_count integer check (
    profile_sample_count is null or profile_sample_count >= 0
  ),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  deleted_at timestamptz,
  unique (user_id, local_id),
  unique (user_id, id),
  foreign key (user_id, source_plan_id)
    references public.dive_plans(user_id, id)
);

alter table public.dive_plans
  add constraint dive_plans_converted_log_owner_fk
  foreign key (user_id, converted_log_id)
  references public.dive_logs(user_id, id)
  deferrable initially deferred;

create table public.guest_claim_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_batch_id text not null check (length(client_batch_id) between 1 and 256),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  expected_plan_count integer not null check (expected_plan_count >= 0),
  expected_log_count integer not null check (expected_log_count >= 0),
  status text not null default 'uploading'
    check (status in ('uploading', 'committed')),
  created_at timestamptz not null default transaction_timestamp(),
  committed_at timestamptz,
  unique (user_id, client_batch_id),
  unique (id, user_id)
);

create table public.guest_claim_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  user_id uuid not null,
  entity_kind text not null check (entity_kind in ('plan', 'log')),
  client_record_id text not null
    check (length(client_record_id) between 1 and 256),
  target_record_id uuid not null default gen_random_uuid(),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  source_plan_client_record_id text,
  converted_log_client_record_id text,
  profile_path text,
  profile_content_revision text,
  profile_sha256 text check (
    profile_sha256 is null or profile_sha256 ~ '^[0-9a-f]{64}$'
  ),
  profile_byte_count bigint check (
    profile_byte_count is null or profile_byte_count >= 0
  ),
  profile_sample_count integer check (
    profile_sample_count is null or profile_sample_count >= 0
  ),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  foreign key (batch_id, user_id)
    references public.guest_claim_batches(id, user_id)
    on delete cascade,
  unique (batch_id, entity_kind, client_record_id)
);

create index dive_logs_owner_cursor_idx
on public.dive_logs(user_id, started_at desc, id desc)
where deleted_at is null;

create index dive_plans_owner_cursor_idx
on public.dive_plans(user_id, planned_at desc nulls last, id desc)
where deleted_at is null;

create index guest_claim_records_batch_idx
on public.guest_claim_records(batch_id, entity_kind, client_record_id);

alter table public.dive_plans enable row level security;
alter table public.dive_logs enable row level security;
alter table public.guest_claim_batches enable row level security;
alter table public.guest_claim_records enable row level security;

revoke all on public.dive_plans,
  public.dive_logs,
  public.guest_claim_batches,
  public.guest_claim_records
from public, anon, authenticated;

grant usage on schema public to authenticated, service_role;
grant select, insert, update on public.dive_plans, public.dive_logs
  to authenticated;
grant select, insert on public.guest_claim_batches to authenticated;
grant select, insert, update on public.guest_claim_records to authenticated;
grant select, insert, update, delete on public.dive_plans,
  public.dive_logs,
  public.guest_claim_batches,
  public.guest_claim_records
to service_role;

create policy dive_plans_owner_select
on public.dive_plans
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy dive_plans_owner_insert
on public.dive_plans
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy dive_plans_owner_update
on public.dive_plans
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy dive_logs_owner_select
on public.dive_logs
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy dive_logs_owner_insert
on public.dive_logs
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy dive_logs_owner_update
on public.dive_logs
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy guest_claim_batches_owner_select
on public.guest_claim_batches
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy guest_claim_batches_owner_insert
on public.guest_claim_batches
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'uploading'
  and committed_at is null
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy guest_claim_records_owner_select
on public.guest_claim_records
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy guest_claim_records_owner_insert
on public.guest_claim_records
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.guest_claim_batches as batch
    where batch.id = batch_id
      and batch.user_id = user_id
      and batch.status = 'uploading'
  )
);

create policy guest_claim_records_owner_update
on public.guest_claim_records
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.guest_claim_batches as batch
    where batch.id = batch_id
      and batch.user_id = user_id
      and batch.status = 'uploading'
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.guest_claim_batches as batch
    where batch.id = batch_id
      and batch.user_id = user_id
      and batch.status = 'uploading'
  )
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'dive-profiles',
  'dive-profiles',
  false,
  52428800,
  array['application/json']
)
on conflict (id) do nothing;

create policy dive_profiles_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'dive-profiles'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('claims', 'logs')
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

create policy dive_profiles_owner_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'dive-profiles'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('claims', 'logs')
  and exists (
    select 1
    from public.app_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

comment on table public.dive_plans is
  'Owner-isolated account dive plans with versioned domain payloads.';
comment on table public.dive_logs is
  'Owner-isolated account dive logs; full profiles remain in private Storage.';
comment on table public.guest_claim_batches is
  'Resumable owner claim manifests kept separate from normal account rows.';
comment on table public.guest_claim_records is
  'Idempotent staged guest records awaiting privileged atomic publication.';
