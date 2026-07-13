begin;

insert into public.legal_documents (kind, version, effective_at, document_url)
values
  (
    'terms',
    '2026-07-13',
    '2026-07-13T00:00:00Z',
    'https://legal.diving-app.invalid/terms/2026-07-13'
  ),
  (
    'privacy',
    '2026-07-13',
    '2026-07-13T00:00:00Z',
    'https://legal.diving-app.invalid/privacy/2026-07-13'
  )
on conflict (kind, version) do nothing;

insert into public.current_legal_documents (kind, document_version)
values
  ('terms', '2026-07-13'),
  ('privacy', '2026-07-13')
on conflict (kind) do update
set document_version = excluded.document_version;

commit;
