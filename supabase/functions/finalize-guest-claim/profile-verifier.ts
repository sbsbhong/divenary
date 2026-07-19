export type ExpectedProfile = {
  sha256: string;
  byteCount: number;
  sampleCount: number;
};

export async function verifyProfileBytes(
  bytes: Uint8Array,
  expected: ExpectedProfile,
): Promise<void> {
  if (bytes.byteLength !== expected.byteCount) {
    throw new Error('profile_byte_count_mismatch');
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actualSha256 = Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('');

  if (actualSha256 !== expected.sha256) {
    throw new Error('profile_digest_mismatch');
  }

  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

  if (!Array.isArray(parsed) || parsed.length !== expected.sampleCount) {
    throw new Error('profile_sample_count_mismatch');
  }
}
