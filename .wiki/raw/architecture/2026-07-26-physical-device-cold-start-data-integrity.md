Source URL: docs/superpowers/specs/2026-07-26-physical-device-cold-start-data-integrity-design.md
Collected: 2026-07-26
Published: 2026-07-26

# Physical device cold start and data integrity

실기기 cold start에서 Core Location의 일시적 `POSITION_UNAVAILABLE`을
최종 실패로 처리하던 경로를 bounded retry로 바꾼다. Logbook과 Planbook의
durable JSON 검증 실패는 빈 배열 fallback을 사용하지 않고 exact raw
quarantine과 recovery-required 상태로 전환한다. Remote hydration, outbox
reconciliation과 claim cleanup은 selected principal의 local repository
검증이 끝난 뒤에만 시작한다.

WatchConnectivity pending artifact는 `localSessionId`, `contentRevision`,
artifact `sha256` identity로 처리한다. Inactive claim history의 exact
artifact이고 live guest source가 없으면 삭제된 row를 다시 만들지 않고
imported acknowledgement만 보낸다. 새 artifact는 개수 제한 없이 모두
local commit 뒤 acknowledge한다.

iOS native inbox의 file materialization, JSON encode와 UserDefaults write는
전용 serial queue에서 실행한다. 자동 Watch drain과 account hydration은
local UI publication과 first interactions 뒤 시작하며 payload/remote row
사이에 cooperative yield를 둔다. 이 변경은 Watch local acknowledgement와
account cloud sync 의미를 합치지 않고 Supabase schema, RLS, Storage path와
Watch contract를 변경하지 않는다.

자동 검증은 durable read failure의 exact-byte 보존, journal crash boundary,
두 개의 새 Watch artifact, historical duplicate와 새 artifact 조합,
transient location recovery, interaction scheduler ordering, native off-main
source boundary를 포함한다. 실기기 검증은 cold launch 3회, sync 중 tab과
logout 입력, pending inbox reconciliation을 별도 확인한다.
