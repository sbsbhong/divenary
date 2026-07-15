create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table public.app_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding_completed_at timestamptz not null,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp()
);

create table public.legal_documents (
  kind text not null check (kind in ('terms', 'privacy')),
  version text not null check (length(version) > 0),
  effective_at timestamptz not null,
  document_url text not null check (document_url ~ '^https://'),
  primary key (kind, version)
);

create table public.current_legal_documents (
  kind text primary key check (kind in ('terms', 'privacy')),
  document_version text not null,
  constraint current_legal_documents_document_fk
    foreign key (kind, document_version)
    references public.legal_documents(kind, version)
);

create table public.consent_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_kind text not null,
  document_version text not null,
  agreed_at timestamptz not null default transaction_timestamp(),
  primary key (user_id, document_kind, document_version),
  constraint consent_records_document_fk
    foreign key (document_kind, document_version)
    references public.legal_documents(kind, version)
);

comment on table public.app_memberships is
  'Users who completed the required current legal onboarding at least once.';
comment on table public.legal_documents is
  'Immutable, versioned terms and privacy document metadata.';
comment on table public.current_legal_documents is
  'Mutable pointers to the currently required effective legal document versions.';
comment on table public.consent_records is
  'Append-only user consent history; rows are removed only by auth.users cascade deletion.';

create function private.reject_legal_document_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'PT409',
    message = 'legal_documents_are_immutable';
end;
$$;

create trigger reject_legal_document_mutation
before update or delete on public.legal_documents
for each row execute function private.reject_legal_document_mutation();

create function private.ensure_current_legal_document_is_effective()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_effective_at timestamptz;
begin
  select document.effective_at
  into target_effective_at
  from public.legal_documents as document
  where document.kind = new.kind
    and document.version = new.document_version;

  if target_effective_at is null then
    raise exception using
      errcode = 'PT400',
      message = 'legal_document_not_found';
  end if;

  if target_effective_at > transaction_timestamp() then
    raise exception using
      errcode = 'PT400',
      message = 'legal_document_not_effective';
  end if;

  return new;
end;
$$;

create trigger ensure_current_legal_document_is_effective
before insert or update on public.current_legal_documents
for each row execute function private.ensure_current_legal_document_is_effective();

revoke all on function private.reject_legal_document_mutation()
  from public, anon, authenticated;
revoke all on function private.ensure_current_legal_document_is_effective()
  from public, anon, authenticated;

alter table public.app_memberships enable row level security;
alter table public.legal_documents enable row level security;
alter table public.current_legal_documents enable row level security;
alter table public.consent_records enable row level security;

create policy legal_documents_readable
on public.legal_documents
for select
to anon, authenticated
using (true);

create policy current_legal_documents_readable
on public.current_legal_documents
for select
to anon, authenticated
using (true);

create policy app_memberships_owner_read
on public.app_memberships
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy consent_records_owner_read
on public.consent_records
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.app_memberships,
  public.legal_documents,
  public.current_legal_documents,
  public.consent_records
from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.legal_documents, public.current_legal_documents
  to anon, authenticated;
grant select on public.app_memberships, public.consent_records
  to authenticated;

create function public.get_onboarding_status()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  current_count integer;
  current_terms_count integer;
  current_privacy_count integer;
  effective_count integer;
  membership_completed_at timestamptz;
  required_documents jsonb;
  accepted_documents jsonb;
begin
  if caller_user_id is null then
    raise exception using
      errcode = 'PT401',
      message = 'authentication_required';
  end if;

  select
    count(*)::integer,
    count(*) filter (where current_document.kind = 'terms')::integer,
    count(*) filter (where current_document.kind = 'privacy')::integer,
    count(*) filter (
      where document.effective_at <= transaction_timestamp()
    )::integer
  into
    current_count,
    current_terms_count,
    current_privacy_count,
    effective_count
  from public.current_legal_documents as current_document
  join public.legal_documents as document
    on document.kind = current_document.kind
    and document.version = current_document.document_version;

  if current_count <> 2
    or current_terms_count <> 1
    or current_privacy_count <> 1
    or effective_count <> 2 then
    raise exception using
      errcode = 'PT500',
      message = 'legal_configuration_invalid';
  end if;

  select membership.onboarding_completed_at
  into membership_completed_at
  from public.app_memberships as membership
  where membership.user_id = caller_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', current_document.kind,
        'version', current_document.document_version,
        'effectiveAt', document.effective_at,
        'documentUrl', document.document_url
      )
      order by case current_document.kind when 'terms' then 1 else 2 end
    ),
    '[]'::jsonb
  )
  into required_documents
  from public.current_legal_documents as current_document
  join public.legal_documents as document
    on document.kind = current_document.kind
    and document.version = current_document.document_version;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', current_document.kind,
        'version', current_document.document_version
      )
      order by case current_document.kind when 'terms' then 1 else 2 end
    ),
    '[]'::jsonb
  )
  into accepted_documents
  from public.current_legal_documents as current_document
  join public.consent_records as consent
    on consent.document_kind = current_document.kind
    and consent.document_version = current_document.document_version
    and consent.user_id = caller_user_id;

  return jsonb_build_object(
    'isComplete',
      membership_completed_at is not null
      and jsonb_array_length(accepted_documents) = 2,
    'onboardingCompletedAt', membership_completed_at,
    'requiredDocuments', required_documents,
    'acceptedDocuments', accepted_documents
  );
end;
$$;

create function public.complete_onboarding(requested_documents jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  caller_claims jsonb := auth.jwt();
  caller_session_id uuid;
  current_count integer;
  locked_current_count integer;
  current_terms_count integer;
  current_privacy_count integer;
  effective_count integer;
  requested_count integer;
  requested_valid_count integer;
  requested_distinct_count integer;
  requested_match_count integer;
  membership_completed_at timestamptz;
  required_documents jsonb;
  accepted_documents jsonb;
begin
  if caller_user_id is null then
    raise exception using
      errcode = 'PT401',
      message = 'authentication_required';
  end if;

  if caller_claims ->> 'is_anonymous' = 'true' then
    raise exception using
      errcode = 'PT403',
      message = 'anonymous_not_allowed';
  end if;

  begin
    caller_session_id := nullif(caller_claims ->> 'session_id', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = 'PT401',
        message = 'active_session_required';
  end;

  if caller_session_id is null then
    raise exception using
      errcode = 'PT401',
      message = 'active_session_required';
  end if;

  perform 1
  from auth.users as auth_user
  where auth_user.id = caller_user_id
  for key share;

  if not found then
    raise exception using
      errcode = 'PT401',
      message = 'active_session_required';
  end if;

  perform 1
  from auth.sessions as auth_session
  where auth_session.id = caller_session_id
    and auth_session.user_id = caller_user_id
  for key share;

  if not found then
    raise exception using
      errcode = 'PT401',
      message = 'active_session_required';
  end if;

  perform current_document.kind
  from public.current_legal_documents as current_document
  order by current_document.kind
  for share;

  get diagnostics locked_current_count = row_count;

  if locked_current_count <> 2 then
    raise exception using
      errcode = 'PT500',
      message = 'legal_configuration_invalid';
  end if;

  select
    count(*)::integer,
    count(*) filter (where current_document.kind = 'terms')::integer,
    count(*) filter (where current_document.kind = 'privacy')::integer,
    count(*) filter (
      where document.effective_at <= transaction_timestamp()
    )::integer
  into
    current_count,
    current_terms_count,
    current_privacy_count,
    effective_count
  from public.current_legal_documents as current_document
  join public.legal_documents as document
    on document.kind = current_document.kind
    and document.version = current_document.document_version;

  if current_count <> 2
    or current_terms_count <> 1
    or current_privacy_count <> 1
    or effective_count <> 2 then
    raise exception using
      errcode = 'PT500',
      message = 'legal_configuration_invalid';
  end if;

  if requested_documents is null
    or jsonb_typeof(requested_documents) is distinct from 'array' then
    raise exception using
      errcode = 'PT400',
      message = 'onboarding_documents_mismatch';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where jsonb_typeof(requested_document.value) = 'object'
        and jsonb_typeof(requested_document.value -> 'kind') = 'string'
        and jsonb_typeof(requested_document.value -> 'version') = 'string'
        and length(requested_document.value ->> 'kind') > 0
        and length(requested_document.value ->> 'version') > 0
    )::integer,
    count(
      distinct jsonb_build_array(
        requested_document.value ->> 'kind',
        requested_document.value ->> 'version'
      )
    )::integer
  into
    requested_count,
    requested_valid_count,
    requested_distinct_count
  from jsonb_array_elements(requested_documents) as requested_document(value);

  select count(*)::integer
  into requested_match_count
  from jsonb_array_elements(requested_documents) as requested_document(value)
  join public.current_legal_documents as current_document
    on current_document.kind = requested_document.value ->> 'kind'
    and current_document.document_version = requested_document.value ->> 'version'
  join public.legal_documents as document
    on document.kind = current_document.kind
    and document.version = current_document.document_version
    and document.effective_at <= transaction_timestamp();

  if requested_count <> 2
    or requested_valid_count <> 2
    or requested_distinct_count <> 2
    or requested_match_count <> 2 then
    raise exception using
      errcode = 'PT400',
      message = 'onboarding_documents_mismatch';
  end if;

  insert into public.consent_records (
    user_id,
    document_kind,
    document_version,
    agreed_at
  )
  select
    caller_user_id,
    current_document.kind,
    current_document.document_version,
    transaction_timestamp()
  from public.current_legal_documents as current_document
  on conflict (user_id, document_kind, document_version) do nothing;

  insert into public.app_memberships (
    user_id,
    onboarding_completed_at,
    created_at,
    updated_at
  )
  values (
    caller_user_id,
    transaction_timestamp(),
    transaction_timestamp(),
    transaction_timestamp()
  )
  on conflict (user_id) do nothing;

  select membership.onboarding_completed_at
  into membership_completed_at
  from public.app_memberships as membership
  where membership.user_id = caller_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', current_document.kind,
        'version', current_document.document_version,
        'effectiveAt', document.effective_at,
        'documentUrl', document.document_url
      )
      order by case current_document.kind when 'terms' then 1 else 2 end
    ),
    '[]'::jsonb
  )
  into required_documents
  from public.current_legal_documents as current_document
  join public.legal_documents as document
    on document.kind = current_document.kind
    and document.version = current_document.document_version;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', current_document.kind,
        'version', current_document.document_version
      )
      order by case current_document.kind when 'terms' then 1 else 2 end
    ),
    '[]'::jsonb
  )
  into accepted_documents
  from public.current_legal_documents as current_document
  join public.consent_records as consent
    on consent.document_kind = current_document.kind
    and consent.document_version = current_document.document_version
    and consent.user_id = caller_user_id;

  return jsonb_build_object(
    'isComplete',
      membership_completed_at is not null
      and jsonb_array_length(accepted_documents) = 2,
    'onboardingCompletedAt', membership_completed_at,
    'requiredDocuments', required_documents,
    'acceptedDocuments', accepted_documents
  );
end;
$$;

revoke execute on function public.get_onboarding_status()
  from public, anon, authenticated;
revoke execute on function public.complete_onboarding(jsonb)
  from public, anon, authenticated;
grant execute on function public.get_onboarding_status() to authenticated;
grant execute on function public.complete_onboarding(jsonb) to authenticated;

comment on function public.get_onboarding_status() is
  'Returns the caller current legal onboarding snapshot without accepting a user identifier.';
comment on function public.complete_onboarding(jsonb) is
  'Atomically records the active social session exact current legal consent set.';
