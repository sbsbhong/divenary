# Guest Claim Semantic Canonical Reuse Design

Date: 2026-07-30

## Problem

A physical iPhone guest claim repeatedly reaches `15 / 15` and then fails with
`remote_conflict`. The claim batch contains fourteen new watch logs and one
watch log that is already present in the account under a different canonical
record ID.

The existing cross-device reconciliation accepts canonical reuse only when the
stored `payload_sha256` equals the staged claim digest. That condition is too
strict for this one record. Its immutable watch profile identity is identical,
and its user-visible fields are identical, but a remote read/write round trip
changed representation-only values:

- `timestamptz` text uses `Z` in one payload and `+00:00` in the other;
- a source-derived floating-point value is `11.600000000000001` in one payload
  and `11.6` in the other;
- `_local_record.createdAt`, `_local_record.updatedAt`, and
  `watch_metadata.importedAt` reflect different import bookkeeping times.

Because `private.finalize_guest_claim` rejects the digest mismatch before the
public wrapper can remap the staged target to the canonical account row, the
entire atomic batch rolls back. The fourteen genuinely new logs are therefore
not published even though every staged record is valid.

## Goal

Allow an active canonical account watch log to satisfy a staged guest claim
when it is the same immutable watch session and differs only by known
serialization or import-bookkeeping representations. Preserve the existing
fail-closed behavior for every user-meaningful difference.

The fix is server-side. Mobile claim progress, local publication, readback, and
exact guest cleanup continue to use the existing transaction state machine.

## Non-goals

- Do not ignore arbitrary `payload_sha256` mismatches.
- Do not merge logs with different immutable profile identity.
- Do not introduce partial-batch publication.
- Do not delete guest data before the existing remote commit, account-local
  publication, and readback gates complete.
- Do not change watch import acknowledgement semantics.

## Accepted equivalence

A canonical log is eligible only when all of these conditions hold:

1. It belongs to the same account and has the same `local_id` as the staged
   claim record.
2. It is active, not soft-deleted.
3. Both records are watch/profile-backed and have exactly the same:
   `profile_content_revision`, `profile_sha256`, `profile_byte_count`, and
   `profile_sample_count`.
4. `source_plan_id` resolves to the same canonical plan relation.
5. Every user-meaningful field is equal, including source, site, title, rating,
   dive mode, mobile data, provenance, profile preview, manual data, and watch
   metadata.
6. The only permitted representation differences are:
   - timestamps that compare equal as PostgreSQL `timestamptz`;
   - source-derived floating-point values equal within the existing account
     readback tolerance;
   - `_local_record.createdAt` and `_local_record.updatedAt`;
   - `watch_metadata.importedAt`.

Missing values remain distinct from present values. Title, site, rating, notes,
profile identity, relationship, deletion state, and other meaningful
differences must still reject the entire claim.

## Transaction design

The public `finalize_guest_claim` wrapper retains the current lock order:

1. claim batch;
2. staged claim records;
3. canonical plans;
4. canonical logs.

While those phase-one locks are held, the wrapper checks digest-mismatched
canonical logs with a private semantic-equivalence helper. An eligible row is
normalized to the staged payload representation and staged digest while
preserving its canonical ID, immutable profile path, and profile revision.

The existing private finalizer then sees the same strict digest it already
requires. It publishes the other staged records atomically. The wrapper keeps
its phase-two locks, full validation, and target-ID remap. Any later failure
rolls back both the normalization and publication.

This keeps the strict digest contract as the final invariant. Semantic
equivalence is a narrow, locked repair step, not a general weakening of claim
validation.

## Security

Semantic helpers live in the `private` schema and are not executable by
`public`, `anon`, `authenticated`, or `service_role`. The only public entry
point remains the service-role-only security-definer finalizer.

All helper and update predicates are owner-, batch-, entity-kind-, and
`local_id`-scoped. The update never changes the canonical ID, owner, local ID,
profile path, or profile revision.

## Verification

Automated coverage must prove:

- timestamp, safe float, and allowed bookkeeping differences reuse the
  canonical ID and commit the whole batch;
- the canonical row receives the staged digest without duplicating the log;
- meaningful payload, relation, deletion-state, or profile differences remain
  atomic conflicts;
- private helpers are not exposed;
- the hosted staging verifier exercises the semantic-reuse path.

After staging verification passes, the existing physical-device claim is
retried. Success requires the batch to commit, the one existing log to reuse
its canonical ID, fourteen new logs to publish, account-local readback to
finish, and the exact claimed guest snapshot to be cleaned without touching
later guest changes.
