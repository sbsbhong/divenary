begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_table('public', 'dive_logs', 'dive logs table exists');
select has_table('public', 'dive_plans', 'dive plans table exists');
select has_table(
  'public',
  'guest_claim_batches',
  'guest claim batches table exists'
);
select has_table(
  'public',
  'guest_claim_records',
  'guest claim records table exists'
);
select has_column(
  'public',
  'dive_logs',
  'profile_sha256',
  'dive logs store the profile digest'
);
select has_column(
  'public',
  'dive_plans',
  'converted_log_id',
  'dive plans store the converted log relationship'
);
select col_is_unique('public', 'dive_logs', array['user_id', 'local_id']);
select col_is_unique('public', 'dive_plans', array['user_id', 'local_id']);
select col_is_unique(
  'public',
  'guest_claim_records',
  array['batch_id', 'entity_kind', 'client_record_id']
);
select policies_are(
  'public',
  'dive_logs',
  array[
    'dive_logs_owner_select',
    'dive_logs_owner_insert',
    'dive_logs_owner_update'
  ]
);
select policies_are(
  'public',
  'dive_plans',
  array[
    'dive_plans_owner_select',
    'dive_plans_owner_insert',
    'dive_plans_owner_update'
  ]
);
select policies_are(
  'public',
  'guest_claim_batches',
  array[
    'guest_claim_batches_owner_select',
    'guest_claim_batches_owner_insert'
  ]
);
select policies_are(
  'public',
  'guest_claim_records',
  array[
    'guest_claim_records_owner_select',
    'guest_claim_records_owner_insert',
    'guest_claim_records_owner_update'
  ]
);
select isnt_empty(
  $$select 1 from storage.buckets where id = 'dive-profiles' and public = false$$
);

select ok(
  (
    select count(*) = 4 and bool_and(c.relrowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'dive_logs',
        'dive_plans',
        'guest_claim_batches',
        'guest_claim_records'
      )
  ),
  'all account and claim tables have RLS enabled'
);

select ok(
  (
    select
      count(*) filter (
        where indexname in (
          'dive_logs_owner_cursor_idx',
          'dive_plans_owner_cursor_idx',
          'guest_claim_records_batch_idx'
        )
      ) = 3
      and count(*) filter (
        where indexname = 'dive_logs_owner_cursor_idx'
          and indexdef like '%(user_id, started_at DESC, id DESC)%'
          and indexdef like '%WHERE (deleted_at IS NULL)%'
      ) = 1
      and count(*) filter (
        where indexname = 'dive_plans_owner_cursor_idx'
          and indexdef like '%(user_id, planned_at DESC NULLS LAST, id DESC)%'
          and indexdef like '%WHERE (deleted_at IS NULL)%'
      ) = 1
      and count(*) filter (
        where indexname = 'guest_claim_records_batch_idx'
          and indexdef like '%(batch_id, entity_kind, client_record_id)%'
      ) = 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename in (
        'dive_logs',
        'dive_plans',
        'guest_claim_records'
      )
  ),
  'owner cursors and claim batch lookup use the required indexes'
);

select is(
  (
    select string_agg(
      grants.table_name || ':' || grants.privilege_type,
      ','
      order by grants.table_name, grants.privilege_type
    )
    from information_schema.role_table_grants as grants
    where grants.table_schema = 'public'
      and grants.table_name in (
        'dive_logs',
        'dive_plans',
        'guest_claim_batches',
        'guest_claim_records'
      )
      and grants.grantee = 'authenticated'
  ),
  'dive_logs:INSERT,dive_logs:SELECT,dive_logs:UPDATE,'
    || 'dive_plans:INSERT,dive_plans:SELECT,dive_plans:UPDATE,'
    || 'guest_claim_batches:INSERT,guest_claim_batches:SELECT,'
    || 'guest_claim_records:INSERT,guest_claim_records:SELECT,'
    || 'guest_claim_records:UPDATE',
  'authenticated receives only the explicit client table privileges'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants as grants
    where grants.table_schema = 'public'
      and grants.table_name in (
        'dive_logs',
        'dive_plans',
        'guest_claim_batches',
        'guest_claim_records'
      )
      and grants.grantee in ('anon', 'PUBLIC')
  ),
  'anon and PUBLIC receive no account or claim table privileges'
);

select ok(
  (
    select
      count(*) filter (
        where schemaname = 'public'
          and tablename in (
            'dive_logs',
            'dive_plans',
            'guest_claim_batches',
            'guest_claim_records'
          )
          and (
            coalesce(qual, '') || ' ' || coalesce(with_check, '')
          ) not like '%app_memberships%'
      ) = 0
      and count(*) filter (
        where schemaname = 'public'
          and tablename in (
            'dive_logs',
            'dive_plans',
            'guest_claim_records'
          )
          and cmd = 'UPDATE'
          and qual is not null
          and with_check is not null
      ) = 3
      and count(*) filter (
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname in (
            'dive_profiles_owner_insert',
            'dive_profiles_owner_select'
          )
          and (
            coalesce(qual, '') || ' ' || coalesce(with_check, '')
          ) like '%foldername(name)%'
          and (
            coalesce(qual, '') || ' ' || coalesce(with_check, '')
          ) like '%app_memberships%'
      ) = 2
      and count(*) filter (
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname like 'dive_profiles_%'
          and cmd in ('UPDATE', 'DELETE')
      ) = 0
      and count(*) filter (
        where (
          coalesce(qual, '') || ' ' || coalesce(with_check, '')
        ) like '%user_metadata%'
      ) = 0
    from pg_catalog.pg_policies
  ),
  'owner policies require membership, updates are checked, and Storage is immutable'
);

insert into auth.users (id)
values
  ('00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000012'),
  ('00000000-0000-0000-0000-000000000013');

insert into public.app_memberships (user_id, onboarding_completed_at)
values
  (
    '00000000-0000-0000-0000-000000000011',
    transaction_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000012',
    transaction_timestamp()
  );

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000013',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$
    insert into public.dive_plans (
      user_id,
      local_id,
      status,
      plan_data,
      payload_sha256
    ) values (
      '00000000-0000-0000-0000-000000000013',
      'pre-onboarding-plan',
      'planned',
      '{"version":1}'::jsonb,
      repeat('a', 64)
    )
  $$,
  '42501',
  null,
  'an authenticated user without membership cannot create account data'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000011',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
select lives_ok(
  $$
    with inserted_plan as (
      insert into public.dive_plans (
        user_id,
        local_id,
        status,
        planned_at,
        plan_data,
        payload_sha256
      ) values (
        '00000000-0000-0000-0000-000000000011',
        'owner-plan',
        'planned',
        '2026-07-19T01:00:00Z',
        '{"version":1}'::jsonb,
        repeat('b', 64)
      ) returning id
    ), inserted_log as (
      insert into public.dive_logs (
        user_id,
        local_id,
        source_plan_id,
        source,
        started_at,
        manual_data,
        mobile_data,
        provenance,
        payload_sha256
      ) select
        '00000000-0000-0000-0000-000000000011',
        'owner-log',
        inserted_plan.id,
        'manual',
        '2026-07-19T02:00:00Z',
        '{"version":1}'::jsonb,
        '{"version":1}'::jsonb,
        '{"source":"manual"}'::jsonb,
        repeat('c', 64)
      from inserted_plan
    ), inserted_batch as (
      insert into public.guest_claim_batches (
        user_id,
        client_batch_id,
        manifest_sha256,
        expected_plan_count,
        expected_log_count
      ) values (
        '00000000-0000-0000-0000-000000000011',
        'owner-batch',
        repeat('d', 64),
        1,
        0
      ) returning id
    )
    insert into public.guest_claim_records (
      batch_id,
      user_id,
      entity_kind,
      client_record_id,
      payload_sha256,
      payload
    ) select
      inserted_batch.id,
      '00000000-0000-0000-0000-000000000011',
      'plan',
      'staged-plan',
      repeat('e', 64),
      '{"version":1}'::jsonb
    from inserted_batch
  $$,
  'an onboarded owner can create account and claim staging rows'
);

select is(
  (
    select jsonb_build_array(
      (select count(*) from public.dive_plans),
      (select count(*) from public.dive_logs),
      (select count(*) from public.guest_claim_batches),
      (select count(*) from public.guest_claim_records)
    )
  ),
  '[1, 1, 1, 1]'::jsonb,
  'an owner can read every owned account and staging row'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000012',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
select is(
  (
    select jsonb_build_array(
      (select count(*) from public.dive_plans),
      (select count(*) from public.dive_logs),
      (select count(*) from public.guest_claim_batches),
      (select count(*) from public.guest_claim_records)
    )
  ),
  '[0, 0, 0, 0]'::jsonb,
  'cross-owner reads return no account or staging rows'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000011',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
select ok(
  not exists (
    select 1 from public.dive_plans where local_id = 'staged-plan'
  ) and not exists (
    select 1 from public.dive_logs where local_id = 'staged-plan'
  ),
  'claim staging records are absent from normal account tables'
);

insert into storage.objects (bucket_id, name, metadata)
values (
  'dive-profiles',
  '00000000-0000-0000-0000-000000000011/claims/profile.json',
  '{"state":"original"}'::jsonb
);
update storage.objects
set metadata = '{"state":"overwritten"}'::jsonb
where bucket_id = 'dive-profiles'
  and name = '00000000-0000-0000-0000-000000000011/claims/profile.json';
select is(
  (
    select metadata ->> 'state'
    from storage.objects
    where bucket_id = 'dive-profiles'
      and name = '00000000-0000-0000-0000-000000000011/claims/profile.json'
  ),
  'original',
  'an owner cannot overwrite an immutable profile object'
);

select throws_ok(
  $$delete from public.dive_logs where local_id = 'owner-log'$$,
  '42501',
  null,
  'authenticated clients have no hard-delete privilege'
);
reset role;

select set_config('request.jwt.claims', '{}', true);
select * from finish();

rollback;
