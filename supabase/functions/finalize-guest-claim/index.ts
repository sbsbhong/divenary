import {createClient} from 'npm:@supabase/supabase-js@2.110.2';

import {verifyProfileBytes} from './profile-verifier.ts';

type FinalizeRequest = {batchId: string};
type FinalizeResponse = {
  batchId: string;
  status: 'committed';
  planCount: number;
  logCount: number;
};

const knownStatus = {
  invalid_token: 401,
  batch_not_found: 404,
  profile_missing: 409,
  profile_digest_mismatch: 409,
  profile_byte_count_mismatch: 409,
  profile_sample_count_mismatch: 409,
  claim_validation_failed: 409,
} as const;

type KnownCode = keyof typeof knownStatus;

type ClaimRecord = {
  id: string;
  entity_kind: 'plan' | 'log';
  profile_path: string | null;
  profile_content_revision: string | null;
  profile_sha256: string | null;
  profile_byte_count: number | null;
  profile_sample_count: number | null;
};

class KnownFailure extends Error {
  constructor(readonly code: KnownCode) {
    super(code);
  }
}

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/;

function isOwnedClaimProfilePath(
  path: string,
  userId: string,
  batchId: string,
): boolean {
  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    return false;
  }

  if (decodedPath.includes('\\')) {
    return false;
  }

  const segments = decodedPath.split('/');

  return (
    segments.length === 5 &&
    segments[0] === userId &&
    segments[1] === 'claims' &&
    segments[2] === batchId &&
    uuidPattern.test(segments[3]) &&
    segments[4].length > '.json'.length &&
    segments[4].endsWith('.json') &&
    segments.every(segment =>
      segment.length > 0 && segment !== '.' && segment !== '..'
    )
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function failureResponse(code: KnownCode): Response {
  return jsonResponse({code}, knownStatus[code]);
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new KnownFailure('claim_validation_failed');
  }

  return value;
}

function readBearer(request: Request): string {
  const authorization = request.headers.get('Authorization');
  const match = authorization?.match(/^Bearer ([^\s]+)$/);

  if (!match) {
    throw new KnownFailure('invalid_token');
  }

  return match[1];
}

async function readFinalizeRequest(request: Request): Promise<FinalizeRequest> {
  if (request.method !== 'POST') {
    throw new KnownFailure('claim_validation_failed');
  }

  let parsed: unknown;

  try {
    parsed = await request.json();
  } catch {
    throw new KnownFailure('claim_validation_failed');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !('batchId' in parsed) ||
    typeof parsed.batchId !== 'string' ||
    !uuidPattern.test(parsed.batchId)
  ) {
    throw new KnownFailure('claim_validation_failed');
  }

  return {batchId: parsed.batchId};
}

function profileExpectation(record: ClaimRecord) {
  const values = [
    record.profile_path,
    record.profile_content_revision,
    record.profile_sha256,
    record.profile_byte_count,
    record.profile_sample_count,
  ];
  const declaredCount = values.filter(value => value !== null).length;

  if (declaredCount === 0) {
    return null;
  }

  if (
    declaredCount !== values.length ||
    record.entity_kind !== 'log' ||
    typeof record.profile_path !== 'string' ||
    record.profile_path.length === 0 ||
    typeof record.profile_content_revision !== 'string' ||
    record.profile_content_revision.length === 0 ||
    typeof record.profile_sha256 !== 'string' ||
    !sha256Pattern.test(record.profile_sha256) ||
    typeof record.profile_byte_count !== 'number' ||
    !Number.isSafeInteger(record.profile_byte_count) ||
    record.profile_byte_count < 0 ||
    typeof record.profile_sample_count !== 'number' ||
    !Number.isSafeInteger(record.profile_sample_count) ||
    record.profile_sample_count < 0
  ) {
    throw new KnownFailure('claim_validation_failed');
  }

  return {
    path: record.profile_path,
    sha256: record.profile_sha256,
    byteCount: record.profile_byte_count,
    sampleCount: record.profile_sample_count,
  };
}

function finalizedResponse(data: unknown, batchId: string): FinalizeResponse {
  if (
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data) ||
    !('batchId' in data) ||
    data.batchId !== batchId ||
    !('status' in data) ||
    data.status !== 'committed' ||
    !('planCount' in data) ||
    typeof data.planCount !== 'number' ||
    !Number.isSafeInteger(data.planCount) ||
    data.planCount < 0 ||
    !('logCount' in data) ||
    typeof data.logCount !== 'number' ||
    !Number.isSafeInteger(data.logCount) ||
    data.logCount < 0
  ) {
    throw new KnownFailure('claim_validation_failed');
  }

  return {
    batchId,
    status: 'committed',
    planCount: data.planCount,
    logCount: data.logCount,
  };
}

Deno.serve(async request => {
  try {
    const jwt = readBearer(request);
    const supabaseUrl = requiredEnvironment('SUPABASE_URL');
    const publishableKey = requiredEnvironment('SUPABASE_ANON_KEY');
    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const {
      data: {user},
      error: authenticationError,
    } = await authClient.auth.getUser(jwt);

    if (authenticationError || !user) {
      throw new KnownFailure('invalid_token');
    }

    const {batchId} = await readFinalizeRequest(request);
    const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const {data: batch, error: batchError} = await serviceClient
      .from('guest_claim_batches')
      .select('id,status,expected_plan_count,expected_log_count')
      .eq('id', batchId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (batchError) {
      throw new KnownFailure('claim_validation_failed');
    }

    if (!batch) {
      throw new KnownFailure('batch_not_found');
    }

    if (batch.status === 'committed') {
      return jsonResponse(
        finalizedResponse(
          {
            batchId,
            status: 'committed',
            planCount: batch.expected_plan_count,
            logCount: batch.expected_log_count,
          },
          batchId,
        ),
      );
    }

    if (batch.status !== 'uploading') {
      throw new KnownFailure('claim_validation_failed');
    }

    const {data: records, error: recordsError} = await serviceClient
      .from('guest_claim_records')
      .select(
        'id,entity_kind,profile_path,profile_content_revision,profile_sha256,profile_byte_count,profile_sample_count',
      )
      .eq('batch_id', batchId)
      .eq('user_id', user.id)
      .order('id');

    if (recordsError || !records) {
      throw new KnownFailure('claim_validation_failed');
    }

    const verifiedProfiles: Array<{
      record_id: string;
      sha256: string;
      byte_count: number;
      sample_count: number;
    }> = [];

    for (const record of records as ClaimRecord[]) {
      const expected = profileExpectation(record);

      if (!expected) {
        continue;
      }

      if (!isOwnedClaimProfilePath(expected.path, user.id, batchId)) {
        throw new KnownFailure('claim_validation_failed');
      }

      const {data: profile, error: profileError} = await serviceClient.storage
        .from('dive-profiles')
        .download(expected.path);

      if (profileError || !profile) {
        throw new KnownFailure('profile_missing');
      }

      try {
        await verifyProfileBytes(
          new Uint8Array(await profile.arrayBuffer()),
          expected,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message in knownStatus &&
          error.message.startsWith('profile_')
        ) {
          throw new KnownFailure(error.message as KnownCode);
        }

        throw new KnownFailure('claim_validation_failed');
      }

      verifiedProfiles.push({
        record_id: record.id,
        sha256: expected.sha256,
        byte_count: expected.byteCount,
        sample_count: expected.sampleCount,
      });
    }

    const {data, error: finalizeError} = await serviceClient.rpc(
      'finalize_guest_claim',
      {
        p_user_id: user.id,
        p_batch_id: batchId,
        p_verified_profiles: verifiedProfiles,
      },
    );

    if (finalizeError) {
      throw new KnownFailure('claim_validation_failed');
    }

    return jsonResponse(finalizedResponse(data, batchId));
  } catch (error) {
    if (error instanceof KnownFailure) {
      return failureResponse(error.code);
    }

    return failureResponse('claim_validation_failed');
  }
});
