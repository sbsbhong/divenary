Source URL: repository commits df41e21..7ee1c60, account-data migrations/functions, and user verification report
Collected: 2026-07-20
Published: 2026-07-20

# Guest data account claim implementation evidence through 7ee1c60

## Supabase data boundary

- `supabase/migrations/20260719130604_create_account_data_and_guest_claim.sql` adds owner-scoped `dive_logs`, `dive_plans`, `guest_claim_batches`, and `guest_claim_records` tables.
- Account rows use `(user_id, local_id)` uniqueness and positive `revision` values. Log/plan list access is owner-isolated by RLS using `auth.uid()` plus an `app_memberships` row.
- Full watch profiles are not embedded in list rows. The private `dive-profiles` bucket accepts authenticated owner paths under `<user_id>/claims/...` and `<user_id>/logs/...`.
- Claim batches bind an immutable `manifest_sha256` and expected log/plan counts. Claim records bind entity payload digests, relationship identifiers, target record IDs, and optional profile path/revision/digest/byte/sample metadata.
- `supabase/functions/finalize-guest-claim` verifies the authenticated user, batch ownership, staged record shape, profile object path and exact downloaded profile bytes before invoking the privileged database finalizer.
- `public.finalize_guest_claim` validates complete counts, staged relationships, profile verification evidence, payload digests, and existing `(user_id, local_id)` rows in one transaction. Repeating a committed batch returns the committed result. Reusing a local ID with a different digest is rejected instead of overwriting account data.
- The finalizer publishes plans and logs, reconnects plan/log relationships, and marks the batch committed atomically. It deliberately retains the committed `guest_claim_batches` row, its `guest_claim_records`, and `<user_id>/claims/...` profile objects so a repeated finalize/readback can remain idempotent and auditable. Auth user deletion cascades the claim rows and account cleanup removes owned profile objects, but no post-commit retention or lifecycle cleanup exists yet. The function is not executable by `anon` or `authenticated`; only `service_role` may call it through the Edge Function boundary.

## Mobile local-first boundary

- `apps/mobile/src/storage/data-principal.ts` and `apps/mobile/src/repositories/principal-repositories.ts` partition local repositories into `guest` and `user:<uuid>` namespaces.
- Legacy unscoped Logbook/Planbook data is migrated once into the guest namespace under a durable migration lock. Source data is removed only after target verification.
- Authenticated account writes are saved locally and represented in the durable account outbox before remote synchronization. Remote revisions are compared and unresolved revision mismatches are retained as conflicts.
- Account and deferred guest rows can be composed for display. The default composition is account-copy-wins for the same local ID; a guest row changed after its immutable claim snapshot is kept visible by a temporary guest-priority guard instead of being deleted as the old snapshot.
- User transitions use generation checks and user-scoped query/cache removal so callbacks from a previous account cannot publish into a later account state.

## Resumable claim boundary

- `apps/mobile/src/claim/guest-claim-store.ts` creates a persistent immutable snapshot and public manifest before remote work. The sidecar binds the exact local record bytes and complete profile bytes needed for retry.
- Profile snapshots are JSON-validated and checked by SHA-256, UTF-8 byte count, sample count, and content revision. Remote profile readback verifies exact object bytes before progress advances.
- The service stages plans before logs, uploads and reads back each record/profile, and advances completed item progress only after successful remote write and readback verification.
- Finalization and committed-batch readback are verified before the already committed snapshot is published directly to the account local repositories and read back there. The service then persists `cleanupPending`; it never persists a transient local `committed` state before cleanup.
- Guest source removal is exact-match guarded. A record that still matches the immutable snapshot is deleted exactly. A record changed after the snapshot is first saved through the normal account local-first mutation repository and durable outbox, read back, and only then removed from the guest repository. Local manifest status becomes `committed` only after all exact deletes or changed-row reconciliations and unreferenced local profile cleanup finish.
- A user may defer eligible guest data and keep it on the device. Deferred data remains visible alongside account data under the default account-copy-wins composition and is not automatically resumed.
- Claim state is bound to one authenticated user. Logout/account changes invalidate stale callbacks and isolate repositories, outbox state, manifests, downloaded profiles, and query caches by user.

## Independent Watch acknowledgement

- WatchConnectivity import acknowledgement remains a device-local transport contract. Watch `syncStatus: synced` means the payload was durably imported into the mobile local repository.
- Watch import ACK does not mean Supabase upload, account outbox completion, or guest claim completion. Watch import continues against the currently published local principal repository without adding an account ID to the watch contract.

## Verification and release boundary

- Automated tests exist for database claim/RLS behavior, the finalizer function, typed repositories, principal migration, account outbox/sync, claim storage/service, account data state, and Watch import principal isolation.
- Claim/progress UI is developed on a separate implementation branch; this source does not claim that it is integrated with the core branch, screenshot-validated, or physically validated.
- The migrations and Edge Function are staging-targeted. This source does not contain evidence that the account-data migrations or `finalize-guest-claim` were deployed to hosted staging.
- The user reported a successful physical Apple login. Physical Google login remains unverified.
- Production Supabase configuration, production legal documents, immediate permanent in-app account deletion, and release validation remain future gates.
