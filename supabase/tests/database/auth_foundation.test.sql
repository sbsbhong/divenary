begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_table('public', 'app_memberships', 'app memberships table exists');
select has_table('public', 'legal_documents', 'legal documents table exists');
select has_table(
  'public',
  'current_legal_documents',
  'current legal document pointers table exists'
);
select has_table('public', 'consent_records', 'consent records table exists');
select has_function(
  'public',
  'get_onboarding_status',
  array[]::text[],
  'onboarding status function exists'
);
select has_function(
  'public',
  'complete_onboarding',
  array['jsonb'],
  'complete onboarding function exists'
);

select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'app_memberships'
  ),
  'app memberships has RLS enabled'
);
select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'legal_documents'
  ),
  'legal documents has RLS enabled'
);
select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'current_legal_documents'
  ),
  'current legal document pointers has RLS enabled'
);
select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'consent_records'
  ),
  'consent records has RLS enabled'
);

select table_privs_are(
  'public',
  'legal_documents',
  'anon',
  array['SELECT'],
  'anon can only read legal documents'
);
select table_privs_are(
  'public',
  'legal_documents',
  'authenticated',
  array['SELECT'],
  'authenticated can only read legal documents'
);
select table_privs_are(
  'public',
  'current_legal_documents',
  'anon',
  array['SELECT'],
  'anon can only read current legal document pointers'
);
select table_privs_are(
  'public',
  'current_legal_documents',
  'authenticated',
  array['SELECT'],
  'authenticated can only read current legal document pointers'
);
select table_privs_are(
  'public',
  'app_memberships',
  'anon',
  array[]::text[],
  'anon has no membership table privilege'
);
select table_privs_are(
  'public',
  'app_memberships',
  'authenticated',
  array['SELECT'],
  'authenticated can only read memberships'
);
select table_privs_are(
  'public',
  'consent_records',
  'anon',
  array[]::text[],
  'anon has no consent table privilege'
);
select table_privs_are(
  'public',
  'consent_records',
  'authenticated',
  array['SELECT'],
  'authenticated can only read consent records'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) as acl
    where n.nspname = 'public'
      and c.relname in (
        'app_memberships',
        'legal_documents',
        'current_legal_documents',
        'consent_records'
      )
      and acl.grantee = 0
  ),
  'PUBLIC has no direct table privileges'
);

select function_privs_are(
  'public',
  'get_onboarding_status',
  array[]::text[],
  'anon',
  array[]::text[],
  'anon cannot execute onboarding status'
);
select function_privs_are(
  'public',
  'get_onboarding_status',
  array[]::text[],
  'authenticated',
  array['EXECUTE'],
  'authenticated can execute onboarding status'
);
select function_privs_are(
  'public',
  'complete_onboarding',
  array['jsonb'],
  'anon',
  array[]::text[],
  'anon cannot complete onboarding'
);
select function_privs_are(
  'public',
  'complete_onboarding',
  array['jsonb'],
  'authenticated',
  array['EXECUTE'],
  'authenticated can complete onboarding'
);
select isnt_definer(
  'public',
  'get_onboarding_status',
  array[]::text[],
  'onboarding status is security invoker'
);
select is_definer(
  'public',
  'complete_onboarding',
  array['jsonb'],
  'onboarding completion is security definer'
);
select volatility_is(
  'public',
  'get_onboarding_status',
  array[]::text[],
  'stable',
  'onboarding status is stable'
);
select volatility_is(
  'public',
  'complete_onboarding',
  array['jsonb'],
  'volatile',
  'onboarding completion is volatile'
);
select ok(
  (
    select p.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_onboarding_status'
      and p.proargtypes = ''::oidvector
  ),
  'onboarding status has an empty search path'
);
select ok(
  (
    select p.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'complete_onboarding'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'requested_documents jsonb'
  ),
  'onboarding completion has an empty search path'
);

select is(
  (select count(*) from public.legal_documents),
  2::bigint,
  'seed contains two immutable legal documents'
);
select is(
  (select count(*) from public.current_legal_documents),
  2::bigint,
  'seed contains one current pointer per required document kind'
);

set local role anon;
select is(
  (select count(*) from public.legal_documents),
  2::bigint,
  'anon can read legal documents through RLS'
);
select is(
  (select count(*) from public.current_legal_documents),
  2::bigint,
  'anon can read current document pointers through RLS'
);
reset role;

insert into auth.users (id)
values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

insert into auth.sessions (id, user_id)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002'
  );

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000002',
    'role', 'authenticated',
    'is_anonymous', false,
    'session_id', '10000000-0000-0000-0000-000000000002'
  )::text,
  true
);
set local role authenticated;
select is(
  public.get_onboarding_status() ->> 'isComplete',
  'false',
  'a social identity without current consent is incomplete'
);
select is(
  public.complete_onboarding(
    '[{"kind":"terms","version":"2026-07-13"},{"kind":"privacy","version":"2026-07-13"}]'::jsonb
  ) ->> 'isComplete',
  'true',
  'second user completes onboarding'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'is_anonymous', false,
    'session_id', '10000000-0000-0000-0000-000000000001'
  )::text,
  true
);
set local role authenticated;
select is(
  public.get_onboarding_status() ->> 'isComplete',
  'false',
  'first user remains independent from another member'
);
select is(
  jsonb_array_length(
    public.complete_onboarding(
      '[{"kind":"terms","version":"2026-07-13"},{"kind":"privacy","version":"2026-07-13"}]'::jsonb
    ) -> 'acceptedDocuments'
  ),
  2,
  'completion response contains only the caller current consent set'
);
select is(
  public.get_onboarding_status() ->> 'isComplete',
  'true',
  'first user is complete after exact current consent'
);
select is(
  (select count(*) from public.app_memberships),
  1::bigint,
  'RLS exposes only the caller membership'
);
select is(
  (select count(*) from public.consent_records),
  2::bigint,
  'RLS exposes only the caller current consent records'
);
select ok(
  not exists (
    select 1
    from public.app_memberships
    where user_id <> auth.uid()
  ),
  'RLS hides cross-owner memberships'
);
select ok(
  not exists (
    select 1
    from public.consent_records
    where user_id <> auth.uid()
  ),
  'RLS hides cross-owner consents'
);
reset role;

update public.app_memberships
set onboarding_completed_at = '2000-01-01T00:00:00Z',
    created_at = '2000-01-01T00:00:00Z',
    updated_at = '2000-01-01T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000001';
update public.consent_records
set agreed_at = '2000-01-01T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000001';

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'is_anonymous', false,
    'session_id', '10000000-0000-0000-0000-000000000001'
  )::text,
  true
);
set local role authenticated;
select is(
  public.complete_onboarding(
    '[{"kind":"privacy","version":"2026-07-13"},{"kind":"terms","version":"2026-07-13"}]'::jsonb
  ) ->> 'isComplete',
  'true',
  'completion is idempotent when document order changes'
);
reset role;
select is(
  (
    select onboarding_completed_at
    from public.app_memberships
    where user_id = '00000000-0000-0000-0000-000000000001'
  ),
  '2000-01-01T00:00:00Z'::timestamptz,
  'idempotent completion preserves onboarding timestamp'
);
select is(
  (
    select created_at
    from public.app_memberships
    where user_id = '00000000-0000-0000-0000-000000000001'
  ),
  '2000-01-01T00:00:00Z'::timestamptz,
  'idempotent completion preserves membership creation timestamp'
);
select is(
  (
    select count(*)
    from public.consent_records
    where user_id = '00000000-0000-0000-0000-000000000001'
      and agreed_at = '2000-01-01T00:00:00Z'
  ),
  2::bigint,
  'idempotent completion preserves consent timestamps'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'is_anonymous', false)::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select public.complete_onboarding('[]'::jsonb)$$,
  'PT401',
  'authentication_required',
  'completion rejects a missing subject claim'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'is_anonymous', true,
    'session_id', '10000000-0000-0000-0000-000000000001'
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select public.complete_onboarding('[]'::jsonb)$$,
  'PT403',
  'anonymous_not_allowed',
  'completion rejects an anonymous JWT'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'is_anonymous', false,
    'session_id', '10000000-0000-0000-0000-000000000002'
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select public.complete_onboarding('[]'::jsonb)$$,
  'PT401',
  'active_session_required',
  'completion rejects another user session'
);
reset role;

delete from auth.sessions
where id = '10000000-0000-0000-0000-000000000002';
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000002',
    'role', 'authenticated',
    'is_anonymous', false,
    'session_id', '10000000-0000-0000-0000-000000000002'
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select public.complete_onboarding('[{"kind":"terms","version":"2026-07-13"},{"kind":"privacy","version":"2026-07-13"}]'::jsonb)$$,
  'PT401',
  'active_session_required',
  'an idempotent retry still rejects a deleted session'
);
reset role;

insert into public.legal_documents (kind, version, effective_at, document_url)
values
  (
    'terms',
    '2026-01-01',
    '2026-01-01T00:00:00Z',
    'https://legal.diving-app.invalid/terms/2026-01-01'
  ),
  (
    'privacy',
    '2026-01-01',
    '2026-01-01T00:00:00Z',
    'https://legal.diving-app.invalid/privacy/2026-01-01'
  ),
  (
    'terms',
    '2099-01-01',
    '2099-01-01T00:00:00Z',
    'https://legal.diving-app.invalid/terms/2099-01-01'
  );

select throws_like(
  $$update public.legal_documents set document_url = 'https://example.invalid/changed' where kind = 'terms' and version = '2026-01-01'$$,
  '%legal_documents_are_immutable%',
  'legal document rows cannot be updated'
);
select throws_like(
  $$delete from public.legal_documents where kind = 'terms' and version = '2026-01-01'$$,
  '%legal_documents_are_immutable%',
  'legal document rows cannot be deleted'
);
select throws_like(
  $$update public.current_legal_documents set document_version = '2099-01-01' where kind = 'terms'$$,
  '%legal_document_not_effective%',
  'a current pointer cannot target a future-effective document'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'is_anonymous', false,
    'session_id', '10000000-0000-0000-0000-000000000001'
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select public.complete_onboarding('[{"kind":"terms","version":"2026-07-13"}]'::jsonb)$$,
  'PT400',
  'onboarding_documents_mismatch',
  'completion rejects a missing document'
);
select throws_ok(
  $$select public.complete_onboarding('[{"kind":"terms","version":"2026-07-13"},{"kind":"terms","version":"2026-07-13"},{"kind":"privacy","version":"2026-07-13"}]'::jsonb)$$,
  'PT400',
  'onboarding_documents_mismatch',
  'completion rejects duplicate documents'
);
select throws_ok(
  $$select public.complete_onboarding('[{"kind":"terms","version":"2026-01-01"},{"kind":"privacy","version":"2026-01-01"}]'::jsonb)$$,
  'PT400',
  'onboarding_documents_mismatch',
  'completion rejects a stale document set'
);
select throws_ok(
  $$select public.complete_onboarding('[{"kind":"terms","version":"2026-07-13"},{"kind":"privacy","version":"2026-07-13"},{"kind":"terms","version":"2026-01-01"}]'::jsonb)$$,
  'PT400',
  'onboarding_documents_mismatch',
  'completion rejects an extra document'
);
select throws_ok(
  $$select public.complete_onboarding('[{"kind":"terms","version":"unknown"},{"kind":"privacy","version":"2026-07-13"}]'::jsonb)$$,
  'PT400',
  'onboarding_documents_mismatch',
  'completion rejects an unknown version'
);
select throws_ok(
  $$select public.complete_onboarding('[{"kind":"terms","version":"2099-01-01"},{"kind":"privacy","version":"2026-07-13"}]'::jsonb)$$,
  'PT400',
  'onboarding_documents_mismatch',
  'completion rejects a future-effective version'
);
reset role;

insert into public.legal_documents (kind, version, effective_at, document_url)
values (
  'terms',
  '2026-08-01',
  '2026-07-13T00:00:00Z',
  'https://legal.diving-app.invalid/terms/2026-08-01'
);
update public.current_legal_documents
set document_version = '2026-08-01'
where kind = 'terms';

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'is_anonymous', false,
    'session_id', '10000000-0000-0000-0000-000000000001'
  )::text,
  true
);
set local role authenticated;
select is(
  public.get_onboarding_status() ->> 'isComplete',
  'false',
  'a new current terms version requires re-consent'
);
select is(
  public.complete_onboarding(
    '[{"kind":"terms","version":"2026-08-01"},{"kind":"privacy","version":"2026-07-13"}]'::jsonb
  ) ->> 'isComplete',
  'true',
  'exact new current set restores completion'
);
select is(
  jsonb_array_length(public.get_onboarding_status() -> 'acceptedDocuments'),
  2,
  'status returns only current accepted documents after re-consent'
);
reset role;
select is(
  (
    select count(*)
    from public.consent_records
    where user_id = '00000000-0000-0000-0000-000000000001'
  ),
  3::bigint,
  're-consent retains the prior terms consent history'
);
select is(
  (
    select onboarding_completed_at
    from public.app_memberships
    where user_id = '00000000-0000-0000-0000-000000000001'
  ),
  '2000-01-01T00:00:00Z'::timestamptz,
  're-consent preserves the original membership timestamp'
);
select is(
  (
    select count(*)
    from public.consent_records
    where user_id = '00000000-0000-0000-0000-000000000001'
      and document_version = '2026-07-13'
      and agreed_at = '2000-01-01T00:00:00Z'
  ),
  2::bigint,
  're-consent preserves prior consent timestamps'
);

delete from public.current_legal_documents where kind = 'privacy';
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'is_anonymous', false,
    'session_id', '10000000-0000-0000-0000-000000000001'
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select public.get_onboarding_status()$$,
  'PT500',
  'legal_configuration_invalid',
  'status reports a stable missing legal configuration error'
);
select throws_ok(
  $$select public.complete_onboarding('[{"kind":"terms","version":"2026-08-01"}]'::jsonb)$$,
  'PT500',
  'legal_configuration_invalid',
  'completion reports the same missing legal configuration error'
);
reset role;

insert into public.current_legal_documents (kind, document_version)
values ('privacy', '2026-07-13');

select set_config('request.jwt.claims', '{}', true);
select * from finish();

rollback;
