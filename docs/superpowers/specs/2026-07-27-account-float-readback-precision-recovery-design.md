# Account Float Readback Precision Recovery Design

Date: 2026-07-27
Status: Proposed

## Problem

Account remote hydration rejects two newly uploaded Watch logs even though the
rows exist in Supabase and the embedded Watch metadata is intact. Both physical
iPhone and simulator report:

```text
Account hydration incomplete after 0 updates: Malformed remote log (2 failures)
```

The aggregate label hides the underlying
`Malformed remote log payload digest` failures.

The failing rows contain typed `double precision` summaries whose REST
readback uses fewer significant decimal digits than the hashed source values:

| Field | Hashed Watch source | Typed readback | Binary64 distance |
| --- | ---: | ---: | ---: |
| First duration | `13.890705108642578` | `13.8907051086426` | 12 ULP |
| First max depth | `6.917554998405613` | `6.91755499840561` | 4 ULP |
| Second duration | `18.46345806121826` | `18.4634580612183` | 11 ULP |

The current compatibility rule accepts only exact or one-adjacent-binary64
values. It therefore cannot reconstruct either row even though substituting
the embedded Watch values restores the exact stored payload SHA-256.

## Goal

Hydrate account logs when a typed floating summary is exactly the observed
15-significant-digit REST representation of the intact embedded source value,
while continuing to reject real numeric divergence, source mutation, other
payload changes, and final digest mismatch.

## Non-goals

- Do not weaken profile path, byte count, SHA-256, sample count, session ID, or
  owner validation.
- Do not change Supabase schema, migration history, RLS, or Storage policies.
- Do not use a generic epsilon, percentage tolerance, or arbitrary ULP limit.
- Do not change WatchConnectivity acknowledgement semantics.
- Do not rewrite stored payload digests or mutate existing remote rows.

## Considered Approaches

### 1. Exact decimal readback equivalence plus final digest verification

Treat two finite numbers as compatible when they are already exact/adjacent or
when the typed readback equals the source value rounded through JavaScript's
15-significant-digit decimal representation. Restore the embedded source value
only when the reconstructed full payload exactly matches the stored SHA-256.

This is the selected approach. It models the observed REST representation
without inventing a broad numeric tolerance, and the final digest remains the
authority for the original payload.

### 2. Increase the ULP allowance

This would recover the observed 12-ULP case but would encode an arbitrary upper
bound and could fail again for another magnitude. It also communicates less
clearly what transport behavior is being accepted.

### 3. Migrate typed summaries or canonical payload storage

Changing columns or adding a canonical payload JSON field could avoid the
readback merge problem for future rows, but it expands the change into hosted
schema migration and existing-row compatibility. It is not needed to recover
the intact rows already stored.

## Design

### Numeric compatibility boundary

`packages/supabase/src/account-data-numbers.ts` will expose a readback-specific
comparison with these rules:

1. Both values must be finite.
2. Exact equality remains valid, including signed zero.
3. Existing adjacent-binary64 compatibility remains valid.
4. A wider difference is valid only when converting the embedded source value
   to 15 significant decimal digits and back to `number` produces the typed
   readback exactly.
5. The comparison is directional: typed database readback is compared against
   the embedded source value. It is not a symmetric approximate-equality API.

The account repository save readback and mobile remote payload recovery will
use the same directional helper so insert/update acknowledgement and later
hydration apply identical rules.

### Payload recovery boundary

`apps/mobile/src/sync/account-payload.ts` will continue to:

1. Parse and validate every remote field.
2. Try the unmodified canonical payload digest.
3. For `duration_seconds` and `max_depth_meters` only, replace a typed readback
   with the embedded Watch value, or the manual measured value when Watch data
   is absent, when the numeric compatibility boundary passes.
4. Accept the candidate only if its complete canonical SHA-256 equals the
   stored `payload_sha256`.
5. Continue combining this candidate with the existing finalized relation
   compatibility rule without changing other fields.

`rating` remains exact because it is a PostgreSQL integer. Timestamp,
profile, owner, relation, and JSON structure checks remain fail-closed.

## Error Handling

Values that are non-finite, do not equal the 15-significant-digit source
readback, lack an embedded source, contain a changed embedded source, or fail
the final payload digest remain `Malformed remote log payload digest`.
Hydration continues isolating invalid rows while publishing valid rows.

## Tests

Test-first coverage will include:

- Numeric helper accepts the observed 12-, 4-, and 11-ULP readbacks.
- Numeric helper preserves exact, adjacent, signed-zero, and finite guards.
- Numeric helper rejects a real divergent value such as `11.5`.
- Repository save readback accepts the observed REST representation.
- Mobile parser hydrates both observed Watch payload shapes and restores their
  original numeric values.
- Mobile parser rejects a changed embedded source, unrelated payload mutation,
  and final digest mismatch.
- Integer `rating` remains exact.
- Existing profile hydration and UTF-8 recovery tests remain green.

## Documentation

After implementation verification, record the recurring numeric readback cause
and the selected bounded recovery rule in the project wiki sync article with a
new immutable raw evidence source. The documentation must state that this is
account log integrity compatibility, not a relaxation of profile validation or
the app's safety boundary.
