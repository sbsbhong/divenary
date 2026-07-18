import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  ONBOARDING_RPC_METADATA_COMMAND,
  STAGING_LEGAL_EFFECTIVE_AT,
  STAGING_LEGAL_VERSION,
  STAGING_PROJECT_REF,
  assertStagingProjectRef,
  buildStagingLegalUrls,
  buildStagingEnvironment,
  sanitizeStagingAuthVerification,
} from './staging-project.mjs';
import {runStagingSupabase} from './run-staging-supabase.mjs';

export {ONBOARDING_RPC_METADATA_COMMAND};

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const supabaseCli = path.join(repositoryRoot, 'node_modules/.bin/supabase');
const stagingApiUrl = `https://${STAGING_PROJECT_REF}.supabase.co`;

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function findPublicApiKey(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const apiKey = findPublicApiKey(item);
      if (apiKey) {
        return apiKey;
      }
    }
    return undefined;
  }

  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  const label = `${value.name ?? ''} ${value.type ?? ''}`.toLowerCase();
  const apiKey = value.api_key ?? value.apiKey ?? value.key;
  if (
    typeof apiKey === 'string' &&
    (label.includes('publishable') || label.includes('anon'))
  ) {
    return apiKey;
  }

  for (const nestedValue of Object.values(value)) {
    const nestedApiKey = findPublicApiKey(nestedValue);
    if (nestedApiKey) {
      return nestedApiKey;
    }
  }

  return undefined;
}

function readStagingPublicApiKey({spawnSyncImpl = spawnSync} = {}) {
  const result = spawnSyncImpl(
    supabaseCli,
    [
      'projects',
      'api-keys',
      '--project-ref',
      STAGING_PROJECT_REF,
      '--output',
      'json',
    ],
    {
      cwd: repositoryRoot,
      env: buildStagingEnvironment(process.env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error('Unable to read the staging public API key.');
  }

  const apiKey = findPublicApiKey(parseJson(result.stdout, 'Staging API keys'));
  if (!apiKey) {
    throw new Error('Staging project has no public API key.');
  }

  return apiKey;
}

async function fetchJson(fetchImpl, url, options, label, statuses = [200]) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch {
    throw new Error(`${label} is not reachable.`);
  }

  const text = await response.text();
  if (!statuses.includes(response.status)) {
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }

  return text.length === 0 ? null : parseJson(text, label);
}

function assertExactLegalDocuments(rows, commitSha) {
  const expectedUrls = buildStagingLegalUrls(commitSha);
  const expected = [
    {
      kind: 'terms',
      version: STAGING_LEGAL_VERSION,
      effectiveAt: STAGING_LEGAL_EFFECTIVE_AT,
      documentUrl: expectedUrls.terms,
    },
    {
      kind: 'privacy',
      version: STAGING_LEGAL_VERSION,
      effectiveAt: STAGING_LEGAL_EFFECTIVE_AT,
      documentUrl: expectedUrls.privacy,
    },
  ];

  if (!Array.isArray(rows) || rows.length !== expected.length) {
    throw new Error('Staging public legal document rows are invalid.');
  }

  const actual = rows;
  for (const [index, document] of expected.entries()) {
    if (
      actual[index]?.kind !== document.kind ||
      actual[index]?.version !== document.version ||
      actual[index]?.effectiveAt !== document.effectiveAt ||
      actual[index]?.documentUrl !== document.documentUrl
    ) {
      throw new Error('Staging public legal document rows do not match the promotion commit.');
    }
  }

  return actual;
}

function inferLegalPromotionCommit(rows) {
  const expectedKinds = ['terms', 'privacy'];
  let promotionCommit;

  for (const [index, expectedKind] of expectedKinds.entries()) {
    const document = rows[index];
    const match =
      typeof document?.documentUrl === 'string'
        ? document.documentUrl.match(
          /^https:\/\/raw\.githubusercontent\.com\/sbsbhong\/divenary\/([0-9a-f]{40})\/docs\/legal\/staging\/2026-07-18\/(terms|privacy)\.md$/,
        )
        : null;

    if (document?.kind !== expectedKind || !match || match[2] !== expectedKind) {
      throw new Error('Staging legal document URL shape is invalid.');
    }

    if (promotionCommit !== undefined && promotionCommit !== match[1]) {
      throw new Error('Staging legal document URLs must use the same promotion commit.');
    }
    promotionCommit = match[1];
  }

  return promotionCommit;
}

function normalizeLegalEffectiveAt(value) {
  if (typeof value !== 'string') {
    throw new Error('Staging legal document effective timestamp is invalid.');
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) {
    throw new Error('Staging legal document effective timestamp is invalid.');
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const fraction = match[7] ?? '';
  const zone = match[8];
  const offsetSign = match[9];
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));

  if (
    month < 1 || month > 12 ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 14 || offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0) ||
    fraction.slice(3).replaceAll('0', '') !== ''
  ) {
    throw new Error('Staging legal document effective timestamp is invalid.');
  }

  const localTime = new Date(0);
  localTime.setUTCFullYear(year, month - 1, day);
  localTime.setUTCHours(hour, minute, second, milliseconds);
  if (
    localTime.getUTCFullYear() !== year ||
    localTime.getUTCMonth() !== month - 1 ||
    localTime.getUTCDate() !== day ||
    localTime.getUTCHours() !== hour ||
    localTime.getUTCMinutes() !== minute ||
    localTime.getUTCSeconds() !== second ||
    localTime.getUTCMilliseconds() !== milliseconds
  ) {
    throw new Error('Staging legal document effective timestamp is invalid.');
  }

  const offsetDirection = zone === 'Z' ? 0 : offsetSign === '+' ? 1 : -1;
  const timestamp =
    localTime.getTime() -
    offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  const normalized = new Date(timestamp).toISOString();
  if (normalized !== STAGING_LEGAL_EFFECTIVE_AT) {
    throw new Error('Staging legal document effective timestamp does not match staging.');
  }

  return normalized;
}

export async function verifyPublicLegalDocuments({fetchImpl, publicApiKey, commitSha}) {
  const headers = {apikey: publicApiKey};
  const pointers = await fetchJson(
    fetchImpl,
    `${stagingApiUrl}/rest/v1/current_legal_documents?select=kind,document_version&order=kind.asc`,
    {headers},
    'Staging legal document pointers',
  );

  if (!Array.isArray(pointers) || pointers.length !== 2) {
    throw new Error('Staging public legal document pointers are invalid.');
  }

  const rows = [];
  for (const kind of ['terms', 'privacy']) {
    const pointer = pointers.find(document => document?.kind === kind);
    if (pointer?.document_version !== STAGING_LEGAL_VERSION) {
      throw new Error('Staging public legal document pointer version is invalid.');
    }

    const documents = await fetchJson(
      fetchImpl,
      `${stagingApiUrl}/rest/v1/legal_documents?kind=eq.${kind}&version=eq.${encodeURIComponent(pointer.document_version)}&select=kind,version,effective_at,document_url`,
      {headers},
      `Staging ${kind} legal document`,
    );
    if (!Array.isArray(documents) || documents.length !== 1) {
      throw new Error(`Staging ${kind} legal document row is invalid.`);
    }

    rows.push({
      kind: documents[0].kind,
      version: documents[0].version,
      effectiveAt: normalizeLegalEffectiveAt(documents[0].effective_at),
      documentUrl: documents[0].document_url,
    });
  }

  const deployedCommit = commitSha ?? inferLegalPromotionCommit(rows);
  return assertExactLegalDocuments(rows, deployedCommit);
}

export async function verifyAnonymousOnboardingRpc({fetchImpl, publicApiKey}) {
  const body = await fetchJson(
    fetchImpl,
    `${stagingApiUrl}/rest/v1/rpc/get_onboarding_status`,
    {
      method: 'POST',
      headers: {
        apikey: publicApiKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    'Staging onboarding RPC',
    [401],
  );

  if (body?.code !== '42501') {
    throw new Error('Staging onboarding RPC permission contract is invalid.');
  }
}

export function parseOnboardingRpcMetadata(output) {
  const body = parseJson(output, 'Staging onboarding RPC metadata');
  const rows = body?.rows;

  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.name !== 'get_onboarding_status' ||
    rows[0]?.argument_types !== '' ||
    rows[0]?.return_type !== 'jsonb'
  ) {
    throw new Error(
      'Staging onboarding RPC signature must be public.get_onboarding_status() -> jsonb.',
    );
  }

  return {
    name: rows[0].name,
    argumentTypes: [],
    returnType: rows[0].return_type,
  };
}

async function readOnboardingRpcMetadata() {
  const result = await runStagingSupabase(ONBOARDING_RPC_METADATA_COMMAND, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0) {
    throw new Error('Unable to read staging onboarding RPC metadata.');
  }

  return parseOnboardingRpcMetadata(result.stdout);
}

export async function verifyProviderFlags({fetchImpl, publicApiKey}) {
  const settings = await fetchJson(
    fetchImpl,
    `${stagingApiUrl}/auth/v1/settings`,
    {headers: {apikey: publicApiKey}},
    'Staging Auth settings',
  );

  const providers = {
    google: settings?.external?.google,
    apple: settings?.external?.apple,
  };
  if (providers.google !== true || providers.apple !== true) {
    throw new Error('Staging Google and Apple providers must both be enabled.');
  }

  return providers;
}

export async function verifyStagingAuth({
  commitSha,
  fetchImpl = fetch,
  readPublicApiKey = readStagingPublicApiKey,
  readRpcMetadata = readOnboardingRpcMetadata,
} = {}) {
  await assertStagingProjectRef();
  const publicApiKey = readPublicApiKey();
  const [legalDocuments, onboardingRpc, providers] = await Promise.all([
    verifyPublicLegalDocuments({fetchImpl, publicApiKey, commitSha}),
    readRpcMetadata(),
    verifyProviderFlags({fetchImpl, publicApiKey}),
  ]);
  await verifyAnonymousOnboardingRpc({fetchImpl, publicApiKey});

  return sanitizeStagingAuthVerification({
    projectRef: STAGING_PROJECT_REF,
    legalDocuments,
    onboardingRpc,
    providers,
  });
}

async function main() {
  const summary = await verifyStagingAuth();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
