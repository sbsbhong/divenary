# Guest claim semantic canonical reuse physical verification evidence

Source URL: physical iPhone UI observation, copied app data container, and staging readback
Collected: 2026-07-30
Published: 2026-07-30

## Device and observed flow

- Device: connected and unlocked iPhone 14 Pro
- Environment: Debug mobile app using hosted staging
- The user opened `계정으로 가져오기`.
- The UI first displayed `15/15` while resuming the previously uploaded failed checkpoint.
- After that checkpoint committed and cleaned up, the sheet refreshed to offer one remaining dive.
- The user started the one-item claim and the UI reported success.

## Remote evidence

- The preserved original batch `909c305f-f2a1-4b7e-8ac4-4b16acd5f83e` is `committed` with zero plans, fifteen logs, and fifteen claim records.
- All fifteen final target IDs resolve to active account log rows.
- The representation-only collision for local ID `watch:34AA0C02-3DC9-4D6A-AB6D-E91F1A3EEFF3:1784557969.601667` reused canonical account ID `7cf3ab00-a649-403b-9da8-55ca607330b2`.
- The obsolete staged target `f29914e2-8763-4d63-90f4-6028924d6201` is not present as an account row.
- The follow-up batch `d30f29a7-d0c3-4ffb-9c64-edb26949b698` is `committed` with zero plans, one log, and one claim record.
- The account has twenty-six active logs: eighteen Watch and eight manual. There are no duplicate active local IDs.
- The prior account count was eleven. The original batch added fourteen genuinely new logs while reusing one canonical row, and the follow-up batch added one log, yielding twenty-six active logs.

## Physical local readback

- A post-completion copy of the iPhone app data container showed twenty-six account-local logs and zero guest logs.
- Every local account log ID and remote ID matched the twenty-six active staging rows; there were no local-only or remote-only records.
- The current checkpoint is a committed compact receipt for the one-item follow-up batch with zero snapshots and zero retained items.
- Account outbox items and conflicts were both empty.

## Conclusion

- The original failure was recovered without re-uploading or duplicating the fifteen staged records.
- Semantic canonical reuse preserved the existing Watch log identity, published only the fourteen genuinely new rows from the original batch, and allowed the subsequent distinct one-item claim to complete.
- Successful guest originals were removed from the guest repository after account publication/readback, so the next inventory did not count those fifteen records again.
- This evidence covers the original iPhone batch. Android, offline retry, force-quit cleanup resume, and second-account isolation remain separate physical gates.
