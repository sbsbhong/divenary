Source URL: docs/superpowers/specs/2026-07-30-mobile-authoritative-watch-log-deletion-design.md
Collected: 2026-08-02
Published: Unknown

# Mobile-authoritative Watch log deletion implementation and physical verification

## 확인된 원인

기존 `15/15` 재가져오기와 11개에서 26개로 늘어난 현상은 Watch가 삭제된 세션을 다시 전송해서 생긴 것이 아니었다. 실패한 guest claim의 immutable 15-item checkpoint가 이미 완료된 upload receipt를 보존했고, 재시도 때 live guest inventory 대신 그 snapshot을 finalization과 account-local publication에 다시 사용했다. 모바일에서 row만 삭제해도 snapshot에는 삭제 의도가 전달되지 않았으므로 과거 로그가 계정 데이터로 부활했다.

## 구현된 삭제 경계

- 모바일은 `localSessionId` 기준 device-wide `WatchLogDeletionStore`에 삭제 묘비를 먼저 영속화하고 readback한 뒤 repository row, account outbox, claim checkpoint와 Watch command를 재조정한다.
- Watch import와 account hydration은 묘비가 있는 session을 화면이나 repository에 다시 게시하지 않는다. Stale Watch artifact는 consume/ACK하되 로그로 만들지 않는다.
- Noncommitted guest claim snapshot이 삭제 session과 겹치면 전체 batch를 그대로 finalize하지 않는다. Remote batch는 staging의 `abandon-guest-claim` 경계로 `uploading → abandoned` 전환한 뒤 live non-tombstoned inventory로 새 snapshot을 만든다. Finalize와 abandon이 경쟁해 이미 committed라면 row를 보이게 게시하지 않고 account delete outbox로 전환한다.
- iPhone native는 deletion command를 `UserDefaults`에 보존한다. `transferUserInfo`는 동일 command의 outstanding background transfer만 중복 방지하고, Watch가 reachable이면 outstanding background transfer가 있어도 `sendMessage` 즉시 채널을 항상 시도한다. Activation, reachability, paired-Watch state와 foreground에서 queue를 다시 flush한다.
- Watch는 삭제할 `localSessionId`를 ledger에 먼저 기록하고 outstanding file transfer, manifest entry, artifact와 saved session을 제거한 뒤 exact acknowledgement를 보낸다. 같은 명령이나 이미 없는 session은 idempotent하게 처리하며 ledger가 load/migration/save의 복원을 막는다.
- Watch에는 삭제 UI나 gesture를 추가하지 않았다. 사용자가 삭제를 시작하는 곳은 모바일뿐이다.

## Staging과 자동 검증

- Migration `20260730130838_abandon_deleted_guest_claim_logs.sql`과 `abandon-guest-claim` Edge Function은 staging `mclvhwzsuvsxjerdouka`에만 배포됐다. Production은 변경하지 않았다.
- Hosted verifier는 owner authorization, cross-owner denial, abandonment, stale finalize rejection, idempotent replay, committed race와 exact claim Storage cleanup을 확인했다.
- Mobile/Jest와 Watch XCTest는 묘비 write-before-delete, stale import 차단, 15-item checkpoint 회귀, cleanup failure 내구성, exact ACK, manifest/artifact 삭제와 process restart 복구를 다룬다.
- iPhone source regression은 paired-Watch state change가 pending deletion queue를 다시 flush하고, outstanding background transfer가 immediate `sendMessage`를 막지 않는 것을 고정한다.

## 2026-08-02 실기기 검증

- Release 앱은 설계대로 `MOBILE_ENVIRONMENT_MODE=release`에서 development/staging Auth client를 만들지 않아 소셜 로그인이 비활성화됐다. 계정 경로는 feature worktree의 staging Debug bundle로 검증했다.
- Debug 검증 중 기존 main checkout의 Metro가 8081을 점유하고 있었다. 별도 Metro를 8083에 띄우고 `devicectl` launch argument `-RCT_jsLocation 192.168.0.4:8083`로 feature bundle을 명시했다. 그렇지 않으면 feature native binary가 main checkout JS를 읽어 검증 결과가 섞일 수 있다.
- 로그아웃 상태에서 Watch demo session을 생성하고 모바일에서 확인한 뒤 로그인했다. `기기 데이터 가져오기` 대상은 과거 15개가 아니라 현재 1개로 표시됐고 progress도 `1/1`이었다. 가져오기 완료 뒤 모바일에서 로그를 삭제하자 Watch saved session도 제거됐다.
- 별도 guest 삭제에서는 iPhone 목록과 Watch session 제거, deletion ACK에 따른 pending queue 정리, 양쪽 앱 재실행과 재동기화 뒤 비부활을 확인했다.
- radio-off 시도에서는 iPhone이 `reachable=false`, pending 1개로 background transfer를 등록했다. WatchConnectivity가 수동 재연결 전에 transfer를 전달해 Watch session은 먼저 사라졌고, 재연결 뒤 ACK가 iPhone pending queue를 0으로 정리했다. 따라서 durable background delivery와 ACK 수렴은 확인했지만, 명령이 오직 수동 reconnect 이후에만 전달되는 통제된 지연 시나리오로 해석하지 않는다.

## 남은 경계

- 이미 삭제 의도가 유실된 과거 Watch history는 추정해서 자동 삭제하지 않는다. 새 버전에서 사용자가 모바일로 다시 삭제한 항목부터 두 기기에 전파된다.
- Production Supabase 승격과 앱 내 account deletion은 별도 gate다.
- WatchConnectivity의 `isReachable`은 즉시 messaging 가능성일 뿐 background transfer 성공 여부가 아니다.
