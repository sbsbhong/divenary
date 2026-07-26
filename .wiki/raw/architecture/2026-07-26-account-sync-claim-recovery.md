# Account sync and claim recovery evidence

Date: 2026-07-26

## Reported behavior

- Guest log 한 건을 로그인 뒤 가져오면 progress는 `1 / 1`이지만 결과는 실패로 남았다.
- Guest inventory를 모두 삭제해도 Home account-data recovery Alert가 계속 남았다.
- 같은 account로 로그인한 iPhone과 simulator가 상대 기기에서 만든 cloud log를
  내려받지 못했다.

## Runtime evidence

Simulator의 persisted claim checkpoint는 다음 상태였다.

- manifest status: `failed`
- item completion: `1 / 1`
- error code: `remote_conflict`
- failure phase: `finalizing`
- remote batch id와 target record id 존재

따라서 guest source snapshot과 remote staging은 완료됐고, 실패 지점은 finalizer
commit 이후 committed row readback, account-local publication, 또는 그 readback
경계다.

Simulator의 별도 account outbox conflict는 initial upsert 형태였다.

- local row는 remote id와 owner를 가졌지만 remote revision은 없었다.
- server remote row는 같은 remote/local id와 revision 1을 가졌다.
- canonical payload와 digest는 local 의도와 동일했다.

Coordinator가 conflict를 저장하기 전에 remote parser가 timestamp를 ISO `Z` 형태로
정규화하므로 raw PostgREST timestamp representation은 conflict checkpoint에 남지
않는다.

## Code evidence

### Timestamp roundtrip

- Account payload producer는 Unix seconds를 `Date#toISOString()`으로 바꾸고 그
  문자열을 canonical digest에 포함한다.
- PostgreSQL `timestamptz`를 거친 row는 같은 순간을 offset이나 다른 fractional
  precision으로 반환할 수 있다.
- Account repository save result는 outbound fields와 raw DB row를 exact string으로
  비교했다.
- Guest claim committed readback은 relationship target만 snapshot 값으로 치환하고
  timestamp를 normalize하지 않은 채 digest를 다시 계산했다.
- Generic account remote parser에는 timestamp normalization이 이미 존재했다.

따라서 DB insert/finalize가 성공해도 의미상 같은 timestamp string representation
차이가 false conflict를 만들 수 있었다.

### Claimed profile path

- Normal account Watch profile path:
  `user/logs/remoteId/contentRevision.json`
- Guest claim Watch profile path:
  `user/claims/batchId/targetRecordId/contentRevision.json`
- Claim finalizer는 claim object를 복사하지 않고 두 번째 path를 final
  `dive_logs.profile_path`로 보존한다.
- Generic hydration은 첫 번째 path prefix만 허용했다.

Claim된 Watch log 한 건이 있으면 다른 기기의 hydration이 path validation에서
중단될 수 있었다.

### Claimed relationship digest

Guest claim snapshot 시점에는 related plan/log의 final target UUID를 알 수 없다.
따라서 source/converted relation은 `null`인 payload로 digest를 만든다. Finalizer는
database foreign key에는 실제 target UUID를 기록한다.

Claim-specific readback verifier는 UUID relation을 먼저 확인한 뒤 snapshot의 null
relation으로 되돌려 digest를 검사한다. Generic hydration parser에는 이 compatibility
규칙이 없어 relation-bearing claimed row를 malformed digest로 거부했다.

### Missing remote pull and sticky recovery

- Remote hydration은 account provider bootstrap에서만 실행됐다.
- Foreground 복귀와 local save는 outbox drain만 실행했다.
- Logbook/Planbook refresh는 local repository query만 refetch했다.
- 초기 hydration 실패가 bootstrap을 `remoteHydration/degraded`로 만든 뒤, 성공한
  후속 drain은 hydrate를 재실행하거나 degraded stage를 ready로 되돌리지 않았다.

이는 한 번의 claimed-row compatibility failure가 cross-device cloud 누락과 Home
Alert 고착을 함께 만드는 구조다.

## Chosen correction

- DB timestamp mapper는 canonical ISO를 반환한다.
- Persisted timestamp equality는 strict timestamp grammar를 통과한 같은 instant에
  한해 semantic equality를 허용한다.
- Claim committed readback은 normal remote parser의 schema/timestamp/digest 검증을
  재사용한다.
- Generic parser는 exact digest를 우선하고, relation UUID를 null로 되돌린 legacy
  claim digest만 제한적으로 허용한다.
- Profile hydration은 owner, batch UUID, remote record id, content revision이 모두
  일치하는 canonical `/claims/` path를 기존 `/logs/` path와 함께 허용한다.
- Foreground hydration은 이미 synced인 Watch row와 canonical local profile key가
  정확히 같고 cached full profile의 session ID, byte count, SHA-256, sample count를
  다시 검증한 경우 remote profile download/write를 반복하지 않는다. Cache가 없거나
  손상됐으면 remote object를 다시 검증해 복구한다.
- Foreground와 explicit screen refresh는 coalesced remote hydration을 수행한다.
  Local mutation의 immediate sync는 push-only를 유지한다.
- 성공한 recovery는 같은 bootstrap issue stage만 해제한다.
- Remote와 local domain content가 동일한 historical conflict만 synced로 정리한다.
  Divergent conflict는 보존한다.
- Malformed remote row는 저장하지 않되 다른 정상 row/type publication을 막지 않도록
  failure를 격리한다.

## Verification boundary

Hosted staging guest-claim verifier는 finalizer, RLS, owner isolation, profile object,
relation publish와 rollback을 통과했다. 기존 verifier는 mobile mapper와 digest parser를
통과하지 않으므로 이 문제를 검출하지 못했다.

Correction은 PostgREST-shaped offset/microsecond timestamp, finalizer-shaped relation
row, claim profile path, foreground pull, equivalent conflict recovery를 mobile/package
tests로 직접 검증해야 한다. Physical iPhone↔simulator convergence는 자동 gate 뒤
사용자 재검증 대상으로 남는다.
