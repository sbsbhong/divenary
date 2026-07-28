# Guest Data Account Claim Device Checklist

작성일: 2026-07-20

대상: staging `mclvhwzsuvsxjerdouka`

상태 표기: 이 문서의 physical check는 모두 실행 전 `PENDING`이다. 자동화, simulator 또는 코드 검토 결과로 physical 항목을 `PASS` 처리하지 않는다.

## 검증 경계

- Finalizer는 remote account rows를 publish하고 batch를 `committed`로 바꾸지만 `guest_claim_batches`, `guest_claim_records`, `<user_id>/claims/...` profile objects를 삭제하지 않는다.
- 이 remote claim evidence는 idempotent readback/audit용으로 유지된다. Auth user deletion은 database claim rows를 cascade하지만 remote Storage profile objects는 자동 삭제하지 않는다. Account deletion과 privileged object cleanup이 아직 구현되지 않아 object는 계속 보존되며, 해당 cleanup은 future release gate다.
- Completion cleanup은 exact snapshot과 같은 **local guest rows**, 더 이상 참조하지 않는 **local guest profiles**, changed-during-claim reconciliation과 local manifest의 최종 `committed` 전이를 뜻한다. Remote claim staging 삭제를 뜻하지 않는다.
- Exact `3 / 32` 중단, 강제 종료 시점, snapshot 직전 profile 손상은 현재 debug pause/fault injector가 없어 physical device에서 결정적으로 만들 수 없다. 해당 수동 항목은 best-effort 관찰이며 아래 자동 테스트가 durability invariant의 결정적 gate다.

## 자동 사전 Gate

UI/core/staging verifier branch가 모두 통합된 동일 candidate SHA에서 루트 기준으로 실행한다.

```sh
yarn workspace @repo/mobile test guest-claim-service.test.ts --runInBand -t "resumes at exactly 3 / 32"
yarn workspace @repo/mobile test guest-claim-service.test.ts --runInBand -t "does not publish committed before cleanup deletion finishes"
yarn workspace @repo/mobile test guest-claim-service.test.ts --runInBand -t "persists cleanupPending, hides claimed ids, and retries cleanup without finalizing twice"
yarn workspace @repo/mobile test guest-claim-service.test.ts --runInBand -t "promotes a changed log through account local-first"
yarn workspace @repo/mobile test guest-claim-service.test.ts --runInBand -t "promotes a changed plan as a pending account update"
yarn workspace @repo/mobile test guest-claim-service.test.ts --runInBand -t "rejects non-identical downloaded profile bytes before progress increments"
yarn workspace @repo/mobile test guest-claim-service.test.ts --runInBand -t "compacts a legacy committed snapshot"
yarn workspace @repo/mobile test guest-claim-store.test.ts --runInBand
yarn workspace @repo/mobile test watch-connectivity-sync.test.tsx --runInBand -t "keeps a raw inbox artifact retryable"
yarn workspace @repo/mobile test watch-connectivity-sync.test.tsx --runInBand -t "continues after a failed first payload"
```

- [x] `PASS 2026-07-20` candidate `278ddfc`: focused mobile 16 suites, 326 tests; Supabase package 53 tests; staging verifier unit 49 tests; local pgTAP 109 tests. 모든 command exit code 0.
- [x] `PASS 2026-07-20` target ID 보정 candidate `8b630a3`: Supabase script 68 tests; Supabase package 53 tests; local finalizer 15 checks; pgTAP 109 tests; guest REST smoke 10 checks; database lint. 재리뷰 `APPROVE`.
- [x] `PASS 2026-07-20` 실패한 feature 자동 gate 없음. 전체 mobile suite의 기존 native Watch source assertion 12건과 repository-wide lint 28건은 base에서도 재현되는 별도 잔여 항목이다.

## Staging 사전 조건

Staging verifier script가 포함된 통합 candidate에서만 다음 명령을 실행한다. Access token, API key, disposable password, OAuth token을 command line이나 보고서에 추가하지 않는다.

```sh
yarn supabase:staging:link
yarn supabase:staging:migrations
yarn supabase:staging:push:dry-run
yarn supabase:staging:verify:auth
yarn supabase:staging:verify:guest-claim
```

- [x] `PASS 2026-07-20` linked project ref가 정확히 `mclvhwzsuvsxjerdouka`다.
- [x] `PASS 2026-07-20` dry-run이 migrations `20260719130604`, `20260719134648`만 제시했고 push 뒤 migration history가 일치했다. `finalize-guest-claim` Edge Function도 같은 staging ref에 배포했다.
- [x] `PASS 2026-07-20` 보정 dry-run은 `20260720230000`만 제시했고 push 뒤 네 migration의 local/remote history가 일치했다. Verifier는 published payload digest와 다른 target ID를 쓰는 새 batch의 409 rollback까지 확인했다.
- [x] `PASS 2026-07-20` Auth verifier와 guest-claim verifier가 모두 PASS로 종료했으며 추적 문서에 email, token, key, profile body를 남기지 않았다.
- [x] `PASS 2026-07-20` verifier는 disposable user 2명을 사용하고 test profile object와 user cleanup을 수행한다. 이 cleanup은 finalizer post-commit lifecycle cleanup과 별개다.
- [ ] `PENDING` signed iPhone build와 Android development build가 staging endpoint만 사용하는지 확인한다.
- [ ] `PENDING` account A/B를 준비하고 각 `auth.uid()`를 비공개 실행 기록에 적는다. Global staging table이 비어 있을 필요는 없다.
- [ ] `PENDING` account A/B별 시작 count와 테스트에 사용할 unique local ID prefix를 기록해 이전 retained claim evidence와 구분한다.

## 24 Logs + 8 Plans 준비

각 플랫폼은 새 설치 또는 앱 데이터 초기화 뒤 로그인하지 않은 guest 상태에서 앱의 공개 UI로 32개를 만든다. 임의 DB/AsyncStorage write나 존재하지 않는 fixture injector를 사용하지 않는다.

- [ ] `PENDING` guest plan 8개를 만든다. `draft`, `planned`, `completed`를 모두 포함하고 제목에 이번 실행의 unique prefix를 붙인다.
- [ ] `PENDING` 계획 2개 이상을 앱의 plan-to-log 흐름으로 전환해 `sourcePlanLocalId` 관계 2쌍 이상을 만든다.
- [ ] `PENDING` 최종 guest log count를 24개로 맞추고 manual/watch provenance와 주요 원본 값을 기록한다.
- [ ] `PENDING` iPhone에서는 가능하면 manual 16개 + paired Watch import 8개로 구성하고 Watch log 4개 이상에 full profile이 있는지 detail에서 확인한다.
- [ ] `PENDING` Android는 Apple Watch import를 지원하지 않으므로 공개 UI로 manual log 24개를 만든다. Android physical claim에서 Watch/profile coverage를 통과했다고 기록하지 않고, profile invariant는 자동 gate와 iPhone Watch regression으로 검증한다.
- [ ] `PENDING` 목록과 상세에서 24 logs + 8 plans가 모두 열리고 relation, timestamps, mode, notes와 provenance가 보존되는지 확인한다.

## 기본 Claim Matrix

| ID | Platform | Viewport | Theme | Text | Motion | Status |
|---|---|---|---|---|---|---|
| C1 | iPhone | 320pt width | Light | Default | Standard | `PENDING` |
| C2 | iPhone | Large phone | Dark | Largest accessibility size | Reduce Motion | `PENDING` |
| C3 | Android | 320dp width | Light | Font scale 1.0 | Standard | `PENDING` |
| C4 | Android | Large phone | Dark | Font scale 2.0 | Remove animations | `PENDING` |

각 행에서 다음 절차를 수행한다.

1. [ ] `PENDING` guest fixture 32개가 있는 상태에서 account A로 로그인한다.
2. [ ] `PENDING` claim 선택 화면에 24 logs와 8 plans가 정확히 표시되는지 확인한다.
3. [ ] `PENDING` 가져오기를 선택하고 progress가 remote write/readback 뒤에만 증가하는지 관찰한다.
4. [ ] `PENDING` best-effort로 세 번째 완료 순간의 exact text `3 / 32`, progress bar 3/32와 VoiceOver/TalkBack 3 of 32를 확인한다. UI가 너무 빨라 포착하지 못하면 `PASS`를 추정하지 말고 자동 `3 / 32` test 결과와 관찰 불가 사실을 함께 기록한다.
5. [ ] `PENDING` item label, progress, action과 sheet가 겹치거나 화면 밖으로 잘리지 않는지 확인한다.
6. [ ] `PENDING` 완료 전 local guest source가 삭제되지 않고 account row가 불완전한 snapshot으로 노출되지 않는지 확인한다.
7. [ ] `PENDING` 완료 뒤 account Logbook 24개와 Planbook 8개가 보이고 relation/profile/detail 값이 원본과 일치하는지 확인한다.
8. [ ] `PENDING` 같은 `localId`의 guest/account copy가 함께 존재하는 전이 중 account-copy-wins로 하나만 표시되는지 확인한다.
9. [ ] `PENDING` exact snapshot과 같은 local guest rows와 unreferenced local guest profiles가 정리되고 local manifest가 cleanup 뒤에만 `committed`가 되는지 확인한다.
10. [ ] `PENDING` remote committed batch/records와 claim profile objects가 finalization 뒤에도 남아 있고 반복 readback이 같은 결과를 내는지 account A의 unique prefix/batch로 확인한다.

## Lifecycle And Retry Matrix

| Scenario | iPhone | Android | Pass condition |
|---|---|---|---|
| Foreground full claim | `PENDING` | `PENDING` | 32개가 중복 없이 account에 publish되고 local exact guest source만 정리된다. |
| Background/foreground | `PENDING` | `PENDING` | background 후 같은 user/batch/count에서 계속되거나 명시적 retry로 재개된다. |
| Force-quit resume | `PENDING` | `PENDING` | 강제 종료 후 새 batch 없이 persisted manifest부터 재개한다. |
| Offline before start | `PENDING` | `PENDING` | local source는 유지되고 network 복구 뒤 retry할 수 있다. |
| Offline during upload | `PENDING` | `PENDING` | 마지막 verified readback count까지만 표시하고 중복 없이 재개한다. |
| Offline after remote commit | `PENDING` | `PENDING` | upload/finalize를 중복 publish하지 않고 `cleanupPending` local cleanup을 마친다. |
| Session expiry | `PENDING` | `PENDING` | 다른 user로 이어 쓰지 않고 같은 account 재인증 뒤 재개한다. |
| Duplicate retry tap | `PENDING` | `PENDING` | 동시 batch나 중복 account row를 만들지 않는다. |

Lifecycle 절차:

1. [ ] `PENDING` 각 시나리오 전에 24 + 8 fixture, account별 remote count, retained claim count/object와 local count를 기록한다.
2. [ ] `PENDING` `3 / 32`가 보이는 순간 interruption을 best-effort로 시도한다. 정확한 시점을 잡지 못하면 실제 마지막 표시 count를 기록하고 exact-3 resume는 자동 test로 판정한다.
3. [ ] `PENDING` force-quit은 OS app switcher에서 종료하고 재실행·동일 account 로그인한다. 현재 debug pause가 없으므로 remote finalize 직후를 정확히 강제하지 못했다면 그 사실을 기록하고 cleanup ordering 자동 tests로 보완한다.
4. [ ] `PENDING` 재개 뒤 completed count가 이전 verified readback보다 감소하거나 검증 없이 증가하지 않는지 확인한다.
5. [ ] `PENDING` 최종 account row count, unique `(user_id, local_id)`, revision과 profile digest를 확인한다.
6. [ ] `PENDING` changed-during-claim을 UI에서 재현할 수 있으면 진행 중 guest row 하나를 편집하고, account pending/outbox update와 guest removal 순서를 관찰한다. 타이밍을 만들지 못하면 changed log/plan 자동 tests를 authoritative 결과로 기록한다.

## Corrupt Profile

현재 공개 UI에는 snapshot 직전 profile bytes를 손상시키는 기능이 없고 debug fault injector도 없다.

1. [ ] `PENDING` supported device storage inspection으로 안전하게 준비할 수 있을 때만 profile이 있는 guest log의 local profile을 claim 시작 **전** 손상시킨다. 준비할 수 없으면 물리 결과를 추정하지 말고 `PENDING - no supported setup`으로 남긴다.
2. [ ] `PENDING` claim이 일반 실패 상태로 멈추고 해당 item progress를 올리지 않는지 best-effort로 확인한다.
3. [ ] `PENDING` local guest log/profile과 나머지 guest items가 삭제되지 않는지 확인한다.
4. [ ] `PENDING` 오류 화면이 raw path, token, Supabase body 또는 stack을 노출하지 않는지 확인한다.
5. [ ] `PENDING` 결정적 판정은 `rejects non-identical downloaded profile bytes before progress increments`와 `guest-claim-store.test.ts` 자동 gate 결과에 연결한다.

## Keep On Device And Settings Retry

1. [ ] `PENDING` account A 로그인 후 claim 선택 화면에서 기기에 유지를 선택한다.
2. [ ] `PENDING` 24 logs + 8 plans가 삭제되지 않고 목록에 device-only badge로 표시되는지 확인한다.
3. [ ] `PENDING` badge가 light/dark, 320pt/320dp, large phone, Dynamic Type/font scale 2.0에서 잘리거나 제목을 밀어내지 않는지 확인한다.
4. [ ] `PENDING` 앱 재시작과 background/foreground 뒤 deferred 상태가 자동 upload로 바뀌지 않는지 확인한다.
5. [ ] `PENDING` Settings retry가 online authenticated 상태와 eligible guest data가 있을 때만 보이는지 확인한다.
6. [ ] `PENDING` Settings retry로 같은 24 + 8을 claim하고 best-effort `3 / 32` 관찰과 completion local cleanup을 확인한다.
7. [ ] `PENDING` account copy와 같은 local ID인 deferred guest row가 account-copy-wins로 한 번만 표시되는지 확인한다.

## Logout, Login, Second Account Isolation

1. [ ] `PENDING` account A claim을 best-effort로 중간 progress에서 중단하고 logout한다.
2. [ ] `PENDING` account B로 로그인해 A의 account rows, outbox, manifest, profile, progress와 query cache가 보이지 않는지 확인한다.
3. [ ] `PENDING` B에서 guest data를 기기에 유지하고 device-only badge가 B account data와만 합성되는지 확인한다.
4. [ ] `PENDING` logout 후 account A로 다시 로그인해 A의 기존 claim만 같은 batch에서 재개되는지 확인한다.
5. [ ] `PENDING` A claim 완료 뒤 logout/login해 account rows가 중복되지 않고 local guest cleanup이 유지되는지 확인한다.
6. [ ] `PENDING` staging에서 A/B account row, claim row와 profile path 첫 segment가 각 `auth.uid()`와 일치하는지 확인한다.

## Accessibility And Visual Checks

- [ ] `PENDING` iPhone 320pt와 Android 320dp에서 제목, `3 / 32`, actions와 실패 상태가 겹치지 않는다.
- [ ] `PENDING` large iPhone/Android에서 sheet가 불필요하게 full-screen card처럼 늘어나지 않는다.
- [ ] `PENDING` light/dark 모두에서 progress track/fill, device-only badge와 disabled action contrast를 확인한다.
- [ ] `PENDING` iOS largest accessibility Dynamic Type에서 text가 잘리지 않고 세로로 재배치된다.
- [ ] `PENDING` Android font scale 2.0에서 긴 한국어/영어 label과 progress가 container 밖으로 나가지 않는다.
- [ ] `PENDING` VoiceOver/TalkBack focus 순서가 title, counts, primary action, secondary action 순서로 이해 가능하다.
- [ ] `PENDING` Reduce Motion/Android remove animations에서 필수 정보를 animation에만 의존하지 않는다.
- [ ] `PENDING` completion announcement가 한 번만 읽히고 이전 account/user의 stale announcement가 나오지 않는다.

## Watch Guest/Authenticated Import Regression

Apple Watch regression은 iPhone에서 guest와 account A 상태로 각각 수행한다. Android 행으로 대체하지 않는다.

1. [ ] `PENDING` paired Apple Watch에서 새 session을 기록하고 iPhone foreground import를 완료한다.
2. [ ] `PENDING` mobile local repository 저장 뒤에만 Watch가 `synced`로 바뀌는지 확인한다.
3. [ ] `PENDING` Supabase를 offline으로 둬도 mobile local import ACK가 cloud sync/claim과 독립적으로 완료되는지 확인한다.
4. [ ] `PENDING` guest import는 guest partition, authenticated import는 account A partition에 저장되는지 확인한다.
5. [ ] `PENDING` logout 직전/직후 payload가 account B나 잘못된 principal에 publish되지 않는지 확인한다.
6. [ ] `PENDING` Watch contract/artifact에 account `userId`, Supabase token 또는 remote object path가 추가되지 않았는지 확인한다.
7. [ ] `PENDING` 8,000 sample artifact 하나를 받은 뒤 수동 가져오기 중 탭 전환과 버튼 입력이 멈추지 않고, JS에 전달되는 preview가 최대 160개인지 진단 로그로 확인한다.
8. [ ] `PENDING` 처리할 수 없는 artifact 다음에 정상 artifact를 같은 inbox batch에 두고, 첫 실패가 두 번째 local import와 ACK를 막지 않는지 확인한다.
9. [ ] `PENDING` prepared profile 채택 중 I/O 실패를 재현할 수 있으면 원본 inbox artifact가 drop-ACK되지 않고 재실행 뒤 같은 payload로 성공하는지 확인한다. 지원되는 fault setup이 없으면 자동 gate를 authoritative 결과로 기록한다.
10. [ ] `PENDING` Watch import 도중 background/foreground와 force-quit/relaunch를 각각 수행해 원본 또는 prepared source가 ACK 전에 사라지지 않는지 확인한다.
11. [ ] `PENDING` 같은 8,000 sample 가져오기를 Release configuration에서도 반복하고, 부팅 직후·수동 가져오기 중 탭 전환과 버튼 반응이 막히지 않는지 Debug 관찰과 구분해 기록한다.

## 완료 Claim 압축과 재실행 Regression

1. [ ] `PENDING` profile을 포함한 guest claim을 완료하고 local guest row/profile과 claim sidecar가 정리되는지 확인한다.
2. [ ] `PENDING` historical claim identity 15개가 있는 완료 영수증과 새 eligible guest row 1개를 함께 준비하고, 가져오기 UI가 과거 15개가 아니라 현재 1개만 대상으로 표시하는지 확인한다.
3. [ ] `PENDING` 완료 뒤 앱을 완전히 종료해 세 번 cold launch하고, 과거 전체 항목 수가 `15 / 15` 같은 새 가져오기 진행률로 다시 표시되지 않는지 확인한다.
4. [ ] `PENDING` 완료 영수증에는 historical Watch identity만 남고 full snapshot/profile bytes가 local metadata envelope에 남지 않는지 확인한다.
5. [ ] `PENDING` 같은 Watch artifact를 재전송해 새 Logbook row나 toast 없이 historical acknowledgement만 수행하는지 확인한다.
6. [ ] `PENDING` schema 1 committed fixture를 사용할 수 있는 내부 build에서는 첫 read 뒤 schema 2 compact receipt로 전환되고 account row 재업로드가 발생하지 않는지 확인한다. 공개 UI에서 fixture를 만들 수 없으면 자동 gate를 authoritative 결과로 기록한다.

## 종료 판정

- [ ] `PENDING` 모든 필수 physical 행에 device/OS, viewport, build SHA, account alias와 실행 시각을 기록했다.
- [ ] `PENDING` 24 logs + 8 plans의 account remote/local count, relation과 적용 가능한 profile digest가 일치한다.
- [ ] `PENDING` exact progress, resume, offline retry, corrupt profile, keep-on-device, Settings retry, completion local cleanup과 second-account isolation을 자동 gate와 physical evidence로 구분해 기록했다.
- [ ] `PENDING` committed remote claim rows/profile objects가 보존되고 finalizer post-commit cleanup이 없음을 확인했다.
- [ ] `PENDING` iPhone/Android 접근성과 iPhone Watch guest/authenticated regression이 통과했다.

Hosted staging deployment와 automated verifier는 `PASS`다. 모든 physical 항목, production Supabase, post-commit claim evidence lifecycle cleanup과 앱 내 즉시 영구 account deletion은 현재 `PENDING` release gate다.
