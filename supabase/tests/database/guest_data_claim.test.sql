begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

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

select results_eq(
  $$
    select
      column_name::text collate "C",
      data_type::text collate "C",
      (is_nullable = 'NO')::boolean,
      coalesce(column_default, '')::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dive_plans'
    order by ordinal_position
  $$,
  $$
    values
      ('id'::text collate "C", 'uuid'::text collate "C", true,
        'gen_random_uuid()'::text collate "C"),
      ('user_id', 'uuid', true, ''),
      ('local_id', 'text', true, ''),
      ('status', 'text', true, ''),
      ('planned_at', 'timestamp with time zone', false, ''),
      ('dive_mode', 'text', false, ''),
      ('site_name', 'text', false, ''),
      ('plan_data', 'jsonb', true, ''),
      ('payload_sha256', 'text', true, ''),
      ('converted_log_id', 'uuid', false, ''),
      ('revision', 'bigint', true, '1'),
      ('created_at', 'timestamp with time zone', true, 'transaction_timestamp()'),
      ('updated_at', 'timestamp with time zone', true, 'transaction_timestamp()'),
      ('deleted_at', 'timestamp with time zone', false, '')
  $$,
  'dive plans expose the exact column type, nullability, and default contract'
);

select results_eq(
  $$
    select
      column_name::text collate "C",
      data_type::text collate "C",
      (is_nullable = 'NO')::boolean,
      coalesce(column_default, '')::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dive_logs'
    order by ordinal_position
  $$,
  $$
    values
      ('id'::text collate "C", 'uuid'::text collate "C", true,
        'gen_random_uuid()'::text collate "C"),
      ('user_id', 'uuid', true, ''),
      ('local_id', 'text', true, ''),
      ('source_plan_id', 'uuid', false, ''),
      ('dive_mode', 'text', false, ''),
      ('source', 'text', true, ''),
      ('started_at', 'timestamp with time zone', true, ''),
      ('ended_at', 'timestamp with time zone', false, ''),
      ('duration_seconds', 'double precision', false, ''),
      ('max_depth_meters', 'double precision', false, ''),
      ('site_name', 'text', false, ''),
      ('title', 'text', false, ''),
      ('rating', 'integer', false, ''),
      ('manual_data', 'jsonb', true, ''),
      ('mobile_data', 'jsonb', true, ''),
      ('watch_metadata', 'jsonb', false, ''),
      ('provenance', 'jsonb', true, ''),
      ('profile_preview', 'jsonb', false, ''),
      ('profile_path', 'text', false, ''),
      ('profile_content_revision', 'text', false, ''),
      ('profile_sha256', 'text', false, ''),
      ('profile_byte_count', 'bigint', false, ''),
      ('profile_sample_count', 'integer', false, ''),
      ('payload_sha256', 'text', true, ''),
      ('revision', 'bigint', true, '1'),
      ('created_at', 'timestamp with time zone', true, 'transaction_timestamp()'),
      ('updated_at', 'timestamp with time zone', true, 'transaction_timestamp()'),
      ('deleted_at', 'timestamp with time zone', false, '')
  $$,
  'dive logs expose the exact column type, nullability, and default contract'
);

select results_eq(
  $$
    select
      column_name::text collate "C",
      data_type::text collate "C",
      (is_nullable = 'NO')::boolean,
      coalesce(column_default, '')::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guest_claim_batches'
    order by ordinal_position
  $$,
  $$
    values
      ('id'::text collate "C", 'uuid'::text collate "C", true,
        'gen_random_uuid()'::text collate "C"),
      ('user_id', 'uuid', true, ''),
      ('client_batch_id', 'text', true, ''),
      ('manifest_sha256', 'text', true, ''),
      ('expected_plan_count', 'integer', true, ''),
      ('expected_log_count', 'integer', true, ''),
      ('status', 'text', true, '''uploading''::text'),
      ('created_at', 'timestamp with time zone', true, 'transaction_timestamp()'),
      ('committed_at', 'timestamp with time zone', false, '')
  $$,
  'claim batches expose the exact column type, nullability, and default contract'
);

select results_eq(
  $$
    select
      column_name::text collate "C",
      data_type::text collate "C",
      (is_nullable = 'NO')::boolean,
      coalesce(column_default, '')::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guest_claim_records'
    order by ordinal_position
  $$,
  $$
    values
      ('id'::text collate "C", 'uuid'::text collate "C", true,
        'gen_random_uuid()'::text collate "C"),
      ('batch_id', 'uuid', true, ''),
      ('user_id', 'uuid', true, ''),
      ('entity_kind', 'text', true, ''),
      ('client_record_id', 'text', true, ''),
      ('target_record_id', 'uuid', true, 'gen_random_uuid()'),
      ('payload_sha256', 'text', true, ''),
      ('payload', 'jsonb', true, ''),
      ('source_plan_client_record_id', 'text', false, ''),
      ('converted_log_client_record_id', 'text', false, ''),
      ('profile_path', 'text', false, ''),
      ('profile_content_revision', 'text', false, ''),
      ('profile_sha256', 'text', false, ''),
      ('profile_byte_count', 'bigint', false, ''),
      ('profile_sample_count', 'integer', false, ''),
      ('created_at', 'timestamp with time zone', true, 'transaction_timestamp()'),
      ('updated_at', 'timestamp with time zone', true, 'transaction_timestamp()')
  $$,
  'claim records expose the exact column type, nullability, and default contract'
);

select results_eq(
  $$
    select
      relation.relname::text collate "C",
      constraint_row.conname::text collate "C",
      constraint_row.contype::text collate "C"
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'dive_logs',
        'dive_plans',
        'guest_claim_batches',
        'guest_claim_records'
      )
      and constraint_row.contype in ('c', 'u', 'f')
    order by relation.relname, constraint_row.conname
  $$,
  $$
    values
      ('dive_logs'::text collate "C",
        'dive_logs_dive_mode_check'::text collate "C", 'c'::text collate "C"),
      ('dive_logs', 'dive_logs_local_id_check', 'c'),
      ('dive_logs', 'dive_logs_payload_sha256_check', 'c'),
      ('dive_logs', 'dive_logs_profile_byte_count_check', 'c'),
      ('dive_logs', 'dive_logs_profile_sample_count_check', 'c'),
      ('dive_logs', 'dive_logs_profile_sha256_check', 'c'),
      ('dive_logs', 'dive_logs_rating_check', 'c'),
      ('dive_logs', 'dive_logs_revision_check', 'c'),
      ('dive_logs', 'dive_logs_source_check', 'c'),
      ('dive_logs', 'dive_logs_user_id_fkey', 'f'),
      ('dive_logs', 'dive_logs_user_id_id_key', 'u'),
      ('dive_logs', 'dive_logs_user_id_local_id_key', 'u'),
      ('dive_logs', 'dive_logs_user_id_source_plan_id_fkey', 'f'),
      ('dive_plans', 'dive_plans_converted_log_owner_fk', 'f'),
      ('dive_plans', 'dive_plans_dive_mode_check', 'c'),
      ('dive_plans', 'dive_plans_local_id_check', 'c'),
      ('dive_plans', 'dive_plans_payload_sha256_check', 'c'),
      ('dive_plans', 'dive_plans_revision_check', 'c'),
      ('dive_plans', 'dive_plans_status_check', 'c'),
      ('dive_plans', 'dive_plans_user_id_fkey', 'f'),
      ('dive_plans', 'dive_plans_user_id_id_key', 'u'),
      ('dive_plans', 'dive_plans_user_id_local_id_key', 'u'),
      ('guest_claim_batches', 'guest_claim_batches_client_batch_id_check', 'c'),
      ('guest_claim_batches', 'guest_claim_batches_expected_log_count_check', 'c'),
      ('guest_claim_batches', 'guest_claim_batches_expected_plan_count_check', 'c'),
      ('guest_claim_batches', 'guest_claim_batches_id_user_id_key', 'u'),
      ('guest_claim_batches', 'guest_claim_batches_manifest_sha256_check', 'c'),
      ('guest_claim_batches', 'guest_claim_batches_status_check', 'c'),
      ('guest_claim_batches', 'guest_claim_batches_user_id_client_batch_id_key', 'u'),
      ('guest_claim_batches', 'guest_claim_batches_user_id_fkey', 'f'),
      ('guest_claim_records', 'guest_claim_records_batch_id_entity_kind_client_record_id_key', 'u'),
      ('guest_claim_records', 'guest_claim_records_batch_id_user_id_fkey', 'f'),
      ('guest_claim_records', 'guest_claim_records_client_record_id_check', 'c'),
      ('guest_claim_records', 'guest_claim_records_entity_kind_check', 'c'),
      ('guest_claim_records', 'guest_claim_records_payload_sha256_check', 'c'),
      ('guest_claim_records', 'guest_claim_records_profile_byte_count_check', 'c'),
      ('guest_claim_records', 'guest_claim_records_profile_sample_count_check', 'c'),
      ('guest_claim_records', 'guest_claim_records_profile_sha256_check', 'c')
  $$,
  'all Task 2 check, unique, and foreign-key constraints exist by exact name'
);

select results_eq(
  $$
    select
      source_relation.relname::text collate "C",
      constraint_row.conname::text collate "C",
      (
        select string_agg(attribute.attname, ',' order by key_column.ordinality)
        from unnest(constraint_row.conkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute
          on attribute.attrelid = constraint_row.conrelid
          and attribute.attnum = key_column.attnum
      )::text collate "C" as source_columns,
      target_namespace.nspname::text collate "C",
      target_relation.relname::text collate "C",
      (
        select string_agg(attribute.attname, ',' order by key_column.ordinality)
        from unnest(constraint_row.confkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute
          on attribute.attrelid = constraint_row.confrelid
          and attribute.attnum = key_column.attnum
      )::text collate "C" as target_columns,
      constraint_row.confdeltype::text collate "C",
      constraint_row.condeferrable,
      constraint_row.condeferred
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as source_relation
      on source_relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as source_namespace
      on source_namespace.oid = source_relation.relnamespace
    join pg_catalog.pg_class as target_relation
      on target_relation.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace as target_namespace
      on target_namespace.oid = target_relation.relnamespace
    where source_namespace.nspname = 'public'
      and source_relation.relname in (
        'dive_logs',
        'dive_plans',
        'guest_claim_batches',
        'guest_claim_records'
      )
      and constraint_row.contype = 'f'
    order by source_relation.relname, constraint_row.conname
  $$,
  $$
    values
      ('dive_logs'::text collate "C", 'dive_logs_user_id_fkey'::text collate "C",
        'user_id'::text collate "C", 'auth'::text collate "C",
        'users'::text collate "C", 'id'::text collate "C",
        'c'::text collate "C", false, false),
      ('dive_logs', 'dive_logs_user_id_source_plan_id_fkey',
        'user_id,source_plan_id', 'public', 'dive_plans', 'user_id,id',
        'a', false, false),
      ('dive_plans', 'dive_plans_converted_log_owner_fk',
        'user_id,converted_log_id', 'public', 'dive_logs', 'user_id,id',
        'a', true, true),
      ('dive_plans', 'dive_plans_user_id_fkey', 'user_id',
        'auth', 'users', 'id', 'c', false, false),
      ('guest_claim_batches', 'guest_claim_batches_user_id_fkey', 'user_id',
        'auth', 'users', 'id', 'c', false, false),
      ('guest_claim_records', 'guest_claim_records_batch_id_user_id_fkey',
        'batch_id,user_id', 'public', 'guest_claim_batches', 'id,user_id',
        'c', false, false)
  $$,
  'foreign keys preserve owners, cascade lifecycles, and deferred conversion links'
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
select throws_ok(
  $$
    insert into public.guest_claim_batches (
      user_id,
      client_batch_id,
      manifest_sha256,
      expected_plan_count,
      expected_log_count,
      status
    ) values (
      '00000000-0000-0000-0000-000000000011',
      'client-created-committed-batch',
      repeat('1', 64),
      0,
      0,
      'committed'
    )
  $$,
  '42501',
  null,
  'authenticated clients cannot create committed claim batches'
);

select throws_ok(
  $$
    insert into public.guest_claim_batches (
      user_id,
      client_batch_id,
      manifest_sha256,
      expected_plan_count,
      expected_log_count,
      committed_at
    ) values (
      '00000000-0000-0000-0000-000000000011',
      'client-created-timestamped-batch',
      repeat('2', 64),
      0,
      0,
      transaction_timestamp()
    )
  $$,
  '42501',
  null,
  'authenticated clients cannot create claim batches with committed_at set'
);

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
    )
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
    )
  $$,
  'an onboarded owner can create account rows and an uploading claim batch'
);

select lives_ok(
  $$
    insert into public.guest_claim_records (
      batch_id,
      user_id,
      entity_kind,
      client_record_id,
      payload_sha256,
      payload
    ) select
      id,
      user_id,
      'plan',
      'staged-plan',
      repeat('e', 64),
      '{"version":1}'::jsonb
    from public.guest_claim_batches
    where client_batch_id = 'owner-batch'
  $$,
  'an onboarded owner can add records to an uploading claim batch'
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

update public.guest_claim_batches
set
  status = 'committed',
  committed_at = transaction_timestamp()
where client_batch_id = 'owner-batch';

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000011',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$
    insert into public.guest_claim_records (
      batch_id,
      user_id,
      entity_kind,
      client_record_id,
      payload_sha256,
      payload
    ) select
      id,
      user_id,
      'plan',
      'post-commit-insert',
      repeat('3', 64),
      '{"version":1}'::jsonb
    from public.guest_claim_batches
    where client_batch_id = 'owner-batch'
  $$,
  '42501',
  null,
  'authenticated clients cannot add records to committed claim batches'
);

update public.guest_claim_records
set payload = '{"version":2}'::jsonb
where client_record_id = 'staged-plan';

select is(
  (
    select payload
    from public.guest_claim_records
    where client_record_id = 'staged-plan'
  ),
  '{"version":1}'::jsonb,
  'authenticated clients cannot mutate records after a batch commits'
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
