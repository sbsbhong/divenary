import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const STAGING_PROJECT_REF = 'mclvhwzsuvsxjerdouka';
export const STAGING_LEGAL_VERSION = '2026-07-18-staging.1';
export const STAGING_LEGAL_EFFECTIVE_AT = '2026-07-18T00:00:00.000Z';
export const ONBOARDING_RPC_METADATA_SQL = [
  'select',
  '  procedure.proname as name,',
  '  pg_get_function_identity_arguments(procedure.oid) as argument_types,',
  '  pg_get_function_result(procedure.oid) as return_type',
  'from pg_catalog.pg_proc as procedure',
  'join pg_catalog.pg_namespace as namespace',
  '  on namespace.oid = procedure.pronamespace',
  "where namespace.nspname = 'public'",
  "  and procedure.proname = 'get_onboarding_status'",
  'order by procedure.oid;',
].join('\n');
export const ONBOARDING_RPC_METADATA_COMMAND = Object.freeze([
  'db',
  'query',
  '--linked',
  '--output-format',
  'json',
  ONBOARDING_RPC_METADATA_SQL,
]);

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const projectRefPath = path.join(repositoryRoot, 'supabase/.temp/project-ref');
const stagingLegalBaseUrl = 'https://raw.githubusercontent.com/sbsbhong/divenary';
const legalDocumentPath = 'docs/legal/staging/2026-07-18';

function assertPromotionCommit(commitSha) {
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error('Staging legal URLs require a 40 lowercase hex commit SHA.');
  }

  return commitSha;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildStagingEnvironment(environment) {
  const stagingEnvironment = {...environment};

  delete stagingEnvironment.SUPABASE_PROJECT_ID;
  delete stagingEnvironment.PINTERNET_SUPABASE_PROJECT_ID;

  return stagingEnvironment;
}

export async function assertStagingProjectRef({
  readProjectRef = () => readFile(projectRefPath, 'utf8'),
} = {}) {
  let projectRef;

  try {
    projectRef = (await readProjectRef()).trim();
  } catch {
    throw new Error(
      `Staging commands require ${projectRefPath} to contain ${STAGING_PROJECT_REF}.`,
    );
  }

  if (projectRef !== STAGING_PROJECT_REF) {
    throw new Error(
      `Refusing staging command: linked project ref is ${projectRef || '(empty)'}.`,
    );
  }
}

export function buildStagingLegalUrls(commitSha) {
  const commit = assertPromotionCommit(commitSha);
  const baseUrl = `${stagingLegalBaseUrl}/${commit}/${legalDocumentPath}`;

  return {
    terms: `${baseUrl}/terms.md`,
    privacy: `${baseUrl}/privacy.md`,
  };
}

export function buildStagingLegalSql(commitSha) {
  const urls = buildStagingLegalUrls(commitSha);

  return [
    'do $staging_legal$',
    'begin',
    '  insert into public.legal_documents (kind, version, effective_at, document_url)',
    '  values',
    `    (${sqlLiteral('terms')}, ${sqlLiteral(STAGING_LEGAL_VERSION)}, ${sqlLiteral(STAGING_LEGAL_EFFECTIVE_AT)}, ${sqlLiteral(urls.terms)}),`,
    `    (${sqlLiteral('privacy')}, ${sqlLiteral(STAGING_LEGAL_VERSION)}, ${sqlLiteral(STAGING_LEGAL_EFFECTIVE_AT)}, ${sqlLiteral(urls.privacy)})`,
    '  on conflict (kind, version) do update',
    '  set effective_at = excluded.effective_at,',
    '      document_url = excluded.document_url',
    '  where legal_documents.effective_at is distinct from excluded.effective_at',
    '    or legal_documents.document_url is distinct from excluded.document_url;',
    '',
    '  insert into public.current_legal_documents (kind, document_version)',
    '  values',
    `    (${sqlLiteral('terms')}, ${sqlLiteral(STAGING_LEGAL_VERSION)}),`,
    `    (${sqlLiteral('privacy')}, ${sqlLiteral(STAGING_LEGAL_VERSION)})`,
    '  on conflict (kind) do update',
    '  set document_version = excluded.document_version;',
    'end',
    '$staging_legal$;',
  ].join('\n');
}

export async function assertStagingLegalDocumentsReachable({
  commitSha,
  fetchImpl = fetch,
}) {
  const urls = buildStagingLegalUrls(commitSha);

  for (const url of Object.values(urls)) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Staging legal URL must use HTTPS.');
    }

    let response;
    try {
      response = await fetchImpl(url);
    } catch {
      throw new Error('Staging legal document is not reachable.');
    }

    if (!response.ok) {
      throw new Error(
        `Staging legal document is not reachable (HTTP ${response.status}).`,
      );
    }

    const document = await response.text();
    const versionLine = `Version: ${STAGING_LEGAL_VERSION}`;
    if (!document.split(/\r?\n/).includes(versionLine)) {
      throw new Error('Staging legal document is missing the exact version marker.');
    }
  }
}

export function sanitizeStagingAuthVerification({
  projectRef,
  legalDocuments,
  onboardingRpc,
  providers,
}) {
  return {
    projectRef,
    legalDocuments: legalDocuments.map(({kind, version}) => ({kind, version})),
    onboardingRpc: `${onboardingRpc.name}(${onboardingRpc.argumentTypes.join(', ')}) -> ${onboardingRpc.returnType}`,
    providers: {google: providers.google, apple: providers.apple},
  };
}

export function readStagingPromotionCommit() {
  const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();

  return assertPromotionCommit(commitSha);
}

function runStagingSupabase(arguments_) {
  const runner = path.join(repositoryRoot, 'supabase/scripts/run-staging-supabase.mjs');
  const result = spawnSync(process.execPath, [runner, ...arguments_], {
    cwd: repositoryRoot,
    env: buildStagingEnvironment(process.env),
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error('Staging Supabase command failed.');
  }
}

export async function seedStagingLegalDocuments({
  commitSha = readStagingPromotionCommit(),
  fetchImpl = fetch,
  makeTemporaryDirectory = () => mkdtemp(path.join(tmpdir(), 'divenary-staging-')),
  removeDirectory = directory => rm(directory, {force: true, recursive: true}),
  writeFileImpl = writeFile,
  runSupabase = runStagingSupabase,
} = {}) {
  await assertStagingProjectRef();
  await assertStagingLegalDocumentsReachable({commitSha, fetchImpl});

  const temporaryDirectory = await makeTemporaryDirectory();
  const sqlPath = path.join(temporaryDirectory, 'staging-legal-documents.sql');

  try {
    await writeFileImpl(sqlPath, buildStagingLegalSql(commitSha), 'utf8');
    runSupabase(['db', 'query', '--linked', '--file', sqlPath]);
  } finally {
    await removeDirectory(temporaryDirectory);
  }
}

async function main() {
  if (process.argv[2] !== 'seed') {
    throw new Error('Usage: node supabase/scripts/staging-project.mjs seed');
  }

  await seedStagingLegalDocuments();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
