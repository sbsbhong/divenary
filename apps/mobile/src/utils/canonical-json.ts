/**
 * Serializes a JSON-compatible value with object keys in a fixed order, so equal values always
 * produce the same text for hashing. Members whose value is `undefined` are left out.
 *
 * Keys are ordered with `localeCompare`, which stored and remote digests already depend on, so
 * the output must stay byte-for-byte the same. `localeCompare` is slow on Hermes, and a profile
 * repeats the same few keys on every depth sample, so the order is computed once per distinct key
 * list and reused.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = orderedKeys(record).map(
      key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    );
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const MAX_CACHED_KEY_ORDERS = 1024;
const keyOrderByKeyList = new Map<string, string[]>();

function orderedKeys(record: Record<string, unknown>): string[] {
  const keys = Object.keys(record).filter(key => record[key] !== undefined);
  const keyList = keys.join('\u0000');
  let ordered = keyOrderByKeyList.get(keyList);
  if (ordered === undefined) {
    ordered = [...keys].sort((left, right) => left.localeCompare(right));
    if (keyOrderByKeyList.size >= MAX_CACHED_KEY_ORDERS) {
      keyOrderByKeyList.clear();
    }
    keyOrderByKeyList.set(keyList, ordered);
  }
  return ordered;
}
