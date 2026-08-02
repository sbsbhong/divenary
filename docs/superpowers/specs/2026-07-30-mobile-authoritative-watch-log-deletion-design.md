# Mobile-Authoritative Watch Log Deletion Design

Date: 2026-07-30

## 문제와 확인된 원인

모바일에서 이미 삭제한 Watch 로그가 실패한 guest claim을 재시도한 뒤 계정
로그로 다시 나타났고, 전체 로그 수가 11개에서 26개로 증가했다.

실기기 저장소와 staging readback으로 확인한 흐름은 다음과 같다.

- 실패한 claim checkpoint에는 Watch 로그 15개의 immutable snapshot과 완료된
  upload receipt가 남아 있었다.
- 재시도 직전 live guest Logbook에는 별도의 새 로그 1개만 있었고, snapshot의
  15개 로그는 이미 모바일에서 삭제된 상태였다.
- `GuestClaimService.retry()`는 live guest inventory를 새로 구성하지 않고 기존
  snapshot의 완료된 upload receipt를 재사용해 곧바로 finalization을 재개했다.
- Remote commit 뒤 `writeAccountSnapshot()`은 현재 guest source 존재 여부와 관계없이
  snapshot 15개를 모두 account local repository에 게시했다.
- 원래 account 11개에 claim batch의 신규 14개, canonical reuse 1개, 별도 새 guest
  claim 1개가 반영되어 최종 26개가 됐다.

따라서 15개는 Watch가 다시 전송해서 생긴 것이 아니다. 모바일 삭제 의도가
claim snapshot에 전달되지 않아 삭제된 로그가 계정 데이터로 부활한 것이 직접
원인이다.

별도로 현재 모바일 삭제는 guest local row를 지우거나 account remote soft-delete를
outbox에 넣을 뿐이다. Watch에는 삭제 명령을 보내지 않는다. Watch는 동기화된
세션과 profile artifact를 계속 보존하므로 두 기기의 삭제 상태도 일치하지 않는다.

## 목표

- 모바일을 로그 삭제의 유일한 사용자 조작 지점으로 둔다.
- 모바일에서 Watch 로그 삭제를 확정하면 로컬, account cloud, 연결된 Watch에서
  같은 logical session을 결국 삭제한다.
- 삭제 의도를 실제 row 삭제보다 먼저 영속화하고, 앱 종료·오프라인·전송 재시도
  뒤에도 삭제된 Watch session이 다시 import되거나 claim으로 게시되지 않게 한다.
- 실패했거나 진행 중인 guest claim snapshot이 삭제된 항목을 포함하면 기존 batch를
  원격에서 최종화 불가능한 상태로 바꾼 뒤 삭제 항목을 제외한 fresh snapshot만
  사용할 수 있게 한다.
- Watch가 삭제 명령을 여러 번 받거나 대상이 이미 없어도 같은 성공 결과를
  반환하는 idempotent protocol을 만든다.
- 기존 account local-first/outbox soft-delete와 Watch import acknowledgement 의미를
  유지한다.

## 비목표

- 이번 범위에서 Watch 삭제 gesture, swipe action, 상세 화면 삭제 버튼을 만들지
  않는다.
- 모바일 수동 로그는 Watch에 존재하지 않으므로 Watch 삭제 명령을 보내지 않는다.
- `WatchSession` 측정 payload나 `packages/contracts`의 session JSON schema 의미를
  바꾸지 않는다. 삭제 명령은 기존 acknowledgement/planned-dive와 같은
  WatchConnectivity control envelope다.
- 이미 삭제 의도가 유실된 과거 로그를 추정해서 자동 삭제하지 않는다. 현재
  부활한 로그는 기능 배포 뒤 사용자가 모바일에서 다시 삭제해야 하며, 그 삭제부터
  두 기기에 전파된다.
- production Supabase에는 검증 없이 배포하지 않는다.
- 감압, 상승, 비상 판단 같은 safety-critical 기능을 추가하지 않는다.

## 검토한 접근

### A. Watch에서 synced session 즉시 자동 삭제

모바일 import ACK 뒤 Watch artifact를 즉시 없애면 저장 공간 문제는 줄지만,
ACK는 iPhone local repository commit만 뜻한다. Account cloud sync나 사용자의
삭제 의도와 관계없는 자동 삭제가 되어 offline recovery source를 잃는다.

### B. 모바일 삭제 때 일회성 Watch 명령만 전송

변경량은 작지만 Watch가 오프라인이거나 앱이 종료되면 명령이 유실될 수 있다.
이미 queued된 artifact가 뒤늦게 도착하면 모바일 로그도 다시 생긴다. 실패한 claim
snapshot의 재게시도 막지 못한다.

### C. 영구 삭제 묘비와 양방향 acknowledgement

모바일에 persistent tombstone을 먼저 쓰고 local/account 삭제, claim invalidation,
Watch command delivery를 각각 idempotent하게 재시도한다. Watch도 session tombstone을
먼저 기록한 뒤 manifest와 artifact를 지우고 ACK한다. Mobile import와 claim은
tombstone을 fail-closed filter로 사용한다.

이 접근을 채택한다. 삭제 경로가 세 군데로 나뉘더라도 하나의 durable intent가
모든 복구 경로를 제어하므로 재생성을 막을 수 있다.

## 삭제 권한과 식별자

사용자 조작 권한은 모바일에만 있다. Watch는 모바일에서 받은 삭제 명령을
실행하고 ACK할 뿐 자체 삭제 UI를 제공하지 않는다.

삭제의 logical identity는 `localSessionId`다.

- `localSessionId`는 Watch session 생성 시 정해지고 같은 logical session의 모든
  artifact에서 유지된다.
- `contentRevision`과 artifact 전체 bytes의 `artifactSha256`은 삭제 요청 당시의
  exact artifact evidence로 함께 저장하고 전송한다.
- Watch의 현재 artifact가 요청의 revision/hash와 다르더라도 `localSessionId`가
  같으면 같은 logical session으로 보고 삭제한다. 현재 모델에서 같은 UUID를
  새로운 다이빙에 재사용하지 않기 때문이다.
- 삭제된 `localSessionId`로 다른 revision이 나중에 도착하면 정상 새 로그로
  받아들이지 않고 삭제된 session의 stale/corrupt retransmission으로 폐기한다.
- 새 다이빙은 항상 새 `localSessionId`를 생성하므로 이전 tombstone의 영향을
  받지 않는다.

## 모바일 삭제 묘비

device-wide `WatchLogDeletionStore`를 추가한다. Guest/account principal이 바뀌어도
같은 Watch session 삭제 의도가 유지되어야 하므로 principal partition 안에 넣지
않는다.

```ts
type WatchLogDeletionTombstone = {
  schemaVersion: 1;
  localSessionId: string;
  requestedAt: number;
  sourceLocalIds: string[];
  expectedArtifact?: {
    contentRevision: string;
    artifactSha256: string;
  };
  watchAcknowledgedAt?: number;
};
```

Store는 `localSessionId`로 unique하며 같은 삭제 요청은 기존 항목에 local ID와
더 완전한 artifact evidence를 합친다. ACK는 delivery 상태만 갱신하고 tombstone을
지우지 않는다. 자동 retention/pruning은 이번 범위에서 하지 않는다.

각 단계의 완료 여부를 별도 enum으로 복제하지 않는다. 재조정 시 repository row,
claim checkpoint, native pending command를 다시 읽어 실제 남은 작업을 계산한다.
이렇게 해야 앱이 단계 사이에서 종료되어도 local state machine과 실제 데이터가
어긋나지 않는다.

새 삭제 API는 아래 순서를 지킨다.

1. 대상 로그를 읽고 `localSessionId`, `contentRevision`,
   `artifactSha256 ?? sha256`을 캡처한다.
2. tombstone을 atomic write하고 readback으로 확인한다.
3. 해당 principal의 claim/delete mutation gate에 들어간다.
4. 교차하는 noncommitted claim을 invalidate한다.
5. 현재 composed repository를 다시 읽고 guest local delete 또는 기존 account
   local-first/outbox delete를 실행한다.
6. native Watch deletion command를 durable queue에 넣는다.
7. Logbook query cache를 갱신하고 account sync를 요청한다.

1~2가 실패하면 row를 삭제하지 않는다. Tombstone이 저장된 뒤 3~7 중 하나가
실패하면 삭제 의도는 되돌리지 않는다. Tombstoned log는 repository composition과
query read에서 즉시 숨기고 foreground/bootstrap reconciliation이 남은 단계를
재시도한다.

수동 로그는 기존 delete 경로를 그대로 사용한다. Watch identity가 불완전한 legacy
Watch 로그는 최소 `localSessionId` tombstone을 저장하고 모바일/account 삭제는
진행한다. Native command는 session ID만으로 실행할 수 있으며 누락된 artifact
evidence는 진단 metadata 부재로만 취급한다.

## Claim과 삭제의 직렬화

현재 claim snapshot store만 자체 write queue를 갖고 있어 일반 Logbook delete와
`finalize()`/`writeAccountSnapshot()`은 경쟁할 수 있다. User별
`GuestClaimMutationGate`를 두고 다음 연산을 같은 queue로 직렬화한다.

- `start`, `resume`, `retry`, `finalize`, account-local publication, cleanup
- Watch log deletion의 claim inspection, abandonment, repository delete
- bootstrap deletion reconciliation

삭제가 먼저 gate를 얻으면 tombstone과 remote abandonment가 확정되기 전 claim이
재개되지 않는다. Claim이 이미 remote finalize 중이면 삭제가 기다린다. Claim이
commit/publication을 마친 뒤 삭제가 현재 account row를 다시 읽어 정상 account
delete를 enqueue하므로 최종 상태는 삭제로 수렴한다.

Import는 gate 밖에서 tombstone을 먼저 검사하므로 이 대기 중 도착한 stale artifact도
새 row를 만들지 않는다.

## Remote guest claim abandonment

### Schema

`guest_claim_batches.status`에 `abandoned`를 추가하고 nullable
`abandoned_at timestamptz`를 추가한다.

상태 invariant는 다음과 같다.

- `uploading`: `committed_at`과 `abandoned_at` 모두 null
- `committed`: `committed_at`만 존재
- `abandoned`: `abandoned_at`만 존재

Authenticated client에는 batch update/delete 권한을 추가하지 않는다. 기존 owner
select/insert와 record stage policy를 유지한다.

### Privileged transition

새 authenticated `abandon-guest-claim` Edge Function과 service-role-only
`public.abandon_guest_claim(uuid, uuid)` wrapper를 추가한다. Private function은
owner와 batch row를 lock하고 아래 결과 중 하나를 반환한다.

- `uploading` → `abandoned`: `abandoned_at` 기록
- `abandoned` → `abandoned`: idempotent success
- `committed` → `committed`: race result
- 다른 owner 또는 없는 batch: fail closed

기존 finalizer는 `uploading`만 허용하므로 abandoned batch는 어떤 stale client가
재시도해도 게시할 수 없다.

Edge Function은 현재 `finalize-guest-claim`과 같은 JWT/user 검증을 수행한다.
Database transition 뒤 service-role Storage client로 DB에 기록된 profile path를
읽고 exact `<userId>/claims/<batchId>/...` prefix만 삭제한다. Storage cleanup 실패는
batch abandonment를 되돌리지 않는다. 응답에 `storageCleanupPending`을 포함하고
같은 호출을 재시도하면 abandoned batch의 object cleanup만 다시 수행한다.
`guest_claim_records`와 batch row는 idempotency/audit evidence로 보존한다.

### Mobile checkpoint 처리

Noncommitted local snapshot의 item 중 tombstoned `localSessionId`가 하나라도 있으면
그 snapshot 전체를 그대로 finalize하지 않는다.

- `remoteBatchId`가 없으면 local checkpoint와 sidecar를 폐기한다.
- `remoteBatchId`가 있으면 remote abandonment가 `abandoned`를 반환한 뒤에만 local
  checkpoint와 sidecar를 폐기한다.
- 이후 live guest inventory를 다시 읽고 tombstoned row를 제외해 새
  `clientBatchId`/manifest snapshot을 만든다.
- 기존 claim이 실행 중이었다면 fresh snapshot으로 계속하고, 실패·deferred
  상태였다면 다음 사용자 retry/choice가 fresh inventory를 사용한다.

Abandonment 호출과 remote finalize가 경쟁해 `committed`가 반환되면 게시된 row를
되돌리려 하지 않는다. Committed batch를 readback하되 tombstoned log를 visible
account row로 노출하지 않는다. Account local base repository에 remote ID/revision을
`saveLocalOnly`로 기록한 직후 같은 gate 안에서 account delete outbox를 enqueue한다.
Query composition은 tombstone과 delete outbox 양쪽을 filter하므로 중간 row가 화면에
나타나지 않는다. Non-tombstoned item은 기존 publication/readback/cleanup을 계속한다.

새 버전이 기존 noncommitted checkpoint를 처음 읽을 때 snapshot log가 live guest와
account local 양쪽에 없으면 이전 앱에서 삭제된 것으로 간주할 수 있는지 검증한다.
확실한 Watch identity와 noncommitted remote state를 모두 확인한 경우에만 tombstone을
backfill하고 batch를 abandon한다. Account 상태를 확인할 수 없는 offline 상황에서는
추정하지 않고 claim을 일시 중단한다.

## WatchConnectivity 삭제 protocol

기존 native control envelope에 아래 kind를 추가한다.

- request: `watchSessionDeletion`
- acknowledgement: `watchSessionDeletionAcknowledgement`

Request field:

```text
formatVersion
commandId
localSessionId
contentRevision?
artifactSha256?
requestedAt
```

ACK field:

```text
formatVersion
commandId
localSessionId
result = deleted | alreadyAbsent
acknowledgedAt
removedContentRevision?
removedArtifactSha256?
```

`commandId`는 normalized request의 deterministic digest로 만든다. iPhone native
`WatchConnectivityInbox`는 pending request를 `UserDefaults`에 저장한 뒤
background `transferUserInfo`와 reachable 상태의 immediate `sendMessage`로 보낸다.
같은 command의 outstanding 여부는 background transfer 중복만 막는다. Background
transfer가 outstanding이어도 Watch가 reachable이면 `sendMessage`를 항상 시도한다.
Activation, reachability change, paired Watch state change와 app foreground에서 queue를
다시 flush한다.

Watch ACK가 오면 native pending request를 제거하고 ACK receipt를 저장한다. JS는
launch/foreground reconcile 또는 event로 receipt를 읽어 tombstone의
`watchAcknowledgedAt`을 갱신한다. JS tombstone은 유지한다.

Watch가 연결되어 있지 않아도 모바일 삭제는 성공한다. 사용자에게는
“워치가 연결되면 함께 삭제됩니다”라는 비차단 안내를 표시한다. 새 설정 화면이나
수동 retry 버튼은 이번 범위에 추가하지 않고 lifecycle retry를 사용한다.

## Watch local 삭제

Watch에도 compact `deleted-session-ids` ledger를 artifact root에 둔다.
삭제 명령을 받으면 다음 순서로 처리한다.

1. `localSessionId`를 Watch ledger에 atomic write하고 readback한다.
2. 같은 session ID의 outstanding `WCSessionFileTransfer`를 cancel한다.
3. `DiveProfileArtifactStore` manifest에서 같은 ID entry를 atomic rewrite로 제거한다.
4. 그 entry가 가리키는 artifact와 해당 session의 finalized/legacy file을 제거한다.
5. manifest에 entry가 없고 artifact가 없음을 확인한다.
6. `DiveSessionStore.sessions`에서 제거한다.
7. `deleted` ACK를 보낸다.

대상이 처음부터 없거나 같은 명령이 반복되면 absence를 확인하고
`alreadyAbsent` ACK를 보낸다. Artifact file cleanup이 실패하면 ACK하지 않고
ledger를 남긴다. 다음 launch 또는 repeated command가 cleanup을 재개한다.

Watch load/migration/save는 tombstoned session ID를 복원하지 않는다. 새 session은
새 UUID를 사용하므로 정상 recording에는 영향이 없다. 이번 작업은 finalized
history만 삭제하며 현재 active underwater recording을 remote command로 중단하지
않는다.

## Stale import 방어

Watch import coordinator는 가능한 가장 이른 시점에 tombstone을 확인한다.

1. Native descriptor에 `localSessionId`가 있으면 full artifact preparation 전에
   확인한다.
2. Legacy inline payload는 strict parse 뒤 repository write 전에 확인한다.
3. Tombstoned payload면 deletion command가 native durable queue에 존재하도록
   보장한다.
4. Payload를 imported acknowledgement로 소비해 Watch의 일반 sync retry를 멈추되
   Logbook에는 저장하지 않는다.
5. `importedCount`에는 포함하지 않고 내부 결과를 `discardedDeleted`로 기록한다.

Repository import entry point에도 같은 filter를 넣어 UI coordinator를 우회한 test,
fixture 또는 future caller가 deleted session을 다시 저장할 수 없게 한다.

Account hydration은 remote soft-deleted row를 기존처럼 제외한다. Tombstoned
`localSessionId`와 일치하는 active remote row가 발견되면 화면에 게시하지 않고
account delete reconciliation 대상으로 넘긴다.

## 데이터 정리와 보존

- Guest local row/profile은 tombstone readback 뒤 기존 delete semantics로 제거한다.
- Account row는 즉시 화면에서 숨기고 기존 outbox가 remote soft-delete readback 뒤
  local metadata/profile을 제거한다.
- Abandoned claim profile object는 Edge Function이 service role로 exact prefix만
  삭제한다.
- Abandoned DB batch/record는 stale finalize 방지와 audit를 위해 보존한다.
- Mobile/Watch deleted-session ledger는 자동 삭제하지 않는다.
- Watch normal import ACK는 계속 “iPhone local repository commit 또는 tombstone에
  의한 의도적 consume 완료”만 뜻한다. Account cloud delete 완료를 뜻하지 않는다.

## 오류와 복구

- Tombstone persistence 실패: 어떤 삭제도 시작하지 않고 사용자에게 실패를
  반환한다.
- Guest/account repository delete 실패: UI에서는 tombstone으로 숨긴 채 foreground
  reconciliation이 재시도한다.
- Claim abandonment network failure: old snapshot finalize를 차단하고 tombstone을
  유지한다. 연결 복구 뒤 abandon부터 재개한다.
- Claim abandonment가 `committed`를 반환: hidden account delete race path를 실행한다.
- Watch offline 또는 command delivery failure: pending native command와 tombstone을
  유지하고 lifecycle event에서 재시도한다.
- Watch artifact delete failure: ACK하지 않고 Watch ledger에서 재개한다.
- Stale Watch file arrival: consume/ACK하되 repository에는 저장하지 않고 delete
  command를 재확인한다.
- Tombstone storage corruption: fail closed로 해당 store를 quarantine하고 사용자
  삭제/Watch import를 중단한다. 손상된 상태에서 deleted session을 정상 import로
  간주하지 않는다.

## 호환성과 rollout

- 기존 수동 로그와 non-Watch account/guest delete는 변경하지 않는다.
- 기존 Watch history는 삭제 명령을 받기 전까지 유지한다.
- 기존 failed noncommitted claim은 확실한 local absence와 remote state를 검증한
  경우에만 abandonment migration을 수행한다.
- Supabase migration, generated database types, remote repository와 Edge Function을
  먼저 local에서 검증한다.
- Staging `mclvhwzsuvsxjerdouka`에 migration/Function을 올리고 hosted verifier를
  통과한 뒤 physical iPhone/Watch gate를 진행한다.
- Production은 별도 승인 전까지 건드리지 않는다.

## 검증

### Mobile unit/integration

- Watch 로그 delete는 tombstone write/readback 전에 repository를 건드리지 않는다.
- Tombstone 뒤 repository/bridge failure가 나도 목록과 detail에서 로그가 다시
  나타나지 않는다.
- Guest delete, account synced delete, account pending-upsert delete가 기존 outbox
  semantics로 수렴한다.
- Manual log delete는 Watch command를 만들지 않는다.
- Tombstoned native descriptor는 full profile prepare/hash 없이 consume된다.
- Legacy inline payload와 direct repository import도 tombstoned session을 저장하지
  않는다.
- 동일 삭제를 반복해도 tombstone과 native command가 하나만 존재한다.
- 관찰된 회귀 fixture를 재현한다: finalizing 실패 snapshot 15개 중 live guest에서
  삭제된 Watch item은 old batch를 abandon하고 fresh inventory에서 제외되며
  `writeAccountSnapshot()`으로 부활하지 않는다.
- Finalize/abandon race가 committed로 끝나도 tombstoned row는 visible publication
  없이 delete outbox로 전환된다.

### Supabase

- Owner만 자신의 batch를 abandon할 수 있고 authenticated role이 table을 직접
  update/delete할 수 없다.
- `uploading → abandoned`와 repeated abandon이 idempotent하다.
- Abandoned batch finalize는 전체 rollback된다.
- Committed batch abandon은 committed를 반환하고 데이터를 바꾸지 않는다.
- Storage cleanup은 exact owner/batch prefix만 지우며 실패 뒤 재시도할 수 있다.
- Hosted verifier가 abandonment, stale finalizer rejection, fresh replacement batch,
  cross-owner denial과 fixture cleanup을 검증한다.

### Watch/native

- Session ID delete가 manifest, artifact, UI session을 제거한다.
- Request revision/hash와 current artifact가 달라도 같은 session ID를 삭제하고 실제
  removed identity를 ACK한다.
- Already-absent와 duplicate command가 idempotent ACK를 보낸다.
- Outstanding file transfer가 cancel되고, 이미 도착한 file은 mobile tombstone에서
  폐기된다.
- Artifact remove 실패와 process restart 뒤 Watch ledger가 cleanup을 재개한다.
- Tombstoned legacy/session migration과 save가 기록을 복원하지 않는다.

### Verification gates

- Focused Jest red/green tests
- Native Swift source-boundary tests
- Supabase pgTAP/REST/Edge Function tests
- `yarn check:quick`
- `yarn mobile:typecheck`
- 관련 mobile Jest suite와 full mobile Jest
- `yarn ios:build`
- `yarn watch:build`
- `yarn codex:check`
- hosted staging verifier

### Physical iPhone/Watch gate

1. Watch demo session을 만들고 iPhone/account에 동기화한다.
2. iPhone에서 로그를 삭제한다.
3. iPhone 목록에서 즉시 사라지고 account remote row가 soft-delete되는지 확인한다.
4. 연결된 Watch 목록에서도 같은 session이 사라지는지 확인한다.
5. 양쪽 앱을 재시작하고 로그가 복원되지 않는지 확인한다.
6. Watch를 offline으로 둔 채 다른 로그를 iPhone에서 삭제하고, reconnect 뒤 Watch
   삭제가 적용되는지 확인한다.
7. 같은 session의 stale artifact fixture를 다시 전달해 iPhone에 재생성되지 않는지
   확인한다.
8. Noncommitted claim snapshot에 포함된 Watch log를 삭제한 뒤 retry해 old batch가
   abandoned되고 progress total과 최종 account inventory에 삭제 항목이 없는지
   확인한다.

실기기 연결이 필요한 시점에는 구현을 멈추고 사용자에게 연결을 요청한다.

2026-08-02 검증에서는 로그아웃 상태의 Watch demo session을 모바일에 동기화한 뒤
로그인했다. 기기 데이터 가져오기는 과거 checkpoint의 15개가 아니라 현재 1개와
`1/1` progress를 표시했고, account import 완료 뒤 모바일 삭제가 Watch saved
session까지 제거했다. 별도 guest 삭제는 ACK queue 정리와 양쪽 앱 재실행 뒤
비부활을 통과했다. Radio-off 시도는 `reachable=false`에서 background transfer가
등록됐지만 WatchConnectivity가 수동 reconnect 전에 전달했으므로 durable delivery와
ACK 수렴 증거로만 기록하며, reconnect 이후에만 전달되는 통제된 지연 증거로
과장하지 않는다.

## Durable documentation

구현 완료 뒤 source evidence를 `.wiki/raw/architecture/`에 추가하고
`.wiki/wiki/architecture/sync-flow.md`,
`.wiki/wiki/architecture/mobile.md`,
`.wiki/wiki/architecture/watch-app.md`,
`.wiki/wiki/architecture/supabase.md`,
`.wiki/wiki/domains/dive-log.md`, index와 log를 갱신한다.

문서에서는 mobile deletion intent, Watch artifact removal, account cloud soft-delete,
guest claim abandonment를 서로 다른 idempotent 경계로 구분한다.
