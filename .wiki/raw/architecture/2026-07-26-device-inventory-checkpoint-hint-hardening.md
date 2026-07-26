Source URL: docs/superpowers/specs/2026-07-26-home-device-inventory-performance-design.md; apps/mobile/src/claim/guest-claim-store.ts; apps/mobile/src/states/account-data.tsx
Collected: 2026-07-26
Published: 2026-07-26

# Device inventory checkpoint hint hardening

Live guest inventory가 0일 때 full claim snapshot을 전혀 확인하지 않으면 Home과 Settings는 빨라지지만, 앱 재시작 전에 남은 `running`, `finalizing`, `cleanupPending`, 일시적 network failure transaction이 영구적으로 재개되지 않을 수 있다. 반대로 full snapshot을 매번 읽으면 과거 15개 profile snapshot parse가 다시 Home interaction을 막는다.

최종 경계는 live inventory count와 transaction recovery hint를 분리한다.

- `GuestClaimStore`는 full snapshot key와 별도로 작은 advisory checkpoint hint를 저장한다.
- Recoverable hint는 `running`, `finalizing`, `cleanupPending`, `failed + network_unavailable`만 나타낸다.
- Hint는 current device-data count나 authoritative transaction status가 아니다. Resume은 항상 full snapshot read와 user/status validation을 거친다.
- Live inventory 0 refresh는 먼저 hidden 0을 publish한다. `inactive` hint면 full snapshot을 읽지 않고 끝내며, recoverable hint만 UI-silent background resume을 시작한다.
- Hint가 없는 legacy snapshot은 interaction 이후 publication당 한 번만 full read한다. Snapshot이 없거나 read/backfill이 실패해 hint가 계속 unknown이어도 같은 publication에서는 audit를 반복하지 않는다. 이 audit는 hint를 backfill하고 recoverable snapshot만 resume하며 presentation을 직접 바꾸지 않는다.
- Deferred audit와 zero-recovery token은 publication generation에 종속된다. Principal/service generation이 바뀌면 이전 generation의 transient token을 새 publication에 복사하지 않고, 새 nonzero inventory가 관찰되면 audit를 cancel·reset한다.
- Claim service progress/snapshot callback은 known-zero 또는 zero-recovery token 중 presentation을 publish하지 않는다. Background transaction은 계속되지만 stale sheet/action은 다시 나타나지 않는다.
- Claim-store read/write/remove와 hint backfill은 user claim key별로 직렬화한다. 오래된 inactive read가 더 최신 recoverable hint를 덮을 수 없다.
- Recoverable full write 전에 stale inactive hint를 제거해 crash 뒤 false inactive를 막는다. Full snapshot write/remove 뒤 hint update/remove는 advisory best-effort이며 실패가 claim transaction을 실패시키지 않는다.
- Full snapshot이 없는 stale recoverable hint는 resume readback 결과로 확인한 뒤 best-effort로 제거한다.

이 sidecar는 Supabase schema, remote claim protocol, RLS, Edge Function 또는 guest snapshot 형식을 변경하지 않는다.
